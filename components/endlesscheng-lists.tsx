'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookMarked, ChevronLeft, ChevronRight, ExternalLink, Loader2, Search } from 'lucide-react';
import lists from '@/lib/endlesscheng-lists.json';
import { api } from '@/lib/api';
import type { LibraryProblem } from '@/lib/problem-library';

type ListKey = keyof typeof lists;
type LibraryRow = Pick<LibraryProblem, 'id' | 'site' | 'slug' | 'title' | 'frontend_id'>;
const labels: Record<ListKey, string> = {
  'sliding-window': '滑动窗口与双指针', 'binary-search': '二分算法', 'monotonic-stack': '单调栈', 'grid': '网格图',
  'bit': '位运算', 'graph': '图论算法', 'dp': '动态规划', 'data-structures': '常用数据结构', 'math': '数学算法',
  'greedy': '贪心与思维', 'tree-backtracking': '链表、树与回溯', 'string': '字符串',
};
const pageSize = 40;

export default function EndlessChengLists({ onPractice }: { onPractice: (id: number) => Promise<void> }) {
  const [active, setActive] = useState<ListKey>('sliding-window'), [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const [library, setLibrary] = useState<LibraryRow[]>([]), [busy, setBusy] = useState(''), [error, setError] = useState('');
  useEffect(() => { api<LibraryRow[]>('/library').then(setLibrary).catch(e => setError(e.message)); }, []);
  useEffect(() => { setPage(0); }, [active, search]);
  const entry = lists[active];
  const rows = useMemo(() => entry.questions.filter(row => !search.trim() || `${row.id} ${row.title} ${row.slug}`.toLowerCase().includes(search.trim().toLowerCase())), [entry, search]);
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize), totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const imported = new Map(library.filter(row => row.site === 'cn').map(row => [row.slug, row]));
  async function practice(row: { slug: string; title: string }) {
    if (busy) return; setBusy(row.slug); setError('');
    try {
      let item = imported.get(row.slug);
      if (!item) { const added = await api<{ problem: LibraryProblem }>('/library', 'POST', { mode: 'official', site: 'cn', slug: row.slug }); item = { id: added.problem.id, site: 'cn', slug: row.slug, title: added.problem.title, frontend_id: added.problem.frontend_id }; setLibrary(value => [item!, ...value]); }
      const session = await api<{ id: number }>(`/library/${item.id}/practice`, 'POST', { language: 'cpp' });
      await onPractice(session.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  return <div className="page author-lists-page">
    <div className="page-heading"><div><div className="heading-kicker">AUTHOR PLAYBOOK</div><h1>灵茶山艾府题单</h1><p>按专题练习，遇到不会的题可以直接进入知序引导。</p></div><a className="secondary-button" href="https://leetcode.cn/discuss/post/RvFUtj/" target="_blank" rel="noreferrer">原文总览 <ExternalLink size={14} /></a></div>
    <div className="author-source"><BookMarked size={18} /><div><strong>作者：灵茶山艾府（endlesscheng）</strong><span>题目与分类来自作者在力扣公开发布的专题题单；知序只保存你主动加入的题目。</span></div><a href="https://leetcode.cn/u/endlesscheng/" target="_blank" rel="noreferrer">作者主页 <ExternalLink size={13} /></a></div>
    <div className="list-category-tabs">{(Object.keys(labels) as ListKey[]).map(key => <button key={key} className={active === key ? 'selected' : ''} onClick={() => setActive(key)}>{labels[key]}<small>{lists[key].questions.length}</small></button>)}</div>
    <div className="records-toolbar"><div className="list-current-title"><strong>{labels[active]}</strong><span>{rows.length} 道题 · 来源题单保持同步快照</span></div><div className="search-input"><Search size={16} /><input aria-label="搜索作者题单" value={search} onChange={e => setSearch(e.target.value)} placeholder="题号、中文标题或 slug" /></div></div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="author-question-list">{visible.map(row => { const saved = imported.has(row.slug); return <article className="author-question-row" key={`${active}:${row.slug}`}><div><small>{row.id}</small><strong>{row.title.replace(/^\d+\.\s*/, '')}</strong><span>{row.slug}</span></div>{saved ? <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void practice(row)}>{busy === row.slug ? <Loader2 size={14} className="spin" /> : <ArrowRight size={14} />}开始练习</button> : <button className="primary-button" disabled={Boolean(busy)} onClick={() => void practice(row)}>{busy === row.slug ? <Loader2 size={14} className="spin" /> : <BookMarked size={14} />}加入题库并练习</button>}</article>; })}</div>
    {!visible.length && <div className="empty-state"><h2>没有找到匹配题目</h2><p>换一个题号、标题或切换专题。</p></div>}
    <div className="pagination"><span>第 {page + 1} / {totalPages} 页</span><button className="icon-button" aria-label="上一页" disabled={page === 0} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17} /></button><button className="icon-button" aria-label="下一页" disabled={page + 1 >= totalPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={17} /></button></div>
    <p className="author-attribution">来源：力扣公开题单与讨论帖。作者：灵茶山艾府。非商业使用请注明出处；商业使用请联系原作者。</p>
  </div>;
}
