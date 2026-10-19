import { test, expect } from '@playwright/test';

const firstProblem = '复制的第一道题\n给定一个整数数组，计算所有元素的和。数组可能为空，请说明处理方式。';
const nextProblem = '准备下一道题\n给定一个有序数组和目标值，请返回目标的位置，不存在时返回负一。';

test('刷新保留题目，体验示例不丢草稿，创建期间继续输入的下一道题不会被清掉', async ({ page, request }) => {
  const created: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const submitted = new Promise<void>(resolve => { started = resolve; });
  try {
    await page.goto('/');
    await page.getByLabel('题目内容', { exact: true }).fill(firstProblem);
    await page.reload();
    await expect(page.getByLabel('题目内容', { exact: true })).toHaveValue(firstProblem);
    await page.getByRole('button', { name: '两数之和 数组 / 哈希表 简单' }).click();
    await page.waitForURL(/session=/); created.push(Number(new URL(page.url()).searchParams.get('session')));
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page.getByLabel('题目内容', { exact: true })).toHaveValue(firstProblem);
    await page.route('**/api/sessions', async route => {
      if (route.request().method() === 'POST') {
        const response = await route.fetch(); const item = await response.json(); created.push(item.id); started(); await gate; await route.fulfill({ response });
      } else await route.continue();
    });
    await page.getByRole('button', { name: '开始拆解题目' }).click();
    await submitted;
    await page.getByLabel('题目内容', { exact: true }).fill(nextProblem);
    release();
    await expect(page.getByRole('heading', { name: '复制的第一道题', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回工作台' }).click();
    await expect(page.getByLabel('题目内容', { exact: true })).toHaveValue(nextProblem);
    await page.reload();
    await expect(page.getByLabel('题目内容', { exact: true })).toHaveValue(nextProblem);
  } finally { release?.(); for (const id of created) await request.delete(`/api/sessions/${id}`); }
});

test('未发问题刷新恢复，提示不清掉输入，回复不会清掉等待期间的下一条问题', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const submitted = new Promise<void>(resolve => { started = resolve; });
  try {
    await page.goto(`/?session=${item.id}`);
    const input = page.getByLabel('向教练提问', { exact: true });
    await input.fill('我还没发出的疑问，为什么不能重复使用同一个下标？');
    await page.reload();
    await expect(input).toHaveValue('我还没发出的疑问，为什么不能重复使用同一个下标？');
    await page.getByRole('button', { name: '给我一个提示', exact: true }).click();
    await expect(page.getByRole('heading', { name: '先把问题说清楚' })).toBeVisible();
    await expect(input).toHaveValue('我还没发出的疑问，为什么不能重复使用同一个下标？');
    await page.route(`**/api/sessions/${item.id}/coach`, async route => {
      const body = route.request().postDataJSON();
      const current = await (await request.get(`/api/sessions/${item.id}`)).json();
      started(); await gate;
      // Only the model response is a test double; draft storage and server writes are real.
      await route.fulfill({ json: { ...current, messages: [...current.messages, { role: 'user', content: body.message }, { role: 'assistant', content: '测试回复：先查询再记录，确保位置不同。', source: 'ai' }] } });
    });
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await submitted;
    await input.fill('下一条问题：哈希表为什么要先查再存？');
    release();
    await expect(page.locator('.messages')).toContainText('测试回复：先查询再记录');
    await expect(input).toHaveValue('下一条问题：哈希表为什么要先查再存？');
    await page.reload();
    await expect(input).toHaveValue('下一条问题：哈希表为什么要先查再存？');
  } finally { release?.(); await request.delete(`/api/sessions/${item.id}`); }
});

test('禁用浏览器存储时，站内导航仍保留输入，实际无法持久化时明确提示', async ({ page, request }) => {
  await page.addInitScript(() => { for (const method of ['getItem', 'setItem', 'removeItem']) Object.defineProperty(Storage.prototype, method, { value: () => { throw new DOMException('Blocked storage', 'SecurityError'); } }); });
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  try {
    await page.goto('/');
    await page.getByLabel('题目内容', { exact: true }).fill(nextProblem);
    await expect(page.locator('.local-input-status')).toContainText('无法暂存');
    await page.locator('nav .nav-item').filter({ hasText: '做题记录' }).click();
    await page.locator('nav .nav-item').filter({ hasText: '学习工作台' }).click();
    await expect(page.getByLabel('题目内容', { exact: true })).toHaveValue(nextProblem);
    // Use same-document history so this checks the in-memory fallback, not a full-page navigation.
    await page.evaluate(id => { history.pushState({}, '', `/?session=${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, item.id);
    const input = page.getByLabel('向教练提问', { exact: true });
    await input.fill('这个问题还没有发送，要在当前窗口保留下来。');
    await page.getByRole('button', { name: '返回工作台' }).click();
    await page.evaluate(id => { history.pushState({}, '', `/?session=${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, item.id);
    await expect(input).toHaveValue('这个问题还没有发送，要在当前窗口保留下来。');
    await expect(page.locator('.question-box')).toContainText('无法暂存');
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});
