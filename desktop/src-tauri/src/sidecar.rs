//! Sidecar process lifecycle management.
//!
//! Owns the two child processes (backend exe + frontend `node server.js`) and
//! guarantees they are torn down on exit via `Drop`. On Windows the process
//! *tree* is killed with `taskkill /T /F` so that no orphaned grandchildren
//! survive; on Unix a plain `child.kill()` is used.

use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Holds the two sidecar child processes for the duration of the app.
pub struct AppProcesses {
    pub backend: Child,
    pub frontend: Child,
}

impl Drop for AppProcesses {
    fn drop(&mut self) {
        self.kill_all();
    }
}

impl AppProcesses {
    /// Kill both child process trees. Idempotent; safe to call multiple times.
    pub fn kill_all(&mut self) {
        kill_tree(&mut self.backend);
        kill_tree(&mut self.frontend);
    }
}

fn kill_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn data_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var("APPDATA").unwrap_or_else(|_| ".".into())).join("zhixu")
    } else if cfg!(target_os = "macos") {
        PathBuf::from(std::env::var("HOME").unwrap_or_default())
            .join("Library")
            .join("Application Support")
            .join("zhixu")
    } else {
        PathBuf::from(std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
            format!(
                "{}/.local/share",
                std::env::var("HOME").unwrap_or_default()
            )
        }))
        .join("zhixu")
    }
}

/// Spawn the backend exe first, then the Next standalone frontend.
///
/// `resource_dir` is `app.path().resource_dir()`, where `bundle.resources` are
/// materialised (e.g. `zhixu-backend.exe` and the `frontend/` directory).
pub fn spawn_all(resource_dir: &Path) -> Result<AppProcesses, String> {
    let data = data_dir();
    let logs = data.join("logs");
    std::fs::create_dir_all(&logs).map_err(|e| format!("无法创建日志目录：{e}"))?;

    // 每个子进程的 stdout/stderr 都落到日志文件（而非未读取的管道），避免子进程写
    // stderr 时管道填满阻塞，也保证启动错误可被诊断。
    let backend_out = File::create(logs.join("backend.log")).map_err(|e| e.to_string())?;
    let backend_err = backend_out.try_clone().map_err(|e| e.to_string())?;
    let frontend_out = File::create(logs.join("frontend.log")).map_err(|e| e.to_string())?;
    let frontend_err = frontend_out.try_clone().map_err(|e| e.to_string())?;

    let backend = Command::new(resource_dir.join("zhixu-backend.exe"))
        .stdin(Stdio::null())
        .stdout(Stdio::from(backend_out))
        .stderr(Stdio::from(backend_err))
        .spawn()
        .map_err(|e| format!("无法启动后端：{e}"))?;

    let front = resource_dir.join("frontend");
    let frontend = Command::new("node")
        // 用相对路径配合 current_dir，避免 Windows 下把含盘符的绝对路径传给 node 时被截断。
        .arg("server.js")
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", "3000")
        .env("NODE_ENV", "production")
        // 移除宿主可能注入的 NODE_OPTIONS（如开发沙箱的 --require shim），
        // 保证独立前端不受宿主 Node 配置干扰。
        .env_remove("NODE_OPTIONS")
        .current_dir(&front)
        .stdin(Stdio::null())
        .stdout(Stdio::from(frontend_out))
        .stderr(Stdio::from(frontend_err))
        .spawn()
        .map_err(|e| format!("未找到 Node.js 或前端启动失败（请安装 Node 22）：{e}"))?;

    Ok(AppProcesses { backend, frontend })
}

/// Poll `http://127.0.0.1:3000/api/health` until ready or timeout.
///
/// The Next server rewrites `/api/*` to the backend on `127.0.0.1:8000`, so a
/// single probe validates the entire chain (frontend up + rewrite + backend up).
pub fn wait_ready(procs: &mut AppProcesses, timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        match ureq::get("http://127.0.0.1:3000/api/health")
            .timeout(Duration::from_secs(2))
            .call()
        {
            Ok(resp) if resp.status() == 200 => return Ok(()),
            _ => {}
        }
        if procs.backend.try_wait().ok().flatten().is_some() {
            return Err("后端进程提前退出".into());
        }
        if procs.frontend.try_wait().ok().flatten().is_some() {
            return Err("前端进程提前退出（请安装 Node 22）".into());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err("启动超时：服务未在预期时间内就绪".into())
}
