import { test, expect } from '@playwright/test';

test('两数之和默认哈希表演示，不排序原数组，先查后存避免重复使用当前位置', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  try {
    await page.goto(`/?session=${item.id}&panel=visualize`);
    await expect(page.getByLabel('演示算法')).toHaveValue('hash-two-sum');
    const demo = page.locator('.algorithm-demo');
    await page.getByRole('button', { name: '演示下一步' }).click();
    await expect(demo.locator('.hash-needed strong')).toHaveText('3');
    await expect(demo.locator('.hash-table')).toContainText('空表');
    await page.getByRole('button', { name: '演示下一步' }).click();
    await expect(demo.locator('.algo-explanation')).toContainText('补数还没有出现');
    await page.getByRole('button', { name: '演示下一步' }).click();
    await expect(demo.locator('.hash-table [data-value="3"]')).toHaveAttribute('data-index', '0');
    await expect(demo.locator('.algo-array [data-index="0"]')).toContainText('3');
    await expect(demo.locator('.algo-array [data-index="1"]')).toContainText('2');
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result strong')).toHaveText('[1, 2]');
    await expect(demo.locator('.cell-found')).toHaveCount(2);
    await expect(demo.locator('.hash-table .is-matching')).toHaveAttribute('data-value', '2');
    await expect(demo.locator('.pointer-mid')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 152, 24)');
    await page.screenshot({ path: 'artifacts/algorithm-hash-desktop.png' });
    await page.locator('.algo-input-settings summary').click();
    await page.getByRole('textbox', { name: '演示原始数组' }).fill('3,3');
    await page.getByRole('button', { name: '应用输入' }).click();
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result strong')).toHaveText('[0, 1]');
    await page.locator('.algo-input-settings summary').click();
    await page.getByRole('textbox', { name: '演示原始数组' }).fill('3');
    await page.getByRole('button', { name: '应用输入' }).click();
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result')).toContainText('没有数对');
    await expect(demo.locator('.algo-principle')).toContainText('最坏 O(n²)');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts).toEqual(item.drafts);
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});
