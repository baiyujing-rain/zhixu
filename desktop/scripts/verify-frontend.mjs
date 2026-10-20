// 前端 standalone 冒烟：校验产物完整性 + 启动 node server.js 并确认返回 200。
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const front = join(root, 'desktop', 'dist', 'frontend');

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

const requiredFiles = ['server.js'];
const requiredDirs = [join('.next', 'static'), 'public'];
const missing = [
  ...requiredFiles.filter((rel) => !existsSync(join(front, rel)) || !statSync(join(front, rel)).isFile()),
  ...requiredDirs.filter((rel) => !existsSync(join(front, rel)) || !statSync(join(front, rel)).isDirectory()),
];
if (missing.length) {
  console.error('verify-frontend: FAIL — 缺少产物：' + missing.join(', '));
  process.exit(1);
}

if (!(await portFree(3000))) {
  console.error('verify-frontend: FAIL — 端口 3000 已被占用，请先释放后再验证');
  process.exit(1);
}

const child = spawn(process.execPath, ['server.js'], {
  cwd: front,
  env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: '3000', NODE_ENV: 'production' },
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = Date.now() + 60_000;
let ok = false;

try {
  while (Date.now() < deadline) {
    try {
      const resp = await fetch('http://127.0.0.1:3000/');
      if (resp.status === 200) {
        ok = true;
        break;
      }
    } catch {
      // 尚未就绪
    }
    if (child.exitCode !== null) break;
    await sleep(500);
  }
} finally {
  try {
    child.kill('SIGKILL');
  } catch {
    // 进程可能已退出
  }
}

if (!ok) {
  console.error('verify-frontend: FAIL — standalone server 未在 60s 内返回 200');
  process.exit(1);
}
console.log('verify-frontend: PASS — server.js + .next/static + public 完整，standalone 服务正常');
