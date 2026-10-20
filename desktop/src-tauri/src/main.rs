// Prevent the console window from appearing on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use std::time::Duration;

use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 二次启动时聚焦已有窗口，避免拉起第二套 sidecar 导致端口冲突。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.show();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;

            let mut procs = match sidecar::spawn_all(&resource_dir) {
                Ok(procs) => procs,
                Err(e) => {
                    app.dialog().message(format!("启动失败：{e}")).blocking_show();
                    app.handle().exit(1);
                    return Ok(());
                }
            };

            if let Err(e) = sidecar::wait_ready(&mut procs, Duration::from_secs(90)) {
                app.dialog().message(e).blocking_show();
                app.handle().exit(1);
                return Ok(());
            }

            // 交给 Tauri 托管；退出时 state 被 drop，AppProcesses::Drop 执行 kill_all。
            app.manage(std::sync::Mutex::new(procs));

            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External("http://127.0.0.1:3000".parse().unwrap()),
            )
            .title("智序")
            .inner_size(1280.0, 800.0)
            .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri app")
        .run(|app, event| {
            // 第二道保险：显式清理一次（主路径仍是 state drop 触发的 Drop）。
            if let RunEvent::Exit = event {
                if let Some(state) =
                    app.try_state::<std::sync::Mutex<sidecar::AppProcesses>>()
                {
                    if let Ok(mut procs) = state.lock() {
                        procs.kill_all();
                    }
                }
            }
        });
}
