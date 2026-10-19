import { test, expect } from '@playwright/test';

test('从题目加入复习，先回想再展开笔记，自评保存并安排下一次，暂停保留历史', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'python' } })).json();
  await request.patch(`/api/sessions/${item.id}`, { data: { notes: '先查补数，再存当前数字，保证两个位置不同。' } });
  try {
    await page.goto(`/?session=${item.id}`);
    await page.getByLabel('题目操作').click();
    await page.getByRole('button', { name: '加入复习计划', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已加入复习计划');
    await page.goto('/?view=review');
    await expect(page.getByRole('heading', { name: '想通之后，再想一遍。' })).toBeVisible();
    const row = page.locator('.review-row').filter({ hasText: item.title });
    await row.getByRole('button', { name: '开始回想', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `回想练习 · ${item.title}` });
    await expect(dialog.locator('.review-question')).toContainText('目标值');
    await expect(dialog).not.toContainText('先查补数，再存当前数字');
    await dialog.getByRole('button', { name: '回想后，展开以往笔记' }).click();
    await expect(dialog.locator('.review-old-notes')).toContainText('先查补数，再存当前数字');
    await dialog.getByLabel('本次复习观察').fill('哈希表只保存前面见过的位置，额外空间 O(n)。');
    await page.screenshot({ path: 'artifacts/review-recall-desktop.png' });
    await dialog.getByRole('button', { name: '基本想起 1 天后', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('.review-notice')).toContainText('下一次安排在');
    await page.getByRole('button', { name: '接下来', exact: true }).click();
    await expect(row).toContainText('已复习 1 次');
    await page.screenshot({ path: 'artifacts/review-board-desktop.png' });
    const history = await (await request.get(`/api/sessions/${item.id}/reviews`)).json();
    expect(history).toHaveLength(1); expect(history[0].note).toContain('额外空间 O(n)');
    const retained = await (await request.get(`/api/sessions/${item.id}`)).json();
    expect(retained.stage).toBe(0); expect(retained.status).toBe('learning');
    await row.getByRole('button', { name: '暂停安排', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '暂停安排', exact: true }).click();
    await expect(row).toHaveCount(0);
    expect((await (await request.get(`/api/sessions/${item.id}/reviews`)).json())).toHaveLength(1);
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('手机和夜墨回想布局无溢出，多窗口冲突不重复记录，未提交观察可继续', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'valid-parentheses', language: 'cpp' } })).json();
  await request.post(`/api/sessions/${item.id}/review-plan`);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?view=review');
    await expect(page.getByRole('heading', { name: '想通之后，再想一遍。' })).toBeVisible();
    await page.getByRole('button', { name: '展开菜单' }).click();
    await page.getByRole('button', { name: '切换深色模式' }).click();
    await page.getByRole('button', { name: '收起菜单' }).click();
    const row = page.locator('.review-row').filter({ hasText: item.title });
    await row.getByRole('button', { name: '开始回想', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('本次复习观察').fill('先确认栈不空，再检查栈顶。');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await row.getByRole('button', { name: '开始回想', exact: true }).click();
    await expect(dialog.getByLabel('本次复习观察')).toHaveValue('先确认栈不空，再检查栈顶。');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'artifacts/review-recall-mobile-dark.png' });
    await request.post(`/api/sessions/${item.id}/reviews`, { data: { rating: 'easy', expected_version: 0, note: 'another window rated this item' } });
    await dialog.getByRole('button', { name: '忘了 10 分钟后', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('复习计划已改变');
    expect((await (await request.get(`/api/sessions/${item.id}/reviews`)).json())).toHaveLength(1);
    await expect(dialog.getByLabel('本次复习观察')).toHaveValue('先确认栈不空，再检查栈顶。');
    await dialog.getByRole('button', { name: '关闭并刷新安排' }).click();
    await page.getByRole('button', { name: '接下来', exact: true }).click();
    await expect(row.getByRole('button', { name: '提前回想' })).toBeEnabled();
    await page.screenshot({ path: 'artifacts/review-board-mobile-dark.png' });
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});
