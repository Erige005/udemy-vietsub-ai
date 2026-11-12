// Service worker: làm proxy mạng cho content script (tránh CORS) và gọi DeepSeek.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(
    data => sendResponse({ data }),
    e => sendResponse({ error: e.message || String(e) })
  );
  return true;
});

async function handle(msg) {
  switch (msg.type) {
    case 'fetchText': {
      const res = await fetch(msg.url);
      if (!res.ok) throw new Error(`Tải phụ đề thất bại (HTTP ${res.status})`);
      return res.text();
    }
    case 'deepseek':
      return callDeepseek(msg.messages);
    case 'openOptions':
      return chrome.runtime.openOptionsPage();
    default:
      throw new Error('Unknown message: ' + msg.type);
  }
}

async function callDeepseek(messages) {
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (!settings.apiKey) throw new Error('Chưa nhập DeepSeek API key (bấm icon extension → Cài đặt)');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.apiKey },
    body: JSON.stringify({
      model: settings.model || 'deepseek-chat',
      messages,
      temperature: 1.0,
      max_tokens: 8000,
      response_format: { type: 'json_object' }
    }),
    signal: AbortSignal.timeout(180000)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('DeepSeek API key không hợp lệ');
    if (res.status === 402) throw new Error('Tài khoản DeepSeek hết tiền');
    throw new Error(`DeepSeek lỗi HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}
