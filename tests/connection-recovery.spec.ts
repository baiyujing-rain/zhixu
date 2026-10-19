import { test, expect } from '@playwright/test';

test('首次读取失败不显示假零题，重连保留输入并恢复真实记录，手机布局清楚', async ({ page, request }) => {
  const before = await (await request.get('/api/sessions')).json();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByLabel('题目内容')).toBeVisible();
  const problem = '未创建的本地题目草稿：给定一个整数数组，返回所有不同数字的数量。';
  await page.getByLabel('题目内容').fill(problem);
  await page.route('**/api/sessions', route => route.fulfill({ status: 502, contentType: 'text/plain', body: 'Internal Server Error' }));
  await page.reload();
  await expect(page.getByRole('heading', { name: '暂时无法读取学习记录' })).toBeVisible();
  await expect(page.locator('.connection-empty [role=alert]')).toContainText('HTTP 502');
  await expect(page.locator('.journey-stats')).toHaveCount(0);
  await expect(page.locator('.connection')).toContainText('本机服务未连接');
  await expect(page.getByRole('button', { name: '开始一道新题' })).toBeDisabled();
  await expect(page.locator('body')).not.toContainText('Unexpected token');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'artifacts/connection-failed-mobile.png', fullPage: true });
  await page.unroute('**/api/sessions');
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
  await expect(page.getByLabel('题目内容')).toHaveValue(problem);
  await expect(page.locator('.journey-stats strong').first()).toContainText(String(before.length));
  expect(await (await request.get('/api/sessions')).json()).toEqual(before);
  expect(errors).toEqual([]);
});

test('连接超过十二秒有明确重试入口，重连恢复原题与演示面板', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let signal!: () => void;
  const started = new Promise<void>(resolve => { signal = resolve; });
  await page.clock.install();
  await page.route('**/api/profile', async route => { signal(); await gate; await route.abort().catch(() => {}); });
  try {
    await page.goto(`/?session=${item.id}&panel=visualize`);
    await started;
    await expect(page.getByRole('status')).toContainText('正在打开你的学习空间');
    await page.clock.fastForward(12500);
    await expect(page.getByRole('heading', { name: '暂时无法读取学习记录' })).toBeVisible();
    await expect(page.locator('.connection-empty [role=alert]')).toContainText('连接本机服务超时');
    await page.screenshot({ path: 'artifacts/connection-timeout-desktop.png', fullPage: true });
    release(); await page.unroute('**/api/profile');
    await page.getByRole('button', { name: '重新连接', exact: true }).click();
    await expect(page.getByRole('heading', { name: '两数之和', exact: true })).toBeVisible();
    await expect(page.locator('.algorithm-demo')).toBeVisible();
    await expect(page.locator('.algo-select')).toHaveValue('hash-two-sum');
    expect(new URL(page.url()).searchParams.get('session')).toBe(String(item.id));
  } finally { release(); await request.delete(`/api/sessions/${item.id}`); }
});

test('复习读取失败不冒充零计划，过期画面明确标记并等待刷新后继续', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'valid-parentheses', language: 'python' } })).json();
  await request.post(`/api/sessions/${item.id}/review-plan`);
  const before = await (await request.get('/api/reviews')).json();
  const fail = () => page.route('**/api/reviews', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '测试连接暂时中断' }) }));
  try {
    await fail(); await page.goto('/?view=review');
    await expect(page.getByRole('heading', { name: '复习安排暂时没有读到' })).toBeVisible();
    await expect(page.locator('.review-stats strong')).toHaveText(['—', '—', '—']);
    await expect(page.locator('.review-add')).toHaveCount(0);
    await expect(page.locator('.review-read-error')).toContainText('无法确认数量');
    await page.unroute('**/api/reviews');
    await page.getByRole('button', { name: '刷新安排', exact: true }).click();
    await expect(page.locator('.review-stats strong').nth(1)).toHaveText(String(before.stats.scheduled));
    const row = page.locator('.review-row').filter({ has: page.getByRole('heading', { name: item.title, exact: true }) });
    await expect(row.getByRole('button', { name: '开始回想' })).toBeEnabled();
    await fail(); await page.getByRole('button', { name: '刷新安排', exact: true }).click();
    await expect(page.locator('.review-read-error')).toContainText('上次读到的安排');
    await expect(row.getByRole('button', { name: '开始回想' })).toBeDisabled();
    await expect(row.getByRole('button', { name: '暂停安排' })).toBeDisabled();
    await page.unroute('**/api/reviews');
    await page.getByRole('button', { name: '刷新安排', exact: true }).click();
    await expect(page.locator('.review-read-error')).toHaveCount(0);
    await expect(row.getByRole('button', { name: '开始回想' })).toBeEnabled();
    const after = await (await request.get('/api/reviews')).json();
    expect(after.entries).toEqual(before.entries);
    expect(after.stats).toEqual(before.stats);
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});
