"use client";

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, CalendarDays, CheckCheck, ChevronRight, Clock3, Lightbulb, Loader2, Plus, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { localDateTime, recordOrigin } from '@/lib/dates';
import Modal from './modal';
import { useLocalInput } from './use-local-input';
import ForeignDrafts from './foreign-drafts';

type Item = { id: number; created_at: string; title: string; language: string; status: string };
type Plan = { session_id: number; created_at: string; title: string; language: string; status: string; step: number; version: number; due_at: string; due: boolean; last_reviewed_at: string | null; next_good_days: number; next_easy_days: number; review_count: number };
type Overview = { entries: Plan[]; stats: { scheduled: number; due: number; reviewed_today: number } };
type Detail = { content: string; notes: string };
type Event = { id: number; rating: string; note: string; reviewed_at: string; next_due_at: string };
type Rating = 'again' | 'hard' | 'good' | 'easy';
const ratingNames: Record<Rating, string> = { again: '忘了', hard: '还不熟', good: '基本想起', easy: '很熟悉' };
const noteKey = (plan: Plan) => `zhixu-review-note-${plan.session_id}:${recordOrigin(plan.created_at)}`;

export default function ReviewBoard({ items, onOpen, onNew, onChanged }: { items: Item[]; onOpen: (id: number) => void; onNew: () => void; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<Overview>({ entries: [], stats: { scheduled: 0, due: 0, reviewed_today: 0 } });
  const [hasData, setHasData] = useState(false), [readError, setReadError] = useState('');
  const [loading, setLoading] = useState(true), [fetching, setFetching] = useState(false), [pending, setPending] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [filter, setFilter] = useState<'due' | 'all' | 'upcoming'>('due'), [search, setSearch] = useState('');
  const [active, setActive] = useState<Plan | null>(null), [detail, setDetail] = useState<Detail | null>(null), [history, setHistory] = useState<Event[]>([]);
  const [practiceLoading, setPracticeLoading] = useState(false), [practiceError, setPracticeError] = useState(''), [showNotes, setShowNotes] = useState(false);
  const observation = useLocalInput(active ? noteKey(active) : null, 3000);
  const note = observation.value;
  const [pausing, setPausing] = useState<Plan | null>(null), [showAllAvailable, setShowAllAvailable] = useState(false);
  const alive = useRef(true), requestEpoch = useRef(0), practiceEpoch = useRef(0), pendingRef = useRef('');
  const loadAbortRef = useRef<AbortController | null>(null);
  pendingRef.current = pending;

  async function load() {
    loadAbortRef.current?.abort();
    const controller = new AbortController(); loadAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    const epoch = ++requestEpoch.current; setFetching(true);
    try {
      const result = await api<Overview>('/reviews', 'GET', undefined, controller.signal);
      if (alive.current && requestEpoch.current === epoch) { setData(result); setHasData(true); setReadError(''); }
    } catch (e) { if (alive.current && requestEpoch.current === epoch) setReadError((e as Error).name === 'AbortError' ? '读取复习安排超时，请重试。' : (e as Error).message); }
    finally {
      window.clearTimeout(timeout);
      if (alive.current && requestEpoch.current === epoch) { setLoading(false); setFetching(false); loadAbortRef.current = null; }
    }
  }
  useEffect(() => {
    alive.current = true; void load();
    function refreshVisible() { if (!document.hidden && !pendingRef.current) void load(); }
    const timer = setInterval(refreshVisible, 60000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { alive.current = false; requestEpoch.current++; practiceEpoch.current++; loadAbortRef.current?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { function protect(event: BeforeUnloadEvent) { if (note.trim() && !observation.cacheAvailable) event.preventDefault(); } window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect); }, [note, observation.cacheAvailable]);
  function setBusy(value: string) { pendingRef.current = value; setPending(value); if (value) { requestEpoch.current++; loadAbortRef.current?.abort(); setFetching(false); } }
  async function refreshParent() { try { await onChanged(); } catch { if (alive.current) setError('记录已保存，但题目列表更新失败，可以稍后刷新。'); } }
  async function enroll(item: Item) {
    if (pendingRef.current) return;
    setBusy(`enroll:${item.id}`); setError('');
    try {
      await api(`/sessions/${item.id}/review-plan`, 'POST', undefined, undefined, item.created_at);
      if (!alive.current) return;
      setNotice(`「${item.title}」已加入复习计划，可以先回想一次。`); setFilter('due'); await load(); await refreshParent();
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(''); }
  }
  async function practice(plan: Plan) {
    const epoch = ++practiceEpoch.current;
    setActive(plan); setDetail(null); setHistory([]); setPracticeError(''); setShowNotes(false); setPracticeLoading(true);
    try {
      const [record, events] = await Promise.all([api<Detail>(`/sessions/${plan.session_id}`, 'GET', undefined, undefined, plan.created_at), api<Event[]>(`/sessions/${plan.session_id}/reviews`, 'GET', undefined, undefined, plan.created_at)]);
      if (alive.current && practiceEpoch.current === epoch) { setDetail(record); setHistory(events); }
    } catch (e) { if (alive.current && practiceEpoch.current === epoch) setPracticeError((e as Error).message); }
    finally { if (alive.current && practiceEpoch.current === epoch) setPracticeLoading(false); }
  }
  function closePractice() { if (pendingRef.current) return; practiceEpoch.current++; setActive(null); }
  function editNote(value: string) { observation.set(value); }
  async function rate(rating: Rating) {
    if (!active || pendingRef.current || practiceLoading || !detail || observation.tooLong || readError || fetching) return;
    setBusy(`rate:${rating}`); setPracticeError('');
    try {
      const result = await api<{ plan: Plan }>(`/sessions/${active.session_id}/reviews`, 'POST', { rating, expected_version: active.version, note }, undefined, active.created_at);
      if (!alive.current) return;
      observation.clearIfEqual(note);
      setActive(null); setNotice(`已记录「${ratingNames[rating]}」，下一次安排在 ${localDateTime(result.plan.due_at)}。`); await load(); await refreshParent();
    } catch (e) { if (alive.current) { setPracticeError((e as Error).message); if (e instanceof ApiError && e.status === 409) void load(); } }
    finally { if (alive.current) setBusy(''); }
  }
  async function pause() {
    if (!pausing || pendingRef.current) return;
    setBusy('pause'); setError('');
    try {
      await api(`/sessions/${pausing.session_id}/review-plan?version=${pausing.version}`, 'DELETE', undefined, undefined, pausing.created_at);
      if (!alive.current) return;
      setPausing(null); setNotice('已暂停安排，过去的复习记录仍然保留。'); await load(); await refreshParent();
    } catch (e) { if (alive.current) { setPausing(null); setError((e as Error).message); } }
    finally { if (alive.current) setBusy(''); }
  }
  const available = items.filter(item => !data.entries.some(plan => plan.session_id === item.id));
  const visible = data.entries.filter(plan => (filter === 'all' || (filter === 'due' ? plan.due : !plan.due)) && `${plan.title} ${plan.language === 'cpp' ? 'C++' : 'Python'}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="page review-page">
    <div className="page-heading"><div><div className="heading-kicker"><span />让理解经得起下一次回想</div><h1>想通之后，再想一遍。</h1><p>先回想，再看笔记。按真实的熟悉程度，为下一次练习留个时间。</p></div><button className="secondary-button" disabled={Boolean(pending) || fetching} onClick={() => void load()}><RefreshCw size={15} className={fetching ? 'spin' : ''} />刷新安排</button></div>
    <div className="review-stats"><section><Clock3 size={19} /><div><strong>{hasData ? data.stats.due : '—'}</strong><span>现在可复习</span></div></section><section><CalendarDays size={19} /><div><strong>{hasData ? data.stats.scheduled : '—'}</strong><span>已安排题目</span></div></section><section><CheckCheck size={19} /><div><strong>{hasData ? data.stats.reviewed_today : '—'}</strong><span>今日复习过 · 北京时间</span></div></section></div>
    <div className="review-method"><Lightbulb size={18} /><p>这是明确的间隔规则：想起后依次间隔 1 / 3 / 7 / 14 / 30 天，很熟悉可以跳一级；还不熟明天再练，忘了则 10 分钟后重试。自评不代表代码已经通过，也不会自动标记掌握。</p></div>
    {readError && <div className="auth-error review-read-error" role="alert">{readError}<p>{hasData ? '以下是上次读到的安排，可能已变化。请刷新成功后再记录自评。' : '尚未读取复习安排，无法确认数量。已有记录没有改变。'}</p></div>}{error && <div className="auth-error" role="alert">{error}</div>}{notice && <div className="review-notice" role="status"><CheckCheck size={16} />{notice}</div>}
    <div className="records-toolbar"><div className="filter-tabs">{([['due', '待复习'], ['upcoming', '接下来'], ['all', '全部安排']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} disabled={!hasData} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="search-input"><Search size={16} /><input aria-label="搜索复习题目" placeholder="搜索题目或语言" value={search} onChange={event => setSearch(event.target.value)} /></div></div>
    {loading ? <div className="review-loading"><Loader2 className="spin" size={20} />正在读取复习安排…</div> : !hasData ? <div className="review-empty"><span><RefreshCw size={29} /></span><h2>复习安排暂时没有读到</h2><p>连接恢复后可以继续，不会把读取失败当作空计划。</p><button className="secondary-button" disabled={fetching} onClick={() => void load()}>再试一次</button></div> : visible.length ? <div className="review-list">{visible.map(plan => <article className="review-row" key={plan.session_id}><span className={`review-row-icon ${plan.due ? 'due' : ''}`}><BookOpen size={21} /></span><div className="review-row-title"><h3>{plan.title}</h3><span>{plan.language === 'cpp' ? 'C++' : 'Python'} · {plan.review_count ? `已复习 ${plan.review_count} 次` : '第一次回想'} · {plan.due ? '现在可以复习' : localDateTime(plan.due_at)}</span></div><button className="primary-button" disabled={Boolean(pending) || fetching || Boolean(readError)} onClick={() => void practice(plan)}><RotateCcw size={14} />{plan.due ? '开始回想' : '提前回想'}</button><button className="text-button" disabled={Boolean(pending)} onClick={() => onOpen(plan.session_id)}>打开题目<ChevronRight size={14} /></button><button className="text-button review-pause" disabled={Boolean(pending) || fetching || Boolean(readError)} onClick={() => setPausing(plan)}>暂停安排</button></article>)}</div> : <div className="review-empty"><span><CalendarDays size={29} /></span><h2>{data.entries.length ? '这个分组暂时没有题目' : '给想通的题，安排下一次相遇。'}</h2><p>{data.entries.length ? '可以查看接下来的安排，或换个关键词。' : '从下方选择一道已有题目。也可以在解题页的「题目操作」里加入复习计划。'}</p>{data.entries.length > 0 && <button className="secondary-button" onClick={() => { setFilter('all'); setSearch(''); }}>查看全部安排</button>}</div>}
    {hasData && !readError && <details className="card review-add" open={data.entries.length === 0 ? true : undefined}><summary><Plus size={17} /><span>从已有题目加入复习计划<small>{available.length} 条尚未安排</small></span></summary><div className="review-available">{available.length ? (showAllAvailable ? available : available.slice(0, 6)).map(item => <div key={item.id}><span><strong>{item.title}</strong><small>{item.language === 'cpp' ? 'C++' : 'Python'} · {item.status === 'mastered' ? '已标记掌握' : '学习中'}</small></span><button className="secondary-button" disabled={Boolean(pending) || loading || fetching} onClick={() => void enroll(item)}>{pending === `enroll:${item.id}` ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}加入复习</button></div>) : <p>还没有可以添加的题目。开始新题，或继续已经安排的练习。</p>}{available.length > 6 && <button className="text-button" onClick={() => setShowAllAvailable(!showAllAvailable)}>{showAllAvailable ? '收起列表' : `显示全部 ${available.length} 条`}</button>}<button className="text-button" onClick={onNew}>开始新题<ChevronRight size={14} /></button></div></details>}
    {active && <Modal className="review-practice-modal" title={`回想练习 · ${active.title}`} locked={Boolean(pending)} onClose={closePractice}>
      <p className="dialog-copy">先不看答案，试着说出关键思路、时间 / 空间复杂度和一个边界例子。需要重新写代码时，可以回工作台继续。</p>
      {practiceLoading ? <div className="review-loading"><Loader2 size={19} className="spin" />正在打开题目…</div> : detail && <>
        <div className="review-question markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.content}</ReactMarkdown></div>
        <div className="review-recall-actions"><button className="text-button" disabled={Boolean(pending)} onClick={() => setShowNotes(!showNotes)}><BookOpen size={14} />{showNotes ? '收起以往笔记' : '回想后，展开以往笔记'}</button><button className="text-button" disabled={Boolean(pending)} onClick={() => { closePractice(); onOpen(active.session_id); }}>回工作台重写<ChevronRight size={14} /></button></div>
        {showNotes && <div className="review-old-notes"><h3>我的复盘笔记</h3>{detail.notes ? <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.notes}</ReactMarkdown></div> : <p>这道题还没有复盘笔记。</p>}{history.length > 0 && <><h3>最近的复习记录</h3>{history.slice(0, 5).map(event => <div className="review-event" key={event.id}><span>{localDateTime(event.reviewed_at)} · {ratingNames[event.rating as Rating]}</span>{event.note && <p>{event.note}</p>}</div>)}</>}</div>}
        <label className="review-note-label">这次卡点或关键观察（可选）<textarea aria-label="本次复习观察" value={note} maxLength={3000} disabled={Boolean(pending)} onChange={event => editNote(event.target.value)} placeholder="比如：不要重复使用当前位置；递归栈也要算空间。" /></label>
        {!observation.cacheAvailable && note && <p className="local-input-warning">浏览器无法暂存本次观察，请先记录自评或复制内容再离开。</p>}<ForeignDrafts entries={observation.foreign} label="观察" disabled={Boolean(pending) || Boolean(note.trim())} onRestore={observation.restore} /><div className="review-rating-label">这次回想得怎么样？</div><div className="review-ratings">{([['again', '10 分钟后'], ['hard', '明天'], ['good', `${active.next_good_days} 天后`], ['easy', `${active.next_easy_days} 天后`]] as const).map(([rating, when]) => <button key={rating} className={`review-rating ${rating}`} disabled={Boolean(pending) || Boolean(readError) || fetching || observation.tooLong} onClick={() => void rate(rating)}><strong>{pending === `rate:${rating}` ? <Loader2 size={15} className="spin" /> : ratingNames[rating]}</strong><small>{when}</small></button>)}</div>
      </>}{readError && <div className="auth-error" role="alert">安排读取失败，请关闭练习并刷新后继续。<button className="text-button" disabled={Boolean(pending)} onClick={() => { closePractice(); void load(); }}>关闭并重连</button></div>}{practiceError && <div className="auth-error" role="alert">{practiceError}<button className="text-button" disabled={Boolean(pending)} onClick={() => { closePractice(); void load(); }}>关闭并刷新安排</button></div>}
    </Modal>}
    {pausing && <Modal title="暂停这道题的复习安排？" locked={Boolean(pending)} onClose={() => setPausing(null)}><p className="dialog-copy">「{pausing.title}」将从复习计划移出，题目、代码、笔记和过去的复习记录仍然保留。重新加入时从第一次回想开始。</p><div className="dialog-actions"><button className="secondary-button" disabled={Boolean(pending)} onClick={() => setPausing(null)}>继续保留</button><button className="primary-button" disabled={Boolean(pending)} onClick={() => void pause()}>暂停安排</button></div></Modal>}
  </div>;
}
