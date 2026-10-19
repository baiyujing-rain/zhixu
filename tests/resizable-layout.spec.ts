import { test, expect, type Locator, type Page } from '@playwright/test';

async function drag(page: Page, handle: Locator, dx: number, dy = 0) {
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2 + dy, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('body')).not.toHaveAttribute('data-resizing');
}
async function width(locator: Locator) { return (await locator.boundingBox())!.width; }
async function height(locator: Locator) { return (await locator.boundingBox())!.height; }
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
}

test('做题栏与上下区域可拖动，保存布局，编辑器正常，最小尺寸和窄屏适配', async ({ page, request }) => {
  const response = await request.post('/api/sessions', { data: { content: '', language: 'cpp', example_id: 'two-sum' } });
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`/?session=${session.id}`);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await expect(page.locator('.sidebar')).not.toBeVisible();
    await expect(page.locator('.topbar')).not.toBeVisible();
    await expect(page.locator('.work-heading')).toHaveCount(0);
    const bounds = await page.locator('.work-columns').boundingBox();
    expect(bounds!.x).toBe(0); expect(bounds!.y).toBe(0);
    expect(bounds!.width).toBe(1440); expect(bounds!.height).toBe(1100);
    const problem = page.locator('.problem-panel'), coach = page.locator('.coach-panel'), code = page.locator('.code-panel');
    const first = page.getByRole('separator', { name: '调整题目与引导宽度', exact: true });
    const second = page.getByRole('separator', { name: '调整引导与代码宽度', exact: true });
    const original = await width(problem), originalCode = await width(code);
    await drag(page, first, 80);
    expect(await width(problem)).toBeCloseTo(original + 80, 0);
    await drag(page, second, -50);
    expect(await width(code)).toBeCloseTo(originalCode + 50, 0);
    await drag(page, first, -1000);
    expect(await width(problem)).toBeGreaterThanOrEqual(179);
    await drag(page, first, 1000);
    expect(await width(coach)).toBeGreaterThanOrEqual(279);
    await first.dblclick();
    await drag(page, first, 60);
    const rows = page.getByRole('separator', { name: '调整代码编辑与操作区域高度', exact: true });
    const editorHeight = await height(page.locator('.editor-container'));
    await drag(page, rows, 0, -70);
    expect(await height(page.locator('.editor-container'))).toBeCloseTo(editorHeight - 70, 0);
    await drag(page, page.getByRole('separator', { name: '调整引导内容与追问区域高度', exact: true }), 0, -50);
    const textarea = page.locator('.monaco-editor textarea.inputarea');
    await textarea.focus(); await page.keyboard.press('Control+A');
    await page.keyboard.insertText('// resize keeps editing working');
    await page.getByRole('button', { name: '保存代码', exact: true }).click();
    await expect(page.locator('.code-toolbar')).toContainText('已保存');
    await expect(page.locator('.ink-impact')).toHaveCount(0, { timeout: 2500 });
    await page.locator('.monaco-editor .view-lines').click();
    await expect(page.locator('.ink-impact')).toHaveCount(1);
    const savedWidth = await width(problem), savedHeight = await height(page.locator('.editor-container'));
    await page.reload();
    await expect(page.locator('.monaco-editor')).toContainText('resize keeps editing working');
    expect(await width(problem)).toBeCloseTo(savedWidth, 0);
    expect(await height(page.locator('.editor-container'))).toBeCloseTo(savedHeight, 0);
    await first.focus(); await page.keyboard.press('ArrowRight');
    expect(await width(problem)).toBeCloseTo(savedWidth + 12, 0);
    await page.screenshot({ path: 'artifacts/resizable-work-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 900, height: 900 });
    await noOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(first).not.toBeVisible();
    await expect(page.getByRole('separator', { name: '调整侧栏宽度' })).not.toBeVisible();
    await page.getByRole('button', { name: '我的代码', exact: true }).click();
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await noOverflow(page);
    expect(errors).toEqual([]);
  } finally { await request.delete(`/api/sessions/${session.id}`); }
});

test('侧栏、首页卡片及设置可调整，刷新保存，双击还原，手机使用自然高度', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
  const sidebar = page.locator('.sidebar');
  const sidebarHandle = page.getByRole('separator', { name: '调整侧栏宽度', exact: true });
  const sideWidth = await width(sidebar);
  await drag(page, sidebarHandle, 35);
  expect(await width(sidebar)).toBeCloseTo(sideWidth + 35, 0);
  const composer = page.locator('.composer');
  const homeHandle = page.getByRole('separator', { name: '调整题目输入与学习足迹宽度', exact: true });
  const composerWidth = await width(composer);
  await drag(page, homeHandle, -55);
  expect(await width(composer)).toBeCloseTo(composerWidth - 55, 0);
  const cardHandle = page.getByRole('separator', { name: '调整题目输入高度', exact: true });
  const naturalHeight = await height(composer);
  await drag(page, cardHandle, 0, 80);
  expect(await height(composer)).toBeCloseTo(naturalHeight + 80, 0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
  expect(await width(sidebar)).toBeCloseTo(sideWidth + 35, 0);
  expect(await width(composer)).toBeCloseTo(composerWidth - 55, 0);
  expect(await height(composer)).toBeCloseTo(naturalHeight + 80, 0);
  await cardHandle.dblclick();
  expect(await height(composer)).toBeCloseTo(naturalHeight, 0);
  await page.locator('.sidebar .nav-item').filter({ hasText: '学习设置' }).click();
  const settingsCard = page.locator('.settings-top-split .settings-card');
  const prefWidth = await width(settingsCard);
  await drag(page, page.getByRole('separator', { name: '调整学习偏好与说明宽度' }), -60);
  expect(await width(settingsCard)).toBeCloseTo(prefWidth - 60, 0);
  await noOverflow(page);
  await page.locator('nav .nav-item').filter({ hasText: '学习工作台' }).click();
  await page.screenshot({ path: 'artifacts/resizable-home-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(homeHandle).not.toBeVisible();
  await expect(cardHandle).not.toBeVisible();
  await noOverflow(page);
});
