import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('下载真实备份，预览选择恢复，原有记录保留，重复记录跳过', async ({ page, request }) => {
  const baseline = new Set<number>((await (await request.get('/api/sessions')).json()).map((item: { id: number }) => item.id));
  const first = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'python' } })).json();
  const second = await (await request.post('/api/sessions', { data: { example_id: 'valid-parentheses', language: 'cpp' } })).json();
  await request.patch(`/api/sessions/${first.id}`, { data: { notes: '备份测试：先查补数再插入。', code: '# archive test saved Python code' } });
  const restored: number[] = [];
  try {
    await page.goto('/?view=settings');
    await page.getByRole('heading', { name: '学习数据备份' }).scrollIntoViewIfNeeded();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载学习备份', exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(/^zhixu-learning-.*\.json$/);
    const body = await fs.readFile((await download.path())!, 'utf-8');
    const archive = JSON.parse(body);
    expect(archive.payload.sessions.find((item: { id: number }) => item.id === first.id).notes).toBe('备份测试：先查补数再插入。');
    await request.delete(`/api/sessions/${first.id}`);
    await page.getByLabel('选择知序学习备份文件', { exact: true }).setInputFiles({ name: 'my-learning.json', mimeType: 'application/json', buffer: Buffer.from(body) });
    await expect(page.locator('.archive-preview')).toContainText('1 条可恢复');
    await expect(page.getByRole('checkbox', { name: `恢复 两数之和（备份编号 ${first.id}）` })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: `恢复 有效的括号（备份编号 ${second.id}）` })).toBeDisabled();
    await page.locator('.archive-preview').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/archive-desktop-preview.png', fullPage: false });
    await page.getByRole('button', { name: '确认恢复 1 条记录', exact: true }).click();
    await expect(page.locator('.archive-notice')).toContainText('已恢复 1 条学习记录');
    const sessions = await (await request.get('/api/sessions')).json();
    for (const item of sessions) if (item.id !== second.id && !baseline.has(item.id) && item.title === first.title) restored.push(item.id);
    expect(restored).toHaveLength(1);
    const copied = await (await request.get(`/api/sessions/${restored[0]}`)).json();
    expect(copied.notes).toBe('备份测试：先查补数再插入。');
    expect(copied.drafts.python).toBe('# archive test saved Python code');
    expect((await request.get(`/api/sessions/${second.id}`)).ok()).toBeTruthy();
    await page.getByLabel('选择知序学习备份文件', { exact: true }).setInputFiles({ name: 'same-backup.json', mimeType: 'application/json', buffer: Buffer.from(body) });
    await expect(page.locator('.archive-preview')).toContainText('0 条可恢复');
    await expect(page.getByRole('button', { name: '确认恢复学习偏好', exact: true })).toBeDisabled();
  } finally { for (const id of [first.id, second.id, ...restored]) await request.delete(`/api/sessions/${id}`); }
});

test('损坏备份与过时预览有明确提示，手机预览可读且无横向溢出', async ({ page, request }) => {
  const baseline = new Set<number>((await (await request.get('/api/sessions')).json()).map((item: { id: number }) => item.id));
  const item = await (await request.post('/api/sessions', { data: { example_id: 'two-sum', language: 'cpp' } })).json();
  // Keep this archived record distinct from untouched examples already in QA.
  // Exact duplicate detection should still skip those existing examples.
  await request.patch(`/api/sessions/${item.id}`, { data: { notes: `过时预览专用笔记：${item.created_at}` } });
  const archive = await (await request.get('/api/data/export')).json();
  const restored: number[] = [];
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?view=settings');
    await page.getByLabel('选择知序学习备份文件', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not a JSON file') });
    await expect(page.locator('.archive-card [role=alert]')).toContainText('不是有效的 JSON');
    await page.getByLabel('选择知序学习备份文件', { exact: true }).setInputFiles({ name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
    await expect(page.locator('.archive-preview')).toContainText('相同记录');
    await page.getByRole('checkbox', { name: '同时恢复学习偏好' }).check();
    await request.patch(`/api/sessions/${item.id}`, { data: { notes: 'changed after preview' } });
    await page.getByRole('button', { name: '确认恢复学习偏好', exact: true }).click();
    await expect(page.locator('.archive-card [role=alert]')).toContainText('重新预览');
    await page.getByRole('button', { name: '重新预览', exact: true }).click();
    await expect(page.locator('.archive-preview')).toContainText('1 条可恢复');
    await page.getByRole('button', { name: '确认恢复 1 条记录', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: 'artifacts/archive-mobile-preview.png', fullPage: false });
    await page.getByRole('button', { name: '确认恢复 1 条记录', exact: true }).click();
    await expect(page.locator('.archive-notice')).toContainText('已恢复 1 条学习记录');
    for (const record of await (await request.get('/api/sessions')).json()) if (record.id !== item.id && !baseline.has(record.id) && record.title === item.title) restored.push(record.id);
    expect((await (await request.get(`/api/sessions/${item.id}`)).json()).notes).toBe('changed after preview');
  } finally { for (const id of [item.id, ...restored]) await request.delete(`/api/sessions/${id}`); }
});
