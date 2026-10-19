import { test, expect } from '@playwright/test';

const original = 'class Solution:\n    def twoSum(self, nums, target):\n        for i in range(len(nums)):\n            for j in range(i + 1, len(nums)):\n                if nums[i] + nums[j] == target:\n                    return [i, j]';
const improved = 'class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, value in enumerate(nums):\n            need = target - value\n            if need in seen:\n                return [seen[need], i]\n            seen[value] = i\n        return []';
const payload = {
  assessment: 'correct', summary: '重复枚举所有数对是主要瓶颈。用哈希表保存已经出现的元素，可以用额外空间换取平均线性时间。', variables: ['n 表示数组长度'],
  current: { time: '最坏 O(n²)', space: 'O(1)', time_reason: '两层循环检查最多 n(n-1)/2 对下标。', space_reason: '只维护两个循环下标；返回值大小固定。' },
  target: { time: '平均 O(n)', space: 'O(n)', time_reason: '一次遍历，查询哈希表平均 O(1)；最坏时间可能退化到 O(n²)。', space_reason: '哈希表最多保存 n 个键值对。' },
  bottlenecks: ['每次选择第一个数，都重新扫描后续候选。'], steps: ['建立数值到下标的映射。', '查找 target - value，找到时返回两个下标。', '先查找，再保存当前元素，防止重复使用同一位置。'],
  changes: ['使用 seen、need 命名，保持每一步只有一个明确的动作。'], tradeoffs: ['辅助空间从 O(1) 增加到 O(n)，换取平均时间从 O(n²) 降到 O(n)。'], checks: ['重复值：[3,3]、目标 6，应返回两个不同下标。', '负数：[-2,7,5]、目标 3，应返回 [0,2]。', '末尾答案：[1,2,3,4]、目标 7，应返回 [2,3]。'], proof: '查询时，seen 只包含之前的元素，因此两个下标不同；补数与当前值的和为目标。', optimized_code: null as string | null,
};

test('优化报告分阶段生成，采用与恢复可逆，刷新保留报告，改动代码必须重新分析', async ({ page, request }) => {
  // Model calls are mocked; database, snapshots, editor writes and reload are real.
  const created = await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'python' } });
  const item = await created.json();
  await request.patch(`/api/sessions/${item.id}`, { data: { code: original } });
  const reports: unknown[] = [];
  await page.route('**/api/settings', route => route.fulfill({ json: { configured: true, provider: 'chatgpt', api_configured: false, base_url: 'https://api.openai.com/v1', model: 'mock' } }));
  await page.route(`**/api/sessions/${item.id}/optimizations`, route => route.fulfill({ json: reports }));
  await page.route(`**/api/sessions/${item.id}/optimize`, async route => {
    const body = route.request().postDataJSON();
    const stored = await (await request.get(`/api/sessions/${item.id}`)).json();
    expect(stored.drafts.python).toBe(original);
    const report = { id: reports.length + 1, session_id: item.id, language: 'python', goal: body.goal, phase: body.phase, input_code: original, created_at: new Date().toISOString().replace('Z', '+00:00'), verification: 'AI 静态分析，未执行代码。', data: { ...payload, optimized_code: body.phase === 'refine' ? improved : null } };
    reports.unshift(report);
    await route.fulfill({ status: 201, json: report });
  });
  try {
    await page.goto(`/?session=${item.id}`);
    await page.getByRole('button', { name: '解法优化', exact: true }).click();
    await expect(page.getByRole('button', { name: '生成精炼代码', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '分析当前解法' }).click();
    await expect(page.getByRole('heading', { name: '先看清你的解法' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '选择优化报告' })).not.toContainText('Invalid Date');
    await expect(page.locator('.complexity-comparison')).toContainText('O(n²)');
    await expect(page.locator('.opt-code')).toHaveCount(0);
    await page.getByRole('button', { name: '生成精炼代码', exact: true }).click();
    await expect(page.getByRole('heading', { name: '更好的解法，为什么更好' })).toBeVisible();
    await expect(page.locator('.opt-code')).toContainText('seen = {}');
    await page.screenshot({ path: 'artifacts/optimization-desktop.png', fullPage: true });
    await page.getByRole('button', { name: '采用此版本', exact: true }).click();
    await expect(page.getByRole('button', { name: '恢复原代码', exact: true })).toBeVisible();
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.python).toBe(improved);
    await page.getByRole('button', { name: '恢复原代码', exact: true }).click();
    await expect(page.locator('.opt-notice')).toContainText('已恢复本报告的原代码。');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.python).toBe(original);
    await page.reload();
    await expect(page.getByRole('heading', { name: '更好的解法，为什么更好' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.sidebar')).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'artifacts/optimization-mobile.png', fullPage: true });
    await request.patch(`/api/sessions/${item.id}`, { data: { code: original + '\n# another version' } });
    await page.reload();
    await expect(page.locator('.opt-stale')).toContainText('另一份代码快照');
    await expect(page.getByRole('button', { name: '生成精炼代码', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '采用此版本', exact: true })).toBeDisabled();
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});
