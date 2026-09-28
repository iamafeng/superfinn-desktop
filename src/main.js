// 壳的全部逻辑：记住配对链接，下次启动直接跳过去。带 ?stay 打开可回到本页改链接。
const KEY = 'superfinn.pwaUrl';
const params = new URLSearchParams(location.search);
const saved = localStorage.getItem(KEY);
if (saved && !params.has('stay')) {
  location.replace(saved);
} else {
  const input = document.getElementById('url');
  const note = document.getElementById('note');
  if (saved) { input.value = saved; note.textContent = '已保存链接，修改后重新连接。'; }
  document.getElementById('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = input.value.trim();
    try { new URL(url); } catch { note.textContent = '链接格式不对。'; return; }
    localStorage.setItem(KEY, url);
    location.replace(url);
  });
}
