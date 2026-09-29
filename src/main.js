// 主窗口的连接页：填地址 + 配对 token（或整段粘贴 superfinn pwa-url 的输出）→ token 进钥匙串 → 探测端口 → 配对并整页换成 PWA。
// 带 ?stay 打开（托盘「连接设置…」、PWA 里的「去连接设置」）就停在表单，不自动跳走。
import { AVATAR_KEY, connectOnce, displayBase, getPref, invoke, loadBase, migrateLegacy, normalizeBase, parsePairText, rememberHome, saveBase, setPref } from './shell.js';

const $ = id => document.getElementById(id);
const shell = document.querySelector('.shell');
const stay = new URLSearchParams(location.search).has('stay');
let timer = null, countdown = 0;

function view(name, status, lamp) {
  shell.dataset.view = name;
  $('st').textContent = status;
  document.querySelector('.lamp').dataset.on = lamp || 'down';
}
function note(text) { $('note').textContent = text || ''; }
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } $('down-next').textContent = ''; }

async function attempt() {
  stopTimer();
  const base = loadBase();
  view('busy', '正在连…', 'busy');
  $('busy-d').textContent = displayBase(base);
  let r;
  try { r = await connectOnce(); } catch (err) { r = { status: 'error', message: err?.message || String(err) }; }
  if (r.status === 'ok') { view('busy', '连上了，正在打开…', 'busy'); return; }
  if (r.status === 'unset') { showForm('先填地址和配对 token。'); return; }
  if (r.status === 'error') { showForm('没连上：' + r.message); return; }
  view('down', '没连上 superFinn', 'down');
  $('down-base').textContent = ' ' + displayBase(r.base);
  countdown = 10;
  timer = setInterval(() => {
    countdown -= 1;
    if (countdown <= 0) { attempt(); return; }
    $('down-next').textContent = countdown + ' 秒后自动再试';
  }, 1000);
}

async function showForm(msg) {
  stopTimer();
  view('form', '还没连上', 'down');
  $('base').value = loadBase() || $('base').value;
  const has = await invoke('token_present').catch(() => false);
  $('token').placeholder = has ? '已存在系统钥匙串里（留空 = 不改）' : 'superfinn pwa-url 链接里 token= 后面那串';
  const av = getPref(AVATAR_KEY) || 'symbol';
  const radio = document.querySelector(`input[name="avatar"][value="${av}"]:not([disabled])`);
  if (radio) radio.checked = true;
  note(msg || '');
}

$('paste').addEventListener('input', () => {
  const { base, token } = parsePairText($('paste').value);
  if (base) $('base').value = base;
  if (token) $('token').value = token;
  if (base || token) note(token ? '已从粘贴的内容里取出地址和 token。' : '已取出地址；还需要 token。');
});

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  let base;
  try { base = normalizeBase($('base').value || parsePairText($('paste').value).base); } catch (err) { note(err.message); return; }
  const token = $('token').value.trim() || parsePairText($('paste').value).token;
  const has = await invoke('token_present').catch(() => false);
  if (!token && !has) { note('还缺配对 token。'); return; }
  try {
    if (token) await invoke('token_save', { token });
  } catch (err) { note('token 没存进钥匙串：' + (err?.message || err)); return; }
  saveBase(base);
  setPref(AVATAR_KEY, 'symbol');   // 2D 形象还没接入
  $('token').value = ''; $('paste').value = '';
  attempt();
});

$('forget').addEventListener('click', async () => {
  try { await invoke('token_clear'); note('已从钥匙串删掉 token。'); } catch (err) { note('没删掉：' + (err?.message || err)); }
  $('token').placeholder = 'superfinn pwa-url 链接里 token= 后面那串';
});
$('retry').addEventListener('click', attempt);
$('edit').addEventListener('click', () => showForm());

(async () => {
  await rememberHome();
  try { await migrateLegacy(); } catch { /* 旧链接坏了就当没有 */ }
  if (stay || !loadBase()) showForm();
  else attempt();
})();
