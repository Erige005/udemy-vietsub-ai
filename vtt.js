// Đọc file WebVTT và ghép các dòng bị cắt thành câu trọn vẹn.

function parseTime(s) {
  const p = s.trim().replace(',', '.').split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

function parseVtt(text) {
  const cues = [];
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const body = lines.slice(i + 1).join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (!body) continue;
    cues.push({ start: parseTime(a), end: parseTime(b.trim().split(/\s+/)[0]), text: body });
  }
  return cues;
}

const SENTENCE_END = /[.?!…]["'”’)\]]*$/;
const MAX_GROUP_SECONDS = 12;
const MAX_GROUP_CUES = 4;
const MAX_GAP_SECONDS = 1.5;

function groupCues(cues) {
  const groups = [];
  let cur = null;
  for (const c of cues) {
    if (cur && (c.start - cur.end > MAX_GAP_SECONDS || c.end - cur.start > MAX_GROUP_SECONDS || cur.count >= MAX_GROUP_CUES)) {
      groups.push(cur);
      cur = null;
    }
    if (!cur) cur = { start: c.start, end: c.end, text: c.text, count: 1 };
    else { cur.end = c.end; cur.text += ' ' + c.text; cur.count++; }
    if (SENTENCE_END.test(c.text)) { groups.push(cur); cur = null; }
  }
  if (cur) groups.push(cur);
  return groups.map((g, id) => ({ id, start: g.start, end: g.end, en: g.text }));
}

if (typeof module !== 'undefined') module.exports = { parseVtt, groupCues };
