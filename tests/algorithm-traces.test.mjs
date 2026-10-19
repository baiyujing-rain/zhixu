import test from 'node:test';
import assert from 'node:assert/strict';
import { twoPointers, binarySearch, brackets, stairs, buildTrace, DEFAULT_INPUTS, coreCode } from 'zhixu-algo-viz';

function arrays(length, minimum = -2, prefix = [], output = []) {
  if (!length) { output.push(prefix); return output; }
  for (let value = minimum; value <= 2; value++) arrays(length - 1, value, [...prefix, value], output);
  return output;
}
function last(trace) { return trace.frames.at(-1); }
function validateCode(trace) {
  for (const language of ['cpp', 'python']) {
    const ids = new Set(coreCode(trace.algorithm, language).map(line => line.id));
    for (const frame of trace.frames) assert.ok(ids.has(frame.line), `${trace.algorithm}: missing ${frame.line}`);
  }
}

test('双指针对有序数组穷举核对；每帧的下标、比较值及移动合法', () => {
  let cases = 0;
  for (let n = 0; n <= 6; n++) for (const values of arrays(n)) for (let target = -5; target <= 5; target++) {
    const trace = twoPointers(values, target), result = last(trace).result;
    let exists = false;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (values[i] + values[j] === target) exists = true;
    assert.equal(result !== null, exists);
    if (result) { assert.ok(result[0] < result[1]); assert.equal(values[result[0]] + values[result[1]], target); }
    for (let i = 0; i < trace.frames.length; i++) {
      const frame = trace.frames[i], previous = trace.frames[i - 1];
      if (frame.sum !== undefined) { assert.ok(frame.left < frame.right); assert.equal(frame.sum, values[frame.left] + values[frame.right]); }
      if (frame.phase === 'move-left') { assert.equal(frame.left, previous.left + 1); assert.equal(frame.right, previous.right); assert.equal(frame.sum, undefined); }
      if (frame.phase === 'move-right') { assert.equal(frame.right, previous.right - 1); assert.equal(frame.left, previous.left); assert.equal(frame.sum, undefined); }
    }
    validateCode(trace); cases++;
  }
  assert.equal(cases, 5082);
});

test('二分与线性查找核对，含空数组、负数、重复值和不存在；区间始终缩小', () => {
  let cases = 0;
  for (let n = 0; n <= 6; n++) for (const values of arrays(n)) for (let target = -4; target <= 4; target++) {
    const trace = binarySearch(values, target), result = last(trace).result;
    assert.equal(result >= 0, values.includes(target));
    if (result >= 0) assert.equal(values[result], target);
    let priorWidth = n;
    for (const frame of trace.frames) {
      if (frame.mid !== undefined) { assert.ok(frame.mid >= frame.left && frame.mid <= frame.right); assert.ok(frame.mid >= 0 && frame.mid < n); }
      if (frame.phase === 'move-left' || frame.phase === 'move-right') {
        const width = Math.max(0, frame.right - frame.left + 1);
        assert.ok(width < priorWidth); priorWidth = width;
      }
    }
    validateCode(trace); cases++;
  }
  assert.equal(cases, 4158);
});

test('括号栈与消去相邻括号的独立方法核对；快照不会被后续出入栈修改', () => {
  const alphabet = '()[]{}';
  let cases = 0;
  function check(text) {
    let reduced = text, next;
    do { next = reduced.replace(/\(\)|\[\]|\{\}/g, ''); if (next === reduced) break; reduced = next; } while (true);
    const trace = brackets(text);
    assert.equal(last(trace).result, reduced.length === 0, text);
    assert.deepEqual(trace.frames[0].stack, []);
    for (let i = 0; i < trace.frames.length; i++) {
      const frame = trace.frames[i], previous = trace.frames[i - 1];
      for (const entry of frame.stack) assert.equal(text[entry.index], entry.char);
      if (frame.phase === 'push') assert.equal(frame.stack.length, previous.stack.length + 1);
      if (frame.phase === 'pop') { assert.equal(frame.stack.length, previous.stack.length - 1); assert.equal(frame.paired.length, previous.paired.length + 2); }
      if (i > 0) assert.notEqual(frame.stack, previous.stack);
    }
    validateCode(trace); cases++;
  }
  function enumerate(text, remaining) { check(text); if (remaining) for (const char of alphabet) enumerate(text + char, remaining - 1); }
  enumerate('', 5);
  assert.equal(cases, 9331);
});

test('DP 与递归路径计数核对，基础状态和依赖在写入前已存在', () => {
  function paths(n) { if (n === 0) return 1; if (n < 0) return 0; return paths(n - 1) + paths(n - 2); }
  for (let n = 0; n <= 20; n++) {
    const trace = stairs(n);
    assert.equal(last(trace).result, paths(n));
    assert.ok(trace.frames[0].dp.every(value => value === null));
    for (const frame of trace.frames) {
      if (frame.dependencies) for (const index of frame.dependencies) { assert.ok(index < frame.active); assert.equal(typeof frame.dp[index], 'number'); }
      if (frame.phase === 'dependencies') assert.equal(frame.dp[frame.active], null);
      if (frame.phase === 'fill') assert.equal(frame.dp[frame.active], frame.dp[frame.active - 1] + frame.dp[frame.active - 2]);
    }
    validateCode(trace);
  }
});

test('输入校验拒绝降序、漏值、小数、超长和非法括号；空输入与默认示例可用', () => {
  for (const values of ['2,1', '1,,2', '1.5,2', 'NaN', '[1,2', Array(13).fill('1').join(','), '10000']) assert.throws(() => buildTrace('binary-search', { ...DEFAULT_INPUTS['binary-search'], values }));
  for (const target of ['', '1.5', 'Infinity', '20000']) assert.throws(() => buildTrace('two-pointers', { ...DEFAULT_INPUTS['two-pointers'], target }));
  for (const text of ['( )', '中文', '('.repeat(17)]) assert.throws(() => buildTrace('brackets', { ...DEFAULT_INPUTS.brackets, brackets: text }));
  for (const value of ['-1', '21', '1.2', '']) assert.throws(() => buildTrace('stairs', { ...DEFAULT_INPUTS.stairs, stairs: value }));
  for (const algorithm of Object.keys(DEFAULT_INPUTS)) validateCode(buildTrace(algorithm, DEFAULT_INPUTS[algorithm]));
  assert.equal(last(buildTrace('binary-search', { ...DEFAULT_INPUTS['binary-search'], values: '[]' })).result, -1);
  assert.equal(last(buildTrace('brackets', { ...DEFAULT_INPUTS.brackets, brackets: '' })).result, true);
});
