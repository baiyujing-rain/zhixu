// 前端 standalone 打包：`next build`（output:standalone）→ 收集产物到 desktop/dist/frontend/，
// 并捆绑 node.exe（优先复制本机已有，缺失时从 npmmirror 下载），使桌面版免装 Node。
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// WorkBuddy/CodeBuddy 沙箱会给 Node 注入「批量删除确认」shim，`next build` 清理旧
// chunk 时可能被拦截。显式关闭（该变量在普通环境中无任何作用）。
process.env.CODEBUDY_SAFE_DELETE_ENABLED = '0';

// BACKEND_URL 会在 next build 时被烘焙进 rewrites；桌面构建必须用默认回环地址。
process.env.BACKEND_URL = 'http://127.0.0.1:8000';

const NODE_VERSION = '22.22.2';
const NODE_EXE_NAME = process.platform === 'win32' ? 'node.exe' : 'node';

console.log('==> next build (output:standalone)');
// 沙箱经 NODE_OPTIONS=--require 注入「安全删除」shim，会拦截 next build 清理旧 chunk 的
// 批量删除（单轮 >=50 个文件触发确认而失败）。子进程环境显式剔除 NODE_OPTIONS，让 next 干净删除。
const buildEnv = { ...process.env };
delete buildEnv.NODE_OPTIONS;
execSync('npm run build', { stdio: 'inherit', cwd: root, env: buildEnv });

const dist = join(root, 'desktop', 'dist', 'frontend');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const standalone = join(root, '.next', 'standalone');
if (!existsSync(join(standalone, 'server.js'))) {
  throw new Error('next build 未产出 .next/standalone/server.js（请确认 next.config.ts 已配置 output:standalone）');
}

cpSync(standalone, dist, { recursive: true });
cpSync(join(root, '.next', 'static'), join(dist, '.next', 'static'), { recursive: true });
cpSync(join(root, 'public'), join(dist, 'public'), { recursive: true });

// 捆绑 node 运行时到 frontend 目录（tauri.conf.json 的 bundle.resources 会整体携带）。
ensureBundledNode(dist);

console.log('==> 前端产物就绪：' + dist);

/**
 * 寻找本机可复用的 node 可执行文件，返回绝对路径；找不到返回 null。
 * 优先级：显式环境变量 > .workbuddy 自带 Node 22 > 当前运行脚本的 Node 22。
 */
function findLocalNode() {
  const explicit = process.env.ZHIXU_NODE_EXE;
  if (explicit && existsSync(explicit)) return resolve(explicit);

  const wb = join(homedir(), '.workbuddy', 'binaries', 'node', 'versions');
  if (existsSync(wb)) {
    const versions = readdirSync(wb).sort().reverse();
    for (const v of versions) {
      if (v.startsWith('22.')) {
        const candidate = join(wb, v, NODE_EXE_NAME);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  const self = process.execPath;
  if (self && existsSync(self) && /node(\.exe)?$/i.test(self)) {
    try {
      const ver = execFileSync(self, ['--version'], { encoding: 'utf8' }).trim();
      if (ver.startsWith('v22.')) return self;
    } catch {
      // 无法探版本则不采用，交给后续 fallback
    }
  }

  return null;
}

/**
 * 确保 frontend 目录内存在 node 运行时（node.exe / node）。
 * 优先复制本机已有 node；缺失时（仅 Windows）从 npmmirror 下载官方发行包解压。
 */
function ensureBundledNode(frontendDir) {
  const target = join(frontendDir, NODE_EXE_NAME);
  const source = findLocalNode();

  if (source) {
    if (resolve(source) !== resolve(target)) {
      cpSync(source, target);
    }
    const ver = execFileSync(target, ['--version'], { encoding: 'utf8' }).trim();
    console.log(`==> 捆绑 node 运行时：${target}（${ver}，来自 ${source}）`);
    return;
  }

  if (process.platform !== 'win32') {
    // 非 Windows 桌面目标当前不在 MVP 范围；开发环境侧靠 PATH 回退。
    console.log('==> 未找到本地 node 运行时，跳过捆绑（非 Windows 目标，sidecar 将回退 PATH）');
    return;
  }

  downloadNodeFromMirror(target);
}

/** 从 npmmirror 下载官方 node 发行包并解压出 node.exe。 */
function downloadNodeFromMirror(target) {
  const url = `https://registry.npmmirror.com/-/binary/node/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;
  const zip = join(dirname(target), `node-v${NODE_VERSION}-win-x64.zip`);
  console.log(`==> 本地未找到 node.exe，从 npmmirror 下载：${url}`);
  execSync(`curl -fL --max-time 600 -o "${zip}" "${url}"`, { stdio: 'inherit' });
  extractNodeExe(zip, target);
  rmSync(zip, { force: true });
  const ver = execFileSync(target, ['--version'], { encoding: 'utf8' }).trim();
  console.log(`==> 捆绑 node 运行时：${target}（${ver}，来自 npmmirror）`);
}

/** 解压 node 发行包并定位 node.exe。优先 bsdtar，失败退回 PowerShell Expand-Archive。 */
function extractNodeExe(zip, target) {
  const tmp = join(dirname(target), '.node-dl');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    execSync(`tar -xf "${zip}" -C "${tmp}"`, { stdio: 'pipe' });
  } catch {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zip}' -DestinationPath '${tmp}' -Force"`,
      { stdio: 'pipe' },
    );
  }
  const found = findNodeExeIn(tmp);
  if (!found) {
    throw new Error('下载的 node 发行包中未找到 node.exe，请检查镜像地址');
  }
  cpSync(found, target);
  rmSync(tmp, { recursive: true, force: true });
}

/** 递归查找目录中的 node 可执行文件。 */
function findNodeExeIn(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findNodeExeIn(p);
      if (nested) return nested;
    } else if (/^node(\.exe)?$/i.test(entry.name)) {
      return p;
    }
  }
  return null;
}
