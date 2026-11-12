// Content script chạy trên trang Udemy: lấy sub tiếng Anh, dịch, hiển thị đè lên video.

const PROMPT_VERSION = 1;
const BATCH_SIZE = 40;
const PARALLEL_BATCHES = 3;
const MAX_RETRIES = 2;
const DEFAULT_FONT_SCALE = 75; // % so với cỡ gốc

const SYSTEM_PROMPT = `You translate subtitles of an English IT / programming video course into Vietnamese.

Rules:
- Write natural spoken Vietnamese, as if the instructor is talking to the students: refer to the instructor as "mình" and to learners as "các bạn" where it fits. Friendly, concise, easy to read quickly as a subtitle.
- Keep technical terms in English (e.g. function, component, state, props, deploy, request, response, database, framework, library, array, object, class, method, server, API, endpoint, build, debug...). Never translate code, identifiers, file names, commands, keyboard shortcuts or product names.
- Use the full transcript below as context: resolve "it/this/that", fix speech fragments and filler words, translate the meaning instead of word by word.
- Each input item is one sentence (sometimes a fragment). Translate each item separately. Never merge, split, skip or reorder items. Every input id must appear exactly once in the output.
- Output JSON only, in this exact shape: {"items":[{"id":0,"vi":"..."}]}`;

const log = (...a) => console.log('[UVS]', ...a);

// ---------- Tiện ích ----------

async function bg(msg) {
  const r = await chrome.runtime.sendMessage(msg);
  if (!r) throw new Error('Không nhận được phản hồi từ extension (thử tải lại trang)');
  if (r.error) throw new Error(r.error);
  return r.data;
}

async function pool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let settings = { enabled: true };
chrome.storage.local.get('settings').then(({ settings: s }) => { settings = { enabled: true, ...s }; });
chrome.storage.onChanged.addListener(ch => {
  if (ch.settings) settings = { enabled: true, ...ch.settings.newValue };
});

// ---------- Udemy API ----------

function apiHeaders() {
  const h = { Accept: 'application/json, text/plain, */*' };
  const m = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
  if (m) {
    h.Authorization = 'Bearer ' + m[1];
    h['X-Udemy-Authorization'] = 'Bearer ' + m[1];
  }
  return h;
}

async function udemyApi(pathOrUrl) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : location.origin + '/api-2.0/' + pathOrUrl;
  const res = await fetch(url, { credentials: 'include', headers: apiHeaders() });
  if (!res.ok) throw new Error(`Udemy API lỗi HTTP ${res.status}`);
  return res.json();
}

function parseLectureUrl() {
  const m = location.pathname.match(/\/course\/([^/]+)\/learn\/lecture\/(\d+)/);
  return m ? { slug: m[1], lectureId: m[2] } : null;
}

const courseCache = {};
async function getCourse(slug) {
  if (courseCache[slug]) return courseCache[slug];
  let course = null;
  try {
    const c = await udemyApi(`courses/${slug}/?fields[course]=id,title`);
    course = { id: String(c.id), title: c.title || '' };
  } catch (e) {
    // Dự phòng: Udemy nhúng courseId trong data-module-args của trang học
    for (const el of document.querySelectorAll('[data-module-args]')) {
      try {
        const args = JSON.parse(el.getAttribute('data-module-args'));
        if (args.courseId) { course = { id: String(args.courseId), title: '' }; break; }
      } catch {}
    }
    if (!course) throw e;
  }
  return (courseCache[slug] = course);
}

function pickEnglishCaption(captions) {
  const en = (captions || []).filter(c => /^en/i.test(c.locale_id || ''));
  return en.find(c => c.source === 'manual') || en[0] || null;
}

async function getLecture(courseId, lectureId) {
  const l = await udemyApi(
    `users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?fields[lecture]=title,asset&fields[asset]=captions`
  );
  return { title: l.title || '', caption: pickEnglishCaption(l.asset?.captions) };
}

async function getCurriculum(courseId) {
  const lectures = [];
  let url = `courses/${courseId}/subscriber-curriculum-items/?page_size=200&fields[lecture]=title,asset&fields[asset]=captions&fields[chapter]=title&fields[quiz]=title&fields[practice]=title`;
  while (url) {
    const page = await udemyApi(url);
    for (const item of page.results || []) {
      if (item._class !== 'lecture') continue;
      const caption = pickEnglishCaption(item.asset?.captions);
      if (caption) lectures.push({ lectureId: String(item.id), title: item.title || '', caption });
    }
    url = page.next;
  }
  return lectures;
}

// ---------- Dịch ----------

const cacheKey = (courseId, lectureId, caption) =>
  `tr:v${PROMPT_VERSION}:${courseId}:${lectureId}:${caption.id || caption.locale_id}`;

async function getCached(key) {
  const r = await chrome.storage.local.get(key);
  return r[key] || null;
}

async function translateBatch(contextMsg, batch) {
  const input = JSON.stringify({ items: batch.map(g => ({ id: g.id, en: g.en })) });
  let result = {};
  let missing = batch;
  for (let attempt = 0; attempt <= MAX_RETRIES && missing.length; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    try {
      const content = await bg({
        type: 'deepseek',
        messages: [
          { role: 'system', content: contextMsg },
          { role: 'user', content: attempt ? JSON.stringify({ items: missing.map(g => ({ id: g.id, en: g.en })) }) : input }
        ]
      });
      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
      for (const it of items) {
        if (it && typeof it.vi === 'string' && it.vi.trim()) result[it.id] = it.vi.trim();
      }
    } catch (e) {
      log('batch lỗi', e.message);
      // Lỗi key / hết tiền thì thử lại cũng vô ích
      if (/API key|hết tiền/.test(e.message)) throw e;
      if (attempt === MAX_RETRIES && !Object.keys(result).length) throw e;
    }
    missing = batch.filter(g => !(g.id in result));
  }
  return result;
}

const inflight = new Map();

// Dịch 1 bài giảng; có cache và gộp các lần gọi trùng nhau
function translateLecture(job, onProgress) {
  const key = cacheKey(job.courseId, job.lectureId, job.caption);
  if (inflight.has(key)) {
    const p = inflight.get(key);
    if (onProgress) p.listeners.push(onProgress);
    return p.promise;
  }
  const entry = { listeners: onProgress ? [onProgress] : [], promise: null };
  entry.promise = (async () => {
    const cached = await getCached(key);
    if (cached) return cached.groups;

    const vtt = await bg({ type: 'fetchText', url: job.caption.url });
    const groups = groupCues(parseVtt(vtt));
    if (!groups.length) throw new Error('Phụ đề tiếng Anh rỗng');

    const transcript = groups.map(g => g.en).join(' ');
    const contextMsg = `${SYSTEM_PROMPT}

Course: ${job.courseTitle || '(unknown)'}
Lecture: ${job.lectureTitle || '(unknown)'}

Full transcript of this lecture (context only):
"""
${transcript}
"""`;

    const batches = [];
    for (let i = 0; i < groups.length; i += BATCH_SIZE) batches.push(groups.slice(i, i + BATCH_SIZE));
    let done = 0;
    const report = () => entry.listeners.forEach(fn => fn(done, batches.length));
    report();

    const vi = {};
    await pool(batches, PARALLEL_BATCHES, async batch => {
      Object.assign(vi, await translateBatch(contextMsg, batch));
      done++;
      report();
    });

    // Câu nào AI vẫn bỏ sót thì giữ tiếng Anh
    const out = groups.map(g => ({ start: g.start, end: g.end, text: vi[g.id] || g.en }));
    await chrome.storage.local.set({
      [key]: { groups: out, lectureTitle: job.lectureTitle, savedAt: Date.now() }
    });
    return out;
  })();
  inflight.set(key, entry);
  entry.promise.finally(() => inflight.delete(key));
  return entry.promise;
}

// ---------- Hiển thị trên video ----------

let current = null; // { lectureId, state: loading|ready|nosub|error, msg, groups, errorAt }
let pausedByUs = false;
let overlay = null;
const hookedVideos = new WeakSet();

function getVideo() {
  return document.querySelector('video');
}

function ensureOverlay(video) {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'uvs-overlay';
    overlay.innerHTML = '<div class="uvs-status"></div><div class="uvs-sub"></div>';
  }
  const parent = video.parentElement;
  if (parent && overlay.parentElement !== parent) {
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(overlay);
  }
}

function setText(sel, text) {
  const el = overlay.querySelector(sel);
  if (el.textContent !== text) el.textContent = text;
}

function hookVideo(video) {
  if (hookedVideos.has(video)) return;
  hookedVideos.add(video);
  video.addEventListener('play', () => {
    if (settings.enabled && current?.state === 'loading') {
      video.pause();
      pausedByUs = true;
    }
  });
}

function resumeIfPaused() {
  if (!pausedByUs) return;
  pausedByUs = false;
  getVideo()?.play().catch(() => {});
}

async function startLecture(slug, lectureId) {
  const me = { lectureId, state: 'loading', msg: 'Đang tải phụ đề tiếng Anh...', groups: null };
  current = me;
  pausedByUs = false;
  try {
    const course = await getCourse(slug);
    const lec = await getLecture(course.id, lectureId);
    if (current !== me) return;
    if (!lec.caption) {
      me.state = 'nosub';
      return;
    }
    me.groups = await translateLecture(
      { courseId: course.id, courseTitle: course.title, lectureId, lectureTitle: lec.title, caption: lec.caption },
      (done, total) => { me.msg = `Đang dịch bài giảng... ${done}/${total}`; }
    );
    me.state = 'ready';
  } catch (e) {
    log(e);
    me.state = 'error';
    me.msg = 'Vietsub AI lỗi: ' + e.message;
    me.errorAt = Date.now();
  }
  if (current === me) resumeIfPaused();
}

function findGroup(groups, t) {
  let lo = 0, hi = groups.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const g = groups[mid];
    if (t < g.start) hi = mid - 1;
    else if (t >= g.end) lo = mid + 1;
    else return g;
  }
  return null;
}

function tick() {
  const loc = settings.enabled ? parseLectureUrl() : null;
  const active = loc && current && current.lectureId === loc.lectureId;

  if (!loc) {
    current = null;
    document.documentElement.classList.remove('uvs-hide-native');
    overlay?.remove();
    return;
  }
  if (!active) startLecture(loc.slug, loc.lectureId);

  const hideNative = current.state === 'loading' || current.state === 'ready';
  document.documentElement.classList.toggle('uvs-hide-native', hideNative);

  const video = getVideo();
  if (!video) return;
  hookVideo(video);
  ensureOverlay(video);
  overlay.style.setProperty('--uvs-scale', (settings.fontScale ?? DEFAULT_FONT_SCALE) / 100);

  if (current.state === 'loading' && !video.paused) {
    video.pause();
    pausedByUs = true;
  }

  let status = '';
  if (current.state === 'loading') status = '⏳ ' + current.msg;
  else if (current.state === 'error' && Date.now() - current.errorAt < 15000) status = '⚠️ ' + current.msg;
  setText('.uvs-status', status);

  const g = current.state === 'ready' ? findGroup(current.groups, video.currentTime) : null;
  setText('.uvs-sub', g ? g.text : '');
}

setInterval(tick, 200);

// ---------- Dịch trước cả khoá ----------

const courseJob = { running: false, stop: false, done: 0, total: 0, failed: 0, currentTitle: '', error: '' };

async function runCourseJob() {
  if (courseJob.running) return;
  const loc = parseLectureUrl();
  if (!loc) throw new Error('Hãy mở trang học của khoá (đang xem 1 bài giảng)');
  Object.assign(courseJob, { running: true, stop: false, done: 0, total: 0, failed: 0, currentTitle: '', error: '' });
  try {
    const course = await getCourse(loc.slug);
    courseJob.currentTitle = 'Đang lấy danh sách bài giảng...';
    const lectures = await getCurriculum(course.id);
    courseJob.total = lectures.length;
    for (const lec of lectures) {
      if (courseJob.stop) break;
      courseJob.currentTitle = lec.title;
      try {
        await translateLecture({ courseId: course.id, courseTitle: course.title, lectureTitle: lec.title, ...lec });
      } catch (e) {
        log('dịch bài lỗi', lec.title, e);
        courseJob.failed++;
        courseJob.error = e.message;
        if (/API key|hết tiền/.test(e.message)) break;
      }
      courseJob.done++;
    }
  } catch (e) {
    courseJob.error = e.message;
  }
  courseJob.running = false;
  courseJob.currentTitle = '';
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getStatus') {
    sendResponse({
      onLecture: !!parseLectureUrl(),
      lectureState: current?.state || null,
      lectureMsg: current?.msg || '',
      job: { ...courseJob }
    });
  } else if (msg.type === 'startCourseJob') {
    runCourseJob().catch(e => { courseJob.error = e.message; courseJob.running = false; });
    sendResponse({ ok: true });
  } else if (msg.type === 'stopCourseJob') {
    courseJob.stop = true;
    sendResponse({ ok: true });
  }
});
