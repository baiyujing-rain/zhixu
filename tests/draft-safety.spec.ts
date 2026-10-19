import { test, expect, type Page } from '@playwright/test';

async function edit(page: Page, code: string) {
  await page.locator('.monaco-editor textarea.inputarea').focus();
  await page.keyboard.press('Control+A'); await page.keyboard.insertText(code);
}

test('自动保存期间继续输入不会被旧响应覆盖，最终保存最新草稿', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let saves = 0;
  await page.route(`**/api/sessions/${item.id}`, async route => {
    if (route.request().method() === 'PATCH' && ++saves === 1) await gate;
    await route.continue();
  });
  try {
    await page.goto(`/?session=${item.id}`);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await edit(page, '// first draft');
    await expect(page.locator('.code-toolbar')).toContainText('正在保存');
    await edit(page, '// latest draft typed during save');
    release();
    await expect(page.locator('.code-toolbar')).toContainText('已保存');
    await expect.poll(async () => (await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.cpp).toBe('// latest draft typed during save');
    await expect(page.locator('.monaco-editor')).toContainText('latest draft typed during save');
    expect(await page.evaluate(id => localStorage.getItem(`zhixu-code-${id}-cpp:${sessionStorage.getItem('zhixu-draft-owner')}`), item.id)).toBeNull();
  } finally { release(); await request.delete(`/api/sessions/${item.id}`); }
});

test('保存失败的草稿刷新后恢复，恢复网络后可保存', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  const routePattern = `**/api/sessions/${item.id}`;
  await page.route(routePattern, route => route.request().method() === 'PATCH' ? route.abort('failed') : route.continue());
  try {
    await page.goto(`/?session=${item.id}`);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await edit(page, '// offline draft must survive');
    await expect(page.locator('.draft-notice')).toContainText('连接中断');
    await page.reload();
    await expect(page.locator('.monaco-editor')).toContainText('offline draft must survive');
    await expect(page.locator('.draft-notice')).toContainText('连接中断');
    await page.unroute(routePattern);
    await page.getByRole('button', { name: '保存代码', exact: true }).click();
    await expect(page.locator('.code-toolbar')).toContainText('已保存');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.cpp).toBe('// offline draft must survive');
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('其他窗口修改产生冲突，刷新和继续编辑仍保留本地，选择远端后可找回副本', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  try {
    await page.goto(`/?session=${item.id}`);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await edit(page, '// local unsaved draft');
    await request.patch(`/api/sessions/${item.id}`, { data: { language: 'cpp', code: '// another window draft' } });
    await expect(page.locator('.code-toolbar')).toContainText('版本冲突');
    await expect(page.locator('.monaco-editor')).toContainText('local unsaved draft');
    await edit(page, '// local conflict edited again');
    await page.reload();
    await expect(page.locator('.code-toolbar')).toContainText('版本冲突');
    await expect(page.locator('.monaco-editor')).toContainText('local conflict edited again');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.cpp).toBe('// another window draft');
    await page.getByRole('button', { name: '使用服务器版本', exact: true }).click();
    await expect(page.locator('.monaco-editor')).toContainText('another window draft');
    await expect(page.locator('.code-toolbar')).toContainText('已保存');
    await page.getByRole('button', { name: '找回此前的本地草稿', exact: true }).click();
    await expect(page.locator('.monaco-editor')).toContainText('local conflict edited again');
    await expect(page.locator('.code-toolbar')).toContainText('已保存');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.cpp).toBe('// local conflict edited again');
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('DeepSeek 旧转接回复不会覆盖后来编辑的草稿', async ({ page, request }) => {
  await page.route('**/api/settings', route => route.fulfill({ json: { provider: 'deepseek_web', configured: true, api_configured: false, base_url: '', model: '' } }));
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  try {
    await page.goto(`/?session=${item.id}`);
    await page.getByRole('button', { name: '给我一个提示', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '稍后继续' }).click();
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await edit(page, '// edited after preparing the old handoff');
    await page.getByRole('button', { name: '继续 DeepSeek 转接' }).click();
    await page.getByLabel('粘贴 DeepSeek 的完整回复', { exact: true }).fill('这是旧代码对应的引导。');
    await page.getByRole('button', { name: '导入并保存回复' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('代码或学习进度已改变');
    await expect(page.locator('.monaco-editor')).toContainText('edited after preparing the old handoff');
    const retained = await (await request.get(`/api/sessions/${item.id}`)).json();
    expect(retained.drafts.cpp).toBe('// edited after preparing the old handoff');
    expect(retained.stage).toBe(0);
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});


test('删除后复用编号的新记录不会接收旧窗口的代码或错误恢复旧缓存', async ({ page, request }) => {
  const old = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${old.id}`, async route => {
    if (route.request().method() === 'PATCH') await gate;
    await route.continue();
  });
  try {
    await page.goto(`/?session=${old.id}`);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await edit(page, '// belongs to deleted record only');
    await expect(page.locator('.code-toolbar')).toContainText('正在保存');
    await request.delete(`/api/sessions/${old.id}`);
    const fresh = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
    expect(fresh.id).toBe(old.id); expect(fresh.created_at).not.toBe(old.created_at);
    release();
    await expect(page.locator('.draft-notice')).toContainText('原题已删除');
    await expect(page.getByRole('button', { name: '保留本地并保存', exact: true })).toBeDisabled();
    expect((await (await request.get(`/api/sessions/${fresh.id}`)).json()).drafts.cpp).toBe(fresh.drafts.cpp);
    await page.reload();
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await expect(page.locator('.monaco-editor')).not.toContainText('belongs to deleted record only');
    await expect(page.locator('.code-toolbar')).toContainText('已保存');
  } finally { release(); await request.delete(`/api/sessions/${old.id}`); }
});


test('真实两个窗口的本地草稿互不清除，刷新恢复各自内容，AI 请求先校验正在看的版本', async ({ page, context, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  const other = await context.newPage();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let aiRequests = 0;
  const pattern = `**/api/sessions/${item.id}`;
  await page.route(pattern, async route => { if (route.request().method() === 'PATCH') await gate; await route.continue(); });
  await other.route(pattern, route => route.request().method() === 'PATCH' ? route.abort('failed') : route.continue());
  await page.route(`**/api/sessions/${item.id}/coach`, route => { aiRequests++; return route.fulfill({ status: 500, body: 'AI must not be requested for a different code version' }); });
  try {
    await page.goto(`/?session=${item.id}`); await other.goto(`/?session=${item.id}`);
    await expect(page.locator('.monaco-editor')).toBeVisible(); await expect(other.locator('.monaco-editor')).toBeVisible();
    await edit(page, '// window A saved version'); await edit(other, '// window B offline version');
    await expect(other.locator('.draft-notice')).toContainText('连接中断');
    await expect(page.locator('.code-toolbar')).toContainText('正在保存');
    release();
    await expect(page.locator('.code-toolbar')).toContainText('已保存');
    expect(await other.evaluate(id => JSON.parse(localStorage.getItem(`zhixu-code-${id}-cpp:${sessionStorage.getItem('zhixu-draft-owner')}`)!).code, item.id)).toBe('// window B offline version');
    await other.reload();
    await expect(other.locator('.monaco-editor')).toContainText('window B offline version');
    await expect(other.locator('.code-toolbar')).toContainText('版本冲突');
    await other.unroute(pattern);
    await other.getByRole('button', { name: '保留本地并保存', exact: true }).click();
    await expect(other.locator('.code-toolbar')).toContainText('已保存');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.cpp).toBe('// window B offline version');
    await page.getByRole('button', { name: '给我一个提示', exact: true }).click();
    await expect(page.locator('.code-toolbar')).toContainText('版本冲突');
    await expect(page.locator('.monaco-editor')).toContainText('window A saved version');
    expect(aiRequests).toBe(0);
    expect(await page.evaluate(id => JSON.parse(localStorage.getItem(`zhixu-code-${id}-cpp:${sessionStorage.getItem('zhixu-draft-owner')}`)!).code, item.id)).toBe('// window A saved version');
  } finally { release(); await other.close(); await request.delete(`/api/sessions/${item.id}`); }
});

test('新打开的页面可手动比较并恢复其他窗口保留的未提交草稿', async ({ page, context, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  await page.route(`**/api/sessions/${item.id}`, route => route.request().method() === 'PATCH' ? route.abort('failed') : route.continue());
  let other;
  try {
    await page.goto(`/?session=${item.id}`);
    await expect(page.locator('.monaco-editor')).toBeVisible(); await edit(page, '// recover this other window draft');
    await expect(page.locator('.draft-notice')).toContainText('连接中断');
    other = await context.newPage(); await other.goto(`/?session=${item.id}`);
    await expect(other.locator('.foreign-drafts')).toContainText('草稿');
    await other.locator('.foreign-drafts summary').click();
    await expect(other.locator('.foreign-drafts pre')).toContainText('recover this other window draft');
    await other.getByRole('button', { name: '恢复这份代码草稿' }).click();
    await expect(other.locator('.monaco-editor')).toContainText('recover this other window draft');
    await expect(other.locator('.code-toolbar')).toContainText('已保存');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.cpp).toBe('// recover this other window draft');
  } finally { await other?.close(); await request.delete(`/api/sessions/${item.id}`); }
});


test('服务器已保存但代理返回错误时，读取确认结果，不制造同内容的版本冲突', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  let writes = 0;
  await page.route(`**/api/sessions/${item.id}`, async route => {
    if (route.request().method() === 'PATCH' && ++writes === 1) { await route.fetch(); await route.fulfill({ status: 502, body: 'Internal Server Error' }); }
    else await route.continue();
  });
  try {
    await page.goto(`/?session=${item.id}`);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await edit(page, '// saved on server but the reply was interrupted');
    await expect(page.locator('.code-toolbar')).toContainText('已保存');
    await expect(page.locator('.draft-notice')).toHaveCount(0);
    expect(writes).toBe(1);
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.cpp).toBe('// saved on server but the reply was interrupted');
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});
