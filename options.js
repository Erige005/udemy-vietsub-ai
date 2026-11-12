const $ = id => document.getElementById(id);

async function load() {
  const all = await chrome.storage.local.get(null);
  const s = all.settings || {};
  $('apiKey').value = s.apiKey || '';
  $('model').value = s.model || '';
  $('count').textContent = Object.keys(all).filter(k => k.startsWith('tr:')).length + ' bài giảng';
}

$('save').addEventListener('click', async () => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    settings: { ...settings, apiKey: $('apiKey').value.trim(), model: $('model').value.trim() }
  });
  $('msg').textContent = 'Đã lưu ✓';
  setTimeout(() => ($('msg').textContent = ''), 2000);
});

$('clear').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('tr:')));
  load();
});

load();
