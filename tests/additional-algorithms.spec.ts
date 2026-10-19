import { test, expect, type Page } from '@playwright/test';

async function input(page: Page, label: string, value: string) {
  const setup = page.locator('.algo-input-settings');
  if ((await setup.getAttribute('open')) === null) await setup.locator('summary').click();
  await page.getByRole('textbox', { name: label, exact: true }).fill(value);
  await page.getByRole('button', { name: '应用输入', exact: true }).click();
}
async function seek(page: Page, step: number) {
  await page.getByRole('slider', { name: '演示时间轴' }).focus();
  await page.keyboard.press('Home');
  for (let index = 0; index < step; index++) await page.keyboard.press('ArrowRight');
}

test('滑动窗口真正移动左端，重复字符先移除再加入，回退恢复与空串 / ASCII 校验', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/?session=${item.id}&panel=visualize`);
    await page.getByLabel('演示算法').selectOption('sliding-window');
    await input(page, '演示滑动窗口字符串', 'abba');
    const demo = page.locator('.algorithm-demo');
    const left = demo.locator('.pointer-left');
    const oldPosition = await left.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).e);
    await seek(page, 9);
    await expect(demo.locator('.algo-explanation')).toContainText('移除 a');
    await expect(left).toHaveCSS('transition-duration', '0.45s');
    await expect.poll(async () => left.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).e)).toBeGreaterThan(oldPosition + 30);
    await expect(demo.locator('.window-table-values')).toContainText('b');
    await expect(demo.locator('.window-table-values')).not.toContainText('a');
    await expect(demo.locator('[data-index="0"][data-window]')).toHaveAttribute('data-window', 'false');
    await expect(demo.locator('[data-index="1"][data-window]')).toHaveAttribute('data-window', 'true');
    const explanation = await demo.locator('.algo-explanation').innerText();
    await page.getByRole('button', { name: '演示上一步' }).click();
    await expect(demo.locator('.algo-explanation')).toContainText('重复');
    await page.getByRole('button', { name: '演示下一步' }).click();
    await expect.poll(() => demo.locator('.algo-explanation').innerText()).toBe(explanation);
    await page.screenshot({ path: 'artifacts/algorithm-window-desktop.png' });
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result strong')).toHaveText('2');
    await input(page, '演示滑动窗口字符串', '');
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result strong')).toHaveText('0');
    await input(page, '演示滑动窗口字符串', '你a');
    await expect(demo.getByRole('alert')).toContainText('英文字母或数字');
    await expect(demo.locator('.algo-result strong')).toHaveText('0');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts).toEqual(item.drafts);
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('BFS 队列真正先进先出，标记距离、最短路径、不可达与起终同格正确', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'python' } })).json();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/?session=${item.id}&panel=visualize`);
    await page.getByLabel('演示算法').selectOption('bfs');
    const demo = page.locator('.algorithm-demo');
    await seek(page, 7);
    const queueSecond = demo.locator('.bfs-queue-token').filter({ hasText: '(1,0)' });
    await expect(queueSecond).toHaveCSS('opacity', '1');
    await expect(queueSecond).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 62, 0)');
    await page.getByRole('button', { name: '演示下一步' }).click();
    await expect(demo.locator('.algo-explanation')).toContainText('队首取出 (0, 1)');
    await expect(queueSecond).toHaveCSS('transition-duration', '0.45s');
    await expect.poll(async () => queueSecond.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).e)).toBeLessThan(25);
    await page.screenshot({ path: 'artifacts/algorithm-bfs-frontier-desktop.png' });
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result strong')).toHaveText('8');
    await expect(demo.locator('.bfs-path-line')).toHaveCount(1);
    await expect(demo.locator('.bfs-cell[data-state="path"]')).toHaveCount(9);
    await page.getByText('对照 Python 核心代码', { exact: true }).click();
    await expect(demo.locator('.algo-code code.is-active')).toContainText('return dist[r][c]');
    await page.screenshot({ path: 'artifacts/algorithm-bfs-path-desktop.png' });
    await input(page, '演示 BFS 网格', 'S#E');
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result strong')).toHaveText('-1');
    await expect(demo.locator('.bfs-path-line')).toHaveCount(0);
    await input(page, '演示 BFS 网格', 'B');
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result strong')).toHaveText('0');
    await input(page, '演示 BFS 网格', 'S..\n.E');
    await expect(demo.getByRole('alert')).toContainText('每行格数必须相同');
    await expect(demo.locator('.algo-result strong')).toHaveText('0');
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('新演示手机夜墨无溢出，刷新恢复输入与暂停位置，关闭平滑动画停止过渡', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?session=${item.id}&panel=visualize`);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.getByLabel('演示算法').selectOption('bfs');
    await input(page, '演示 BFS 网格', 'S..\n.#.\n..E');
    await seek(page, 6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await expect(page.locator('.bfs-queue-token').filter({ hasText: '(0,1)' })).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await page.screenshot({ path: 'artifacts/algorithm-bfs-mobile-dark.png' });
    await page.getByRole('checkbox', { name: '平滑动画', exact: true }).uncheck();
    await expect(page.locator('.bfs-queue-token').first()).toHaveCSS('transition-duration', '0s');
    await page.reload();
    await expect(page.getByLabel('演示算法')).toHaveValue('bfs');
    await expect(page.locator('.algo-progress')).toContainText('步骤 7');
    await expect(page.locator('.algo-progress')).toContainText('已暂停');
    await page.getByLabel('演示算法').selectOption('sliding-window');
    await input(page, '演示滑动窗口字符串', 'Aa0Aa1Bb2');
    await seek(page, 9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'artifacts/algorithm-window-mobile.png' });
    expect(errors).toEqual([]);
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});
