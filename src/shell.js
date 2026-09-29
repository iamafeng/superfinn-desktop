// 壳内页面（连接页 index.html、伴侣窗的连接中页 companion.html）共用的一小层。
// 壳只记两样东西：服务地址（本页 localStorage，不是秘密）和配对 token（系统钥匙串，经 Rust 命令存取，页面脚本读不到）。

export const BASE_KEY = 'superfinn.base';
export const AVATAR_KEY = 'superfinn.avatar';
/** 早期版本把整条配对链接（含 token）存在 localStorage；启动时搬进钥匙串并删掉 */
export const LEGACY_KEY = 'superfinn.pwaUrl';

export function inShell() {
  const I = globalThis.__TAURI_INTERNALS__;
  return !!I && typeof I.invoke === 'function';
}

export function invoke(cmd, args) {
  const I = globalThis.__TAURI_INTERNALS__;
  if (!I || typeof I.invoke !== 'function') return Promise.reject(new Error('这个页面要在 superFinn 桌面壳里打开'));
  try { return Promise.resolve(I.invoke(cmd, args || {})); } catch (err) { return Promise.reject(err); }
}

function store() { try { return globalThis.localStorage || null; } catch { return null; } }
export function getPref(k) { try { return store()?.getItem(k) ?? null; } catch { return null; } }
export function setPref(k, v) { try { if (v == null) store()?.removeItem(k); else store()?.setItem(k, v); } catch { /* 没有 localStorage 也能用 */ } }

/** 纯函数：地址 → 规范的 origin（只认 http / https） */
export function normalizeBase(v) {
  let u;
  try { u = new URL(String(v || '').trim()); } catch { throw new Error('地址格式不对，应该像 http://127.0.0.1:7777'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('地址只能以 http:// 或 https:// 开头');
  return u.origin;
}

/** 纯函数：从粘贴的文字里取出 { base, token }。
 * 可以是 `superfinn pwa-url` 的整段输出（第一条 /pair?token= 链接优先）、一条配对链接，或者只是地址。取不到的字段为空串。 */
export function parsePairText(text) {
  const urls = String(text || '').match(/https?:\/\/[^\s"'<>，。；、）)]+/g) || [];
  const parsed = [];
  for (const raw of urls) { try { parsed.push(new URL(raw)); } catch { /* 跳过坏链接 */ } }
  const pair = parsed.find(u => u.pathname === '/pair' && u.searchParams.get('token'));
  if (pair) return { base: pair.origin, token: pair.searchParams.get('token') || '' };
  const any = parsed.find(u => u.protocol === 'http:' || u.protocol === 'https:');
  return any ? { base: any.origin, token: any.searchParams.get('token') || '' } : { base: '', token: '' };
}

/** 纯函数：给人看的地址（不带任何查询参数，token 不会出现在界面上） */
export function displayBase(base) { try { return new URL(base).origin; } catch { return ''; } }

export function loadBase() { return getPref(BASE_KEY) || ''; }
export function saveBase(base) { setPref(BASE_KEY, normalizeBase(base)); }

/** 旧版存的整条配对链接：token 搬进钥匙串、地址留下、旧键删掉 */
export async function migrateLegacy() {
  const old = getPref(LEGACY_KEY);
  if (!old) return false;
  const { base, token } = parsePairText(old);
  try {
    if (token) await invoke('token_save', { token });
    if (base && !loadBase()) saveBase(base);
  } finally { setPref(LEGACY_KEY, null); }
  return true;
}

/** 本页在壳里的地址（不带查询参数），报给 Rust，「重试」「连接设置」时导航回来 */
export function rememberHome() {
  return invoke('remember_home', { href: location.origin + location.pathname }).catch(() => {});
}

/** 连一次：没配置 → 'unset'；端口不通 → 'down'；通了 → 导航去配对（成功时页面就换走了，返回 'ok'） */
export async function connectOnce() {
  const base = loadBase();
  const has = await invoke('token_present').catch(() => false);
  if (!base || !has) return { status: 'unset', base };
  const ok = await invoke('probe', { base }).catch(() => false);
  if (!ok) return { status: 'down', base };
  await invoke('pair_open', { base });
  return { status: 'ok', base };
}

/** 无边框窗口的拖动：按住标记了 data-drag 的区域 */
export function wireDrag(root) {
  root.addEventListener('mousedown', e => {
    if (e.button !== 0 || !e.target.closest('[data-drag]') || e.target.closest('button,input,textarea,label,a')) return;
    e.preventDefault(); invoke('window_drag').catch(() => {});
  });
}
