/** Inspect the live app without allowing any API mutation or model generation. */
import { chromium, request, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseURL = 'http://127.0.0.1:3000';
const api = await request.newContext({ baseURL });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], mutations = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname !== '127.0.0.1') return route.abort('blockedbyclient');
  if (url.pathname.startsWith('/api/') && route.request().method() !== 'GET') {
    mutations.push(url.pathname); return route.abort('blockedbyclient');
  }
  return route.continue();
});
try {
  const sessions = await (await api.get('/api/sessions')).json();
  await page.goto(baseURL);
  await expect(page.getByRole('heading', { name: '今天，想通一道题。' })).toBeVisible();
  await expect(page.locator('.journey-stats strong').first()).toHaveText(`${sessions.length}题`);
  await page.screenshot({ path: path.join(root, 'artifacts', 'final-home-production.png'), fullPage: true });
  await page.locator('nav .nav-item').filter({ hasText: '做题记录' }).click();
  await expect(page.locator('.record-row')).toHaveCount(sessions.length);
  if (sessions.length) {
    await page.locator('.record-row').first().getByRole('button', { name: '继续学习', exact: false }).click();
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.getByRole('button', { name: '算法演示', exact: true }).click();
    await expect(page.locator('.algorithm-demo')).toBeVisible();
    await expect(page.getByLabel('演示算法').locator('option')).toHaveCount(7);
    await page.getByLabel('演示算法').selectOption('bfs');
    await page.getByRole('button', { name: '演示跳到结尾' }).click();
    // Default start (0,0) -> goal (4,4): the legal route takes 8 moves.
    await expect(page.locator('.algo-result')).toContainText('8');
    await page.screenshot({ path: path.join(root, 'artifacts', 'final-work-production.png'), fullPage: true });
    await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  }
  await page.locator('nav .nav-item').filter({ hasText: '我的复盘' }).click();
  const reviews = await (await api.get('/api/reviews')).json();
  await expect(page.locator('.review-stats strong').nth(1)).toHaveText(String(reviews.stats.scheduled));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(errors).toEqual([]); expect(mutations).toEqual([]);
  const result = { checked_at_utc: new Date().toISOString(), sessions: sessions.length, reviews: reviews.stats.scheduled, algorithm_choices: 7, page_errors: errors, attempted_api_mutations: mutations, passed: true };
  await fs.writeFile(path.join(root, 'artifacts', 'production-readonly-smoke.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); await api.dispose(); }
