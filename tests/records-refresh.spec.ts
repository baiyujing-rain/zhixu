import { test, expect } from '@playwright/test';

test('手动刷新读取另一窗口的真实记录，导航也会更新列表，失败保留旧内容', async ({ page, request }) => {
  const ids: number[] = [];
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
    const title = `另一窗口的题目 ${Date.now()}`;
    const first = await (await request.post('/api/sessions', { data: { content: `${title}\n给定一个整数数组，返回所有元素的和，包含空数组。`, language: 'cpp' } })).json();
    ids.push(first.id);
    await page.getByRole('button', { name: '刷新学习记录', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('学习记录已刷新');
    const total = (await (await request.get('/api/sessions')).json()).length;
    await expect(page.locator('.journey-stats strong').first()).toHaveText(`${total}题`);
    await page.locator('nav .nav-item').filter({ hasText: '做题记录' }).click();
    const record = page.locator('.record-row').filter({ hasText: title });
    await expect(record).toBeVisible();
    await request.delete(`/api/sessions/${first.id}`);
    await page.route('**/api/sessions', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '测试服务中断' }) }));
    await page.getByRole('button', { name: '刷新学习记录', exact: true }).click();
    await expect(page.locator('.error-banner[role=alert]')).toContainText('上次读到的内容');
    await expect(record).toBeVisible();
    await page.unroute('**/api/sessions');
    await page.getByRole('button', { name: '刷新学习记录', exact: true }).click();
    await expect(record).toHaveCount(0);
    await expect(page.locator('.error-banner')).toHaveCount(0);
  } finally { for (const id of ids) await request.delete(`/api/sessions/${id}`); }
});

test('迟到的旧列表不会覆盖导航期间读到的新记录', async ({ page, request }) => {
  const ids: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let signal!: () => void;
  const started = new Promise<void>(resolve => { signal = resolve; });
  let reads = 0;
  let aborted = false;
  page.on('requestfailed', req => { if (req.url().endsWith('/api/sessions')) aborted = true; });
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
    await page.route('**/api/sessions', async route => {
      if (++reads === 1) { const response = await route.fetch(); signal(); await gate; await route.fulfill({ response }).catch(() => {}); }
      else await route.continue();
    });
    await page.getByRole('button', { name: '刷新学习记录', exact: true }).click();
    await started;
    const title = `延迟列表之后创建 ${Date.now()}`;
    const item = await (await request.post('/api/sessions', { data: { content: `${title}\n给定一个整数数组，返回其中的最大元素，说明空数组情况。`, language: 'python' } })).json();
    ids.push(item.id);
    await page.locator('nav .nav-item').filter({ hasText: '做题记录' }).click();
    await expect(page.locator('.record-row').filter({ hasText: title })).toBeVisible();
    release(); await expect.poll(() => aborted).toBe(true);
    await expect(page.locator('.record-row').filter({ hasText: title })).toBeVisible();
  } finally { release(); for (const id of ids) await request.delete(`/api/sessions/${id}`); }
});
