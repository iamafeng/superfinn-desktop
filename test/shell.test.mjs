// 壳的纯函数用例：node --test（不装任何依赖）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parsePairText, normalizeBase, displayBase } from '../src/shell.js';

const inject = () => {
  const box = {};
  vm.runInNewContext(readFileSync(new URL('../src/inject/pwa-shell.js', import.meta.url), 'utf8'), box);
  return box.__SF_SHELL__;
};

test('parsePairText：superfinn pwa-url 的整段输出取第一条配对链接', () => {
  const out = '本机：http://127.0.0.1:7777/pair?token=abc123def\nS1 不做公网入口：宿主机浏览器经端口转发打开上面的本机链接';
  assert.deepEqual(parsePairText(out), { base: 'http://127.0.0.1:7777', token: 'abc123def' });
});
test('parsePairText：配对链接优先于普通地址；只有地址时 token 为空', () => {
  assert.deepEqual(parsePairText('看 http://127.0.0.1:7777/ 和 http://127.0.0.1:7859/pair?token=t1'), { base: 'http://127.0.0.1:7859', token: 't1' });
  assert.deepEqual(parsePairText('http://127.0.0.1:7777'), { base: 'http://127.0.0.1:7777', token: '' });
  assert.deepEqual(parsePairText('没有链接'), { base: '', token: '' });
  assert.deepEqual(parsePairText('（http://localhost:7777/pair?token=x9）。'), { base: 'http://localhost:7777', token: 'x9' });
});
test('normalizeBase 只认 http / https，只留 origin', () => {
  assert.equal(normalizeBase(' http://127.0.0.1:7777/pair?token=x '), 'http://127.0.0.1:7777');
  assert.throws(() => normalizeBase('file:///etc/passwd'), /http/);
  assert.throws(() => normalizeBase('127.0.0.1:7777'));
  assert.equal(displayBase('http://127.0.0.1:7777/pair?token=secret'), 'http://127.0.0.1:7777');
});

test('注入脚本在没有 document 的环境只挂纯函数', () => {
  const S = inject();
  assert.equal(typeof S.deriveState, 'function');
  assert.equal(S.BAR_H, 30);
});
test('deriveState：断线 > 等你 > 在做 > 空闲', () => {
  const { deriveState } = inject();
  assert.equal(deriveState({ link: 'down', lamp: 'busy', need: true }), 'down');
  assert.equal(deriveState({ link: 'ok', lamp: 'busy', need: true }), 'need');
  assert.equal(deriveState({ link: 'ok', lamp: 'need' }), 'need');
  assert.equal(deriveState({ link: 'ok', lamp: 'busy' }), 'busy');
  assert.equal(deriveState({ link: 'ok', lamp: 'idle' }), 'idle');
  assert.equal(deriveState({ link: 'connecting' }), 'idle');
  assert.equal(deriveState(), 'idle');
});
test('isPwaUrl / miniRedirect：只接管服务端页面；伴侣窗根页面换成 ?view=mini', () => {
  const { isPwaUrl, miniRedirect } = inject();
  const L = (href) => new URL(href);
  assert.equal(isPwaUrl(L('http://127.0.0.1:7777/')), true);
  assert.equal(isPwaUrl(L('http://tauri.localhost/index.html')), false);
  assert.equal(isPwaUrl(L('tauri://localhost/companion.html')), false);
  assert.equal(miniRedirect(L('http://127.0.0.1:7777/')), '/?view=mini');
  assert.equal(miniRedirect(L('http://127.0.0.1:7777/?view=mini')), null);
  assert.equal(miniRedirect(L('http://127.0.0.1:7777/pair?token=x')), null);
  assert.equal(miniRedirect(L('http://tauri.localhost/')), null);
});
test('isUnpairedText / dropText / foldedLine', () => {
  const { isUnpairedText, dropText, foldedLine } = inject();
  assert.equal(isUnpairedText('未配对：在电脑上运行 superfinn pwa-url'), true);
  assert.equal(isUnpairedText('配对失败：链接无效或已更换。'), true);
  assert.equal(isUnpairedText('没有这个文件'), false);
  assert.equal(dropText(['a.png', 'b.txt']), '看看这个：a.png、b.txt');
  assert.equal(dropText([]), '看看这个');
  assert.equal(foldedLine(' 在做：整理日报 ', 0, 'busy'), '在做：整理日报');
  assert.equal(foldedLine('等你点头', 2, 'need'), '需要你 2 · 等你点头');
  assert.equal(foldedLine('随便', 0, 'down'), '没连上 superFinn');
  assert.equal(foldedLine('', 0, 'idle'), '空闲');
});

test('权限：服务端页面拿不到任何 token 命令；两份 capability 覆盖全部已声明命令', () => {
  const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
  const local = read('../src-tauri/capabilities/default.json'), remote = read('../src-tauri/capabilities/remote.json');
  const build = readFileSync(new URL('../src-tauri/build.rs', import.meta.url), 'utf8');
  const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const declared = [...build.matchAll(/"([a-z_]+)",/g)].map(m => m[1]);
  const handled = lib.match(/generate_handler!\[([^\]]+)\]/)[1].split(',').map(s => s.trim()).filter(Boolean);
  assert.deepEqual([...declared].sort(), [...handled].sort(), 'build.rs 声明的命令 = generate_handler 注册的命令');
  const perm = c => 'allow-' + c.replace(/_/g, '-');
  for (const c of declared) assert.ok(local.permissions.includes(perm(c)), `壳内页面缺 ${perm(c)}`);
  assert.ok(remote.remote.urls.every(u => /^http:\/\/(127\.0\.0\.1|localhost):\*$/.test(u)), '远程页面只放本机回环地址');
  for (const p of remote.permissions) assert.ok(!/token|pair|probe|remember|open-main/.test(p), `远程页面不该有 ${p}`);
  assert.ok(!remote.permissions.some(p => p.startsWith('core:')), '远程页面不给 core 权限');
});
test('配置：没有写死任何服务地址；伴侣窗在 Rust 里建（无边框、置顶、不进任务栏）', () => {
  const conf = readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8');
  const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.ok(!/https?:\/\/(127\.0\.0\.1|localhost)/.test(conf));
  assert.ok(!/https?:\/\/(127\.0\.0\.1|localhost)/.test(lib));
  for (const s of ['"companion"', '.decorations(false)', '.always_on_top(true)', '.skip_taskbar(true)', '.disable_drag_drop_handler()', 'include_str!("../../src/inject/pwa-shell.js")']) assert.ok(lib.includes(s), s);
});
