import { ALGORITHMS, type Algorithm } from './algorithm-traces';
export type PracticePrompt = { level: '入门' | '强化'; title: string; prompt: string };
export type AlgorithmEntry = { id: Algorithm; category: string; title: string; description: string; focus: string[]; practice: PracticePrompt[] };
/** Only implemented, verified traces belong here. Add a trace and tests before registering. */
export const ALGORITHM_CATALOG: AlgorithmEntry[] = [
  { id: 'hash-two-sum', category: '数组与字符串', title: '哈希表查找', description: '看到一个数，先找它需要的另一个数。', focus: ['原始下标', '先查后存', '重复值'], practice: [{ level: '入门', title: '两数之和', prompt: '给定无序数组和目标值，返回两个数的下标。' }, { level: '强化', title: '四数之和计数', prompt: '统计四个下标互不相同且和为目标值的组合数量。' }] },
  { id: 'two-pointers', category: '数组与字符串', title: '有序双指针', description: '利用排序，逐步排除不可能的两端。', focus: ['排序条件', '左右移动', '排除依据'], practice: [{ level: '入门', title: '有序数组两数之和', prompt: '在升序数组中找到和为目标值的一对下标。' }, { level: '强化', title: '三数之和', prompt: '找出数组中所有和为 0 且不重复的三元组。' }] },
  { id: 'sliding-window', category: '数组与字符串', title: '滑动窗口', description: '维护没有重复字符的连续区间。', focus: ['窗口规则', '收缩左端', '最优长度'], practice: [{ level: '入门', title: '最长不重复子串', prompt: '返回字符串中最长连续不重复子串的长度。' }, { level: '强化', title: '最小覆盖子串', prompt: '找到包含目标字符串全部字符的最短窗口。' }] },
  { id: 'binary-search', category: '查找与遍历', title: '闭区间二分', description: '一次比较，让候选范围缩小一半。', focus: ['区间边界', '中点', '无解'], practice: [{ level: '入门', title: '标准二分查找', prompt: '在升序数组中返回目标值下标，不存在时返回 -1。' }, { level: '强化', title: '搜索旋转排序数组', prompt: '在被旋转过的升序数组中以对数时间查找目标。' }] },
  { id: 'bfs', category: '查找与遍历', title: '广度优先搜索', description: '按距离逐层探索，找到网格最短路径。', focus: ['先进先出', '入队标记', '路径还原'], practice: [{ level: '入门', title: '网格最短路径', prompt: '只能上下左右移动，求起点到终点的最少步数。' }, { level: '强化', title: '腐烂的橘子', prompt: '计算所有橘子变腐烂所需的最少分钟数。' }] },
  { id: 'brackets', category: '状态与结构', title: '栈与括号匹配', description: '最后遇到的左括号，先完成配对。', focus: ['栈顶', '入栈出栈', '匹配失败'], practice: [{ level: '入门', title: '有效括号', prompt: '判断括号串能否正确闭合。' }, { level: '强化', title: '最长有效括号', prompt: '返回括号串中最长有效连续子串的长度。' }] },
  { id: 'stairs', category: '状态与结构', title: '动态规划', description: '从已经知道的状态，计算下一步。', focus: ['基础状态', '状态依赖', '转移'], practice: [{ level: '入门', title: '爬楼梯', prompt: '每次走 1 或 2 层，计算到第 n 层的走法数。' }, { level: '强化', title: '打家劫舍', prompt: '相邻房屋不能同时偷，求能取得的最大金额。' }] },
  { id: 'merge-sort', category: '排序与贪心', title: '归并排序', description: '先拆分，再把两个有序区间合并。', focus: ['分治', '双路合并', '稳定排序'], practice: [{ level: '入门', title: '排序数组', prompt: '用归并排序把整数数组按升序排列。' }, { level: '强化', title: '计算逆序对', prompt: '统计数组中 i < j 且 nums[i] > nums[j] 的对数。' }] },
  { id: 'quick-sort', category: '排序与贪心', title: '快速排序', description: '让基准值归位，再递归处理两侧区间。', focus: ['基准值', '分区', '递归边界'], practice: [{ level: '入门', title: '快速排序', prompt: '选择基准并原地分区，把数组按升序排列。' }, { level: '强化', title: '数组中的第 K 个最大元素', prompt: '利用快速选择在平均线性时间内找到第 k 大元素。' }] },
  { id: 'interval-greedy', category: '排序与贪心', title: '区间调度贪心', description: '优先选择结束最早且不冲突的区间。', focus: ['按结束时间排序', '局部最优', '冲突判断'], practice: [{ level: '入门', title: '最多不重叠区间', prompt: '从若干区间中选择最多个互不重叠的区间。' }, { level: '强化', title: '用最少箭引爆气球', prompt: '用尽可能少的点覆盖所有重叠区间。' }] },
];
export const algorithmName = (id: Algorithm) => ALGORITHMS[id].name;
