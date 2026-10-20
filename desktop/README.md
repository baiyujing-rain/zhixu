# 智序桌面版（Windows MVP）

> 双击启动 → Tauri 壳拉起「后端（PyInstaller 单文件 exe）+ 前端（Next standalone）」→ 系统 WebView2 加载 `http://127.0.0.1:3000` → 退出时清理子进程。

## 架构

| 组件 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | Tauri 2 + 系统 WebView2 | 体积小；`bundle.resources` 携带后端 exe + 前端目录 |
| 后端 | PyInstaller 单文件（`console=False`） | 免 Python；固定 `127.0.0.1:8000` |
| 前端 | Next.js `output:'standalone'` + `node server.js` | 自包含、rewrites 已烘焙；固定 `127.0.0.1:3000` |
| 生命周期 | `std::process::Command` 自行 spawn/清理 | 退出时 `taskkill /PID <pid> /T /F` 清理进程树 |

前端所有 `/api/*` 请求经 Next `rewrites` 打到 `127.0.0.1:8000`；`BACKEND_URL` 在 `next build` 时被烘焙，桌面构建强制使用默认回环地址。

## 运行环境（用户侧）

- Windows 10/11（通常自带 WebView2 Runtime，缺失请装 [Evergreen 引导安装器](https://developer.microsoft.com/microsoft-edge/webview2/)）
- **Node.js 22**（前端 sidecar 用 `node server.js`；MVP 明确假设用户已安装）
- **无需安装 Python**（后端已打包为 exe）

## 构建环境（开发者侧）

- Node 22 + npm
- Python 3.13 + `.venv`（仅用于 PyInstaller）
- Rust stable（MSVC）+ Visual Studio Build Tools 2022「使用 C++ 的桌面开发」工作负载（仅编译 Tauri 壳时需要）

### 工具链安装

```powershell
# 1) Rust（默认 stable + MSVC）
#    官方 https://win.rustup.rs；国内可设镜像：
$env:RUSTUP_DIST_SERVER="https://mirrors.ustc.edu.cn/rust-static"
$env:RUSTUP_UPDATE_ROOT="https://mirrors.ustc.edu.cn/rust-static/rustup"
.\rustup-init.exe -y --default-toolchain stable --profile minimal

# 2) crates.io 镜像（缓解首次 cargo build 超时），写入 %USERPROFILE%\.cargo\config.toml：
#    [source.crates-io] replace-with = "ustc"
#    [source.ustc] registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
$env:CARGO_HTTP_TIMEOUT="600"; $env:CARGO_NET_RETRY="10"

# 3) Tauri CLI（仓库根）
npm install

# 4) PyInstaller（仅 venv，不进 requirements.txt）
.venv\Scripts\python.exe -m pip install "pyinstaller>=6.10,<7"
```

## 一键构建

```powershell
# 仓库根执行；产物为 NSIS 安装包（免 WiX）
npm run desktop:build
```

分步：

```powershell
npm run desktop:backend     # PyInstaller → desktop/dist/backend/zhixu-backend.exe
npm run desktop:frontend    # next build(standalone) → desktop/dist/frontend/
npx tauri build --config desktop/src-tauri/tauri.conf.json   # Tauri 壳 + NSIS
```

## 验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File desktop/scripts/verify-backend.ps1   # exe 启动 → /api/health=200
node desktop/scripts/verify-frontend.mjs                                                 # standalone 产物完整 + server.js 200
powershell -NoProfile -ExecutionPolicy Bypass -File desktop/scripts/verify-desktop.ps1   # 端到端：3000→8000 全链路
```

## 产物

- 安装包：`desktop/src-tauri/target/release/bundle/nsis/智序_1.0.0_x64-setup.exe`
- 裸 exe（未安装）：`desktop/src-tauri/target/release/zhixu-desktop.exe`

## 数据目录

- `%APPDATA%\zhixu\`：`zhixu.db`（数据库）、`.env`（AI 设置）、`logs\backend.log` / `logs\frontend.log`
- 凭据仍在 `%LOCALAPPDATA%\Zhixu\chatgpt\`（DPAPI），Web/桌面共享，不改动

## 已知限制（MVP）

- **本地运行样例（判题）降级**：冻结后无独立 Python 解释器，`/api/sessions/{id}/judge` 返回友好提示「请使用静态审阅或到力扣验证」；Web 版不受影响。
- **固定端口**：3000/8000；被占用时 `wait_ready` 超时弹窗。动态端口列为 Phase B。
- **未代码签名**：Windows 首次运行可能触发 SmartScreen 提示，内部使用可接受。
- **图标为占位图**：后续用 `npx tauri icon <1024x1024.png>` 替换正式 logo。
- **NSIS 仅 currentUser 安装**：免 UAC 提权；如需系统级安装/MSI，需 WiX 工具链（Phase D）。

## 开发调试

```powershell
# 需先启动后端与前端（开发模式）
npm run dev                          # 前端 next dev（127.0.0.1:3000）
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
npm run desktop:dev                  # tauri dev（devUrl=http://127.0.0.1:3000）
```

> 说明：`tauri dev` 依赖 `beforeDevCommand` 先产出 `desktop/dist/frontend`；sidecar 在 dev 模式从 `resource_dir` 找后端/前端，完整闭环以 `tauri build`（生产）为准。

## QA 清单

- [ ] 双击安装包启动，出现「智序」窗口并加载学习界面
- [ ] `%APPDATA%\zhixu\zhixu.db` 生成，Web/桌面数据目录正确
- [ ] AI 设置读写落到 `%APPDATA%\zhixu\.env`
- [ ] 关闭窗口后，`tasklist` 中无残留 `zhixu-backend.exe` / `node.exe`
- [ ] 二次启动聚焦已有窗口（单实例），不报端口冲突
- [ ] 内置示例题「运行样例」返回桌面版降级提示（而非崩溃）
