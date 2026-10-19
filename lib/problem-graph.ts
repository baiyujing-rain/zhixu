import { ALGORITHM_CATALOG, type Algorithm } from 'zhixu-algo-viz';

/** The minimal slice of a learning record needed for graph inference. */
export type GraphItem = {
  id: number;
  title: string;
  tags: string[];
  difficulty?: string;
  status?: string;
  example_id?: string;
  updated_at?: string;
};

export type RelatedItem = {
  id: string;
  title: string;
  subtitle: string;
  kind: 'algorithm' | 'practice' | 'seen';
  algorithm?: Algorithm;
  sessionId?: number;
  hint?: string;
};

export type RelatedGroup = {
  kind: 'algorithm' | 'practice' | 'seen';
  title: string;
  items: RelatedItem[];
};

const EXAMPLE_ALGORITHM: Record<string, Algorithm> = {
  'two-sum': 'hash-two-sum',
  'valid-parentheses': 'brackets',
  'binary-search': 'binary-search',
};

/** Built-in example → its canonical demo algorithm. */
export function exampleToAlgorithm(exampleId?: string): Algorithm | null {
  if (!exampleId) return null;
  return EXAMPLE_ALGORITHM[exampleId] ?? null;
}

const KEYWORD_RULES: [RegExp, Algorithm][] = [
  [/(两数之和|哈希表|散列|two\s*sum)/i, 'hash-two-sum'],
  [/(二分(查找|搜索)?|binary\s*search)/i, 'binary-search'],
  [/(双指针|two\s*pointers?)/i, 'two-pointers'],
  [/(滑动窗口|无重复.*(子串|字符)|最长不重复|sliding\s*window)/i, 'sliding-window'],
  [/(括号|栈|valid\s*parentheses|brackets?)/i, 'brackets'],
  [/(广度优先|bfs|最短路径|网格.*路径|迷宫)/i, 'bfs'],
  [/(爬楼梯|打家劫舍|动态规划|记忆化|stairs)/i, 'stairs'],
  [/(归并排序|归并|merge\s*sort)/i, 'merge-sort'],
  [/(快速排序|快排|快速选择|quick\s*sort|第\s*k\s*(个|大))/i, 'quick-sort'],
  [/(区间调度|区间|贪心|interval|greedy)/i, 'interval-greedy'],
];

/** Guess an algorithm from a non-example item's title and tags. */
export function guessAlgorithm(item: GraphItem): Algorithm | null {
  const text = `${item.title || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
  for (const [pattern, algorithm] of KEYWORD_RULES) {
    if (pattern.test(text)) return algorithm;
  }
  return null;
}

const DIFFICULTY_ORDER: Record<string, number> = { '简单': 0, '入门': 0, '中等': 1, '困难': 2 };
function difficultyRank(difficulty?: string): number {
  return DIFFICULTY_ORDER[difficulty ?? ''] ?? 3;
}

/**
 * Pure derivation of the related-problem card groups:
 *   - same-category algorithms from the catalog (open the lab demo)
 *   - practice prompts for the matched algorithm (text suggestions)
 *   - earlier records sharing at least one tag (top 5 by overlap → difficulty → recency)
 */
export function buildRelated(current: GraphItem, items: GraphItem[]): RelatedGroup[] {
  const groups: RelatedGroup[] = [];
  const algorithm = exampleToAlgorithm(current.example_id) ?? guessAlgorithm(current);
  const entry = algorithm ? ALGORITHM_CATALOG.find(row => row.id === algorithm) : undefined;

  if (entry) {
    const sameCategory = ALGORITHM_CATALOG.filter(row => row.category === entry.category && row.id !== entry.id);
    if (sameCategory.length) {
      groups.push({
        kind: 'algorithm',
        title: '同一分类的其他算法',
        items: sameCategory.map(row => ({
          id: `algorithm:${row.id}`,
          title: row.title,
          subtitle: `打开演示 · ${row.category}`,
          kind: 'algorithm' as const,
          algorithm: row.id,
          hint: row.description,
        })),
      });
    }
    if (entry.practice.length) {
      groups.push({
        kind: 'practice',
        title: '配套练习',
        items: entry.practice.map((practice, index) => ({
          id: `practice:${entry.id}:${index}`,
          title: practice.title,
          subtitle: `${practice.level} · ${practice.prompt}`,
          kind: 'practice' as const,
          hint: practice.prompt,
        })),
      });
    }
  }

  const currentTags = new Set(current.tags || []);
  const seen = items
    .filter(item => item.id !== current.id)
    .map(item => ({ item, intersection: (item.tags || []).filter(tag => currentTags.has(tag)) }))
    .filter(({ intersection }) => intersection.length > 0)
    .sort((a, b) => {
      if (b.intersection.length !== a.intersection.length) return b.intersection.length - a.intersection.length;
      const da = difficultyRank(a.item.difficulty), db = difficultyRank(b.item.difficulty);
      if (da !== db) return da - db;
      return (b.item.updated_at || '').localeCompare(a.item.updated_at || '');
    })
    .slice(0, 5);

  if (seen.length) {
    groups.push({
      kind: 'seen',
      title: '这题用的技巧，之前见过',
      items: seen.map(({ item, intersection }) => ({
        id: `session:${item.id}`,
        title: item.title,
        subtitle: `共同技巧：${intersection.join(' / ')}`,
        kind: 'seen' as const,
        sessionId: item.id,
        hint: `${item.difficulty || '未知难度'} · ${item.status === 'mastered' ? '已掌握' : '学习中'}`,
      })),
    });
  }

  return groups;
}
