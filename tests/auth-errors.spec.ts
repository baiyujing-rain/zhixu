import { test, expect } from '@playwright/test';

test('非 JSON 的服务器错误显示可读提示并关闭空白登录窗口', async ({ page }) => {
  const status = { connected: false, plan_enabled: false, account: null, accounts: [], pending: false, error: null };
  await page.route('**/api/auth/status', route => route.fulfill({ json: status }));
  await page.route('**/api/settings/provider', route => route.fulfill({ json: {} }));
  await page.route('**/api/auth/start', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' }));
  await page.goto('/?view=settings');
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  const popup = await popupPromise;
  await expect(page.locator('.auth-error')).toHaveText('登录服务暂时不可用（HTTP 500），请稍后重试。');
  await expect.poll(() => popup.isClosed()).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled();
  await expect(page.locator('.auth-error')).not.toContainText('Unexpected token');
});
