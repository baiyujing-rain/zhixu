/** Deterministic teaching traces. These functions do not execute user code or AI output. */
import { slidingWindow, breadthFirst, parseGrid, hashTwoSum, mergeSort, quickSort, intervalGreedy, parseIntervals } from './additional-traces';
export type Algorithm = 'two-pointers' | 'binary-search' | 'brackets' | 'stairs' | 'sliding-window' | 'bfs' | 'hash-two-sum' | 'merge-sort' | 'quick-sort' | 'interval-greedy';
export type DemoInput = { values: string; target: string; brackets: string; stairs: string; window?: string; grid?: string; intervals?: string };
export type Phase = 'start' | 'probe' | 'compare' | 'move-left' | 'move-right' | 'found' | 'read' | 'push' | 'match' | 'pop' | 'advance' | 'mismatch' | 'base' | 'dependencies' | 'fill' | 'finish' | 'window-duplicate' | 'window-shrink' | 'window-add' | 'window-best' | 'bfs-pop' | 'bfs-neighbor' | 'bfs-enqueue' | 'hash-lookup' | 'hash-store' | 'sort-split' | 'sort-compare' | 'sort-write' | 'greedy-scan' | 'greedy-select' | 'greedy-skip';
export type StackEntry = { char: string; index: number };
export type Frame = {
  phase: Phase; title: string; detail: string; line: string;
  left?: number; right?: number; mid?: number; sum?: number;
  cursor?: number; stack?: StackEntry[]; paired?: number[]; matching?: number;
  dp?: (number | null)[]; active?: number; dependencies?: number[];
  hashEntries?: { value: number; index: number }[]; needed?: number;
  windowEnd?: number; seen?: StackEntry[]; bestLength?: number; bestStart?: number; bestEnd?: number;
  queue?: number[]; distances?: number[]; parents?: number[]; processed?: number[]; current?: number; neighbor?: { row: number; col: number; index?: number; reason: 'outside' | 'wall' | 'seen' | 'new' }; path?: number[];
  expression?: string; result?: number | number[] | boolean | null;
  array?: number[]; compareIndices?: number[]; intervals?: { start: number; end: number; index: number }[]; selected?: number[]; intervalCursor?: number;
};
export type Trace = { algorithm: Algorithm; frames: Frame[]; values: number[]; target?: number; text?: string; n?: number; grid?: { rows: string[]; width: number; height: number; start: number; goal: number } };
export const DEFAULT_INPUTS: Record<Algorithm, DemoInput> = {
  'hash-two-sum': { values: '3, 2, 4', target: '6', brackets: '', stairs: '6' },
  'two-pointers': { values: '1, 2, 4, 7, 11, 15', target: '15', brackets: '', stairs: '6' },
  'binary-search': { values: '-1, 0, 3, 5, 9, 12', target: '9', brackets: '', stairs: '6' },
  brackets: { values: '', target: '0', brackets: '([{}])', stairs: '6' },
  stairs: { values: '', target: '0', brackets: '', stairs: '6' },
  'sliding-window': { values: '', target: '0', brackets: '', stairs: '6', window: 'abcaabcbb' },
  bfs: { values: '', target: '0', brackets: '', stairs: '6', grid: `S..#.
.#...
.#.#.
...#.
##..E` },
  'merge-sort': { values: '7, 2, 9, 1, 5, 3', target: '0', brackets: '', stairs: '6' },
  'quick-sort': { values: '8, 3, 6, 1, 7, 2', target: '0', brackets: '', stairs: '6' },
  'interval-greedy': { values: '', target: '0', brackets: '', stairs: '6', intervals: '1-3, 2-4, 3-5, 5-7, 6-9' },
};
export const ALGORITHMS: Record<Algorithm, { name: string; condition: string; principle: string; time: string; space: string }> = {
  'hash-two-sum': { name: '哈希表 · 两数之和', condition: '数组可以无序；返回从 0 开始的两个不同下标。有重复值时也必须来自两个位置，无解返回空数组。', principle: '表中只保存以前的元素。先查询 target − 当前值，再保存当前元素，保证不会重复使用同一个下标。', time: '平均 O(n)，哈希退化时最坏 O(n²)', space: 'O(n)' },
  'two-pointers': { name: '双指针 · 有序两数之和', condition: '数组必须升序；返回从 0 开始的两个不同下标。无序两数之和不能直接套用此方法。', principle: '数组有序：和太小，增大左端；和太大，减小右端。每次排除一个不可能的端点。', time: 'O(n)', space: 'O(1)' },
  'binary-search': { name: '二分查找 · 闭区间', condition: '数组必须升序；重复值允许，找到其中一个下标即可；不存在返回 -1。', principle: '答案如果存在，就在闭区间 [left, right] 中。比较中点后，排除中点及不可能的一半。', time: 'O(log n)（n ≥ 1）', space: 'O(1)' },
  brackets: { name: '栈 · 有效括号', condition: '只接受 () [] {}。最晚遇到的左括号，应最先被同类右括号关闭。空串按此规则判定有效。', principle: '栈底到栈顶保存尚未关闭的左括号。右括号只能匹配栈顶，不能跳过它。', time: 'O(n)', space: 'O(n)' },
  'sliding-window': { name: '滑动窗口 · 最长不重复子串', condition: '求最长不重复连续子串的长度。只接受英文字母和数字，最多 12 个字符；大小写不同，空串返回 0。最优窗口仅用于演示。', principle: '窗口内始终没有重复字符。遇到重复的候选字符，先从左端移除，直到可以加入它；左右指针都只向右。', time: 'O(n)（每个字符最多加入、移除各一次）', space: 'O(1)（固定的 128 项 ASCII 字符表）' },
  bfs: { name: 'BFS · 网格最短路径', condition: '每步上下左右走一格，不能穿过 #。S 起点，E 终点，. 通路；B 表示起终点同格。最多 5×5 格，返回步数，无路返回 −1。', principle: '先进先出的队列按距离分层探索。格子在入队时就标记，首次到达的距离最短，不能重复入队。', time: 'O(行数 × 列数)', space: 'O(行数 × 列数)' },
  stairs: { name: '动态规划 · 爬楼梯', condition: '每次爬 1 或 2 层。演示范围 0～20 层；0 层按 1 种空路径计数。', principle: '到第 i 层的最后一步来自 i−1 或 i−2；两类路径互不重叠，所以把它们相加。', time: 'O(n)', space: 'O(n)（完整 DP 表）' },
  'merge-sort': { name: '归并排序', condition: '输入最多 12 个整数，可以无序、重复或为空。演示把区间拆开，再把两个有序子区间合并。', principle: '先解决更小的区间，再把两个有序结果按从小到大合并；每层合并 O(n)，共有 O(log n) 层。', time: 'O(n log n)', space: 'O(n)' },
  'quick-sort': { name: '快速排序', condition: '输入最多 12 个整数，可以无序、重复或为空。演示取区间末端为基准，把较小元素放到左侧。', principle: '基准值归位后，左侧都不大于它，右侧都不小于它；递归处理两边区间。', time: '平均 O(n log n)，最坏 O(n²)', space: '平均 O(log n)' },
  'interval-greedy': { name: '贪心 · 区间调度', condition: '输入若干个开始-结束区间（如 1-3, 2-4），最多 10 个；目标是选出最多个互不重叠区间。', principle: '每次选择结束时间最早且不冲突的区间，为后面留下最多空间。局部最优选择可以延伸成全局最优。', time: 'O(n log n)', space: 'O(n)' },
};

function integer(text: string, label: string, min: number, max: number) {
  if (!/^[+-]?\d+$/.test(text.trim())) throw new Error(`${label}必须是整数。`);
  const value = Number(text.trim());
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}范围为 ${min}～${max}。`);
  return value;
}
export function parseValues(text: string, sorted = true) {
  let raw = text.trim();
  if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1).trim();
  if (!raw) return [];
  const parts = raw.split(/[,，]/);
  if (parts.length > 12) throw new Error('最多输入 12 个数，让每个位置都能看清楚。');
  const values = parts.map(value => integer(value, '数组元素', -9999, 9999));
  if (sorted && values.some((value, i) => i > 0 && value < values[i - 1])) throw new Error('此演示要求升序数组。请按从小到大输入；不会自动排序或改变下标。');
  return values;
}

export function twoPointers(values: number[], target: number): Trace {
  const frames: Frame[] = [];
  let left = 0, right = values.length - 1;
  const add = (frame: Frame) => frames.push({ left, right, ...frame });
  add({ phase: 'start', line: 'init', title: '从两端开始', detail: 'left 指向最左端，right 指向最右端。先比较它们的和。' });
  while (left < right) {
    const sum = values[left] + values[right];
    add({ phase: 'compare', line: 'compare', sum, expression: `${values[left]} + ${values[right]} = ${sum}`, title: '比较当前两端的和', detail: `下标 ${left} 与 ${right} 的和为 ${sum}，目标是 ${target}。` });
    if (sum === target) {
      add({ phase: 'found', line: 'found', sum, result: [left, right], title: '找到两个不同的位置', detail: `${values[left]} + ${values[right]} = ${target}，返回下标 [${left}, ${right}]。` });
      return { algorithm: 'two-pointers', frames, values: [...values], target };
    }
    if (sum < target) {
      const previous = left++;
      add({ phase: 'move-left', line: 'left', title: '和太小，左指针向右', detail: `刚才的和 ${sum} < ${target}。固定下标 ${previous} 时，换更小的右端只会让和更小，所以排除它：left 从 ${previous} 移到 ${left}。` });
    } else {
      const previous = right--;
      add({ phase: 'move-right', line: 'right', title: '和太大，右指针向左', detail: `刚才的和 ${sum} > ${target}。固定下标 ${previous} 时，换更大的左端只会让和更大，所以排除它：right 从 ${previous} 移到 ${right}。` });
    }
  }
  add({ phase: 'finish', line: 'end', result: null, title: '没有符合条件的数对', detail: values.length < 2 ? '数组不足两个元素，无法选择两个不同下标。' : '两指针已相遇。不能重复使用同一个元素，所有可行端点都已排除。' });
  return { algorithm: 'two-pointers', frames, values: [...values], target };
}

export function binarySearch(values: number[], target: number): Trace {
  const frames: Frame[] = [];
  let left = 0, right = values.length - 1;
  const add = (frame: Frame) => frames.push({ left, right, ...frame });
  add({ phase: 'start', line: 'init', title: '保留整个闭区间', detail: '候选范围是 [left, right]，两端都包含在内。区间非空时才取中点。' });
  while (left <= right) {
    const mid = left + Math.floor((right - left) / 2);
    add({ phase: 'probe', line: 'probe', mid, title: '取候选区间的中点', detail: `mid = ${left} + ⌊(${right} − ${left}) / 2⌋ = ${mid}。` });
    add({ phase: 'compare', line: 'compare', mid, expression: `${values[mid]} ${values[mid] === target ? '=' : values[mid] < target ? '<' : '>'} ${target}`, title: '中点值与目标比较', detail: `下标 ${mid} 的值是 ${values[mid]}，目标是 ${target}。` });
    if (values[mid] === target) {
      add({ phase: 'found', line: 'found', mid, result: mid, title: '找到目标', detail: `nums[${mid}] = ${target}，返回下标 ${mid}。` });
      return { algorithm: 'binary-search', frames, values: [...values], target };
    }
    if (values[mid] < target) {
      const previous = left; left = mid + 1;
      add({ phase: 'move-left', line: 'left', title: '排除中点及左半边', detail: `下标 ${previous}～${mid} 的值都不大于 ${values[mid]}，小于目标。left 移到 mid + 1 = ${left}，不再检查旧中点。` });
    } else {
      const previous = right; right = mid - 1;
      add({ phase: 'move-right', line: 'right', title: '排除中点及右半边', detail: `下标 ${mid}～${previous} 的值都不小于 ${values[mid]}，大于目标。right 移到 mid − 1 = ${right}，不再检查旧中点。` });
    }
  }
  add({ phase: 'finish', line: 'end', result: -1, title: '区间已空，目标不存在', detail: `left = ${left} > right = ${right}，没有候选位置，返回 -1。` });
  return { algorithm: 'binary-search', frames, values: [...values], target };
}

export function brackets(text: string): Trace {
  const frames: Frame[] = [], stack: StackEntry[] = [], paired: number[] = [];
  const opening = '([{', closing = ')]}';
  let cursor = 0;
  const add = (frame: Frame) => frames.push({ cursor, stack: stack.map(entry => ({ ...entry })), paired: [...paired], ...frame });
  add({ phase: 'start', line: 'init', title: '先准备一个空栈', detail: '从左到右读括号，栈中只保存尚未关闭的左括号。' });
  for (; cursor < text.length; cursor++) {
    const char = text[cursor];
    add({ phase: 'read', line: 'loop', title: `读下标 ${cursor}：${char}`, detail: opening.includes(char) ? '这是左括号，接下来将它压入栈顶。' : '这是右括号，接下来检查它能否关闭栈顶。' });
    if (opening.includes(char)) {
      stack.push({ char, index: cursor });
      add({ phase: 'push', line: 'push', title: '左括号入栈', detail: `${char} 成为新的栈顶。之前的左括号要等它先关闭。` });
    } else {
      const top = stack[stack.length - 1], expected = opening[closing.indexOf(char)];
      if (!top || top.char !== expected) {
        add({ phase: 'mismatch', line: 'reject', result: false, title: '匹配失败，立即停止', detail: !top ? `遇到 ${char} 时栈为空，没有左括号可以关闭。` : `右括号 ${char} 需要 ${expected}，但栈顶是 ${top.char}。不能越过栈顶去找更早的括号。` });
        return { algorithm: 'brackets', frames, values: [], text };
      }
      add({ phase: 'match', line: 'compare', matching: top.index, title: '右括号与栈顶同类', detail: `下标 ${cursor} 的 ${char} 对应栈顶下标 ${top.index} 的 ${top.char}，接下来弹出栈顶。` });
      stack.pop(); paired.push(top.index, cursor);
      add({ phase: 'pop', line: 'pop', matching: top.index, title: '配对成功，栈顶出栈', detail: `下标 ${top.index} 与 ${cursor} 已配对。弹出 ${top.char} 后，继续检查剩余括号。` });
    }
    add({ phase: 'advance', line: 'loop', cursor: cursor + 1, title: '继续读下一个位置', detail: cursor + 1 < text.length ? `下一个要读取的下标是 ${cursor + 1}。` : '所有字符已读完，接下来检查栈是否为空。' });
  }
  add({ phase: 'finish', line: 'end', result: stack.length === 0, title: stack.length ? '还有左括号没有关闭' : '全部匹配成功', detail: stack.length ? `栈里还剩 ${stack.length} 个左括号，因此返回 false。` : '输入已读完且栈为空，返回 true。' });
  return { algorithm: 'brackets', frames, values: [], text };
}

export function stairs(n: number): Trace {
  const frames: Frame[] = [], dp: (number | null)[] = Array(n + 1).fill(null);
  const add = (frame: Frame) => frames.push({ dp: [...dp], ...frame });
  add({ phase: 'start', line: 'init', title: '先定义每个状态', detail: 'dp[i] 表示到达第 i 层的不同走法数。图中问号表示尚未计算；代码的初始 0 只是占位，不能当已知走法数参与求和。' });
  dp[0] = 1;
  add({ phase: 'base', line: 'base0', active: 0, title: '基础状态：dp[0] = 1', detail: '不爬任何台阶是一种空路径。这个约定让第 2 层的转移公式也成立。' });
  if (n >= 1) {
    dp[1] = 1;
    add({ phase: 'base', line: 'base1', active: 1, title: '基础状态：dp[1] = 1', detail: '到第 1 层，只能从地面走 1 步。' });
  }
  for (let i = 2; i <= n; i++) {
    const dependencies = [i - 2, i - 1];
    add({ phase: 'dependencies', line: 'loop', active: i, dependencies, expression: `dp[${i - 2}] + dp[${i - 1}] = ${dp[i - 2]} + ${dp[i - 1]}`, title: `先看第 ${i} 层的两个来源`, detail: `最后一步走 2 层，从第 ${i - 2} 层来；最后一步走 1 层，从第 ${i - 1} 层来。` });
    dp[i] = (dp[i - 2] as number) + (dp[i - 1] as number);
    add({ phase: 'fill', line: 'fill', active: i, dependencies, expression: `${dp[i - 2]} + ${dp[i - 1]} = ${dp[i]}`, title: `写入 dp[${i}] = ${dp[i]}`, detail: '两类路径按最后一步的长度区分，不会重复计数。相加后，这个状态就可以供后面使用。' });
  }
  add({ phase: 'finish', line: 'end', active: n, result: dp[n] as number, title: `到第 ${n} 层，共 ${dp[n]} 种走法`, detail: '所有依赖都先计算、后使用。最后读取 dp[n]，演示结束。' });
  return { algorithm: 'stairs', frames, values: [], n };
}

export function buildTrace(algorithm: Algorithm, input: DemoInput): Trace {
  if (algorithm === 'hash-two-sum') return hashTwoSum(parseValues(input.values, false), integer(input.target, '目标值', -19998, 19998));
  if (algorithm === 'two-pointers' || algorithm === 'binary-search') {
    const values = parseValues(input.values), target = integer(input.target, '目标值', -19998, 19998);
    return algorithm === 'two-pointers' ? twoPointers(values, target) : binarySearch(values, target);
  }
  if (algorithm === 'brackets') {
    if (input.brackets.length > 16) throw new Error('括号串最多 16 个字符。');
    if (!/^[()[\]{}]*$/.test(input.brackets)) throw new Error('只允许输入英文括号 () [] {}，不包含空格或其他字符。');
    return brackets(input.brackets);
  }
  if (algorithm === 'sliding-window') {
    if (typeof input.window !== 'string' || input.window.length > 12 || !/^[a-zA-Z0-9]*$/.test(input.window)) throw new Error('只接受最多 12 个英文字母或数字，也可以留空。');
    return slidingWindow(input.window);
  }
  if (algorithm === 'bfs') return breadthFirst(parseGrid(input.grid || ''));
  if (algorithm === 'stairs') return stairs(integer(input.stairs, '台阶数', 0, 20));
  if (algorithm === 'merge-sort') return mergeSort(parseValues(input.values, false));
  if (algorithm === 'quick-sort') return quickSort(parseValues(input.values, false));
  if (algorithm === 'interval-greedy') return intervalGreedy(parseIntervals(input.intervals || ''));
  throw new Error('不支持的演示算法。');
}

export type CodeLine = { id: string; text: string };
export function coreCode(algorithm: Algorithm, language: 'cpp' | 'python'): CodeLine[] {
  const cpp = language === 'cpp';
  if (algorithm === 'hash-two-sum') return [
    { id: 'init', text: cpp ? 'unordered_map<long long, int> seen;' : 'seen = {}' },
    { id: 'loop', text: cpp ? 'for (int i = 0; i < (int)nums.size(); ++i) {' : 'for i, value in enumerate(nums):' },
    { id: 'need', text: cpp ? '    long long need = (long long)target - nums[i];' : '    need = target - value' },
    { id: 'lookup', text: cpp ? '    auto it = seen.find(need);' : '    if need in seen:' },
    { id: 'found', text: cpp ? '    if (it != seen.end()) return {it->second, i};' : '        return [seen[need], i]' },
    { id: 'store', text: cpp ? '    seen[nums[i]] = i;' : '    seen[value] = i' },
    ...(cpp ? [{ id: 'close', text: '}' }] : []), { id: 'end', text: cpp ? 'return {};' : 'return []' },
  ];
  if (algorithm === 'two-pointers') return [
    { id: 'init', text: cpp ? 'int left = 0, right = (int)nums.size() - 1;' : 'left, right = 0, len(nums) - 1' },
    { id: 'loop', text: cpp ? 'while (left < right) {' : 'while left < right:' },
    { id: 'compare', text: cpp ? '    int sum = nums[left] + nums[right];' : '    total = nums[left] + nums[right]' },
    { id: 'found', text: cpp ? '    if (sum == target) return {left, right};' : '    if total == target: return [left, right]' },
    { id: 'left', text: cpp ? '    if (sum < target) ++left;' : '    if total < target: left += 1' },
    { id: 'right', text: cpp ? '    else --right;' : '    else: right -= 1' },
    ...(cpp ? [{ id: 'close', text: '}' }] : []), { id: 'end', text: cpp ? 'return {};' : 'return []' },
  ];
  if (algorithm === 'binary-search') return [
    { id: 'init', text: cpp ? 'int left = 0, right = (int)nums.size() - 1;' : 'left, right = 0, len(nums) - 1' },
    { id: 'loop', text: cpp ? 'while (left <= right) {' : 'while left <= right:' },
    { id: 'probe', text: cpp ? '    int mid = left + (right - left) / 2;' : '    mid = left + (right - left) // 2' },
    { id: 'compare', text: cpp ? '    // 将 nums[mid] 与 target 比较' : '    # 将 nums[mid] 与 target 比较' },
    { id: 'found', text: cpp ? '    if (nums[mid] == target) return mid;' : '    if nums[mid] == target: return mid' },
    { id: 'left', text: cpp ? '    if (nums[mid] < target) left = mid + 1;' : '    if nums[mid] < target: left = mid + 1' },
    { id: 'right', text: cpp ? '    else right = mid - 1;' : '    else: right = mid - 1' },
    ...(cpp ? [{ id: 'close', text: '}' }] : []), { id: 'end', text: cpp ? 'return -1;' : 'return -1' },
  ];
  if (algorithm === 'sliding-window') return [
    { id: 'init', text: cpp ? 'bool seen[128] = {}; int left = 0, best = 0;' : 'seen = [False] * 128; left = best = 0' },
    { id: 'loop', text: cpp ? 'for (int right = 0; right < (int)s.size(); ++right) {' : 'for right, char in enumerate(s):' },
    { id: 'candidate', text: cpp ? '    auto c = static_cast<unsigned char>(s[right]);' : '    c = ord(char)' },
    { id: 'duplicate', text: cpp ? '    while (seen[c]) {' : '    while seen[c]:' },
    { id: 'shrink', text: cpp ? '        seen[static_cast<unsigned char>(s[left])] = false;\n        ++left;' : '        seen[ord(s[left])] = False\n        left += 1' },
    ...(cpp ? [{ id: 'close-window', text: '    }' }] : []),
    { id: 'add', text: cpp ? '    seen[c] = true;' : '    seen[c] = True' },
    { id: 'best', text: cpp ? '    best = max(best, right - left + 1);' : '    best = max(best, right - left + 1)' },
    ...(cpp ? [{ id: 'close', text: '}' }] : []), { id: 'end', text: cpp ? 'return best;' : 'return best' },
  ];
  if (algorithm === 'bfs') return [
    { id: 'init', text: cpp ? 'int rows = grid.size(), cols = grid[0].size();\nvector<vector<int>> dist(rows, vector<int>(cols, -1));\nqueue<pair<int, int>> q; q.push(start);\ndist[start.first][start.second] = 0;\nint dr[] = {-1, 0, 1, 0}, dc[] = {0, 1, 0, -1};' : 'from collections import deque\nrows, cols = len(grid), len(grid[0])\ndist = [[-1] * cols for _ in range(rows)]\nq = deque([start]); dist[start[0]][start[1]] = 0' },
    { id: 'loop', text: cpp ? 'while (!q.empty()) {' : 'while q:' },
    { id: 'pop', text: cpp ? '    auto [r, c] = q.front(); q.pop();' : '    r, c = q.popleft()' },
    { id: 'found', text: cpp ? '    if (make_pair(r, c) == goal) return dist[r][c];' : '    if (r, c) == goal: return dist[r][c]' },
    { id: 'neighbor', text: cpp ? '    for (int k = 0; k < 4; ++k) {\n        int nr = r + dr[k], nc = c + dc[k];' : '    for dr, dc in [(-1, 0), (0, 1), (1, 0), (0, -1)]:\n        nr, nc = r + dr, c + dc' },
    { id: 'skip', text: cpp ? "        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols\n            || grid[nr][nc] == '#' || dist[nr][nc] != -1) continue;" : "        if not (0 <= nr < rows and 0 <= nc < cols) or grid[nr][nc] == '#' or dist[nr][nc] != -1: continue" },
    { id: 'enqueue', text: cpp ? '        dist[nr][nc] = dist[r][c] + 1; q.push({nr, nc});' : '        dist[nr][nc] = dist[r][c] + 1; q.append((nr, nc))' },
    ...(cpp ? [{ id: 'close', text: '    }\n}' }] : []), { id: 'end', text: cpp ? 'return -1;' : 'return -1' },
  ];
  if (algorithm === 'brackets') return [
    { id: 'init', text: cpp ? 'vector<char> st;' : "stack = []; pairs = {')': '(', ']': '[', '}': '{'}" },
    { id: 'loop', text: cpp ? 'for (char c : s) {' : 'for c in s:' },
    { id: 'push', text: cpp ? "    if (c == '(' || c == '[' || c == '{') st.push_back(c);" : "    if c in '([{': stack.append(c)" },
    { id: 'compare', text: cpp ? "    else {\n        char expected = c == ')' ? '(' : (c == ']' ? '[' : '{');" : '    else:  # 检查栈是否为空、栈顶是否匹配' },
    { id: 'reject', text: cpp ? '        if (st.empty() || st.back() != expected) return false;' : '        if not stack or stack[-1] != pairs[c]: return False' },
    { id: 'pop', text: cpp ? '        st.pop_back();' : '        stack.pop()' },
    ...(cpp ? [{ id: 'close', text: '    }\n}' }] : []), { id: 'end', text: cpp ? 'return st.empty();' : 'return not stack' },
  ];
  if (algorithm === 'merge-sort') return [
    { id: 'init', text: cpp ? 'void mergeSort(int left, int right) {' : 'def merge_sort(left, right):' },
    { id: 'split', text: cpp ? '    int mid = left + (right - left) / 2;' : '    mid = left + (right - left) // 2' },
    { id: 'compare', text: cpp ? '    if (a[i] <= a[j]) temp.push_back(a[i++]);' : '    if left_value <= right_value: temp.append(left_value)' },
    { id: 'write', text: cpp ? '    a[left + k] = temp[k];' : '    values[left + k] = temp[k]' },
    { id: 'end', text: cpp ? '}' : 'return values' },
  ];
  if (algorithm === 'quick-sort') return [
    { id: 'init', text: cpp ? 'void quickSort(int left, int right) {' : 'def quick_sort(left, right):' },
    { id: 'pivot', text: cpp ? '    int pivot = a[right];' : '    pivot = values[right]' },
    { id: 'compare', text: cpp ? '    if (a[cursor] <= pivot) {' : '    if values[cursor] <= pivot:' },
    { id: 'swap', text: cpp ? '        swap(a[store], a[cursor]);' : '        values[store], values[cursor] = values[cursor], values[store]' },
    { id: 'pivot-place', text: cpp ? '    swap(a[store], a[right]);' : '    values[store], values[right] = values[right], values[store]' },
    { id: 'end', text: cpp ? '}' : 'return values' },
  ];
  if (algorithm === 'interval-greedy') return [
    { id: 'init', text: cpp ? 'sort(intervals.begin(), intervals.end(), byEnd);' : 'intervals.sort(key=lambda item: item.end)' },
    { id: 'scan', text: cpp ? 'for (const auto& interval : intervals) {' : 'for interval in intervals:' },
    { id: 'select', text: cpp ? '    if (interval.start >= lastEnd) {' : '    if interval.start >= last_end:' },
    { id: 'skip', text: cpp ? '    } // 与已选区间冲突，跳过' : '    # 冲突，跳过' },
    ...(cpp ? [{ id: 'close', text: '    }\n}' }] : []), { id: 'end', text: cpp ? 'return count;' : 'return count' },
  ];
  return [
    { id: 'init', text: cpp ? 'vector<int> dp(n + 1, 0);' : 'dp = [0] * (n + 1)' },
    { id: 'base0', text: 'dp[0] = 1' + (cpp ? ';' : '') },
    { id: 'base1', text: cpp ? 'if (n >= 1) dp[1] = 1;' : 'if n >= 1: dp[1] = 1' },
    { id: 'loop', text: cpp ? 'for (int i = 2; i <= n; ++i) {' : 'for i in range(2, n + 1):' },
    { id: 'fill', text: cpp ? '    dp[i] = dp[i - 1] + dp[i - 2];' : '    dp[i] = dp[i - 1] + dp[i - 2]' },
    ...(cpp ? [{ id: 'close', text: '}' }] : []), { id: 'end', text: cpp ? 'return dp[n];' : 'return dp[n]' },
  ];
}
