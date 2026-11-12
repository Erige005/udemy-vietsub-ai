const $ = id => document.getElementById(id);
let tabId = null;

const LECTURE_STATES = {
  loading: 'Bài hiện tại: đang dịch...',
  ready: 'Bài hiện tại: đã có vietsub ✓',
  nosub: 'Bài hiện tại: không có phụ đề tiếng Anh',
  error: 'Bài hiện tại: lỗi'
};

async function send(msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    return null;
  }
}

async function refresh() {
  const s = await send({ type: 'getStatus' });
  if (!s) {
    $('lecture').innerHTML = '<span class="muted">Mở một bài giảng Udemy để dùng (nếu đã mở, hãy tải lại trang).</span>';
    $('job').textContent = '';
    $('start').disabled = true;
    return;
  }
  const lec = s.lectureState ? LECTURE_STATES[s.lectureState] : 'Chưa mở bài giảng nào';
  $('lecture').textContent = lec + (s.lectureState === 'error' ? ' — ' + s.lectureMsg : '');

  const j = s.job;
  let html = '';
  if (j.running) {
    html = `<progress max="${j.total || 1}" value="${j.done}"></progress>
      <div>${j.done}/${j.total || '?'} bài${j.failed ? `, ${j.failed} lỗi` : ''}</div>
      <div class="muted">${escapeHtml(j.currentTitle)}</div>`;
  } else if (j.total) {
    html = `<div>Đã xử lý ${j.done}/${j.total} bài${j.failed ? `, ${j.failed} lỗi` : ''}.</div>`;
  }
  if (j.error) html += `<div class="err">${escapeHtml(j.error)}</div>`;
  $('job').innerHTML = html;
  $('start').disabled = j.running || !s.onLecture;
  $('stop').hidden = !j.running;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  const { settings = {} } = await chrome.storage.local.get('settings');
  $('enabled').checked = settings.enabled !== false;
  $('fontScale').value = settings.fontScale ?? 75;
  $('fontScaleVal').textContent = $('fontScale').value + '%';
  if (!settings.apiKey) {
    $('job').innerHTML = '<span class="err">Chưa nhập DeepSeek API key — bấm Cài đặt.</span>';
  }
  refresh();
  setInterval(refresh, 1000);
})();

$('enabled').addEventListener('change', async e => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, enabled: e.target.checked } });
});
$('fontScale').addEventListener('input', async e => {
  const fontScale = Number(e.target.value);
  $('fontScaleVal').textContent = fontScale + '%';
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, fontScale } });
});
$('start').addEventListener('click', async () => { await send({ type: 'startCourseJob' }); refresh(); });
$('stop').addEventListener('click', async () => { await send({ type: 'stopCourseJob' }); refresh(); });
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
