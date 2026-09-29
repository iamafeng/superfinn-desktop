// 伴侣窗连上之前的页面：没配置 → 请去主窗口；端口不通 → 「没连上 superFinn」+ 重试（并每 10 秒自动再试）；通了 → 配对，
// 服务端 302 回 / 后由注入脚本换成 /?view=mini。
import { BASE_KEY, connectOnce, invoke, rememberHome, wireDrag } from './shell.js';

const $ = id => document.getElementById(id);
const shell = document.querySelector('.shell');
let timer = null;

function view(name, text, lamp) {
  shell.dataset.view = name;
  $('st').textContent = 'superFinn · ' + text;
  document.querySelector('.lamp').dataset.on = lamp;
  invoke('shell_state', { state: 'down' }).catch(() => {});   // 还在壳内页 = 还没连上；「在做」只由 PWA 页面报
}
function later(sec) {
  if (timer) clearInterval(timer);
  let n = sec;
  timer = setInterval(() => {
    n -= 1;
    if (n <= 0) { clearInterval(timer); timer = null; attempt(); return; }
    $('down-next').textContent = n + ' 秒后自动再试';
  }, 1000);
}

async function attempt() {
  if (timer) { clearInterval(timer); timer = null; }
  $('down-next').textContent = '';
  view('busy', '连接中', 'busy');
  let r;
  try { r = await connectOnce(); } catch (err) { r = { status: 'down', message: err?.message }; }
  if (r.status === 'ok') return;
  if (r.status === 'unset') { view('unset', '还没连上', 'down'); later(5); return; }   // 主窗口存好后：storage 事件或 5 秒一次的复查接着连
  view('down', '没连上', 'down');
  later(10);
}

wireDrag(document.body);
$('hide').addEventListener('click', () => invoke('window_hide').catch(() => {}));
$('retry').addEventListener('click', attempt);
$('open-main').addEventListener('click', () => invoke('open_main', { stay: true }).catch(() => {}));
// 同一个壳内源：主窗口保存地址后这里会收到 storage 事件
addEventListener('storage', e => { if (e.key === BASE_KEY && shell.dataset.view === 'unset') setTimeout(attempt, 800); });

(async () => { await rememberHome(); attempt(); })();
