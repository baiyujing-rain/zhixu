import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleToAlgorithm, guessAlgorithm, buildRelated } from '../lib/problem-graph.ts';

test('exampleToAlgorithm 映射内置示例；未知示例返回 null', () => {
  assert.equal(exampleToAlgorithm('two-sum'), 'hash-two-sum');
  assert.equal(exampleToAlgorithm('valid-parentheses'), 'brackets');
  assert.equal(exampleToAlgorithm('binary-search'), 'binary-search');
  assert.equal(exampleToAlgorithm('n-queens'), null);
  assert.equal(exampleToAlgorithm(undefined), null);
});

test('guessAlgorithm 按标题与标签命中算法', () => {
  assert.equal(guessAlgorithm({ id: 1, title: '接雨水', tags: ['数组', '双指针'] }), 'two-pointers');
  assert.equal(guessAlgorithm({ id: 2, title: '无重复字符的最长子串', tags: ['字符串', '滑动窗口'] }), 'sliding-window');
  assert.equal(guessAlgorithm({ id: 3, title: '最长有效括号', tags: ['栈'] }), 'brackets');
  assert.equal(guessAlgorithm({ id: 4, title: '课程表', tags: ['图', '拓扑排序'] }), null);
});

test('buildRelated 生成同分类算法与配套练习组', () => {
  const current = { id: 1, title: '两数之和', tags: ['数组', '哈希表'], status: 'learning', example_id: 'two-sum', updated_at: '2026-01-01T00:00:00Z' };
  const groups = buildRelated(current, []);
  const algorithmGroup = groups.find(group => group.kind === 'algorithm');
  assert.ok(algorithmGroup, '应有同分类算法组');
  assert.ok(algorithmGroup.items.length > 0);
  assert.ok(algorithmGroup.items.every(item => item.algorithm && item.algorithm !== 'hash-two-sum'));
  assert.ok(algorithmGroup.items.every(item => item.subtitle.includes('打开演示')));
  const practice = groups.find(group => group.kind === 'practice');
  assert.ok(practice, '应有配套练习组');
  assert.equal(practice.items.length, 2);
  assert.ok(practice.items.every(item => item.kind === 'practice'));
});

test('buildRelated 的「之前见过」按标签交集数排序并排除自身', () => {
  const current = { id: 1, title: '两数之和', tags: ['数组', '哈希表'], status: 'mastered', updated_at: '2026-01-01T00:00:00Z' };
  const items = [
    { id: 1, title: '两数之和', tags: ['数组', '哈希表'], difficulty: '简单', status: 'mastered', updated_at: '2026-01-01T00:00:00Z' },
    { id: 2, title: '三数之和', tags: ['数组', '双指针'], difficulty: '中等', status: 'learning', updated_at: '2026-01-02T00:00:00Z' },
    { id: 3, title: '四数之和', tags: ['数组', '哈希表', '双指针'], difficulty: '中等', status: 'learning', updated_at: '2026-01-03T00:00:00Z' },
    { id: 4, title: '爬楼梯', tags: ['动态规划'], difficulty: '简单', status: 'mastered', updated_at: '2026-01-04T00:00:00Z' },
  ];
  const seen = buildRelated(current, items).find(group => group.kind === 'seen');
  assert.ok(seen);
  assert.equal(seen.items.length, 2);
  assert.equal(seen.items[0].sessionId, 3, '交集数更多（3 个）的题目应排最前');
  assert.equal(seen.items[0].subtitle.includes('数组'), true);
  assert.equal(seen.items.some(item => item.sessionId === 1), false, '应排除自身');
  assert.equal(seen.items.some(item => item.sessionId === 4), false, '无交集标签的不应出现');
});

test('无匹配时 buildRelated 返回空数组（优雅降级）', () => {
  const current = { id: 1, title: '课程表', tags: ['图'], status: 'learning' };
  assert.deepEqual(buildRelated(current, []), []);
});
