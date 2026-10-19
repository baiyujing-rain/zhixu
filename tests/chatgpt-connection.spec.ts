import { test, expect } from '@playwright/test';

test('ChatGPT 设置可发现，手机布局可用，取消登录不假装授权成功', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const status = { connected: false, plan_enabled: false, account: null, accounts: [], pending: false, error: null };
  await page.route('**/api/auth/status', route => route.fulfill({ json: status }));
  await page.route('**/api/auth/start', route => { status.pending = true; return route.fulfill({ json: { authorization_url: '/api/auth/authorize?ticket=test-ticket' } }); });
  await page.route('**/api/settings/provider', route => route.fulfill({ json: { configured: false, provider: 'chatgpt', api_configured: false, base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' } }));
  await page.route('**/api/auth/cancel', route => { status.pending = false; return route.fulfill({ json: status }); });
  await page.context().route('**/api/auth/authorize?ticket=test-ticket', route => route.fulfill({ body: '<h1>Mock official authorization navigation</h1>', contentType: 'text/html' }));
  await page.goto('/?view=settings');
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled();
  await page.screenshot({ path: 'artifacts/chatgpt-settings-desktop.png', fullPage: true });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  const popup = await popupPromise;
  await expect(page.getByText('等待你在浏览器中完成授权')).toBeVisible();
  await popup.close();
  await page.getByRole('button', { name: '取消授权' }).click();
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -200, 0)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'artifacts/chatgpt-settings-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('已授权账号显示模型及订阅说明，刷新不重复欢迎提示', async ({ page }) => {
  const status = { connected: true, plan_enabled: true, account: { id: 'mock-account', email: 'student@example.com', model: 'account-model' }, accounts: [{ id: 'mock-account', email: 'student@example.com', connected: true }], pending: false, error: null };
  await page.route('**/api/auth/status', route => route.fulfill({ json: status }));
  await page.route('**/api/settings', route => route.fulfill({ json: { configured: true, provider: 'chatgpt', api_configured: false, chatgpt: status, base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' } }));
  await page.route('**/api/auth/models', route => route.fulfill({ json: { models: [{ slug: 'account-model', display_name: '账号可用模型' }], selected: 'account-model' } }));
  await page.goto('/?view=settings');
  await expect(page.getByRole('dialog', { name: 'ChatGPT 订阅使用说明' })).toBeVisible();
  await page.getByRole('button', { name: '知道了' }).click();
  await expect(page.getByRole('combobox', { name: 'ChatGPT 模型' })).toHaveValue('account-model');
  await expect(page.getByText('student@example.com', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/chatgpt-settings-authorized-demo.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'ChatGPT 模型' })).toHaveValue('account-model');
  await expect(page.getByRole('dialog', { name: 'ChatGPT 订阅使用说明' })).not.toBeVisible();
  await expect(page.getByRole('link', { name: '管理 ChatGPT 用量' })).toBeVisible();
});
