import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';

async function openNotes(page: Page) {
  const menu = page.getByLabel('题目操作');
  if (!(await page.locator('.focus-actions').evaluate(element => (element as HTMLDetailsElement).open))) await menu.click();
  await page.getByRole('button', { name: '复盘笔记', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '把思路留下来' })).toBeVisible();
}

test('笔记自动保存，提纲保留原文，Markdown 预览与含双语代码的真实文件导出', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  const cpp = '// export fence test\n````\n// ends after nested backticks';
  await request.patch(`/api/sessions/${item.id}`, { data: { code: cpp } });
  try {
    await page.goto(`/?session=${item.id}`); await openNotes(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('复盘笔记', { exact: true }).fill('# 我的观察\n\n先查询补数，再保存当前位置。');
    await expect(dialog.locator('.notes-editor-status')).toContainText('已保存');
    await dialog.getByRole('button', { name: '追加复盘提纲' }).click();
    await expect(dialog.getByLabel('复盘笔记', { exact: true })).toHaveValue(/先查询补数/);
    await expect(dialog.locator('.notes-editor-status')).toContainText('已保存');
    await dialog.getByRole('button', { name: '预览', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: '复杂度与取舍', exact: true })).toBeVisible();
    await expect(dialog.locator('.notes-preview')).toContainText('先查询补数');
    await dialog.getByRole('checkbox', { name: '导出时包含两种语言的已保存代码' }).check();
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '导出复盘 Markdown' }).click();
    const download = await downloaded; expect(download.suggestedFilename()).toBe('两数之和-复盘.md');
    const text = await fs.readFile((await download.path())!, 'utf-8');
    expect(text).toContain('先查询补数'); expect(text).toContain('额外空间（包含递归栈）');
    expect(text).toContain('`````cpp'); expect(text).toContain(cpp);
    expect(text).toContain('### Python');
    await page.screenshot({ path: 'artifacts/notes-preview-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'artifacts/notes-preview-mobile.png' });
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).drafts.cpp).toBe(cpp);
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('断网笔记刷新恢复，另一窗口冲突明确处理，使用远端后可找回本地副本', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'python' } })).json();
  const pattern = `**/api/sessions/${item.id}`;
  await page.route(pattern, route => route.request().method() === 'PATCH' ? route.abort('failed') : route.continue());
  try {
    await page.goto(`/?session=${item.id}`); await openNotes(page);
    await page.getByLabel('复盘笔记', { exact: true }).fill('本地尚未保存的关键观察。');
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('连接中断');
    await page.reload(); await openNotes(page);
    await expect(page.getByLabel('复盘笔记', { exact: true })).toHaveValue('本地尚未保存的关键观察。');
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('连接中断');
    await request.patch(`/api/sessions/${item.id}`, { data: { notes: '另一个窗口保存的笔记。' } });
    await page.unroute(pattern);
    await page.getByRole('button', { name: '保存笔记', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('服务器笔记已在其他窗口改变');
    await page.getByRole('button', { name: '使用服务器版本', exact: true }).click();
    await expect(page.getByLabel('复盘笔记', { exact: true })).toHaveValue('另一个窗口保存的笔记。');
    await page.getByRole('button', { name: '找回此前的本地笔记' }).click();
    await expect(page.getByLabel('复盘笔记', { exact: true })).toHaveValue('本地尚未保存的关键观察。');
    await expect(page.locator('.notes-editor-status')).toContainText('已保存');
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).notes).toBe('本地尚未保存的关键观察。');
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});

test('笔记保存期间继续输入，旧响应不会重置最新文本或代码', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  await page.route(`**/api/sessions/${item.id}`, async route => {
    if (route.request().method() === 'PATCH' && ++writes === 1) await gate;
    await route.continue();
  });
  try {
    await page.goto(`/?session=${item.id}`); await openNotes(page);
    const textarea = page.getByLabel('复盘笔记', { exact: true });
    await textarea.fill('第一版笔记。');
    await expect(page.locator('.notes-editor-status')).toContainText('正在保存');
    await textarea.fill('保存期间继续写下的最终笔记。');
    release();
    await expect(page.locator('.notes-editor-status')).toContainText('已保存');
    await expect(textarea).toHaveValue('保存期间继续写下的最终笔记。');
    const retained = await (await request.get(`/api/sessions/${item.id}`)).json();
    expect(retained.notes).toBe('保存期间继续写下的最终笔记。');
    expect(retained.drafts).toEqual(item.drafts);
  } finally { release(); await request.delete(`/api/sessions/${item.id}`); }
});


test('代码保存与笔记写入的短暂版本竞争安全重试，不产生虚假的字段冲突', async ({ page, request }) => {
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  let writes = 0;
  await page.route(`**/api/sessions/${item.id}`, async route => {
    if (route.request().method() === 'PATCH' && route.request().postDataJSON().notes !== undefined && ++writes === 1) {
      await request.patch(`/api/sessions/${item.id}`, { data: { code: '// independently saved code from another window' } });
      await route.fulfill({ status: 409, json: { detail: '记录在请求期间发生变化，请重试。' } });
    } else await route.continue();
  });
  try {
    await page.goto(`/?session=${item.id}`); await openNotes(page);
    await page.getByLabel('复盘笔记', { exact: true }).fill('笔记字段本身没有被其他窗口改变。');
    await expect(page.locator('.notes-editor-status')).toContainText('已保存');
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
    const saved = await (await request.get(`/api/sessions/${item.id}`)).json();
    expect(saved.notes).toBe('笔记字段本身没有被其他窗口改变。');
    expect(saved.drafts.cpp).toBe('// independently saved code from another window');
    expect(writes).toBe(2);
  } finally { await request.delete(`/api/sessions/${item.id}`); }
});
