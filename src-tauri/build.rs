// 声明壳自己的命令，让它们受 capabilities 管：壳内页面见 capabilities/default.json，
// 服务端 PWA 页面（仅本机回环地址）见 capabilities/remote.json，后者拿不到任何 token 相关命令。
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "token_save",
            "token_clear",
            "token_present",
            "probe",
            "pair_open",
            "remember_home",
            "go_home",
            "open_main",
            "shell_state",
            "window_drag",
            "window_fold",
            "window_pin",
            "window_hide",
            "main_connected",
        ]),
    ))
    .expect("failed to run tauri-build");
}
