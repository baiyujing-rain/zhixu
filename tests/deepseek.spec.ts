import { test, expect } from '@playwright/test';

const data = {
  assessment: 'correct', summary: '用哈希表减少重复扫描。', variables: ['n 表示数组长度。'],
  current: { time: '最坏 O(n²)', space: 'O(1)', time_reason: '两层循环。', space_reason: '只有循环下标。' },
  target: { time: '平均 O(n)', space: 'O(n)', time_reason: '一次遍历和平均常数查询。', space_reason: '保存已出现元素。' },
  bottlenecks: ['重复扫描候选元素。'], steps: ['先查补数再保存当前元素。'], tradeoffs: ['额外空间换取平均线性时间。'], checks: ['重复元素 [3,3]。'], proof: '映射只包含之前的下标。', changes: ['使用 seen 命名。'],
  optimized_code: 'class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, value in enumerate(nums):\n            if target - value in seen:\n                return [seen[target - value], i]\n            seen[value] = i',
};

test('DeepSeek 网页版入口、复制上下文、刷新继续、导入保存与专注三栏', async ({ page, request }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  // Settings are simulated; handoff preparation, persistence and import use real API.
  // No global provider is changed and no paid inference is called.
  let provider = 'chatgpt';
  await page.route('**/api/settings', route => route.fulfill({ json: { provider, configured: true, api_configured: false, base_url: 'https://api.openai.com/v1', model: 'mock', deepseek_configured: false, deepseek_model: 'deepseek-flash' } }));
  await page.route('**/api/settings/provider', async route => { provider = route.request().postDataJSON().provider; await route.fulfill({ json: { provider } }); });
  await page.route('**/api/auth/status', route => route.fulfill({ json: { connected: false, plan_enabled: false, pending: false, account: null, accounts: [] } }));
  const response = await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } });
  const item = await response.json();
  try {
    await page.goto('/?view=settings');
    await page.getByRole('button', { name: '使用 DeepSeek 网页版转接', exact: true }).click();
    await expect(page.getByRole('button', { name: '已选择网页版转接' })).toBeVisible();
    await page.goto(`/?session=${item.id}`);
    await page.getByRole('button', { name: '给我一个提示', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'DeepSeek 网页版转接' });
    await expect(dialog).toBeVisible();
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).stage).toBe(0);
    await page.getByRole('button', { name: '复制提问', exact: true }).click();
    await expect(page.getByRole('button', { name: '提问已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('C++17');
    await expect(page.getByRole('link', { name: '打开 DeepSeek 网页版' })).toHaveAttribute('href', 'https://chat.deepseek.com/');
    await page.getByText('查看完整提问', { exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'DeepSeek 提问内容' })).toHaveValue(/C\+\+17/);
    await page.reload();
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: '稍后继续' }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: '继续 DeepSeek 转接' }).click();
    await page.getByLabel('粘贴 DeepSeek 的完整回复', { exact: true }).fill('### 先用一个例子\n返回的是两个下标，你可以先手算 [2,7]。');
    await page.getByRole('button', { name: '导入并保存回复' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('heading', { name: '先用一个例子' })).toBeVisible();
    await expect(page.locator('.messages')).toContainText('DeepSeek 网页版导入');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).stage).toBe(1);
    await page.reload();
    await expect(page.getByRole('heading', { name: '先用一个例子' })).toBeVisible();
    await expect(page.locator('.sidebar')).not.toBeVisible();
    await expect(page.locator('.topbar')).not.toBeVisible();
    await page.screenshot({ path: 'artifacts/focus-deepseek-desktop.png', fullPage: true });
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
    await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('DeepSeek 优化转接两阶段导入，错误回复不写入报告，原草稿保留', async ({ page, request }) => {
  await page.route('**/api/settings', route => route.fulfill({ json: { provider: 'deepseek_web', configured: true, api_configured: false } }));
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'python' } })).json();
  const original = 'class Solution:\n    def twoSum(self, nums, target):\n        for i in range(len(nums)):\n            for j in range(i + 1, len(nums)):\n                if nums[i] + nums[j] == target:\n                    return [i, j]';
  await request.patch(`/api/sessions/${item.id}`, { data: { code: original } });
  try {
    await page.goto(`/?session=${item.id}&panel=optimize`);
    await page.getByRole('button', { name: '分析当前解法', exact: true }).click();
    await page.getByLabel('粘贴 DeepSeek 的完整回复（JSON 分析报告）').fill('不是 JSON');
    await page.getByRole('button', { name: '导入并保存回复' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('JSON');
    expect((await (await request.get(`/api/sessions/${item.id}/optimizations`)).json()).length).toBe(0);
    await page.getByLabel('粘贴 DeepSeek 的完整回复（JSON 分析报告）').fill(JSON.stringify(data));
    await page.getByRole('button', { name: '导入并保存回复' }).click();
    await expect(page.getByRole('heading', { name: '先看清你的解法' })).toBeVisible();
    await expect(page.locator('.opt-code')).toHaveCount(0);
    await page.getByRole('button', { name: '生成精炼代码', exact: true }).click();
    await page.getByLabel('粘贴 DeepSeek 的完整回复（JSON 分析报告）').fill(JSON.stringify(data));
    await page.getByRole('button', { name: '导入并保存回复' }).click();
    await expect(page.getByRole('heading', { name: '更好的解法，为什么更好' })).toBeVisible();
    await expect(page.locator('.opt-code')).toContainText('seen = {}');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.python).toBe(original);
    await page.reload();
    await expect(page.locator('.opt-code')).toContainText('seen = {}');
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});
