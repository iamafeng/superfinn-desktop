// superFinn 壳：两个窗口 + 一个托盘，只放「窗口置顶 / 拖动 / 折叠 / 托盘状态 / 配对 token 进系统钥匙串」这几条最小命令。
// 页面、消息流、审批都在 superFinn 服务那边；壳只知道用户在运行时填的地址。
//
// 窗口：
//   main       主窗口。先开壳内的连接页（index.html），连上后整页换成服务端 PWA。S4 T23 起缺省不显示：只在首次没配对时先出来给人填 token，
//              连上后自动收起；之后从伴侣窗「打开主窗口」或托盘菜单打开。
//   companion  伴侣窗。无边框、置顶、不进任务栏的小窗；壳内页（companion.html）连上后换成 PWA 的 /?view=mini。缺省只起它。
// 两个窗口都注入 src/inject/pwa-shell.js：只在服务端 PWA 页面上生效（拖动条、折叠、离线提示、托盘状态、拖放文件）。
//
// 权限：build.rs 声明了下面这些命令；capabilities/default.json 给壳内页面，capabilities/remote.json 只给本机回环地址上的
// PWA 页面一个子集（没有任何 token 相关命令）。
use std::{
    collections::HashMap,
    fs,
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, RunEvent, Url, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

/// 系统钥匙串里的条目（Windows 凭据管理器 / macOS 钥匙串 / Linux 内核 keyutils）
const KEY_SERVICE: &str = "io.superfinn.desktop";
const KEY_ACCOUNT: &str = "pair-token";
/// 与 tauri.conf.json 的 app.trayIcon.id 一致
const TRAY_ID: &str = "superfinn";
/// 折叠后只剩一条状态行的高度（逻辑像素），与 pwa-shell.js 的 BAR_H 一致
const FOLD_H: f64 = 30.0;
const INJECT: &str = include_str!("../../src/inject/pwa-shell.js");

#[derive(Default)]
struct Shell {
    /// 每个窗口的壳内页面地址（重试 / 连接设置时导航回去）
    homes: Mutex<HashMap<String, String>>,
    /// 折叠前的伴侣窗尺寸
    unfolded: Mutex<Option<PhysicalSize<u32>>>,
    /// 伴侣窗最后的位置（退出时写盘，下次启动恢复）
    companion_pos: Mutex<Option<PhysicalPosition<i32>>>,
    /// S4 T23：首次启动没有配对 token 时主窗口先出来给人填；连上后由 PWA 页面报 main_connected，主窗口自动收起（只这一次）
    autohide_main: Mutex<bool>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ───────── 配对 token：只进系统钥匙串，不落任何文件 ─────────

fn key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEY_SERVICE, KEY_ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
fn token_save(token: String) -> Result<(), String> {
    let t = token.trim();
    if t.is_empty() || t.len() > 512 || !t.chars().all(|c| c.is_ascii_graphic()) {
        return Err("配对 token 格式不对".into());
    }
    key_entry()?.set_password(t).map_err(|e| e.to_string())
}

#[tauri::command]
fn token_clear() -> Result<(), String> {
    match key_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn token_present() -> bool {
    key_entry()
        .ok()
        .and_then(|e| e.get_password().ok())
        .map_or(false, |t| !t.is_empty())
}

// ───────── 连接 ─────────

fn base_url(base: &str) -> Result<Url, String> {
    let u = Url::parse(base.trim()).map_err(|_| "地址格式不对".to_string())?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return Err("地址只能以 http:// 或 https:// 开头".into());
    }
    if u.host_str().is_none() {
        return Err("地址里没有主机名".into());
    }
    Ok(u)
}

/// 服务端口能不能连上（TCP 握手，1.5 秒超时）。不走网页 fetch，避开跨源与混合内容限制。
#[tauri::command]
async fn probe(base: String) -> Result<bool, String> {
    let u = base_url(&base)?;
    let host = u.host_str().unwrap_or_default().trim_start_matches('[').trim_end_matches(']').to_string();
    let port = u.port_or_known_default().unwrap_or(80);
    let ok = tauri::async_runtime::spawn_blocking(move || match (host.as_str(), port).to_socket_addrs() {
        Ok(addrs) => addrs
            .into_iter()
            .any(|a| TcpStream::connect_timeout(&a, Duration::from_millis(1500)).is_ok()),
        Err(_) => false,
    })
    .await
    .unwrap_or(false);
    Ok(ok)
}

/// 把当前窗口导航到 <base>/pair?token=…（token 从钥匙串取，不经过网页脚本）。服务端种下配对 cookie 后跳回 /。
#[tauri::command]
fn pair_open(window: WebviewWindow, base: String) -> Result<(), String> {
    let token = key_entry()?
        .get_password()
        .map_err(|_| "还没保存配对 token".to_string())?;
    let mut u = base_url(&base)?;
    u.set_path("/pair");
    u.set_query(None);
    u.set_fragment(None);
    u.query_pairs_mut().append_pair("token", &token);
    window.navigate(u).map_err(|e| e.to_string())
}

/// 壳内页面报上自己的地址（Windows 与 macOS 的壳内地址不同，由页面自己说最准）
#[tauri::command]
fn remember_home(window: WebviewWindow, shell: tauri::State<'_, Shell>, href: String) -> Result<(), String> {
    let u = Url::parse(&href).map_err(|e| e.to_string())?;
    if !is_local(&u) {
        return Err("只接受壳内页面".into());
    }
    lock(&shell.homes).insert(window.label().to_string(), href);
    Ok(())
}

fn is_local(u: &Url) -> bool {
    u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost")
}

fn navigate_home(window: &WebviewWindow, shell: &Shell, stay: bool) -> Result<(), String> {
    let href = lock(&shell.homes)
        .get(window.label())
        .cloned()
        .ok_or_else(|| "找不到壳内页面".to_string())?;
    let mut u = Url::parse(&href).map_err(|e| e.to_string())?;
    u.set_query(if stay { Some("stay") } else { None });
    window.navigate(u).map_err(|e| e.to_string())
}

/// 回到壳内页面：stay = 停在连接设置；否则重新探测并连接（「重试」）
#[tauri::command]
fn go_home(window: WebviewWindow, shell: tauri::State<'_, Shell>, stay: bool) -> Result<(), String> {
    navigate_home(&window, shell.inner(), stay)
}

#[tauri::command]
fn open_main(app: AppHandle, stay: bool) -> Result<(), String> {
    let w = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不在".to_string())?;
    if stay {
        navigate_home(&w, app.state::<Shell>().inner(), true)?;
    }
    reveal(&w);
    Ok(())
}

/// S4 T23：主窗口里的 PWA 页面连上了（注入脚本在服务端页面找到 .one-app 时报一次）。
/// 只在「首次启动因为没配对才打开主窗口」的那一次把主窗口收起；平时从托盘打开的主窗口不动。
#[tauri::command]
fn main_connected(window: WebviewWindow, shell: tauri::State<'_, Shell>) -> Result<(), String> {
    if window.label() != "main" {
        return Ok(());
    }
    let mut flag = lock(&shell.autohide_main);
    if *flag {
        *flag = false;
        let _ = window.hide();
    }
    Ok(())
}

// ───────── 托盘三态（外加没连上） ─────────

#[derive(Clone, Copy)]
enum Lamp {
    Idle,
    Busy,
    Need,
    Down,
}

/// 自绘托盘图标：琥珀色小方灯，与 PWA 状态行的灯同一套形状（空心 = 空闲，实心 = 在做，实心加外框 = 等你，虚线 = 没连上）
fn lamp_icon(lamp: Lamp) -> Image<'static> {
    const S: u32 = 32;
    const AMBER: [u8; 4] = [0xa8, 0x5f, 0x00, 0xff];
    let mut px = vec![0u8; (S * S * 4) as usize];
    for y in 0..S {
        for x in 0..S {
            let inside = |m: u32| x >= m && x < S - m && y >= m && y < S - m;
            let ring = |m: u32, w: u32| inside(m) && !inside(m + w);
            let on = match lamp {
                Lamp::Idle => ring(6, 3),
                Lamp::Busy => inside(6),
                Lamp::Need => inside(10) || ring(2, 3),
                Lamp::Down => ring(6, 3) && ((x + y) / 4) % 2 == 0,
            };
            if on {
                let i = ((y * S + x) * 4) as usize;
                px[i..i + 4].copy_from_slice(&AMBER);
            }
        }
    }
    Image::new_owned(px, S, S)
}

#[tauri::command]
fn shell_state(app: AppHandle, state: String) -> Result<(), String> {
    let (lamp, words) = match state.as_str() {
        "idle" => (Lamp::Idle, "空闲"),
        "busy" => (Lamp::Busy, "在做"),
        "need" => (Lamp::Need, "等你"),
        "down" => (Lamp::Down, "没连上 superFinn"),
        _ => return Err("不认识的状态".into()),
    };
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_icon(Some(lamp_icon(lamp))).map_err(|e| e.to_string())?;
        tray.set_tooltip(Some(format!("superFinn · {words}")))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ───────── 伴侣窗：拖动 / 折叠 / 置顶 / 隐藏 ─────────

#[tauri::command]
fn window_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_fold(window: WebviewWindow, shell: tauri::State<'_, Shell>, folded: bool) -> Result<(), String> {
    let mut keep = lock(&shell.unfolded);
    if folded {
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        if keep.is_none() {
            *keep = Some(size);
        }
        window
            .set_size(LogicalSize::new(size.width as f64 / scale, FOLD_H))
            .map_err(|e| e.to_string())
    } else if let Some(size) = keep.take() {
        window.set_size(size).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn window_pin(window: WebviewWindow, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

#[tauri::command]
fn window_hide(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

// ───────── 装配 ─────────

fn reveal(w: &WebviewWindow) {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
}

fn toggle(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            reveal(&w);
        }
    }
}

/// 注入脚本前面带上窗口名（main / companion），脚本据此决定要不要拖动条、要不要报托盘状态
fn inject_for(label: &str) -> String {
    format!("window.__SF_SHELL_WIN__ = {label:?};\n{INJECT}")
}

fn pos_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("companion-position"))
}

fn load_pos(app: &AppHandle) -> Option<PhysicalPosition<i32>> {
    let text = fs::read_to_string(pos_file(app)?).ok()?;
    let mut it = text.split_whitespace().map(|v| v.parse::<i32>());
    match (it.next(), it.next()) {
        (Some(Ok(x)), Some(Ok(y))) => Some(PhysicalPosition::new(x, y)),
        _ => None,
    }
}

fn save_pos(app: &AppHandle) {
    let Some(p) = *lock(&app.state::<Shell>().companion_pos) else { return };
    if let Some(f) = pos_file(app) {
        if let Some(dir) = f.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(f, format!("{} {}", p.x, p.y));
    }
}

/// 记住的位置还在某块屏幕上才用（换了显示器就回到默认位置）
fn on_screen(w: &WebviewWindow, p: PhysicalPosition<i32>) -> bool {
    w.available_monitors().map_or(false, |ms| {
        ms.iter().any(|m| {
            let (o, s) = (m.position(), m.size());
            p.x >= o.x && p.y >= o.y && p.x < o.x + s.width as i32 - 40 && p.y < o.y + s.height as i32 - 20
        })
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Shell::default())
        .invoke_handler(tauri::generate_handler![
            token_save,
            token_clear,
            token_present,
            probe,
            pair_open,
            remember_home,
            go_home,
            open_main,
            shell_state,
            window_drag,
            window_fold,
            window_pin,
            window_hide,
            main_connected
        ])
        .setup(|app| {
            // S4 T23（T16 第 7 条真机打回 7）：缺省只起伴侣窗，主窗口按需（伴侣窗里「打开主窗口」/ 托盘菜单）。
            // 首次启动钥匙串里没有配对 token 时例外：主窗口先出来给人填地址与 token，连上后自动收起（main_connected）。
            let first_run = !token_present();
            *lock(&app.state::<Shell>().autohide_main) = first_run;
            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("superFinn")
                .inner_size(1280.0, 820.0)
                .min_inner_size(960.0, 600.0)
                .center()
                .visible(first_run)
                .initialization_script(&inject_for("main"))
                .build()?;
            let companion = WebviewWindowBuilder::new(app, "companion", WebviewUrl::App("companion.html".into()))
                .title("superFinn")
                .inner_size(340.0, 300.0)
                .min_inner_size(220.0, FOLD_H)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(true)
                // 让网页自己收到拖进来的文件（HTML5 drop），生成「看看这个」
                .disable_drag_drop_handler()
                .initialization_script(&inject_for("companion"))
                .build()?;

            let handle = app.handle().clone();
            {
                let shell = app.state::<Shell>();
                let mut homes = lock(&shell.homes);
                for w in [&main, &companion] {
                    if let Ok(u) = w.url() {
                        homes.insert(w.label().to_string(), u.to_string());
                    }
                }
            }
            if let Some(p) = load_pos(&handle) {
                if on_screen(&companion, p) {
                    let _ = companion.set_position(p);
                }
            }

            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "companion", "显示 / 隐藏伴侣窗", true, None::<&str>)?,
                    &MenuItem::with_id(app, "main", "打开主窗口（完整页面）", true, None::<&str>)?,
                    &MenuItem::with_id(app, "settings", "连接设置…", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "quit", "退出 superFinn", true, None::<&str>)?,
                ],
            )?;
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                tray.set_menu(Some(menu))?;
                tray.set_icon(Some(lamp_icon(Lamp::Down)))?;
                tray.set_tooltip(Some("superFinn · 连接中（左键菜单：显示伴侣窗 / 打开主窗口 / 退出）"))?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "companion" => toggle(app, "companion"),
            "main" => {
                if let Some(w) = app.get_webview_window("main") {
                    reveal(&w);
                }
            }
            "settings" => {
                let _ = open_main(app.clone(), true);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_window_event(|window, event| match event {
            // 关窗 = 收进托盘；退出走托盘菜单（伴侣窗拖动条上的 ▣ 也是收进托盘，首次会提示「我在托盘里，点小灯回来」）
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Moved(p) if window.label() == "companion" => {
                *lock(&window.state::<Shell>().companion_pos) = Some(*p);
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building superFinn")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                save_pos(app);
            }
        });
}
