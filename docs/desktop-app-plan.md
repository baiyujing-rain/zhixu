# 智序（Zhixu）桌面版改造方案

> 将现有「Next.js 15 前端 + FastAPI 后端 + SQLite」本地 Web 应用，封装为
> 跨平台桌面应用（Windows / macOS / Linux）。

---

## 0. 现状与关键约束（已核实）

| 项 | 现状 |
|---|---|
| 前端 | Next.js 15（App Router），`next start` 绑 `127.0.0.1:3000` |
| 后端 | FastAPI + uvicorn，绑 `127.0.0.1:8000`，SQLite 持久化 |
| 前后端通信 | 前端所有请求走 `/api/*` 相对路径，经 `next.config.ts` 的 `rewrites` 代理到 `BACKEND_URL`（默认 `http://127.0.0.1:8000`） |
| 运行时 | Node.js 22 + Python 3.13 |
| 现有打包 | Docker（backend + frontend 双容器） |

**关键结论**：因为前端依赖 `rewrites`（Next 服务端特性），**不能简单静态导出**，
桌面化必须采用 **sidecar 双进程架构**：

```
Tauri 外壳（WebView 窗口）
   ├── 启动时 spawn → Next 前端服务（127.0.0.1:3000）
   └── 启动时 spawn → FastAPI 后端（127.0.0.1:8000，PyInstaller 打包）
   WebView 加载 http://127.0.0.1:3000
```

---

## 1. 技术选型（已确定）

| 组件 | 选型 | 理由 |
|---|---|---|
| 桌面框架 | **Tauri 2** | 体积小（~10MB vs Electron 150MB）、内存低、系统 WebView |
| 前端打包 | `next build` 产物 + `next start`（Node sidecar） | 保留 rewrites，零前端改动 |
| 后端打包 | **PyInstaller**（单二进制） | 用户无需装 Python |
| 打包分发 | Tauri CLI（`tauri build`）产出平台安装包 |

---

## 2. 目录结构调整（新增 `desktop/`）

```
zhixu/
├── desktop/                        # 新增：Tauri 桌面壳
│   ├── src-tauri/
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   ├── build.rs
│   │   └── src/
│   │       ├── main.rs             # 启动时 spawn 前端+后端 sidecar
│   │       └── sidecar.rs          # 子进程管理（生命周期、端口、日志）
│   ├── icons/                      # 应用图标（ico/icns/png）
│   └── scripts/
│       ├── build-backend.py        # PyInstaller 打包后端脚本
│       └── bundle.sh               # 一站式构建脚本
├── app/ lib/ components/           # 前端（不动）
├── backend/                        # 后端（不动，仅加 PyInstaller spec）
│   └── zhixu-backend.spec          # 新增：PyInstaller 配置
└── package.json                    # 新增 desktop 相关脚本
```

---

## 3. 核心实现步骤

### 步骤 1：安装工具链

```bash
# Rust（Tauri 必需）
# Windows: 下载 rustup-init.exe 安装
# macOS/Linux: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Tauri CLI
npm install -D @tauri-apps/cli@^2

# PyInstaller（在 venv 内）
.venv/Scripts/python.exe -m pip install pyinstaller
```

### 步骤 2：后端 PyInstaller 打包

创建 `backend/zhixu-backend.spec`，关键配置：

```python
# 单文件、无控制台窗口（Windows）
a = Analysis(['desktop/backend_entry.py'], ...)
exe = EXE(..., console=False, name='zhixu-backend', ...)
```

新增 `desktop/backend_entry.py`（后端启动入口，替代 uvicorn 命令）：

```python
import uvicorn
from backend.main import app

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8000, log_level='warning')
```

**注意点**：
- SQLite 数据目录在桌面版要指向**用户数据目录**（`~/.local/share/zhixu/` 或
  `%APPDATA%/zhixu/`），不能放在安装目录（无写权限 / 升级被覆盖）。
- PyInstaller 需包含 `backend/` 包的隐式导入（SQLAlchemy 模型、uvicorn 的
  loop 实现 `uvloop`/`asyncio` 等），用 `hiddenimports` 补齐。

### 步骤 3：前端 sidecar 处理

前端**不改代码**，只需保证：
- 桌面版用 `next build` + `next start` 作为 sidecar 进程
- 后端地址通过环境变量 `BACKEND_URL=http://127.0.0.1:8000` 注入（现有 rewrites
  已支持，默认值即正确）

**体积优化（可选）**：`next build` 的 `.next` + `node_modules` 较大，可用
`next start` 的 standalone 模式（`output: 'standalone'`）裁剪掉不必要的
依赖，减小体积。但**这会改变 next.config.ts**，需权衡。

### 步骤 4：Tauri 外壳（核心）

`desktop/src-tauri/src/main.rs` 的逻辑：

```rust
// 1. 启动时先拉起后端 sidecar（PyInstaller 二进制）
// 2. 再拉起前端 sidecar（node next start）
// 3. 等待两个端口就绪（轮询 127.0.0.1:8000 / 3000）
// 4. 创建 WebView 窗口，加载 http://127.0.0.1:3000
// 5. 窗口关闭时，优雅停止两个子进程（防止僵尸进程/端口占用）
```

`tauri.conf.json` 关键配置：
- `build.frontendDist`：指向前端静态资源（或空，纯 sidecar 模式）
- `bundle.externalBin`：声明 PyInstaller 后端 + node 前端两个 sidecar 二进制
- `bundle.targets`：`all`（或按平台分别构建）

### 步骤 5：跨平台差异处理

| 差异点 | 处理方式 |
|---|---|
| 后端二进制名 | Windows `zhixu-backend.exe`，macOS/Linux `zhixu-backend`（无后缀）——sidecar.rs 里按 `cfg!(target_os)` 判断 |
| 数据目录 | Windows `%APPDATA%/zhixu/`，macOS `~/Library/Application Support/zhixu/`，Linux `~/.local/share/zhixu/`——用 Tauri 的 `app_data_dir()` 统一获取 |
| 前端 Node 运行时 | **关键决策**：是要求用户装 Node，还是打包一个便携 Node？推荐用 `pkg` 或 `node --experimental-sea` 把 `next start` 打成单二进制，或附带便携 Node |
| WebView | Windows 用 WebView2（Win10/11 自带），macOS 用 WKWebView，Linux 用 WebKitGTK（需系统装 `libwebkit2gtk`） |
| 安装包格式 | Windows `.msi`/`.exe`（NSIS）、macOS `.dmg`/`.app`、Linux `.deb`/`.rpm`/`.AppImage` |
| 签名/公证 | macOS 需签名 + 公证（否则 Gatekeeper 拦截）；Windows 建议代码签名（可选） |

### 步骤 6：构建与分发

```bash
# 一键构建脚本（desktop/scripts/bundle.sh 内）
1. cd backend && python -m PyInstaller zhixu-backend.spec   # 产出后端二进制
2. npm run build                                           # 前端 next build
3. npm run tauri build                                     # 产出各平台安装包
```

产物：
- Windows：`desktop/src-tauri/target/release/bundle/msi/*.msi` + `.exe`
- macOS：`.dmg` + `.app`
- Linux：`.deb` + `.rpm` + `.AppImage`

---

## 4. 关键风险与决策点

| # | 风险/决策 | 说明 |
|---|---|---|
| 1 | **前端 Node 运行时打包** | 最大难点。可选：①要求用户装 Node（最简单但体验差）②`pkg`/`bun build` 打成单文件 ③附带便携 Node。**建议先用 ① 验证架构，再优化到 ②** |
| 2 | **PyInstaller 隐式导入** | SQLAlchemy/uvicorn 的动态导入易漏，需仔细配 hiddenimports + 逐平台测试 |
| 3 | **端口冲突** | 若 3000/8000 被占用，sidecar 启动失败。需加端口探测 + 动态端口 + 回退 |
| 4 | **macOS Gatekeeper** | 未签名 app 会被拦截，需 Apple 开发者证书签名（$99/年） |
| 5 | **Linux WebKitGTK 依赖** | 用户需装 `libwebkit2gtk-4.1-dev` 等，AppImage 可自带 |
| 6 | **CI 跨平台构建** | 用 GitHub Actions 三平台矩阵（windows/macos/ubuntu runner）自动构建 |

---

## 5. 推荐实施顺序（分阶段，降低风险）

1. **阶段 A（MVP，1-2 天）**：Tauri 壳 + PyInstaller 后端 + 假设用户装 Node 跑前端
   → 先在 Windows 打通「双击启动 → 双服务拉起 → WebView 加载」闭环
2. **阶段 B（完善）**：前端 Node 运行时打包成单文件、端口动态分配、优雅退出
3. **阶段 C（跨平台）**：macOS/Linux 构建 + 签名 + 三平台 CI 矩阵
4. **阶段 D（发布）**：自动更新（Tauri updater）、安装包、图标/品牌

---

## 6. 结论

方案可行，核心是 **Tauri 2 sidecar 双进程架构**：
- 前端 `next start`（保留 rewrites，零改动）+ 后端 PyInstaller 二进制
- Tauri 外壳负责「拉起两个子进程 + 生命周期管理 + WebView 展示」
- 最大工作量在「前端 Node 运行时打包」和「PyInstaller 隐式依赖」两个点
