import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeDemoHash, parseDemoHash, DEFAULT_INPUTS, buildTrace } from 'zhixu-algo-viz';

test('分享 hash 往返：只编码与默认输入不同的字段，step 只在大于 0 时出现', () => {
  const share = { algorithm: 'two-pointers', input: { ...DEFAULT_INPUTS['two-pointers'], target: '11' }, index: 3 };
  const hash = serializeDemoHash(share);
  assert.match(hash, /^alg=two-pointers/);
  assert.match(hash, /&target=11/);
  assert.ok(!hash.includes('values='), '未变化的 values 不应出现在 hash 中');
  assert.match(hash, /&step=3/);

  const parsed = parseDemoHash(hash);
  assert.equal(parsed.algorithm, 'two-pointers');
  assert.equal(parsed.input.target, '11');
  assert.equal(parsed.input.values, DEFAULT_INPUTS['two-pointers'].values);
  assert.equal(parsed.index, 3);
});

test('默认输入产生最简 hash，且 step=0 被省略', () => {
  const hash = serializeDemoHash({ algorithm: 'binary-search', input: { ...DEFAULT_INPUTS['binary-search'] }, index: 0 });
  assert.equal(hash, 'alg=binary-search');
  const parsed = parseDemoHash(hash);
  assert.equal(parsed.index, 0);
  assert.equal(parsed.input.values, DEFAULT_INPUTS['binary-search'].values);
});

test('特殊字符（#、换行）经 encodeURIComponent 编码后仍可逆', () => {
  const grid = 'S.#\n.#.\n..E';
  const input = { ...DEFAULT_INPUTS.bfs, grid };
  const hash = serializeDemoHash({ algorithm: 'bfs', input, index: 1 });
  assert.ok(!hash.includes('\n'));
  assert.ok(hash.includes('%23'), '井号应被编码为 %23');
  const parsed = parseDemoHash(hash);
  assert.equal(parsed.input.grid, grid);
});

test('非法 hash 返回 null（空串 / 未知算法 / 缺 alg / 非法编码）', () => {
  assert.equal(parseDemoHash(''), null);
  assert.equal(parseDemoHash('alg=nope'), null);
  assert.equal(parseDemoHash('foo=bar'), null);
  assert.equal(parseDemoHash('alg='), null);
  assert.equal(parseDemoHash('alg=two-pointers&values=%E0%A4%A'), null);
});

test('非法输入通过 buildTrace 校验失败时返回 null', () => {
  assert.equal(parseDemoHash('alg=two-pointers&values=2,1&target=5'), null);
  assert.equal(parseDemoHash('alg=brackets&brackets=( )'), null);
});

test('step 非整数或越界时 clamp 到有效帧范围', () => {
  const frames = buildTrace('two-pointers', DEFAULT_INPUTS['two-pointers']).frames.length;
  const clamped = parseDemoHash('alg=two-pointers&step=9999');
  assert.equal(clamped.index, frames - 1);
  assert.equal(parseDemoHash('alg=two-pointers&step=-3').index, 0);
  assert.equal(parseDemoHash('alg=two-pointers&step=abc').index, 0);
  assert.equal(parseDemoHash('alg=two-pointers&step=1.5').index, 0);
});

test('超过 2000 字符的 hash 被拒绝', () => {
  const long = 'alg=two-pointers&values=' + '1,'.repeat(1500);
  assert.ok(long.length > 2000);
  assert.equal(parseDemoHash(long), null);
});

test('未知键被忽略，前置 # 可容忍', () => {
  const parsed = parseDemoHash('#alg=two-pointers&foo=bar&step=1');
  assert.equal(parsed.algorithm, 'two-pointers');
  assert.equal(parsed.index, 1);
  assert.equal(parsed.input.values, DEFAULT_INPUTS['two-pointers'].values);
});

test('十个算法默认状态均可往返', () => {
  for (const algorithm of Object.keys(DEFAULT_INPUTS)) {
    const hash = serializeDemoHash({ algorithm, input: { ...DEFAULT_INPUTS[algorithm] }, index: 0 });
    const parsed = parseDemoHash(hash);
    assert.equal(parsed.algorithm, algorithm);
    assert.equal(parsed.index, 0);
  }
});
