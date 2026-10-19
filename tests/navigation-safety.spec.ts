import { test, expect } from '@playwright/test';

test('浏览器后退并打开另一题后，先前延迟的 AI 回复不能切回旧题', async ({ page, request }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ids: string[] = [];
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/api/sessions/*/coach', async route => {
    const response = await route.fetch();
    requested();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '两数之和 数组 / 哈希表 简单' }).click();
    await page.waitForURL(/session=/);
    ids.push(new URL(page.url()).searchParams.get('session')!);
    await page.getByRole('button', { name: '给我一个提示', exact: true }).click();
    await expect(page.locator('.thinking')).toBeVisible();
    await started;
    await page.goBack();
    await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
    await page.getByRole('button', { name: '有效的括号 字符串 / 栈 简单' }).click();
    await page.waitForURL(/session=/);
    ids.push(new URL(page.url()).searchParams.get('session')!);
    await expect(page.getByRole('heading', { name: '有效的括号', exact: true })).toBeVisible();
    const completed = page.waitForResponse(response => response.url().endsWith(`/sessions/${ids[0]}/coach`));
    release(); await completed;
    await expect(page.getByRole('heading', { name: '有效的括号', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '给我一个提示', exact: true })).toBeEnabled();
    expect(new URL(page.url()).searchParams.get('session')).toBe(ids[1]);
    await expect(page.locator('.messages')).not.toContainText('先把问题说清楚');
  } finally { release(); for (const id of ids) await request.delete(`/api/sessions/${id}`); }
});

test('浏览器前进后退可以恢复未保存的本地草稿，迟到保存不重开旧题', async ({ page, request }) => {
  const ids: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  await page.route('**/api/sessions/*', async route => {
    if (route.request().method() === 'PATCH' && ++writes === 1) await gate;
    await route.continue();
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '两数之和 数组 / 哈希表 简单' }).click();
    await page.waitForURL(/session=/); ids.push(new URL(page.url()).searchParams.get('session')!);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.locator('.monaco-editor textarea.inputarea').focus();
    await page.keyboard.press('Control+A'); await page.keyboard.insertText('// survives browser history navigation');
    await expect(page.locator('.code-toolbar')).toContainText('正在保存');
    await page.goBack();
    await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
    release();
    await expect.poll(async () => (await (await request.get(`/api/sessions/${ids[0]}`)).json()).drafts.cpp).toBe('// survives browser history navigation');
    await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
    await page.goForward();
    await expect(page.locator('.monaco-editor')).toContainText('survives browser history navigation');
    await expect(page.locator('.code-toolbar')).toContainText('已保存');
  } finally { release(); for (const id of ids) await request.delete(`/api/sessions/${id}`); }
});


test('迟到的删除响应不关闭另一题的笔记，只清理被删除题目的缓存', async ({ page, request }) => {
  const first = await (await request.post('/api/sessions', { data: { content: '删除导航测试题目\n给定一个整数数组，返回所有元素之和。数组可能为空。', language: 'cpp' } })).json();
  const second = await (await request.post('/api/sessions', { data: { content: '保持笔记测试题目\n给定一个整数数组，返回最大元素。请说明空数组的处理方式。', language: 'python' } })).json();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${first.id}`, async route => {
    if (route.request().method() === 'DELETE') { const response = await route.fetch(); await gate; await route.fulfill({ response }); }
    else await route.continue();
  });
  try {
    await page.goto('/');
    await page.evaluate(ids => {
      for (const key of [`zhixu-code-${ids.first}-cpp`, `zhixu-notes-${ids.first}`, `zhixu-notes-${ids.first}-recovery`, `zhixu-review-note-${ids.first}:old-origin`, `zhixu-animation-${ids.first}`]) localStorage.setItem(key, 'cleanup only this record');
      localStorage.setItem(`zhixu-animation-${ids.second}`, 'keep other record');
    }, { first: first.id, second: second.id });
    await page.locator('nav .nav-item').filter({ hasText: '做题记录' }).click();
    await page.getByRole('button', { name: `删除${first.title}`, exact: true }).click();
    await page.getByRole('button', { name: '删除记录', exact: true }).click();
    await page.goBack();
    await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
    await page.locator('.continue-card').getByRole('button', { name: '继续学习' }).click();
    await expect(page.getByRole('heading', { name: second.title, exact: true })).toBeVisible();
    await page.getByLabel('题目操作').click();
    await page.getByRole('button', { name: '复盘笔记', exact: true }).click();
    await page.getByLabel('复盘笔记', { exact: true }).fill('这条新笔记不能被旧删除请求关闭。');
    const completed = page.waitForResponse(response => response.url().endsWith(`/sessions/${first.id}`) && response.request().method() === 'DELETE');
    release(); await completed;
    await expect(page.getByRole('dialog', { name: '把思路留下来' })).toBeVisible();
    await expect(page.getByLabel('复盘笔记', { exact: true })).toHaveValue('这条新笔记不能被旧删除请求关闭。');
    await expect.poll(() => page.evaluate(id => Object.keys(localStorage).filter(key => key.startsWith(`zhixu-code-${id}-`) || key === `zhixu-notes-${id}` || key === `zhixu-notes-${id}-recovery` || key.startsWith(`zhixu-review-note-${id}:`) || key === `zhixu-animation-${id}`).length, first.id)).toBe(0);
    expect(await page.evaluate(id => localStorage.getItem(`zhixu-animation-${id}`), second.id)).toBe('keep other record');
  } finally { release(); await request.delete(`/api/sessions/${first.id}`); await request.delete(`/api/sessions/${second.id}`); }
});
