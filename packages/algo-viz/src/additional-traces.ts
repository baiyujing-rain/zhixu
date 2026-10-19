import type { Frame, StackEntry, Trace } from './algorithm-traces';

/** The boolean table in the core code is visualized by its true entries. */
export function slidingWindow(text: string): Trace {
  let left = 0, right = -1, windowEnd = -1, bestLength = 0, bestStart = 0, bestEnd = -1;
  const seen = new Map<string, number>(), frames: Frame[] = [];
  const add = (frame: Frame) => frames.push({ left, right, windowEnd, bestLength, bestStart, bestEnd,
    seen: [...seen].map(([char, index]) => ({ char, index } satisfies StackEntry)), ...frame });
  add({ phase: 'start', line: 'init', title: '先准备一个没有字符的窗口', detail: '字符表全是 false，left = 0。我们依次尝试把右侧字符加入窗口，并记录目前的最长长度。' });
  for (right = 0; right < text.length; right++) {
    const char = text[right]; windowEnd = right - 1;
    add({ phase: 'read', line: 'candidate', cursor: right, title: `尝试加入下标 ${right} 的 ${char}`, detail: `当前有效窗口是 ${left <= windowEnd ? `[${left}, ${windowEnd}]` : '空'}。先检查 ${char} 是否已经在窗口里；此时还没有把新字符加入。` });
    while (seen.has(char)) {
      const previous = left, removed = text[left];
      add({ phase: 'window-duplicate', line: 'duplicate', cursor: right, matching: seen.get(char), title: '候选字符与窗口中已有字符重复', detail: `字符表中 ${char} 是 true。不能直接加入它，我们要从窗口左端逐个移除，直到重复消失。` });
      seen.delete(removed); left++;
      add({ phase: 'window-shrink', line: 'shrink', cursor: right, title: `移除 ${removed}，左端向右一步`, detail: `把下标 ${previous} 的 ${removed} 对应表项设为 false，left 从 ${previous} 变成 ${left}。${seen.has(char) ? `${char} 仍在窗口内，还要继续收缩。` : `现在 ${char} 不在窗口内，可以加入它。`}` });
    }
    seen.set(char, right); windowEnd = right;
    add({ phase: 'window-add', line: 'add', cursor: right, title: `加入 ${char}，窗口仍然不重复`, detail: `将 ${char} 的表项设为 true。有效窗口 [${left}, ${right}] 包含 ${right - left + 1} 个连续字符。` });
    const size = right - left + 1, improved = size > bestLength;
    if (improved) { bestLength = size; bestStart = left; bestEnd = right; }
    add({ phase: 'window-best', line: 'best', cursor: right, expression: `max(best, ${right} − ${left} + 1) = ${bestLength}`, title: improved ? `更新最长长度为 ${bestLength}` : `保持最长长度 ${bestLength}`, detail: improved ? `当前窗口「${text.slice(left, right + 1)}」更长，记录这个长度。` : '当前窗口没有更长。保留之前的最优长度，不把已移出的字符算进窗口。' });
  }
  // Keep R on the last scanned character in the final illustration.
  right = text.length - 1;
  add({ phase: 'finish', line: 'end', result: bestLength, title: `最长不重复子串长度：${bestLength}`, detail: text.length ? `一个最优窗口是「${text.slice(bestStart, bestEnd + 1)}」。左右指针都只向右，每个字符最多加入、移除各一次；嵌套 while 并不意味着 O(n²)。` : '空串没有字符，返回 0。字符表仍为空。' });
  return { algorithm: 'sliding-window', frames, values: [], text };
}

export type Grid = NonNullable<Trace['grid']>;
export function parseGrid(input: string): Grid {
  const raw = input.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  const rows = raw.split('\n');
  if (!raw || rows.length > 5 || rows[0].length < 1 || rows[0].length > 5) throw new Error('网格需要 1～5 行、每行 1～5 格。');
  const width = rows[0].length;
  if (rows.some(row => row.length !== width)) throw new Error('每行格数必须相同，不会自动补齐或删去格子。');
  if (rows.some(row => !/^[.#SEB]+$/.test(row))) throw new Error('只允许 . # S E B，不包含空格或其他字符。');
  const starts: number[] = [], goals: number[] = [];
  rows.forEach((row, r) => [...row].forEach((char, c) => { if (char === 'S' || char === 'B') starts.push(r * width + c); if (char === 'E' || char === 'B') goals.push(r * width + c); }));
  if (starts.length !== 1 || goals.length !== 1) throw new Error('需要唯一 S 与唯一 E，或者一个 B 表示起终点同格。');
  return { rows, width, height: rows.length, start: starts[0], goal: goals[0] };
}

export function breadthFirst(grid: Grid): Trace {
  const size = grid.width * grid.height, distances = Array<number>(size).fill(-1), parents = Array<number>(size).fill(-1);
  const queue = [grid.start], processed: number[] = [], frames: Frame[] = [];
  let current: number | undefined;
  const coordinate = (index: number) => `(${Math.floor(index / grid.width)}, ${index % grid.width})`;
  const add = (frame: Frame) => frames.push({ current, distances: [...distances], parents: [...parents], queue: [...queue], processed: [...processed], ...frame });
  distances[grid.start] = 0;
  add({ phase: 'start', line: 'init', title: '起点入队，距离记为 0', detail: `起点 ${coordinate(grid.start)} 入队，同时标记距离为 0。格子在入队时标记，之后不会重复加入。` });
  const directions = [[-1, 0, '上'], [0, 1, '右'], [1, 0, '下'], [0, -1, '左']] as const;
  while (queue.length) {
    current = queue.shift() as number; processed.push(current);
    const row = Math.floor(current / grid.width), col = current % grid.width;
    add({ phase: 'bfs-pop', line: 'pop', title: `从队首取出 ${coordinate(current)}`, detail: `先进先出：当前格子的最短距离为 ${distances[current]}。先检查是否已经到达终点，再尝试上下左右的邻居。` });
    if (current === grid.goal) {
      const path: number[] = []; let index = current;
      while (index >= 0) { path.push(index); index = parents[index]; }
      path.reverse();
      add({ phase: 'found', line: 'found', path, result: distances[current], title: `抵达终点，最少 ${distances[current]} 步`, detail: grid.start === grid.goal ? '起点就是终点，不需要移动，返回 0。' : `队列按距离从近到远处理，首次到达的距离最短。路径共有 ${path.length} 个格子、${path.length - 1} 次移动；步数不等于格子数。已找到终点，队列里的剩余格子不影响最短步数，可以停止。` });
      return { algorithm: 'bfs', frames, values: [], grid: { ...grid, rows: [...grid.rows] } };
    }
    for (const [dr, dc, name] of directions) {
      const nr = row + dr, nc = col + dc;
      const outside = nr < 0 || nr >= grid.height || nc < 0 || nc >= grid.width;
      const index = outside ? undefined : nr * grid.width + nc;
      const reason = outside ? 'outside' : grid.rows[nr][nc] === '#' ? 'wall' : distances[index as number] >= 0 ? 'seen' : 'new';
      const neighbor = { row: nr, col: nc, index, reason } as NonNullable<Frame['neighbor']>;
      const detail = reason === 'outside' ? '坐标在网格外，不能访问。' : reason === 'wall' ? '这是障碍，不能穿过。' : reason === 'seen' ? `入队时已经标记过距离 ${distances[index as number]}，不重复入队。` : `这是未访问的通路，可以从当前格走过去，距离增加 1。`;
      add({ phase: 'bfs-neighbor', line: reason === 'new' ? 'neighbor' : 'skip', neighbor, title: `检查${name}方邻居 (${nr}, ${nc})`, detail });
      if (reason !== 'new') continue;
      distances[index as number] = distances[current] + 1; parents[index as number] = current; queue.push(index as number);
      add({ phase: 'bfs-enqueue', line: 'enqueue', neighbor, expression: `dist[${nr}][${nc}] = ${distances[current]} + 1 = ${distances[index as number]}`, title: `标记 ${coordinate(index as number)} 并加入队尾`, detail: '先写距离，再入队。同层格子按先后探索，下一层从队尾等待；之后遇到此格子会跳过。' });
    }
  }
  add({ phase: 'finish', line: 'end', current: undefined, result: -1, title: '队列为空，终点不可达', detail: '从起点能到达的区域已经全部探索。障碍把终点隔开，返回 −1，而不是编造一条路径。' });
  return { algorithm: 'bfs', frames, values: [], grid: { ...grid, rows: [...grid.rows] } };
}


export function hashTwoSum(values: number[], target: number): Trace {
  const seen = new Map<number, number>(), frames: Frame[] = [];
  let cursor = -1;
  const add = (frame: Frame) => frames.push({ cursor, hashEntries: [...seen].map(([value, index]) => ({ value, index })), ...frame });
  add({ phase: 'start', line: 'init', title: '只记录已经见过的元素', detail: '准备一个数值到下标的哈希表。从左到右遍历，先查补数，再保存当前元素；不会排序或改变原始下标。' });
  for (cursor = 0; cursor < values.length; cursor++) {
    const value = values[cursor], needed = target - value;
    add({ phase: 'read', line: 'need', needed, expression: `need = ${target} − (${value}) = ${needed}`, title: `读下标 ${cursor}，需要补数 ${needed}`, detail: `当前值是 ${value}。另一个数必须是 ${needed}，才能与它相加得到 ${target}。当前元素还没有存进表。` });
    const match = seen.get(needed);
    add({ phase: 'hash-lookup', line: 'lookup', needed, matching: match, title: match === undefined ? '补数还没有出现' : `表中已经有补数 ${needed}`, detail: match === undefined ? `哈希表中找不到 ${needed}，本轮没有答案，接下来保存当前元素。` : `表中 ${needed} 对应之前的下标 ${match}。先查后存，保证这个下标小于当前下标 ${cursor}，不会用同一个位置两次。` });
    if (match !== undefined) {
      add({ phase: 'found', line: 'found', needed, matching: match, result: [match, cursor], title: '找到两个不同的下标', detail: `返回 [${match}, ${cursor}]：${values[match]} + ${value} = ${target}。重复值也能使用，只要它们来自两个不同位置。` });
      return { algorithm: 'hash-two-sum', frames, values: [...values], target };
    }
    const previous = seen.get(value); seen.set(value, cursor);
    add({ phase: 'hash-store', line: 'store', needed, title: `保存 ${value} → 下标 ${cursor}`, detail: previous === undefined ? '查找已经结束，现在保存当前元素。之后的元素才能使用这个位置。' : `这个值先前在下标 ${previous}，现在更新为 ${cursor}。任一之前的位置都能构成有效答案，更新仍保持“只来自以前”的不变式。` });
  }
  cursor = values.length - 1;
  add({ phase: 'finish', line: 'end', result: null, title: '没有找到符合条件的数对', detail: values.length < 2 ? '不足两个元素，不能选两个不同下标。返回空数组。' : '每个元素都查询过补数，没有匹配。返回空数组，不能重复使用一个位置凑出目标。' });
  return { algorithm: 'hash-two-sum', frames, values: [...values], target };
}

function sortFrameValues(values: number[]) { return [...values]; }

/** Stable teaching trace for top-down merge sort. */
export function mergeSort(values: number[]): Trace {
  const array = [...values], frames: Frame[] = [];
  const add = (frame: Frame) => frames.push({ array: sortFrameValues(array), ...frame });
  add({ phase: 'start', line: 'init', left: 0, right: Math.max(0, array.length - 1), title: '准备待排序数组', detail: '归并排序先把问题拆成更小的连续区间，再把两个有序区间合并。' });
  function sort(left: number, right: number) {
    if (left >= right) return;
    const mid = left + Math.floor((right - left) / 2);
    add({ phase: 'sort-split', line: 'split', left, right, mid, title: `把区间 [${left}, ${right}] 对半拆开`, detail: `左半区是 [${left}, ${mid}]，右半区是 [${mid + 1}, ${right}]。先分别排好，再合并。` });
    sort(left, mid); sort(mid + 1, right);
    const copy = array.slice(), result: number[] = [];
    let i = left, j = mid + 1;
    while (i <= mid || j <= right) {
      add({ phase: 'sort-compare', line: 'compare', left, right, mid, compareIndices: [i <= mid ? i : j, j <= right ? j : i], title: '比较两个有序区间的队首', detail: i <= mid && j <= right ? `比较 ${array[i]} 和 ${array[j]}，较小者先放入合并结果。` : '一侧已经取完，剩余元素可以直接接到结果后面。' });
      if (j > right || (i <= mid && copy[i] <= copy[j])) result.push(copy[i++]); else result.push(copy[j++]);
      array[left + result.length - 1] = result[result.length - 1];
      add({ phase: 'sort-write', line: 'write', left, right, mid, active: left + result.length - 1, compareIndices: [left + result.length - 1], expression: `写入位置 ${left + result.length - 1}`, title: '把较小值写回数组', detail: `合并结果目前是 [${result.join(', ')}]。这一格已经确定，继续处理剩余元素。` });
    }
  }
  if (array.length) sort(0, array.length - 1);
  add({ phase: 'finish', line: 'end', left: 0, right: Math.max(0, array.length - 1), result: [...array], title: '排序完成', detail: `数组已经从小到大排列：[${array.join(', ')}]。每层合并总共处理 n 个元素。` });
  return { algorithm: 'merge-sort', frames, values: [...values] };
}

/** Lomuto-partition quick sort trace; the pivot is always the right endpoint. */
export function quickSort(values: number[]): Trace {
  const array = [...values], frames: Frame[] = [];
  const add = (frame: Frame) => frames.push({ array: sortFrameValues(array), ...frame });
  add({ phase: 'start', line: 'init', left: 0, right: Math.max(0, array.length - 1), title: '准备待排序数组', detail: '快速排序选择一个基准值，把更小的元素放到左侧，再递归处理两边。' });
  function sort(left: number, right: number) {
    if (left >= right) return;
    const pivot = array[right];
    add({ phase: 'sort-split', line: 'pivot', left, right, mid: right, compareIndices: [right], title: `选取基准值 ${pivot}`, detail: `把区间 [${left}, ${right}] 的最后一个元素 ${pivot} 作为基准。` });
    let store = left;
    for (let cursor = left; cursor < right; cursor++) {
      add({ phase: 'sort-compare', line: 'compare', left, right, mid: right, active: cursor, compareIndices: [cursor, right], title: `比较 ${array[cursor]} 与基准 ${pivot}`, detail: array[cursor] <= pivot ? `${array[cursor]} ≤ ${pivot}，它应该留在左侧分区。` : `${array[cursor]} > ${pivot}，暂时留在右侧分区。` });
      if (array[cursor] <= pivot) {
        [array[store], array[cursor]] = [array[cursor], array[store]];
        add({ phase: 'sort-write', line: 'swap', left, right, mid: right, active: store, compareIndices: [store, cursor], title: `把较小元素放到位置 ${store}`, detail: `交换后，位置 ${store} 已属于基准的左侧分区。` });
        store++;
      }
    }
    [array[store], array[right]] = [array[right], array[store]];
    add({ phase: 'found', line: 'pivot-place', left, right, mid: store, active: store, compareIndices: [store], title: `基准 ${pivot} 归位`, detail: `基准左边都不大于它，右边都不小于它。接下来递归处理两侧。` });
    sort(left, store - 1); sort(store + 1, right);
  }
  if (array.length) sort(0, array.length - 1);
  add({ phase: 'finish', line: 'end', left: 0, right: Math.max(0, array.length - 1), result: [...array], title: '排序完成', detail: `数组已经从小到大排列：[${array.join(', ')}]。` });
  return { algorithm: 'quick-sort', frames, values: [...values] };
}

export type Interval = { start: number; end: number; index: number };
export function parseIntervals(input: string): Interval[] {
  const raw = input.trim();
  if (!raw) return [];
  const parts = raw.split(/[,，]/).map(part => part.trim()).filter(Boolean);
  if (parts.length > 10) throw new Error('最多输入 10 个区间。');
  const intervals = parts.map((part, index) => {
    const match = part.match(/^(-?\d+)\s*[-~]\s*(-?\d+)$/);
    if (!match) throw new Error(`区间“${part}”格式不正确，请使用 start-end。`);
    const start = Number(match[1]), end = Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end) throw new Error(`区间“${part}”需要满足 start < end。`);
    return { start, end, index };
  });
  return intervals.sort((a, b) => a.end - b.end || a.start - b.start || a.index - b.index);
}

export function intervalGreedy(input: Interval[]): Trace {
  const intervals = input.map(item => ({ ...item })), selected: number[] = [], frames: Frame[] = [];
  let lastEnd = Number.NEGATIVE_INFINITY;
  const add = (frame: Frame) => frames.push({ intervals: intervals.map(item => ({ ...item })), selected: [...selected], ...frame });
  add({ phase: 'start', line: 'init', intervalCursor: -1, result: 0, title: '按结束时间从早到晚排列', detail: '结束得越早，给后面的区间留下的空间越多。现在还没有选择任何区间。' });
  intervals.forEach((item, cursor) => {
    add({ phase: 'greedy-scan', line: 'scan', intervalCursor: cursor, title: `检查区间 ${item.start}-${item.end}`, detail: item.start >= lastEnd ? `它从 ${item.start} 开始，当前最后结束时间是 ${lastEnd === Number.NEGATIVE_INFINITY ? '无' : lastEnd}，可以选择。` : `它从 ${item.start} 开始，早于当前结束时间 ${lastEnd}，与已选区间冲突。` });
    if (item.start >= lastEnd) {
      selected.push(item.index); lastEnd = item.end;
      add({ phase: 'greedy-select', line: 'select', intervalCursor: cursor, result: selected.length, title: `选择 ${item.start}-${item.end}`, detail: `它是当前可选区间中结束最早的一个。选择后，最后结束时间更新为 ${lastEnd}。` });
    } else add({ phase: 'greedy-skip', line: 'skip', intervalCursor: cursor, result: selected.length, title: '跳过冲突区间', detail: '选择它会和已选区间重叠，跳过不会减少已经得到的数量。' });
  });
  add({ phase: 'finish', line: 'end', intervalCursor: intervals.length - 1, result: selected.length, title: `最多选择 ${selected.length} 个区间`, detail: selected.length ? `按结束时间贪心选择的原始区间下标为 [${selected.join(', ')}]。` : '没有可选区间。' });
  return { algorithm: 'interval-greedy', frames, values: [] };
}
