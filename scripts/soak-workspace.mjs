/** Real-browser endurance check. Only writes to the isolated QA service. */
import { chromium, request, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--minutes');
const minutes = index < 0 ? 90 : Number(process.argv[index + 1]);
if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > 180) throw new Error('Use --minutes between 0.1 and 180.');
const baseURL = 'http://127.0.0.1:3001';
const directory = path.join(root, 'artifacts', 'qa');
await fs.mkdir(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const resultPath = path.join(directory, `soak-${stamp}.json`);
const result = { started_at: new Date().toISOString(), requested_minutes: minutes, cycles: 0, page_errors: [], failed_api_responses: [], samples: [], passed: false, stopped: false, cleanup_completed: false };
let stop = false;
process.on('SIGINT', () => { stop = true; });
process.on('SIGTERM', () => { stop = true; });
const api = await request.newContext({ baseURL, timeout: 15000 });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', error => result.page_errors.push(error.message));
page.on('response', response => { if (response.url().startsWith(`${baseURL}/api/`) && response.status() >= 400) result.failed_api_responses.push({ status: response.status(), path: new URL(response.url()).pathname }); });
// No model generation belongs in this check, including accidentally clicked UI.
await page.route(/\/api\/sessions\/\d+\/(?:coach|optimize|external\/coach|external\/optimize)/, route => route.abort('blockedbyclient'));
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
let item;
async function snapshot(label) {
  await cdp.send('HeapProfiler.collectGarbage');
  const response = await cdp.send('Performance.getMetrics');
  const metrics = Object.fromEntries(response.metrics.map(entry => [entry.name, entry.value]));
  result.samples.push({ label, at: new Date().toISOString(), cycles: result.cycles, heap_mb: Math.round(metrics.JSHeapUsedSize / 1024 / 1024 * 100) / 100, documents: metrics.Documents, nodes: metrics.Nodes, listeners: metrics.JSEventListeners });
  await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
}
try {
  if (!(await api.get('/api/health')).ok()) throw new Error('QA service is unavailable.');
  const title = `连续使用检查 ${stamp}`;
  const created = await api.post('/api/sessions', { data: { content: `${title}\n给定一个整数数组和目标值，返回两个不同位置，其元素之和等于目标。请讨论无解与重复值。`, language: 'cpp' } });
  if (!created.ok()) throw new Error('Could not create isolated check record.');
  item = await created.json();
  const algorithms = ['hash-two-sum', 'two-pointers', 'binary-search', 'brackets', 'stairs', 'sliding-window', 'bfs'];
  const question = '这是一条未发送的连续检查提问，切换页面和刷新应保留。';
  await page.goto(`/?session=${item.id}&panel=visualize`);
  await expect(page.locator('.algorithm-demo')).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  const started = Date.now();
  while (!stop && Date.now() - started < minutes * 60000) {
    const cycle = result.cycles + 1;
    await page.getByRole('button', { name: '算法演示', exact: true }).click();
    await page.getByLabel('演示算法').selectOption(algorithms[(cycle - 1) % algorithms.length]);
    await page.getByLabel('演示播放速度').selectOption('2');
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(page.locator('.algo-progress')).toContainText('步骤 2', { timeout: 3000 });
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const position = await page.getByRole('slider', { name: '演示时间轴' }).inputValue();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('slider', { name: '演示时间轴' })).toHaveValue(position);
    if (cycle % 7 === 0) {
      await page.reload();
      await expect(page.getByLabel('演示算法')).toHaveValue(algorithms[(cycle - 1) % algorithms.length]);
      await expect(page.getByRole('slider', { name: '演示时间轴' })).toHaveValue(position);
      await expect(page.locator('.algo-progress')).toContainText('已暂停');
    }
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(page.locator('.algo-result')).toBeVisible();
    await page.getByRole('button', { name: '演示上一步' }).click();
    await page.getByRole('button', { name: '思路引导', exact: true }).click();
    await page.getByLabel('向教练提问', { exact: true }).fill(question);
    const language = cycle % 2 ? 'cpp' : 'python';
    await page.getByRole('button', { name: language === 'cpp' ? 'C++' : 'Python', exact: true }).click();
    await expect(page.locator('.code-toolbar .selected')).toHaveText(language === 'cpp' ? 'C++' : 'Python');
    await expect(page.getByRole('button', { name: language === 'cpp' ? 'C++' : 'Python', exact: true })).toBeEnabled();
    const code = `${language === 'cpp' ? '//' : '#'} 连续检查第 ${cycle} 次；草稿只属于隔离数据库。`;
    await page.locator('.monaco-editor textarea.inputarea').focus();
    await page.keyboard.press('Control+A'); await page.keyboard.insertText(code);
    await expect.poll(async () => (await (await api.get(`/api/sessions/${item.id}`)).json()).drafts[language], { timeout: 10000 }).toBe(code);
    if (cycle % 5 === 0) {
      await page.getByLabel('题目操作').click();
      await page.getByRole('button', { name: '复盘笔记', exact: true }).click();
      const note = `## 连续使用检查\n\n第 ${cycle} 轮，笔记和双语代码必须分别保存。`;
      await page.getByLabel('复盘笔记', { exact: true }).fill(note);
      await page.getByRole('button', { name: '保存笔记', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await (await api.get(`/api/sessions/${item.id}`)).json()).notes).toBe(note);
    }
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
    await expect(page.locator('.ink-impact')).toHaveCount(0, { timeout: 5000 });
    result.cycles = cycle;
    if (cycle === 3 || cycle % 20 === 0) {
      await snapshot(cycle === 3 ? 'warmed-home' : 'home');
      const sample = result.samples.at(-1);
      if (sample.heap_mb > 512) throw new Error(`Retained heap exceeded 512 MB: ${sample.heap_mb}`);
      console.log(`Cycle ${cycle}: ${sample.heap_mb} MB after GC; no page/API errors.`);
    }
    if (result.page_errors.length || result.failed_api_responses.length) throw new Error('Browser or API failures occurred; inspect result JSON.');
    await page.locator('nav .nav-item').filter({ hasText: '做题记录' }).click();
    await page.getByLabel('搜索做题记录').fill(title);
    await page.locator('.record-title').getByRole('button', { name: title, exact: true }).click();
    await expect(page.getByLabel('向教练提问', { exact: true })).toHaveValue(question);
    await expect(page.locator('.monaco-editor')).toContainText(code);
  }
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
  await expect(page.locator('.ink-impact')).toHaveCount(0, { timeout: 5000 });
  await snapshot('final-home');
  const baseline = result.samples.find(sample => sample.label === 'warmed-home');
  result.retained_growth_mb = baseline ? Math.round((result.samples.at(-1).heap_mb - baseline.heap_mb) * 100) / 100 : null;
  const stored = await (await api.get(`/api/sessions/${item.id}`)).json();
  expect(stored.stage).toBe(0); expect(stored.status).toBe('learning');
  result.final_record = { cpp_characters: stored.drafts.cpp.length, python_characters: stored.drafts.python.length, notes_characters: stored.notes.length, stage: stored.stage, status: stored.status };
  result.stopped = stop;
  result.passed = !stop && result.cycles > 0 && !result.page_errors.length && !result.failed_api_responses.length;
} catch (error) { result.error = error.stack || String(error); process.exitCode = 1; }
finally {
  result.finished_at = new Date().toISOString();
  result.elapsed_minutes = Math.round((Date.parse(result.finished_at) - Date.parse(result.started_at)) / 60000 * 100) / 100;
  if (item) { try { result.cleanup_completed = (await api.delete(`/api/sessions/${item.id}`)).status() === 204; } catch (error) { result.cleanup_error = String(error); } }
  await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
  await browser.close(); await api.dispose();
  console.log(JSON.stringify({ result: resultPath, cycles: result.cycles, minutes: result.elapsed_minutes, passed: result.passed, cleanup: result.cleanup_completed, error: result.error }));
}
