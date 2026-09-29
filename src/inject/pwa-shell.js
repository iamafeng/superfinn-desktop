/* superFinn 壳 · 注入脚本。Rust 侧把它作为 initialization_script 注入 main / companion 两个窗口的每个页面，
 * 前面带一行 window.__SF_SHELL_WIN__ = "main" | "companion"。
 *
 * 只在服务端 PWA 页面上生效（壳内页面、其它协议一律不碰），做五件事：
 *   1. 伴侣窗：/pair 跳回的 / 换成 /?view=mini；顶上加一条拖动条（拖动 / 置顶 / 折叠成一行 / 收进托盘）。
 *   2. 托盘三态：读 PWA 自己画出来的状态（.one-app[data-link]、.lamp[data-on]、「需要你」行）→ shell_state（idle / busy / need / down）。
 *   3. 离线：连接断开超过 3 秒 → 盖一层「没连上 superFinn」+「重试」（回壳内页面重新探测、重新配对）。
 *   4. 配对失效（服务端回「未配对」「配对失败」）→ 提示并给出回连接设置的按钮。
 *   5. 伴侣窗拖放文件 → /api/upload（同源，带配对 cookie）→ 在同一条连接上说「看看这个」。
 * 壳不存任何消息，也不另开连接：状态只来自 PWA 页面本身，页面只来自服务端。
 * 颜色只用 PWA 的 token（var(--*)），取不到时退回系统色，不写字面颜色。
 * 纯函数挂在 window.__SF_SHELL__ 上，测试用 node 直接载入本文件。 */
(function (root) {
  'use strict';
  var BAR_H = 30;              // 与 lib.rs 的 FOLD_H 一致
  var DOWN_GRACE_MS = 3000;    // 断线多久才盖离线层（PWA 自己会先重连几次）
  var MAX_DROP = 3;            // 一次最多拖几个文件
  var WORDS = { idle: '空闲', busy: '在做', need: '等你', down: '没连上 superFinn' };
  var SHORT = { idle: '空闲', busy: '在做', need: '等你', down: '没连上' };   // 拖动条上用短的

  /** 纯函数：页面上看得到的状态 → 托盘状态。link = .one-app[data-link]，lamp = .lamp[data-on]，need = 「需要你」行在不在 */
  function deriveState(v) {
    v = v || {};
    if (v.link === 'down') return 'down';
    if (v.need || v.lamp === 'need') return 'need';
    if (v.lamp === 'busy') return 'busy';
    return 'idle';
  }
  /** 纯函数：是不是服务端 PWA 的页面（壳内页面在 Windows 上是 http://tauri.localhost，在 macOS 上是 tauri://） */
  function isPwaUrl(loc) {
    if (!loc) return false;
    return (loc.protocol === 'http:' || loc.protocol === 'https:') && loc.hostname !== 'tauri.localhost';
  }
  /** 纯函数：伴侣窗落在 PWA 根页面却没带 ?view=mini（/pair 302 回来的）→ 应该换成的地址；否则 null */
  function miniRedirect(loc) {
    if (!isPwaUrl(loc) || loc.pathname !== '/') return null;
    if (/[?&]view=mini\b/.test(loc.search || '')) return null;
    return '/?view=mini';
  }
  /** 纯函数：服务端回的是不是「没配对」页（纯文本，没有 .one-app） */
  function isUnpairedText(text) { return /未配对|配对失败/.test(String(text || '')); }
  /** 纯函数：拖进来的文件名 → 一句话 */
  function dropText(names) {
    var n = (names || []).filter(Boolean);
    return n.length ? '看看这个：' + n.join('、') : '看看这个';
  }
  /** 纯函数：折叠后状态行上的那句（「需要你几件」放最前面，窄窗截断时也看得到） */
  function foldedLine(stText, needYou, state) {
    var t = String(stText || '').replace(/\s+/g, ' ').trim();
    if (state === 'down') return WORDS.down;
    if (!t) t = WORDS[state] || '';
    return needYou > 0 ? '需要你 ' + needYou + ' · ' + t : t;
  }

  var PURE = { deriveState: deriveState, isPwaUrl: isPwaUrl, miniRedirect: miniRedirect, isUnpairedText: isUnpairedText, dropText: dropText, foldedLine: foldedLine, WORDS: WORDS, BAR_H: BAR_H };
  root.__SF_SHELL__ = PURE;

  var d = root.document, loc = root.location;
  if (!d || !isPwaUrl(loc)) return;
  var WIN = root.__SF_SHELL_WIN__ === 'companion' ? 'companion' : 'main';
  if (WIN === 'companion') {
    var to = miniRedirect(loc);
    if (to) { loc.replace(to); return; }
  }

  function invoke(cmd, args) {
    var I = root.__TAURI_INTERNALS__;
    if (!I || typeof I.invoke !== 'function') return Promise.reject(new Error('不在壳里'));
    try { return Promise.resolve(I.invoke(cmd, args || {})); } catch (err) { return Promise.reject(err); }
  }
  function pref(k, v) {
    try { if (v === undefined) return root.localStorage.getItem(k); root.localStorage.setItem(k, v); } catch (err) { /* 没有 localStorage 也能用 */ }
    return null;
  }
  function el(tag, cls, text) { var n = d.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(act, text, title) { var b = el('button', 'sf-btn', text); b.type = 'button'; b.setAttribute('data-sf', act); b.title = title; b.setAttribute('aria-label', title); return b; }

  var CSS = [
    '.sf-bar{position:fixed;top:0;left:0;right:0;height:' + BAR_H + 'px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:0 4px 0 8px;',
    'background:var(--bg-2,Canvas);color:var(--ink-2,CanvasText);border-bottom:var(--rule-w,1px) solid var(--rule,GrayText);',
    'font:var(--fs-1,12px)/1 var(--font-mono,ui-monospace,monospace);letter-spacing:.06em;user-select:none;-webkit-user-select:none;cursor:grab}',
    '.sf-grip{color:var(--ink-3,GrayText);letter-spacing:0}',
    '.sf-lamp{flex:none;width:8px;height:8px;border:var(--rule-w,1px) solid var(--accent,CanvasText)}',
    '.sf-lamp[data-on=busy],.sf-lamp[data-on=need]{background:var(--accent,CanvasText)}',
    '.sf-lamp[data-on=down]{border-style:dashed}',
    '.sf-text{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.sf-bar[data-on=need] .sf-text{color:var(--accent,CanvasText)}',
    '.sf-btn{flex:none;height:22px;min-width:24px;padding:0 6px;border:var(--rule-w,1px) solid transparent;background:transparent;color:var(--ink-2,CanvasText);font:inherit;cursor:pointer;border-radius:0}',
    '.sf-btn:hover,.sf-btn:focus-visible{border-color:var(--rule,GrayText);outline:0}',
    '.sf-btn[aria-pressed=true]{color:var(--accent,CanvasText)}',
    'html.sf-companion .app{height:calc(100vh - ' + BAR_H + 'px);height:calc(100dvh - ' + BAR_H + 'px);margin-top:' + BAR_H + 'px}',
    'html.sf-folded .app,html.sf-folded .drawer-wrap{display:none!important}',
    'html.sf-folded body{background:var(--bg-2,Canvas)}',
    'html.sf-drop .app{outline:var(--rule-w,1px) dashed var(--accent,CanvasText);outline-offset:-4px}',
    '.sf-cover{position:fixed;left:0;right:0;bottom:0;top:0;z-index:2147482000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;',
    'background:var(--bg,Canvas);color:var(--ink,CanvasText);font:var(--fs-2,14px)/1.5 var(--font-ui,ui-monospace,monospace);text-align:center;padding:16px}',
    'html.sf-companion .sf-cover{top:' + BAR_H + 'px}',
    '.sf-cover .sf-t{color:var(--accent,CanvasText);font-size:var(--fs-3,16px);letter-spacing:.04em}',
    '.sf-cover .sf-d{color:var(--ink-3,GrayText);font-size:var(--fs-1,12px)}',
    '.sf-cover .sf-go{border:var(--rule-w,1px) solid var(--accent,CanvasText);background:var(--accent,CanvasText);color:var(--accent-ink,Canvas);padding:4px 16px;font:inherit;cursor:pointer;border-radius:0}',
    '.sf-row{display:flex;gap:8px}',
    '.sf-cover .sf-quiet{background:transparent;color:var(--ink-2,CanvasText);border-color:var(--rule,GrayText)}',
    '.sf-toast{position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483001;padding:4px 8px;background:var(--bg-2,Canvas);border:var(--rule-w,1px) solid var(--accent,CanvasText);color:var(--ink,CanvasText);font:var(--fs-1,12px)/1.4 var(--font-mono,ui-monospace,monospace)}'
  ].join('\n');

  var S = { state: null, sent: null, folded: false, pinned: true, downSince: 0, cover: null, app: null };
  var ui = {};

  function report(state) {
    if (WIN !== 'companion' || state === S.sent) return;   // 只由伴侣窗报托盘状态，免得两个窗口抢
    S.sent = state;
    invoke('shell_state', { state: state }).catch(function () { S.sent = null; });
  }
  function toast(text) {
    if (ui.toast) ui.toast.remove();
    ui.toast = el('div', 'sf-toast', text); d.body.appendChild(ui.toast);
    var t = ui.toast; setTimeout(function () { if (t.parentNode) t.remove(); if (ui.toast === t) ui.toast = null; }, 4000);
  }
  /** 盖一层：标题 + 说明 + 主按钮（+ 主窗口多一个「连接设置」） */
  function showCover(title, desc, label, onGo) {
    hideCover();
    var c = el('div', 'sf-cover'); c.setAttribute('role', 'alert');
    c.appendChild(el('div', 'sf-t', title));
    if (desc) c.appendChild(el('div', 'sf-d', desc));
    var row = el('div', 'sf-row');
    var b = el('button', 'sf-go', label); b.type = 'button'; b.addEventListener('click', onGo); row.appendChild(b);
    if (WIN === 'main' && onGo !== settings) { var s2 = el('button', 'sf-go sf-quiet', '连接设置'); s2.type = 'button'; s2.addEventListener('click', settings); row.appendChild(s2); }
    c.appendChild(row);
    d.body.appendChild(c); S.cover = c;
  }
  function hideCover() { if (S.cover) { S.cover.remove(); S.cover = null; } }
  /** 重试 = 回壳内页面：那边先探测端口，通了再配对一次（token 在钥匙串里，不经过这个页面） */
  function retry() { invoke('go_home', { stay: false }).catch(function () { root.location.reload(); }); }
  function settings() { invoke('go_home', { stay: true }).catch(function () { toast('去托盘菜单「连接设置…」改地址或 token'); }); }

  function read(app) {
    var lamp = app.querySelector('.status .lamp'), st = app.querySelector('.status .st-text'), nb = app.querySelector('.needbar .tag');
    var needYou = nb ? Number(String(nb.textContent).replace(/\D+/g, '')) || 1 : 0;
    return { link: app.getAttribute('data-link'), lamp: lamp && lamp.getAttribute('data-on'), need: needYou > 0, needYou: needYou, text: st ? st.textContent : '' };
  }
  function sync(app) {
    var v = read(app), now = Date.now();
    var state = deriveState(v);
    if (state === 'down') {
      if (!S.downSince) S.downSince = now;
      if (now - S.downSince >= DOWN_GRACE_MS && !S.cover) showCover('没连上 superFinn', '它可能没在运行，或者换了地址。', '重试', retry);
    } else {
      S.downSince = 0;
      if (S.cover && S.cover.getAttribute('data-kind') !== 'unpaired') hideCover();
    }
    // 断线的前 3 秒托盘还按上一个状态显示，免得一闪
    var shown = state === 'down' && S.downSince && now - S.downSince < DOWN_GRACE_MS && S.state && S.state !== 'down' ? S.state : state;
    S.state = shown;
    report(shown);
    if (ui.bar) {
      ui.bar.setAttribute('data-on', shown);
      ui.lamp.setAttribute('data-on', shown);
      ui.text.textContent = S.folded ? foldedLine(v.text, v.needYou, shown) : 'superFinn · ' + SHORT[shown];
    }
  }

  function fold(on) {
    S.folded = !!on;
    d.documentElement.classList.toggle('sf-folded', S.folded);
    if (ui.fold) { ui.fold.textContent = S.folded ? '+' : '-'; ui.fold.title = S.folded ? '展开' : '折叠成一行'; ui.fold.setAttribute('aria-label', ui.fold.title); ui.fold.setAttribute('aria-pressed', String(S.folded)); }
    pref('sf.shell.folded', S.folded ? '1' : '0');
    invoke('window_fold', { folded: S.folded }).catch(function () {});
    if (S.app) sync(S.app);
  }
  function pin(on) {
    S.pinned = !!on;
    if (ui.pin) ui.pin.setAttribute('aria-pressed', String(S.pinned));
    pref('sf.shell.pinned', S.pinned ? '1' : '0');
    invoke('window_pin', { on: S.pinned }).catch(function () {});
  }
  function bar(app) {
    var b = el('div', 'sf-bar'); b.setAttribute('role', 'toolbar'); b.setAttribute('aria-label', '伴侣窗');
    ui.bar = b;
    b.appendChild(el('span', 'sf-grip', '≡'));
    ui.lamp = el('span', 'sf-lamp'); b.appendChild(ui.lamp);
    ui.text = el('span', 'sf-text', 'superFinn'); b.appendChild(ui.text);
    ui.pin = btn('pin', '顶', '置顶'); b.appendChild(ui.pin);
    ui.fold = btn('fold', '-', '折叠成一行'); b.appendChild(ui.fold);
    b.appendChild(btn('hide', '×', '收进托盘'));
    b.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || (e.target.closest && e.target.closest('button'))) return;
      e.preventDefault(); invoke('window_drag').catch(function () {});
    });
    b.addEventListener('dblclick', function (e) { if (!(e.target.closest && e.target.closest('button'))) fold(!S.folded); });
    b.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-sf]') : null; if (!t) return;
      var act = t.getAttribute('data-sf');
      if (act === 'fold') fold(!S.folded);
      else if (act === 'pin') pin(!S.pinned);
      else if (act === 'hide') invoke('window_hide').catch(function () {});
    });
    d.body.appendChild(b);
    d.documentElement.classList.add('sf-companion');
    S.pinned = pref('sf.shell.pinned') !== '0'; ui.pin.setAttribute('aria-pressed', String(S.pinned));
    if (!S.pinned) invoke('window_pin', { on: false }).catch(function () {});
    if (pref('sf.shell.folded') === '1') fold(true);
    else ui.fold.setAttribute('aria-pressed', 'false');
  }

  /** 拖放文件：上传到同一个服务（同源、带配对 cookie），再在 PWA 自己那条连接上说一句 */
  function drops(app) {
    var depth = 0;
    function has(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0; }
    d.addEventListener('dragenter', function (e) { if (!has(e)) return; e.preventDefault(); depth++; d.documentElement.classList.add('sf-drop'); });
    d.addEventListener('dragover', function (e) { if (!has(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    d.addEventListener('dragleave', function (e) { if (!has(e)) return; depth = Math.max(0, depth - 1); if (!depth) d.documentElement.classList.remove('sf-drop'); });
    d.addEventListener('drop', function (e) {
      if (!has(e)) return;
      e.preventDefault(); depth = 0; d.documentElement.classList.remove('sf-drop');
      var files = Array.prototype.slice.call(e.dataTransfer.files || [], 0, MAX_DROP);
      if (!files.length) return;
      if (S.folded) fold(false);
      var L = root.SF_LIVE;
      if (!L || L.state() !== 'ok') { toast('还没连上，文件没发出去'); return; }
      Promise.all(files.map(function (f) {
        var fd = new root.FormData(); fd.append('file', f, f.name);
        return root.fetch('/api/upload', { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) {
          return r.json().then(function (j) { if (!r.ok || !j || !j.id) throw new Error((j && j.error) || ('HTTP ' + r.status)); return j; });
        });
      })).then(function (ups) {
        return L.call('run', { text: dropText(ups.map(function (u) { return u.name; })), attachments: ups.map(function (u) { return u.id; }) });
      }).then(function () { toast('收到 ' + files.length + ' 个文件，交给它看了'); }, function (err) { toast('没传上：' + (err && err.message ? err.message : '出错了')); });
    });
  }

  function boot() {
    var style = el('style'); style.textContent = CSS; (d.head || d.documentElement).appendChild(style);
    var app = d.querySelector('.one-app');
    if (!app) {
      if (d.body && isUnpairedText(d.body.innerText || d.body.textContent)) {
        if (WIN === 'companion') d.documentElement.classList.add('sf-companion');
        showCover('配对失效了', '服务端换过配对 token。在电脑上运行 superfinn pwa-url，把新链接贴到连接设置里。', WIN === 'companion' ? '重试' : '去连接设置', WIN === 'companion' ? retry : settings);
        S.cover.setAttribute('data-kind', 'unpaired');
        report('down');
      }
      return;
    }
    S.app = app;
    if (WIN === 'companion') { bar(app); drops(app); }
    var mo = new root.MutationObserver(function () { sync(app); });
    mo.observe(app, { attributes: true, attributeFilter: ['data-link'], childList: true, subtree: true, characterData: true });
    setInterval(function () { sync(app); }, 1000);   // 断线计时要走表，不只靠 DOM 变化
    sync(app);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
