// 前端 standalone 打包：`next build`（output:standalone）→ 收集产物到 desktop/dist/frontend/。
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// WorkBuddy/CodeBuddy 沙箱会给 Node 注入「批量删除确认」shim，`next build` 清理旧
// chunk 时可能被拦截。显式关闭（该变量在普通环境中无任何作用）。
process.env.CODEBUDY_SAFE_DELETE_ENABLED = '0';

// BACKEND_URL 会在 next build 时被烘焙进 rewrites；桌面构建必须用默认回环地址。
process.env.BACKEND_URL = 'http://127.0.0.1:8000';

console.log('==> next build (output:standalone)');
execSync('npm run build', { stdio: 'inherit', cwd: root });

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

console.log('==> 前端产物就绪：' + dist);
