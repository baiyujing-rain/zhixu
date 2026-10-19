import { test, expect, type Page } from '@playwright/test';

async function setInput(page: Page, name: string, value: string) {
  const setup = page.locator('.algo-input-settings');
  if (await setup.getAttribute('open') === null) await setup.locator('summary').click();
  await page.getByRole('textbox', { name }).fill(value);
}

test('演示逐帧、回退、真实位移、时间轴、持久化和输入校验，代码草稿保持独立', async ({ page, request }) => {
  const created = await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } });
  const item = await created.json(), original = item.drafts.cpp;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/?session=${item.id}`);
    await page.getByRole('button', { name: '算法演示', exact: true }).click();
    await expect(page).toHaveURL(/panel=visualize/);
    const demo = page.locator('.algorithm-demo');
    await expect(demo).toBeVisible();
    await page.getByLabel('演示算法').selectOption('two-pointers');
    await expect(demo.locator('.algo-progress')).toContainText('已暂停');
    await expect(demo.locator('.algo-explanation h3')).toHaveText('从两端开始');
    await expect(page.getByRole('button', { name: '演示上一步' })).toBeDisabled();
    const next = page.getByRole('button', { name: '演示下一步' });
    await next.click();
    await expect(demo.locator('.algo-expression')).toHaveText('1 + 15 = 16');
    const right = demo.locator('.pointer-right');
    const before = await right.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).e);
    await next.click();
    await expect(demo.locator('.algo-explanation h3')).toHaveText('和太大，右指针向左');
    await expect(right).toHaveCSS('transition-duration', '0.45s');
    await expect.poll(async () => right.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).e)).toBeLessThan(before - 10);
    const explanation = await demo.locator('.algo-explanation').innerText();
    await page.getByRole('button', { name: '演示上一步' }).click();
    await expect(demo.locator('.algo-expression')).toHaveText('1 + 15 = 16');
    await next.click();
    await expect.poll(() => demo.locator('.algo-explanation').innerText()).toBe(explanation);
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result')).toContainText('[2, 4]');
    await expect(demo.locator('.cell-found')).toHaveCount(2);
    await expect(next).toBeDisabled();
    await page.getByText('对照 C++ 核心代码', { exact: true }).click();
    await expect(demo.locator('.algo-code code.is-active')).toContainText('return {left, right}');
    await page.getByRole('button', { name: '演示回到开头' }).click();
    const timeline = page.getByRole('slider', { name: '演示时间轴' });
    await timeline.focus(); await page.keyboard.press('ArrowRight');
    await expect(demo.locator('.algo-progress')).toContainText('步骤 2');
    await page.reload();
    await expect(demo.locator('.algo-progress')).toContainText('步骤 2');
    await expect(demo.locator('.algo-progress')).toContainText('已暂停');
    await setInput(page, '演示升序数组', '4,2,1');
    await page.getByRole('button', { name: '应用输入', exact: true }).click();
    await expect(demo.getByRole('alert')).toContainText('升序');
    await expect(demo.locator('.algo-progress')).toContainText('步骤 2');
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '取消修改' }).click();
    await page.screenshot({ path: 'artifacts/algorithm-pointers-desktop.png', fullPage: true });
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.cpp).toBe(original);
    expect(errors).toEqual([]);
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('二分无解和单元素、栈成功失败、DP 基础值及语言对照', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'binary-search', language: 'python' } })).json();
  try {
    await page.goto(`/?session=${item.id}&panel=visualize`);
    const demo = page.locator('.algorithm-demo'), select = page.getByLabel('演示算法', { exact: true });
    await expect(select).toHaveValue('binary-search');
    await setInput(page, '演示升序数组', '[]');
    await page.getByRole('button', { name: '应用输入' }).click();
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result')).toContainText('-1');
    await setInput(page, '演示升序数组', '9');
    await page.getByRole('button', { name: '应用输入' }).click();
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result')).toContainText('0');
    await select.selectOption('brackets');
    await page.getByRole('button', { name: '演示下一步' }).click();
    await page.getByRole('button', { name: '演示下一步' }).click();
    await expect(demo.locator('.stack-token').filter({ hasText: '下标 0' })).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: '演示上一步' }).click();
    await expect(demo.locator('.stack-token').filter({ hasText: '下标 0' })).toHaveCSS('opacity', '0');
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result')).toContainText('true');
    await setInput(page, '演示括号串', '([)]');
    await page.getByRole('button', { name: '应用输入' }).click();
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result')).toContainText('false');
    await expect(demo.locator('.algo-explanation')).toContainText('不能越过栈顶');
    await expect(demo.locator('.stack-token').filter({ hasText: '下标 1' })).toHaveCSS('opacity', '1');
    await page.screenshot({ path: 'artifacts/algorithm-stack-desktop.png', fullPage: true });
    await select.selectOption('stairs');
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result')).toContainText('13');
    await setInput(page, '演示台阶数', '0');
    await page.getByRole('button', { name: '应用输入' }).click();
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    await expect(demo.locator('.algo-result')).toContainText('1');
    await setInput(page, '演示台阶数', '6');
    await page.getByRole('button', { name: '应用输入' }).click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '演示下一步' }).click();
    await expect(demo.locator('.dp-destination')).toContainText('2');
    await expect(demo.locator('.dp-destination strong')).toHaveText('2');
    await page.getByText('对照 Python 核心代码', { exact: true }).click();
    await expect(demo.locator('.algo-code code.is-active')).toContainText('dp[i] = dp[i - 1] + dp[i - 2]');
    await page.screenshot({ path: 'artifacts/algorithm-dp-desktop.png', fullPage: true });
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('播放可暂停、切换会停止旧计时器；夜墨手机及窄栏不溢出', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'valid-parentheses', language: 'cpp' } })).json();
  try {
    await page.goto(`/?session=${item.id}&panel=visualize`);
    const demo = page.locator('.algorithm-demo');
    await expect(page.getByLabel('演示算法')).toHaveValue('brackets');
    await page.getByRole('combobox', { name: '演示播放速度' }).selectOption('2');
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(demo.locator('.algo-progress')).toContainText('步骤 2', { timeout: 2500 });
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    const position = await page.getByRole('slider', { name: '演示时间轴' }).inputValue();
    // Observe past a complete tick, so this proves pause cancels the pending timer.
    await page.waitForTimeout(1000);
    await expect(page.getByRole('slider', { name: '演示时间轴' })).toHaveValue(position);
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.getByRole('button', { name: '思路引导', exact: true }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: '算法演示', exact: true }).click();
    await expect(demo.locator('.algo-progress')).toContainText('已暂停');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await expect(demo).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.getByLabel('演示算法').selectOption('stairs');
    await page.getByRole('checkbox', { name: '平滑动画' }).uncheck();
    await expect(demo).toHaveAttribute('data-motion', 'false');
    await page.screenshot({ path: 'artifacts/algorithm-mobile-dark.png', fullPage: true });
    await page.setViewportSize({ width: 900, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});
