import { test, expect } from '@playwright/test';

test('浏览器禁止本地存储时仍可学习、切换主题和动画并保存服务器草稿', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      Object.defineProperty(Storage.prototype, method, { value: () => { throw new DOMException('Storage is blocked', 'SecurityError'); } });
    }
  });
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  try {
    await page.goto('/?view=settings');
    await expect(page.getByRole('button', { name: '动态', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '切换深色模式' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('.page-heading h1').click();
    await expect(page.locator('.ink-impact')).toHaveCount(0);
    await page.getByRole('button', { name: '动态', exact: true }).click();
    await page.locator('.page-heading h1').click();
    await expect(page.locator('.ink-impact')).toHaveCount(1);
    await page.goto(`/?session=${item.id}`);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.locator('.monaco-editor textarea.inputarea').focus();
    await page.keyboard.press('Control+A'); await page.keyboard.insertText('// server save works without local cache');
    await expect(page.locator('.draft-notice')).toContainText('无法缓存草稿');
    await expect(page.locator('.code-toolbar')).toContainText('已保存');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.cpp).toBe('// server save works without local cache');
    expect(errors).toEqual([]);
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('其他窗口的草稿存储事件不会中断当前水墨波纹', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { name: '今天，想通一道题。' }).click();
  await expect(page.locator('.ink-impact')).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'zhixu-code-999-cpp', newValue: '{}' })));
  await expect(page.locator('.ink-impact')).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'zhixu-ink-motion', newValue: 'off' })));
  await expect(page.locator('.ink-impact')).toHaveCount(0);
});
