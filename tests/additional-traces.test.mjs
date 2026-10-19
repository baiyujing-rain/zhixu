import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrace, DEFAULT_INPUTS, coreCode, slidingWindow, breadthFirst, parseGrid, mergeSort, quickSort, intervalGreedy, parseIntervals, hashTwoSum } from '@zhixu/algo-viz';

function codeLines(trace) {
  for (const language of ['cpp', 'python']) {
    const ids = new Set(coreCode(trace.algorithm, language).map(line => line.id));
    for (const frame of trace.frames) assert.ok(ids.has(frame.line), `${trace.algorithm}: ${frame.line}`);
  }
}
function longestByEnumeration(text) {
  let best = 0;
  for (let start = 0; start < text.length; start++) for (let end = start + 1; end <= text.length; end++) {
    const candidate = text.slice(start, end);
    if (new Set(candidate).size === candidate.length) best = Math.max(best, candidate.length);
  }
  return best;
}

test('滑动窗口与穷举子串核对 9841 例，每帧窗口 / 字符表 / 最优值一致', () => {
  let cases = 0;
  function check(text) {
    const trace = slidingWindow(text);
    assert.equal(trace.frames.at(-1).result, longestByEnumeration(text), text);
    for (let index = 0; index < trace.frames.length; index++) {
      const frame = trace.frames[index], previous = trace.frames[index - 1];
      const window = text.slice(frame.left, Math.max(frame.left, frame.windowEnd + 1));
      assert.equal(new Set(window).size, window.length);
      assert.equal(frame.seen.length, window.length);
      for (const entry of frame.seen) { assert.equal(text[entry.index], entry.char); assert.ok(entry.index >= frame.left && entry.index <= frame.windowEnd); }
      assert.equal(new Set(frame.seen.map(entry => entry.char)).size, frame.seen.length);
      if (frame.bestLength) {
        const best = text.slice(frame.bestStart, frame.bestEnd + 1);
        assert.equal(best.length, frame.bestLength); assert.equal(new Set(best).size, best.length);
      }
      if (frame.phase === 'window-shrink') { assert.equal(frame.left, previous.left + 1); assert.equal(frame.seen.length, previous.seen.length - 1); }
      if (frame.phase === 'window-add') { assert.equal(frame.windowEnd, frame.right); assert.equal(frame.seen.length, previous.seen.length + 1); }
      if (frame.phase === 'window-duplicate') assert.ok(frame.seen.some(entry => entry.char === text[frame.cursor]));
      if (previous) { assert.ok(frame.left >= previous.left); assert.ok(frame.bestLength >= previous.bestLength); assert.notEqual(frame.seen, previous.seen); }
    }
    codeLines(trace); cases++;
  }
  function enumerate(text, remaining) { check(text); if (remaining) for (const char of 'abc') enumerate(text + char, remaining - 1); }
  enumerate('', 8);
  assert.equal(cases, 9841);
  for (const text of ['Aa0Aa1Bb2', 'abcdefghijkl', 'aaaaaaaaaaaa', '012345678901']) check(text);
});

function shortestByRelaxation(grid) {
  const distances = Array(grid.width * grid.height).fill(Infinity);
  distances[grid.start] = 0;
  for (let round = 0; round < distances.length; round++) {
    let changed = false;
    for (let index = 0; index < distances.length; index++) {
      const row = Math.floor(index / grid.width), col = index % grid.width;
      if (grid.rows[row][col] === '#') continue;
      const neighbors = [];
      if (row) neighbors.push(index - grid.width);
      if (row + 1 < grid.height) neighbors.push(index + grid.width);
      if (col) neighbors.push(index - 1);
      if (col + 1 < grid.width) neighbors.push(index + 1);
      for (const adjacent of neighbors) {
        if (grid.rows[Math.floor(adjacent / grid.width)][adjacent % grid.width] === '#') continue;
        if (distances[index] + 1 < distances[adjacent]) { distances[adjacent] = distances[index] + 1; changed = true; }
      }
    }
    if (!changed) break;
  }
  return distances;
}

test('BFS 与独立距离松弛核对，含 171 种小网格、不可达、同格与每帧队列 / 父节点 / 最短路径', () => {
  let cases = 0;
  function check(input) {
    const grid = parseGrid(input), expected = shortestByRelaxation(grid), trace = breadthFirst(grid);
    const result = trace.frames.at(-1).result;
    assert.equal(result, Number.isFinite(expected[grid.goal]) ? expected[grid.goal] : -1, input);
    const discovered = new Set([grid.start]);
    let priorDistance = -1;
    for (let index = 0; index < trace.frames.length; index++) {
      const frame = trace.frames[index], previous = trace.frames[index - 1];
      assert.equal(new Set(frame.queue).size, frame.queue.length);
      assert.equal(new Set(frame.processed).size, frame.processed.length);
      assert.ok(frame.queue.every(cell => !frame.processed.includes(cell)));
      assert.ok(frame.queue.every(cell => frame.distances[cell] >= 0));
      for (let cell = 0; cell < frame.distances.length; cell++) if (frame.distances[cell] >= 0) {
        assert.equal(frame.distances[cell], expected[cell]);
        if (cell !== grid.start) { const parent = frame.parents[cell]; assert.ok(parent >= 0); assert.equal(frame.distances[cell], frame.distances[parent] + 1); }
      }
      if (frame.phase === 'bfs-pop') { assert.equal(frame.current, previous.queue[0]); assert.equal(frame.queue.length, previous.queue.length - 1); assert.ok(frame.distances[frame.current] >= priorDistance); priorDistance = frame.distances[frame.current]; }
      if (frame.phase === 'bfs-enqueue') { const child = frame.neighbor.index; assert.ok(!discovered.has(child)); discovered.add(child); assert.equal(frame.queue.at(-1), child); assert.equal(frame.parents[child], frame.current); }
      if (frame.neighbor?.reason === 'outside') assert.ok(frame.neighbor.index === undefined);
      if (previous) { assert.notEqual(frame.queue, previous.queue); assert.notEqual(frame.distances, previous.distances); assert.notEqual(frame.parents, previous.parents); }
    }
    const last = trace.frames.at(-1);
    if (result >= 0) {
      assert.equal(last.path.length, result + 1); assert.equal(last.path[0], grid.start); assert.equal(last.path.at(-1), grid.goal);
      for (let index = 1; index < last.path.length; index++) {
        const a = last.path[index - 1], b = last.path[index];
        assert.equal(Math.abs(Math.floor(a / grid.width) - Math.floor(b / grid.width)) + Math.abs(a % grid.width - b % grid.width), 1);
      }
    } else { assert.equal(last.queue.length, 0); assert.equal(last.distances[grid.goal], -1); }
    codeLines(trace); cases++;
  }
  for (let height = 1; height <= 3; height++) for (let width = 1; width <= 3; width++) {
    const cells = width * height;
    if (cells === 1) { check('B'); continue; }
    for (let mask = 0; mask < 2 ** (cells - 2); mask++) {
      const chars = Array.from({ length: cells }, (_, index) => index === 0 ? 'S' : index === cells - 1 ? 'E' : mask & (1 << (index - 1)) ? '#' : '.');
      check(Array.from({ length: height }, (_, row) => chars.slice(row * width, (row + 1) * width).join('')).join('\n'));
    }
  }
  assert.equal(cases, 171);
  for (const input of [DEFAULT_INPUTS.bfs.grid, 'S....\n.....\n.....\n.....\n....E', '..E\n.#.\nS..', 'B..\n...']) check(input);
});

test('新增输入条件严格校验，非法输入不默默改动问题，B / 空字符串可用', () => {
  assert.equal(buildTrace('sliding-window', { ...DEFAULT_INPUTS['sliding-window'], window: '' }).frames.at(-1).result, 0);
  for (const window of ['中文', 'a a', '😀', 'abcdefghijklmn']) assert.throws(() => buildTrace('sliding-window', { ...DEFAULT_INPUTS['sliding-window'], window }));
  for (const grid of ['', 'S', 'E', 'SS.E', 'S..\n.E', 'S E', 'S!E', 'S.....E', 'SB.E', 'S\n.\n.\n.\n.\nE']) assert.throws(() => parseGrid(grid), grid);
  assert.equal(parseGrid('S.\r\n.E').height, 2);
  assert.equal(buildTrace('bfs', { ...DEFAULT_INPUTS.bfs, grid: 'B' }).frames.at(-1).result, 0);
});

test('归并排序与快速排序的每个终态都等于独立排序结果，且代码行均可映射', () => {
  const cases = [[], [1], [3, 1, 2], [4, 4, -1, 0], [9, 2, 7, 3, 1, 8]];
  for (const values of cases) for (const build of [mergeSort, quickSort]) {
    const trace = build(values), expected = [...values].sort((a, b) => a - b), last = trace.frames.at(-1);
    assert.deepEqual(last.result, expected);
    assert.deepEqual(last.array, expected);
    for (const frame of trace.frames) {
      assert.deepEqual(frame.array, frame.array.slice());
      if (frame.compareIndices) assert.ok(frame.compareIndices.every(index => index >= 0 && index < values.length));
    }
    codeLines(trace);
  }
});

test('区间调度按结束时间贪心，结果与穷举最大独立集一致', () => {
  function brute(intervals) {
    let best = 0;
    for (let mask = 0; mask < (1 << intervals.length); mask++) {
      const chosen = intervals.filter((_, i) => mask & (1 << i)).sort((a, b) => a.end - b.end);
      if (chosen.every((item, i) => i === 0 || item.start >= chosen[i - 1].end)) best = Math.max(best, chosen.length);
    }
    return best;
  }
  for (const input of ['', '1-3', '1-3,2-4,3-5,5-7,6-9', '-2-0,-1-2,2-4,3-5']) {
    const intervals = parseIntervals(input), trace = intervalGreedy(intervals), result = trace.frames.at(-1).result;
    assert.equal(result, brute(intervals));
    assert.ok(trace.frames.every(frame => (frame.selected || []).every(index => intervals.some(item => item.index === index))));
    codeLines(trace);
  }
  assert.throws(() => parseIntervals('1-1'));
  assert.throws(() => parseIntervals('1'));
});


test('无序两数之和哈希表穷举 42966 例，先查后存、重复值和原始下标正确', () => {
  let cases = 0;
  function check(values) {
    for (let target = -5; target <= 5; target++) {
      let exists = false;
      for (let left = 0; left < values.length; left++) for (let right = left + 1; right < values.length; right++) if (values[left] + values[right] === target) exists = true;
      const trace = hashTwoSum(values, target), answer = trace.frames.at(-1).result;
      assert.equal(answer !== null, exists);
      if (answer) { assert.ok(answer[0] < answer[1]); assert.equal(values[answer[0]] + values[answer[1]], target); }
      assert.deepEqual(trace.values, values);
      for (let index = 0; index < trace.frames.length; index++) {
        const frame = trace.frames[index], previous = trace.frames[index - 1];
        assert.equal(new Set(frame.hashEntries.map(entry => entry.value)).size, frame.hashEntries.length);
        for (const entry of frame.hashEntries) {
          assert.equal(values[entry.index], entry.value);
          if (['read', 'hash-lookup', 'found'].includes(frame.phase)) assert.ok(entry.index < frame.cursor);
        }
        if (frame.needed !== undefined) assert.equal(frame.needed, target - values[frame.cursor]);
        if (frame.phase === 'hash-store') assert.ok(frame.hashEntries.some(entry => entry.value === values[frame.cursor] && entry.index === frame.cursor));
        if (previous) assert.notEqual(frame.hashEntries, previous.hashEntries);
      }
      codeLines(trace); cases++;
    }
  }
  function enumerate(values, remaining) { check(values); if (remaining) for (const value of [-2, -1, 0, 1, 2]) enumerate([...values, value], remaining - 1); }
  enumerate([], 5);
  assert.equal(cases, 42966);
  assert.deepEqual(buildTrace('hash-two-sum', { ...DEFAULT_INPUTS['hash-two-sum'], values: '3,2,4', target: '6' }).frames.at(-1).result, [1, 2]);
  assert.deepEqual(buildTrace('hash-two-sum', { ...DEFAULT_INPUTS['hash-two-sum'], values: '3,3', target: '6' }).frames.at(-1).result, [0, 1]);
});
