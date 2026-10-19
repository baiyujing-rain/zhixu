'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { utcDate, recordOrigin } from '@/lib/dates';
import { removeLearningCache } from '@/lib/learning-cache';
import Modal from './modal';
import { useLocalInput } from './use-local-input';
import { useCodeDraft } from './use-code-draft';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ChatGPTConnection from './chatgpt-connection';
import LeetCodeConnection from './leetcode-connection';
import ProblemLibrary from './problem-library';
import EndlessChengLists from './endlesscheng-lists';
import AlgorithmLab from './algorithm-lab';
import JudgePanel from './judge-panel';
import OptimizationPanel, { type Report } from './optimization-panel';
import InkControls from './ink-controls';
import DataArchive from './data-archive';
import ReviewBoard from './review-board';
import NotesEditor from './notes-editor';
import ForeignDrafts from './foreign-drafts';
import DeepSeekConnection from './deepseek-connection';
import DeepSeekTransfer, { type ExternalExchange } from './deepseek-transfer';
import { ResizablePanels, ResizableSection, SidebarResize } from './resizable-layout';
import { ArrowUpRight, ArrowRight, ArrowLeft, BookOpen, Check, CheckCheck, ChevronRight, CircleHelp, Code2, Compass, Copy, FileText, History, Layers3, Lightbulb, Loader2, Moon, Plus, Search, Send, Settings2, Sparkles, Sun, Trash2, X, Braces, Bookmark, PanelLeftClose, RotateCcw, GraduationCap, CalendarDays, Save, PlugZap, ExternalLink, FlaskConical, BookMarked } from 'lucide-react';

const CodeEditor = dynamic(() => import('./code-editor'), { ssr: false });
const AlgorithmDemo = dynamic(() => import('./algorithm-demo'), { ssr: false, loading: () => <div className="editor-loading">正在准备算法演示…</div> });
type Language = 'cpp' | 'python';
type View = 'home' | 'history' | 'review' | 'settings' | 'library' | 'lab' | 'lists' | 'work';
type Message = { role: string; content: string; kind?: string; source?: string };
type Item = { id: number; created_at: string; title: string; content: string; language: Language; difficulty: string; tags: string[]; stage: number; status: string; drafts: Record<string, string>; messages: Message[]; notes: string; example_id?: string; updated_at: string };
type Example = { id: string; title: string; difficulty: string; tags: string[]; content: string };
type Profile = { language: Language; level: 'beginner' | 'intermediate'; style: 'guided' | 'example' };
type AISettings = { configured: boolean; provider: 'chatgpt' | 'api_key' | 'deepseek' | 'deepseek_web'; deepseek_configured?: boolean; deepseek_model?: string; api_configured: boolean; base_url: string; model: string };

const languageName = (language: Language) => language === 'cpp' ? 'C++' : 'Python';
const dateLabel = (date: string) => utcDate(date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });

function normalizeProblemMarkdown(value: string) {
  const repaired = value
    .replace(/\u00a0/g, ' ')
    .replace(/\*\*([^*\n]+?)\*\*\s*\*\*([^*\n]+?)\*\*/g, '**$1 $2**')
    .replace(/\*\*([^\s*](?:[^*\n]*?[^\s*])?)\s+\*\*/g, '**$1**')
    .replace(/\n(?:[ \t]*\n)+[ \t]*-[ \t]*/g, '\n- ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return repaired.includes('** ') || repaired.includes(' **') ? repaired.replace(/\*\*/g, '') : repaired;
}
function Markdown({ children, problem = false }: { children: string; problem?: boolean }) { const value = problem ? normalizeProblemMarkdown(children) : children; return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown></div>; }
function LanguageSwitch({ value, onChange, disabled = false }: { value: Language; onChange: (value: Language) => void; disabled?: boolean }) {
  return <div className="language-switch" aria-label="题解语言"><button className={value === 'cpp' ? 'selected' : ''} onClick={() => onChange('cpp')} disabled={disabled}>C++</button><button className={value === 'python' ? 'selected' : ''} onClick={() => onChange('python')} disabled={disabled}>Python</button></div>;
}
function PathIllustration() {
  return <div className="path-illustration" aria-label="从理解题目到独立解题的思考路径">
    <svg viewBox="0 0 460 230" role="img" aria-label="理解、观察、突破、解题四个阶段">
      <defs><pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="currentColor" opacity=".13" /></pattern></defs>
      <rect width="460" height="230" fill="url(#dots)" />
      <path d="M48 163 C90 163 86 78 152 78 S206 158 268 158 S328 65 401 65" fill="none" stroke="#b0cdc5" strokeWidth="2" strokeDasharray="5 6" />
      <path d="M48 163 C90 163 86 78 152 78 S206 158 268 158" fill="none" stroke="#218879" strokeWidth="3" />
      {[[48, 163], [152, 78], [268, 158], [401, 65]].map(([cx, cy], i) => <g key={i}><circle cx={cx} cy={cy} r="17" fill={i === 2 ? '#167c70' : '#fff'} stroke={i === 3 ? '#afc9c3' : '#218879'} strokeWidth="2" /><text x={cx} y={cy + 5} textAnchor="middle" fontSize="13" fill={i === 2 ? 'white' : '#167c70'}>{i < 2 ? '✓' : i + 1}</text></g>)}
      <text x="48" y="201" textAnchor="middle">理解题目</text><text x="152" y="45" textAnchor="middle">发现线索</text><text x="268" y="197" textAnchor="middle">想通一步</text><text x="401" y="105" textAnchor="middle">独立解题</text>
    </svg>
    <div className="path-note"><Lightbulb size={14} /> 每一个「原来如此」，都算进步</div>
  </div>;
}

export default function Workspace() {
  const [view, setView] = useState<View>('home');
  const [items, setItems] = useState<Item[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [profile, setProfile] = useState<Profile>({ language: 'cpp', level: 'beginner', style: 'guided' });
  const [settings, setSettings] = useState<AISettings>({ configured: false, provider: 'chatgpt', api_configured: false, base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' });
  const [key, setKey] = useState('');
  const problemInput = useLocalInput('zhixu-new-problem', 20000);
  const input = problemInput.value, setInput = problemInput.set;
  const [current, setCurrent] = useState<Item | null>(null);
  const currentRef = useRef<Item | null>(null), navigationRef = useRef(0);
  currentRef.current = current;
  const draft = useCodeDraft<Item>(item => { if (currentRef.current?.id === item.id) { currentRef.current = item; setCurrent(item); } });
  const { code, dirty } = draft;
  const questionInput = useLocalInput(current ? `zhixu-question-${current.id}:${recordOrigin(current.created_at)}` : null, 10000);
  const question = questionInput.value, setQuestion = questionInput.set;
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [initialError, setInitialError] = useState('');
  const initializationRef = useRef(0);
  const initializationAbortRef = useRef<AbortController | null>(null);
  const listRefreshRef = useRef(0);
  const listRefreshAbortRef = useRef<AbortController | null>(null);
  const [recordsFetching, setRecordsFetching] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [dark, setDark] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [mobileTab, setMobileTab] = useState('coach');
  const [coachTab, setCoachTab] = useState<'guide' | 'optimize' | 'visualize'>('guide');
  const [dialog, setDialog] = useState<'solution' | 'notes' | 'delete' | 'help' | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [transferOpen, setTransferOpen] = useState(true);
  const [exchange, setExchange] = useState<ExternalExchange | null>(null);
  const [importedReport, setImportedReport] = useState<Report | null>(null);
  const renderEpoch = navigationRef.current;
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { setDark(localStorage.getItem('zhixu-theme') === 'dark'); } catch {}
    void initialize();
    const onPopState = () => { const params = new URLSearchParams(location.search); const id = params.get('session'); setDialog(null); if (id) void openSession(Number(id), false); else { navigationRef.current++; currentRef.current = null; setCurrent(null); draft.clear(); setBusy(false); setExchange(null); setError(''); setView(['history', 'review', 'settings', 'library', 'lab', 'lists'].includes(params.get('view') || '') ? params.get('view') as View : 'home'); } };
    window.addEventListener('popstate', onPopState);
    return () => { window.removeEventListener('popstate', onPopState); initializationRef.current++; initializationAbortRef.current?.abort(); listRefreshRef.current++; listRefreshAbortRef.current?.abort(); };
    // Initial loading runs once. Navigation mutations happen in explicit actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [current?.messages.length, busy]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if ((dirty && !draft.cacheAvailable) || (input.trim() && !problemInput.cacheAvailable) || (question.trim() && !questionInput.cacheAvailable)) { event.preventDefault(); } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [dirty, draft.cacheAvailable, input, problemInput.cacheAvailable, question, questionInput.cacheAvailable]);

  async function initialize() {
    initializationAbortRef.current?.abort();
    const epoch = ++initializationRef.current;
    const controller = new AbortController();
    initializationAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setLoaded(false); setInitializing(true); setInitialError('');
    setError('');
    try {
      const [sessions, list, pref, connection] = await Promise.all([api<Item[]>('/sessions', 'GET', undefined, controller.signal), api<Example[]>('/examples', 'GET', undefined, controller.signal), api<Profile>('/profile', 'GET', undefined, controller.signal), api<AISettings>('/settings', 'GET', undefined, controller.signal)]);
      if (initializationRef.current !== epoch) return;
      setItems(sessions); setExamples(list); setProfile(pref); setSettings(connection);
      setLoaded(true);
      const params = new URLSearchParams(location.search);
      if (params.get('session')) await openSession(Number(params.get('session')), false);
      else if (['history', 'review', 'settings', 'library', 'lab', 'lists'].includes(params.get('view') || '')) setView(params.get('view') as View);
    } catch (e) {
      if (initializationRef.current === epoch) setInitialError((e as Error).name === 'AbortError' ? '连接本机服务超时，请检查启动窗口后重试。' : (e as Error).message);
    } finally {
      window.clearTimeout(timeout);
      controller.abort();
      if (initializationRef.current === epoch) { setInitializing(false); initializationAbortRef.current = null; }
    }
  }
  async function refresh() {
    listRefreshAbortRef.current?.abort();
    const controller = new AbortController(); listRefreshAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    const epoch = ++listRefreshRef.current; setRecordsFetching(true);
    try {
      const result = await api<Item[]>('/sessions', 'GET', undefined, controller.signal);
      if (listRefreshRef.current === epoch) setItems(result);
    } catch (e) { throw (e as Error).name === 'AbortError' ? new Error('读取学习记录超时或已被新的读取替代，请重试。') : e; }
    finally { window.clearTimeout(timeout); if (listRefreshRef.current === epoch) { setRecordsFetching(false); listRefreshAbortRef.current = null; } }
  }
  async function refreshRecords() {
    const epoch = navigationRef.current;
    try { await refresh(); if (navigationRef.current === epoch) { setError(''); setToast('学习记录已刷新'); } }
    catch (e) { if (navigationRef.current === epoch) setError(`记录刷新未完成，当前仍显示上次读到的内容。${(e as Error).message}`); }
  }
  function accept(item: Item, recover = false) { currentRef.current = item; setCurrent(item); draft.accept(item, recover); }
  async function saveDraft(force = false) {
    return await draft.save(false, true, force) || current;
  }
  async function navigate(next: View) {
    if (!loaded || busy) return;
    const epoch = ++navigationRef.current;
    setBusy(true);
    try {
      await saveDraft(); await refresh();
      if (navigationRef.current !== epoch) return;
      currentRef.current = null; setCurrent(null); draft.clear(); setView(next); setSidebar(false); setExchange(null); setImportedReport(null); setTransferOpen(false); setDialog(null); setError('');
      history.pushState({}, '', next === 'home' ? '/' : `/?view=${next}`);
    } catch (e) { if (navigationRef.current === epoch) setError((e as Error).message); }
    finally { if (navigationRef.current === epoch) setBusy(false); }
  }
  async function openSession(id: number, push = true) {
    const epoch = ++navigationRef.current;
    setBusy(true); setError('');
    try {
      if (push) await saveDraft();
      const result = await api<Item>(`/sessions/${id}`, 'GET', undefined, undefined, items.find(item => item.id === id)?.created_at);
      if (navigationRef.current !== epoch) return;
      accept(result, true); setImportedReport(null); setView('work'); setDialog(null); setExchange(null);
      setCoachTab(!push && new URLSearchParams(location.search).get('panel') === 'visualize' ? 'visualize' : !push && new URLSearchParams(location.search).get('panel') === 'optimize' ? 'optimize' : 'guide');
      setMobileTab('coach'); setTransferOpen(true);
      if (push) history.pushState({}, '', `/?session=${id}`);
      const pending = await api<ExternalExchange | null>(`/sessions/${id}/external`);
      if (navigationRef.current === epoch) setExchange(pending);
    } catch (e) { if (navigationRef.current === epoch) setError((e as Error).message); }
    finally { if (navigationRef.current === epoch) setBusy(false); }
  }
  async function create(exampleId?: string) {
    const epoch = ++navigationRef.current;
    setBusy(true); setError('');
    try {
      await saveDraft();
      const result = await api<Item>('/sessions', 'POST', { content: input, language: profile.language, example_id: exampleId });
      if (!exampleId) problemInput.clearIfEqual(input);
      if (navigationRef.current !== epoch) return;
      accept(result); setExchange(null); setImportedReport(null); setTransferOpen(false); setView('work'); setCoachTab('guide'); setMobileTab('coach'); history.pushState({}, '', `/?session=${result.id}`); await refresh();
    } catch (e) { if (navigationRef.current === epoch) setError((e as Error).message); }
    finally { if (navigationRef.current === epoch) setBusy(false); }
  }
  async function coach(action: string, message?: string) {
    if (!current || busy) return;
    const epoch = navigationRef.current;
    setBusy(true); setError('');
    try {
      const saved = await saveDraft(true);
      if (navigationRef.current !== epoch) return;
      const result = await api<Item | ExternalExchange>(`/sessions/${current.id}/${settings.provider === 'deepseek_web' ? 'external/coach' : 'coach'}`, 'POST', { action, message: message || '', language: current.language, expected_code: saved?.drafts[current.language] ?? code }, undefined, current.created_at);
      if (navigationRef.current !== epoch) return;
      if ('external' in result) { setExchange(result); setTransferOpen(true); }
      else { accept(result); await refresh(); }
      if (action === 'ask' && message === question) questionInput.clearIfEqual(question);
    } catch (e) { if (navigationRef.current === epoch) setError((e as Error).message); }
    finally { if (navigationRef.current === epoch) setBusy(false); }
  }
  async function changeLanguage(language: Language) {
    if (!current || language === current.language || busy) return;
    const epoch = navigationRef.current;
    setBusy(true);
    try {
      await saveDraft(); if (navigationRef.current !== epoch) return;
      const result = await api<Item>(`/sessions/${current.id}`, 'PATCH', { language }, undefined, current.created_at);
      if (navigationRef.current === epoch) accept(result, true);
    } catch (e) { if (navigationRef.current === epoch) setError((e as Error).message); }
    finally { if (navigationRef.current === epoch) setBusy(false); }
  }
  async function updateProfile(value: Profile) {
    setBusy(true); setError('');
    try { const result = await api<Profile>('/profile', 'PUT', value); setProfile(result); setToast('学习偏好已保存'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function saveSettings() {
    setBusy(true); setError('');
    try { const result = await api<AISettings>('/settings', 'PUT', { provider: 'api_key', base_url: settings.base_url, model: settings.model, ...(key.trim() ? { api_key: key.trim() } : {}) }); setSettings(result); setKey(''); setToast('API 模式设置已保存'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function refreshConnection() { setSettings(await api<AISettings>('/settings')); }
  function changeCoachTab(next: 'guide' | 'optimize' | 'visualize') {
    setCoachTab(next);
    if (current) history.replaceState({}, '', `/?session=${current.id}${next === 'guide' ? '' : `&panel=${next}`}`);
  }
  async function applyOptimizedCode(value: string) {
    if (!current) return;
    const epoch = navigationRef.current;
    const saved = await saveDraft();
    if (navigationRef.current !== epoch || !saved) return;
    const result = await api<Item>(`/sessions/${current.id}`, 'PATCH', { language: current.language, code: value, expected_code: saved.drafts[current.language] || '' }, undefined, current.created_at);
    if (navigationRef.current === epoch) accept(result);
  }
  async function openNotes() {
    if (!current || busy) return;
    const epoch = navigationRef.current; setBusy(true); setError('');
    try {
      await saveDraft(); if (navigationRef.current !== epoch) return;
      const item = await api<Item>(`/sessions/${current.id}`, 'GET', undefined, undefined, current.created_at);
      if (navigationRef.current !== epoch) return;
      accept({ ...item, language: current.language }, true); setDialog('notes');
    } catch (e) { if (navigationRef.current === epoch) setError((e as Error).message); }
    finally { if (navigationRef.current === epoch) setBusy(false); }
  }
  async function markMastered() {
    if (!current) return;
    const epoch = navigationRef.current;
    setBusy(true);
    try {
      await saveDraft(); if (navigationRef.current !== epoch) return;
      const result = await api<Item>(`/sessions/${current.id}`, 'PATCH', { status: current.status === 'mastered' ? 'learning' : 'mastered' }, undefined, current.created_at);
      if (navigationRef.current !== epoch) return;
      accept(result); await refresh(); setToast(current.status === 'mastered' ? '已设为继续学习' : '已记录为掌握，记得过几天再练一次');
    } catch (e) { if (navigationRef.current === epoch) setError((e as Error).message); }
    finally { if (navigationRef.current === epoch) setBusy(false); }
  }
  async function enrollCurrent() {
    if (!current || busy) return;
    const epoch = navigationRef.current; setBusy(true); setError('');
    try {
      await saveDraft(); if (navigationRef.current !== epoch) return;
      await api(`/sessions/${current.id}/review-plan`, 'POST', undefined, undefined, current.created_at);
      if (navigationRef.current !== epoch) return;
      setToast('已加入复习计划，可在「我的复盘」里回想练习'); await refresh();
    } catch (e) { if (navigationRef.current === epoch) setError((e as Error).message); }
    finally { if (navigationRef.current === epoch) setBusy(false); }
  }
  async function remove() {
    if (!deleting) return;
    const epoch = navigationRef.current; setBusy(true);
    try {
      await api(`/sessions/${deleting.id}`, 'DELETE', undefined, undefined, deleting.created_at);
      removeLearningCache(deleting.id);
      if (navigationRef.current === epoch && currentRef.current?.id === deleting.id && recordOrigin(currentRef.current.created_at) === recordOrigin(deleting.created_at)) { currentRef.current = null; setCurrent(null); draft.clear(); }
      await refresh();
      if (navigationRef.current === epoch) { setDialog(null); setToast('做题记录已删除'); }
    } catch (e) { if (navigationRef.current === epoch) setError((e as Error).message); }
    finally { if (navigationRef.current === epoch) setBusy(false); }
  }
  async function copyCode() { try { await navigator.clipboard.writeText(code); setToast('代码已复制'); } catch { setToast('无法访问剪贴板，请在编辑器中手动复制'); } }
  const mastered = items.filter(item => item.status === 'mastered').length;
  const active = items.find(item => item.status === 'learning');
  const filtered = items.filter(item => (item.title + item.tags.join(' ') + languageName(item.language)).toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || item.status === filter));
  const navItems = [{ id: 'home', label: '学习工作台', icon: Compass }, { id: 'library', label: '我的题库', icon: BookOpen }, { id: 'lab', label: '算法实验室', icon: FlaskConical }, { id: 'lists', label: '作者题单', icon: BookMarked }, { id: 'history', label: '做题记录', icon: History }, { id: 'review', label: '我的复盘', icon: Bookmark }];

  return <div className={`app-shell ${view === 'work' ? 'work-mode' : ''}`}>
    <aside className={`sidebar ${sidebar ? 'mobile-open' : ''}`}>
      <a href="/" onClick={e => { e.preventDefault(); void navigate('home'); }} className="brand"><span className="brand-mark" aria-hidden="true"><span>知</span></span><span>知序<small>把思路想清楚</small></span></a>
      <button className="new-problem" onClick={() => { void navigate('home').then(() => inputRef.current?.focus()); }} disabled={!loaded || busy}><Plus size={18} /> 开始一道新题</button>
      <span className="nav-caption">你的学习空间</span>
      <nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id || (view === 'work' && id === 'home') ? 'active' : ''}`} onClick={() => void navigate(id as View)} disabled={!loaded || busy}><Icon size={19} />{label}{id === 'history' && items.length > 0 && <span className="nav-count">{items.length}</span>}</button>)}</nav>
      <div className="sidebar-note"><div className="note-symbol"><Lightbulb size={22} /></div><p>想不出来，也没关系。</p><span>好的思路，往往从一个<br />小小的问题开始。</span><div className="note-line" /></div>
      <div className="sidebar-bottom"><button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => void navigate('settings')} disabled={!loaded || busy}><Settings2 size={19} />学习设置</button><div className="user-row"><span className="avatar">学</span><div><strong>我的算法旅程</strong><small>{loaded ? `${languageName(profile.language)} 学习者` : initializing ? '正在连接学习空间' : '等待重新连接'}</small></div><button className="icon-button" aria-label={dark ? '切换浅色模式' : '切换深色模式'} onClick={() => { setDark(!dark); try { localStorage.setItem('zhixu-theme', !dark ? 'dark' : 'light'); } catch {} }}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div></div>
      <SidebarResize />
    </aside>
    {sidebar && <button className="sidebar-scrim" aria-label="收起菜单" onClick={() => setSidebar(false)} />}
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setSidebar(!sidebar)} aria-label="展开菜单"><PanelLeftClose size={19} /></button><span>我的学习空间</span><ChevronRight size={14} /><strong>{view === 'home' ? '学习工作台' : view === 'history' ? '做题记录' : view === 'review' ? '我的复盘' : view === 'settings' ? '学习设置' : view === 'library' ? '我的题库' : view === 'lab' ? '算法实验室' : view === 'lists' ? '作者题单' : current?.title}</strong></div><div className="topbar-right"><span className="connection"><i className={loaded && settings.configured ? 'connected' : ''} />{!loaded ? initializing ? '正在连接本机服务' : '本机服务未连接' : settings.configured ? settings.provider === 'chatgpt' ? 'ChatGPT 已授权' : settings.provider === 'deepseek_web' ? 'DeepSeek 网页版转接' : settings.provider === 'deepseek' ? 'DeepSeek API 已配置' : 'API 已配置' : '示例体验模式'}</span><button className="icon-button" aria-label="刷新学习记录" disabled={!loaded || busy || recordsFetching} onClick={() => void refreshRecords()}><RotateCcw size={17} className={recordsFetching ? 'spin' : ''} /></button><button className="icon-button" aria-label="使用说明" onClick={() => setDialog('help')}><CircleHelp size={19} /></button></div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><div>{settings.provider === 'chatgpt' && (error.includes('subscription_sharing_usage_limit_exceeded') || error.includes('额度')) && <a className="text-button" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">管理 ChatGPT 用量 <ExternalLink size={13} /></a>}{!loaded || !examples.length ? <button onClick={() => void initialize()}><RotateCcw size={14} />重新连接</button> : !settings.configured && view === 'work' ? <button onClick={() => void navigate('settings')}>去配置 AI</button> : null}<button className="icon-button" onClick={() => setError('')} aria-label="关闭错误"><X size={16} /></button></div></div>}
      {!loaded ? initializing ? <div className="loading-screen" role="status"><Loader2 className="spin" size={26} /><p>正在打开你的学习空间…</p></div> : <section className="connection-empty" aria-labelledby="connection-heading"><div className="connection-empty-mark"><PlugZap size={30} /></div><span className="small-label">稍等，先把学习空间接上</span><h1 id="connection-heading">暂时无法读取学习记录</h1><p>当前尚未读到本机数据库，无法确认题目数量。<br />检查知序启动窗口，再试一次。</p><div className="connection-empty-detail" role="alert">{initialError}</div><button className="primary-button" onClick={() => void initialize()}><RotateCcw size={15} />重新连接</button><small>重试不会创建、清空或覆盖已有题目。</small></section> : <>
      {view === 'home' && <div className="page home-page">
        <div className="page-heading"><div><div className="heading-kicker"><span /> 每一步，都在靠近答案</div><h1>今天，想通一道题。</h1><p>把没思路的题交给知序，从「不会」走向「我懂了」。</p></div><div className="heading-date"><span>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' })}</span><small>慢慢来，也会很快</small></div></div>
        <ResizableSection storageKey="hero-height" label="调整首页山水区域高度" min={240} max={650}><section className="hero"><div className="hero-copy"><span className="hero-chip"><Sparkles size={14} /> 一位耐心的算法教练</span><h2>答案之前，<br />先找到自己的思路。</h2><p>一点提示，一个例子，一次尝试。<br />让每一道题，都成为下次解题的底气。</p><div className="hero-languages"><span><Braces size={15} /> C++</span><span><Code2 size={15} /> Python</span><span className="hero-language-note">用你熟悉的语言，理解算法</span></div></div><PathIllustration /></section></ResizableSection>
        <ResizablePanels className="home-grid" storageKey="home-columns" defaults={[3, 1]} minimums={[400, 220]} labels={["调整题目输入与学习足迹宽度"]} breakpoint={1050}><div className="home-primary">
          <ResizableSection storageKey="composer-height" label="调整题目输入高度" min={300}><section className="composer card"><div className="section-heading"><div><h2><FileText size={19} /> 从一道题开始</h2><p>粘贴力扣题目，告诉我你卡在哪里。</p></div><LanguageSwitch value={profile.language} onChange={value => void updateProfile({ ...profile, language: value })} disabled={busy} /></div><label className="sr-only" htmlFor="problem-input">题目内容</label><textarea ref={inputRef} id="problem-input" value={input} onChange={e => setInput(e.target.value)} placeholder={'把题目粘贴到这里…\n\n建议包含题目描述、输入输出示例和数据范围。'} maxLength={20000} /><div className="local-input-status"><span>{input.trim() ? problemInput.cacheAvailable ? '本页题目草稿已暂存' : '浏览器无法暂存，请先复制备份' : '创建后题目与学习记录会保存在本机'}</span><span>{input.length.toLocaleString('zh-CN')} / 20,000</span>{input && <button className="text-button" onClick={() => setInput('')}>清空本页草稿</button>}</div>{problemInput.tooLong && <div className="composer-notice" role="alert">题目超过 20,000 字符，请精简后创建；当前输入仍保留。</div>}<ForeignDrafts entries={problemInput.foreign} label="题目" disabled={busy || Boolean(input.trim())} onRestore={problemInput.restore} /><div className="composer-footer"><span><CheckCheck size={14} /> 分步提示，由你决定何时看答案</span><button className="primary-button" disabled={busy || input.trim().length < 15 || problemInput.tooLong} onClick={() => void create()}>{busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} 开始拆解题目 <ArrowRight size={16} /></button></div>{!settings.configured && <div className="composer-notice">新题引导需要授权 ChatGPT，也可以先体验下面的示例题。<button onClick={() => void navigate('settings')}>连接 ChatGPT <ArrowUpRight size={12} /></button></div>}</section></ResizableSection>
          <ResizableSection storageKey="examples-height" label="调整示例题区域高度" min={220}><section className="example-section"><div className="section-heading"><div><h2>还没有题目？从这里热身</h2><p>三道经典小题，体验从观察到解法的过程。</p></div><span className="subtle-badge">无需配置 AI</span></div><div className="examples-list">{examples.map((example, i) => <button className="example-row" key={example.id} onClick={() => void create(example.id)} disabled={busy}><span className={`example-icon example-${i}`} >{i === 0 ? <Braces size={20} /> : i === 1 ? <Layers3 size={20} /> : <Search size={20} />}</span><div className="example-info"><strong>{example.title}</strong><span>{example.tags.join(' / ')}</span></div><span className="difficulty">{example.difficulty}</span><ChevronRight size={17} /></button>)}</div></section></ResizableSection>
        </div><div className="home-secondary"><ResizableSection storageKey="journey-height" label="调整学习足迹高度" min={240}><section className="journey-card card"><div className="section-heading"><h2>我的学习足迹</h2><GraduationCap size={20} /></div><div className="journey-stats"><div><strong>{items.length}<small>题</small></strong><span>已经开始</span></div><div><strong>{mastered}<small>题</small></strong><span>自评掌握</span></div></div><div className="journey-progress"><div style={{ width: `${items.length ? mastered / items.length * 100 : 0}%` }} /></div><p>{items.length ? '每次尝试都留下记录，复盘让进步看得见。' : '你的第一步，从一道题开始。'}</p><button className="text-button" onClick={() => void navigate('history')}>查看做题记录 <ArrowUpRight size={15} /></button></section></ResizableSection>
          <ResizableSection storageKey="continue-height" label="调整继续学习区域高度" min={180}><section className="continue-card">{active ? <><span className="small-label"><History size={14} /> 接着上次的思路</span><h3>{active.title}</h3><p>已探索 {Math.min(active.stage, 4)} / 4 层提示</p><button onClick={() => void openSession(active.id)} disabled={busy}>继续学习 <ArrowRight size={16} /></button></> : <><span className="small-label"><Compass size={14} /> 给正在起步的你</span><h3>没有思路，<br />就从一个例子开始。</h3><p>先手动算一遍，再想想自己做了什么。算法往往就藏在这个过程里。</p></>}</section></ResizableSection>
          <div className="learning-tip"><span className="tip-icon"><BookOpen size={19} /></span><div><strong>学会一道，胜过看懂十道</strong><p>试着先说出你的想法，再向教练要一点提示。</p></div></div>
        </div></ResizablePanels><footer className="page-footer"><span className="footer-logo"><Layers3 size={14} /> 知序</span><span>让思考有迹可循。</span><span>C++ & Python</span></footer>
      </div>}

      {view === 'library' && <ProblemLibrary language={profile.language} initialPaste={input} onImported={() => setInput('')} onPractice={async id => { await openSession(id); }} />}
      {view === 'lab' && <AlgorithmLab />}
      {view === 'lists' && <EndlessChengLists onPractice={async id => { await openSession(id); }} />}

      {view === 'history' && <div className="page records-page"><div className="page-heading"><div><div className="heading-kicker"><span /> {view === 'history' ? '每一次尝试，都有意义' : '把看懂，变成真正掌握'}</div><h1>{view === 'history' ? '走过的题，留下的思路。' : '回头看，才走得更远。'}</h1><p>{view === 'history' ? '继续卡住的题，也重新挑战已经掌握的题。' : '打开一道题，写下关键观察、踩过的坑和自己的解法。'}</p></div><button className="primary-button" onClick={() => void navigate('home')}><Plus size={16} /> 开始新题</button></div><div className="records-toolbar"><div className="filter-tabs">{[['all', '全部'], ['learning', '学习中'], ['mastered', '已掌握']].map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{label}{value === 'all' && <span>{items.length}</span>}</button>)}</div><div className="search-input"><Search size={16} /><input aria-label="搜索做题记录" placeholder="搜索题目、标签或语言" value={search} onChange={e => setSearch(e.target.value)} /></div></div>{filtered.length ? <div className="records-list">{filtered.map(item => <article className="record-row" key={item.id}><span className={`record-icon ${item.status === 'mastered' ? 'mastered' : ''}`}>{item.status === 'mastered' ? <CheckCheck size={21} /> : <Code2 size={21} />}</span><div className="record-title"><button onClick={() => void openSession(item.id)}>{item.title}</button><span>{item.tags.length ? item.tags.join(' / ') : '自定义题目'} <b>·</b> {languageName(item.language)}</span></div><span className={`status-badge ${item.status}`}>{item.status === 'mastered' ? '已掌握' : '学习中'}</span><span className="record-date">{dateLabel(item.updated_at)}</span><button className="text-button" onClick={() => void openSession(item.id)} disabled={busy}>继续学习<ChevronRight size={15} /></button><button className="icon-button delete-button" aria-label={`删除${item.title}`} onClick={() => { setDeleting(item); setDialog('delete'); }}><Trash2 size={16} /></button></article>)}</div> : <div className="empty-state"><span><BookOpen size={32} /></span><h2>{search || filter !== 'all' ? '没有找到符合条件的题目' : '这里会收藏你的思考过程'}</h2><p>{search || filter !== 'all' ? '换个关键词，或查看全部记录。' : '开始第一道题后，对话、代码和复盘都能在这里找回来。'}</p><button className="primary-button" onClick={() => { if (search || filter !== 'all') { setSearch(''); setFilter('all'); } else void navigate('home'); }}>{search || filter !== 'all' ? '查看全部' : '开始第一道题'}<ArrowRight size={16} /></button></div>}</div>}

      {view === 'review' && <ReviewBoard items={items} onOpen={id => void openSession(id)} onNew={() => void navigate('home')} onChanged={refresh} />}

      {view === 'settings' && <div className="page settings-page"><div className="page-heading"><div><div className="heading-kicker"><span /> 让教练更了解你</div><h1>按你的节奏，学习。</h1><p>选择熟悉的语言和讲解方式，知序会据此调整引导。</p></div></div><div className="settings-grid"><ResizablePanels className="settings-top-split" storageKey="settings-columns" defaults={[3, 1]} minimums={[430, 190]} labels={["调整学习偏好与说明宽度"]} breakpoint={1050}><ResizableSection storageKey="preferences-height" label="调整学习偏好区域高度" min={330}><section className="card settings-card"><h2><GraduationCap size={20} /> 学习偏好</h2><div className="setting-row"><div><strong>默认题解语言</strong><p>新题目将使用这个语言，做题时也可以切换。</p></div><LanguageSwitch value={profile.language} onChange={value => void updateProfile({ ...profile, language: value })} disabled={busy} /></div><fieldset><legend>你目前的算法基础</legend><div className="choice-grid">{[['beginner', '刚刚起步', '希望从基础概念讲起'], ['intermediate', '有一些基础', '更关注关键观察和优化']].map(([value, title, text]) => <button key={value} className={`choice ${profile.level === value ? 'selected' : ''}`} disabled={busy} onClick={() => void updateProfile({ ...profile, level: value as Profile['level'] })}><span><strong>{title}</strong>{profile.level === value && <Check size={16} />}</span><small>{text}</small></button>)}</div></fieldset><fieldset><legend>你喜欢的讲解方式</legend><div className="choice-grid">{[['guided', '一步步提问', '通过小问题，自己发现思路'], ['example', '多举点例子', '用具体数据，走一遍过程']].map(([value, title, text]) => <button key={value} className={`choice ${profile.style === value ? 'selected' : ''}`} disabled={busy} onClick={() => void updateProfile({ ...profile, style: value as Profile['style'] })}><span><strong>{title}</strong>{profile.style === value && <Check size={16} />}</span><small>{text}</small></button>)}</div></fieldset><InkControls /></section></ResizableSection><aside className="settings-aside"><Lightbulb size={27} /><h3>你不需要一次就懂。</h3><p>告诉教练「讲简单一点」或「换个例子」，也是学习的一部分。</p><span>偏好随时可以调整。</span></aside></ResizablePanels><ResizableSection storageKey="archive-height" label="调整数据备份区域高度" min={260}><DataArchive onRestored={async () => { await refresh(); setProfile(await api<Profile>('/profile')); }} onRecords={() => void navigate('history')} /></ResizableSection><ResizableSection storageKey="deepseek-height" label="调整 DeepSeek 设置高度" min={260}><DeepSeekConnection provider={settings.provider} configured={Boolean(settings.deepseek_configured)} initialModel={settings.deepseek_model || 'deepseek-flash'} onChange={refreshConnection} /></ResizableSection><ResizableSection storageKey="connection-height" label="调整 AI 连接区域高度" min={260}><ChatGPTConnection provider={settings.provider} onChange={refreshConnection} /></ResizableSection><ResizableSection storageKey="leetcode-height" label="调整力扣连接区域高度"><LeetCodeConnection /></ResizableSection><ResizableSection storageKey="api-height" label="调整 API 设置区域高度" min={80}><details className="card settings-card ai-card api-alternative"><summary>其他连接方式：API 密钥<span>按服务商 API 用量单独计费</span></summary><div className="section-heading"><h2><PlugZap size={20} /> 连接你的 AI 教练</h2><span className={`status-badge ${settings.configured ? 'mastered' : 'learning'}`}>{settings.api_configured ? '已保存密钥' : '尚未配置'}</span></div><p className="settings-description">支持兼容 OpenAI Chat Completions 的接口。配置后可以拆解任意新题、追问和审阅代码。</p><label>接口地址<input value={settings.base_url} onChange={e => setSettings({ ...settings, base_url: e.target.value })} placeholder="https://api.openai.com/v1" type="url" /></label><div className="form-columns"><label>模型名称<input value={settings.model} onChange={e => setSettings({ ...settings, model: e.target.value })} placeholder="服务商提供的模型名称" /></label><label>API 密钥<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={settings.api_configured ? '留空保留当前密钥' : '粘贴你的 API 密钥'} /></label></div><div className="settings-save"><span>密钥仅保存到本机后端配置，不会返回浏览器。</span><button className="primary-button" onClick={() => void saveSettings()} disabled={busy || !settings.base_url.trim() || !settings.model.trim()}>{busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />} 保存并使用 API 模式</button></div><p className="form-note">保存后切换到 API 模式，API 费用与 ChatGPT 订阅分开。实际连通性会在第一次提问时验证。</p></details></ResizableSection></div></div>}

      {view === 'work' && current && <div className="work-page"><div className="mobile-work-tabs">{[['problem', '题目'], ['coach', '思路引导'], ['code', '我的代码']].map(([id, label]) => <button key={id} className={mobileTab === id ? 'selected' : ''} onClick={() => setMobileTab(id)}>{label}</button>)}</div><ResizablePanels className="work-columns" storageKey="work-columns" defaults={[.85, 1.35, 1]} minimums={[180, 280, 235]} labels={["调整题目与引导宽度", "调整引导与代码宽度"]}>
        <section className={`problem-panel work-panel ${mobileTab === 'problem' ? 'mobile-visible' : ''}`}><div className="panel-heading focus-problem-heading"><button className="icon-button" aria-label="返回工作台" onClick={() => void navigate('home')} disabled={busy}><ArrowLeft size={17} /></button><div><h1>{current.title}</h1><span>题目描述 · {languageName(current.language)}</span></div><details className="focus-actions"><summary aria-label="题目操作"><Settings2 size={17} /></summary><div><button onClick={() => void openNotes()} disabled={busy}><Bookmark size={14} />复盘笔记</button><button onClick={() => void enrollCurrent()} disabled={busy}><CalendarDays size={14} />加入复习计划</button><button onClick={() => void markMastered()} disabled={busy}><CheckCheck size={14} />{current.status === 'mastered' ? '已掌握' : '标记掌握'}</button><button onClick={() => void navigate('settings')} disabled={busy}><PlugZap size={14} />连接 AI</button><button onClick={() => setDialog('help')}><CircleHelp size={14} />使用说明</button></div></details></div><div className="problem-body"><div className="problem-tags">{current.tags.map(tag => <span key={tag}>{tag}</span>)}</div><Markdown problem>{current.content}</Markdown><div className="problem-bottom-note"><Lightbulb size={17} /><p>先读示例，再看约束。<br />题目给出的每个条件，都可能是线索。</p></div></div></section>
        <section className={`coach-panel work-panel ${mobileTab === 'coach' ? 'mobile-visible' : ''}`}><div className="panel-heading coach-panel-heading"><div className="coach-panel-tabs"><button className={coachTab === 'guide' ? 'selected' : ''} onClick={() => changeCoachTab('guide')} disabled={busy}><Sparkles size={14} />思路引导</button><button className={coachTab === 'optimize' ? 'selected' : ''} onClick={() => changeCoachTab('optimize')} disabled={busy}><Code2 size={14} />解法优化</button><button className={coachTab === 'visualize' ? 'selected' : ''} onClick={() => changeCoachTab('visualize')} disabled={busy}><Layers3 size={14} />算法演示</button></div><span className="coach-online"><i />知序教练</span></div>{coachTab === 'visualize' ? <AlgorithmDemo key={`${current.id}:${recordOrigin(current.created_at)}`} sessionId={current.id} exampleId={current.example_id} createdAt={current.created_at} language={current.language} /> : coachTab === 'optimize' ? <OptimizationPanel key={`${current.id}:${recordOrigin(current.created_at)}`} sessionId={current.id} createdAt={current.created_at} language={current.language} code={code} busy={busy} configured={settings.configured} provider={settings.provider} onSave={() => saveDraft(true)} onApply={applyOptimizedCode} onBusyChange={value => { if (navigationRef.current === renderEpoch && currentRef.current?.id === current.id && recordOrigin(currentRef.current.created_at) === recordOrigin(current.created_at)) setBusy(value); }} onSettings={() => void navigate('settings')} onExternal={exchange => { if (navigationRef.current === renderEpoch && currentRef.current?.id === exchange.session_id && recordOrigin(currentRef.current.created_at) === recordOrigin(current.created_at)) { setExchange(exchange); setTransferOpen(true); } }} importedReport={importedReport} /> : <><div className="stage-path">{['读懂', '起步', '观察', '实现'].map((label, i) => <div key={label} className={current.stage > i ? 'done' : current.stage === i ? 'current' : ''}><span>{current.stage > i ? <Check size={11} /> : i + 1}</span><small>{label}</small></div>)}</div><ResizablePanels axis="y" className="coach-body-split" storageKey="coach-rows" defaults={[3, 1]} minimums={[180, 210]} labels={["调整引导内容与追问区域高度"]}><div className="messages" aria-live="polite">{current.messages.map((message, i) => <div className={`message ${message.role}`} key={i}>{message.role === 'assistant' && <div className="message-author"><span><Layers3 size={14} /></span>知序{message.source === 'example' && <small>示例引导</small>}{message.source === 'deepseek_web' && <small>DeepSeek 网页版导入</small>}</div>}<div className="message-content"><Markdown>{message.content}</Markdown></div></div>)}{busy && <div className="thinking"><Loader2 className="spin" size={15} /> 正在整理这一步的思路…</div>}<div ref={endRef} /></div><div className="coach-controls">{settings.provider === 'deepseek_web' && <div className="web-mode-note">DeepSeek 网页版转接：复制提问，粘贴回复。</div>}<div className="hint-actions"><button onClick={() => void coach('hint')} disabled={busy || current.stage >= 4}><Lightbulb size={14} />{current.stage === 0 ? '给我一个提示' : current.stage >= 4 ? '分级提示已完成' : '再给一点提示'}</button><button onClick={() => void coach('ask', '这一步我没理解，请用更简单的语言和具体例子解释。')} disabled={busy}>讲简单一点</button><button onClick={() => setDialog('solution')} disabled={busy}>完整题解 <ExternalLink size={12} /></button></div><form className="question-box" onSubmit={e => { e.preventDefault(); void coach('ask', question); }}><textarea aria-label="向教练提问" placeholder="说说你的想法，或告诉我你卡在哪里…" value={question} onChange={e => setQuestion(e.target.value)} maxLength={10000} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (question.trim() && !busy && !questionInput.tooLong) void coach('ask', question); } }} /><div><span>Enter 发送 · Shift + Enter 换行{question.trim() && <> · {questionInput.cacheAvailable ? '本页已暂存' : '无法暂存，请先复制'}</>}</span><button aria-label="发送问题" disabled={busy || !question.trim() || questionInput.tooLong} type="submit"><Send size={16} /></button></div></form>{questionInput.tooLong && <p className="local-input-warning" role="alert">问题超过 10,000 字符，请精简后发送。</p>}<ForeignDrafts entries={questionInput.foreign} label="问题" disabled={busy || Boolean(question.trim())} onRestore={questionInput.restore} /><small className="coach-footnote">{settings.provider === 'chatgpt' && settings.configured && <>正在使用 ChatGPT 订阅 · <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">管理用量</a><br /></>}AI 讲解可能有误，请结合题目和边界例子验证。</small></div></ResizablePanels></>}</section>
        <section className={`code-panel work-panel ${mobileTab === 'code' ? 'mobile-visible' : ''}`}><JudgePanel sessionId={current.id} language={current.language} code={code} onSave={() => saveDraft(true)} onOpenLibrary={() => void navigate('library')} /><div className="panel-heading"><h2><Code2 size={17} /> 我的代码</h2><button className="icon-button" aria-label="复制代码" onClick={() => void copyCode()}><Copy size={15} /></button></div>{(draft.error || !draft.cacheAvailable) && <div className="draft-notice" role="alert"><p>{draft.error || '当前浏览器无法缓存草稿，请及时保存到后端。'}</p>{!draft.cacheAvailable && draft.error && <p>浏览器也无法缓存当前代码，请先复制到其他位置再离开。</p>}{draft.status === 'conflict' && <><details><summary>比较服务器代码</summary><pre>{draft.remoteCode}</pre></details><div><button disabled={busy || !draft.canResolve} onClick={() => { setBusy(true); void draft.save(true).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>保留本地并保存</button><button disabled={busy || !draft.canResolve} onClick={() => { setError(''); draft.useRemote(); }}>使用服务器版本</button>{!draft.canResolve && <button onClick={() => void draft.refreshRemote().catch(e => setError(e.message))}>重新读取服务器版本</button>}</div></>}</div>}<ForeignDrafts entries={draft.foreignDrafts} label="代码" disabled={busy || draft.status === 'saving' || draft.dirty} onRestore={draft.restoreForeign} /><div className="code-toolbar"><LanguageSwitch value={current.language} onChange={value => void changeLanguage(value)} disabled={busy} /><span className={dirty ? 'unsaved' : ''}>{draft.status === 'saving' ? '正在保存…' : draft.status === 'conflict' ? '版本冲突' : draft.status === 'offline' ? '保存未完成' : dirty ? '未保存' : '已保存'}</span><button className="icon-button" aria-label="保存代码" disabled={!dirty || busy || draft.status === 'saving'} onClick={() => { setBusy(true); void saveDraft().then(() => setToast('代码已保存')).catch(e => setError(e.message)).finally(() => setBusy(false)); }}><Save size={15} /></button></div><ResizablePanels axis="y" className="editor-body-split" storageKey="editor-rows" defaults={[3, 1]} minimums={[180, 185]} labels={["调整代码编辑与操作区域高度"]}><div className="editor-container"><CodeEditor value={code} language={current.language} dark={dark} readOnly={busy} onChange={draft.edit} /></div><div className="editor-footer"><div><span>{current.language === 'cpp' ? 'C++17' : 'Python 3'}</span><span>UTF-8</span></div>{draft.hasRecovery && <button className="text-button draft-recovery" onClick={() => { setError(''); draft.restoreRecovery(); }}>找回此前的本地草稿</button>}<button className="primary-button" onClick={() => void coach('review')} disabled={busy || !code.trim()}><Search size={15} /> 帮我检查思路</button><button className="editor-optimize-link" disabled={busy} onClick={() => { changeCoachTab('optimize'); setMobileTab('coach'); }}><Code2 size={14} />我已写出解法，分析复杂度并优化</button><p>AI 静态审阅，不执行代码。<br />测试通过情况请在力扣提交验证。</p></div></ResizablePanels></section>
      </ResizablePanels></div>}
      </>}
    </main>
    {exchange && !transferOpen && view === 'work' && <button className="secondary-button transfer-resume" onClick={() => setTransferOpen(true)}>继续 DeepSeek 转接</button>}
    {exchange && transferOpen && <DeepSeekTransfer exchange={exchange} beforeImport={saveDraft} onClose={() => setTransferOpen(false)} onImported={result => { if (currentRef.current?.id !== exchange.session_id) return; if (exchange.mode === 'coach') { accept(result as Item); void refresh(); } else { setImportedReport(result as Report); changeCoachTab('optimize'); setMobileTab('coach'); } setExchange(null); setToast('DeepSeek 回复已导入并保存'); }} />}
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    {dialog === 'solution' && <Modal title="准备好核对完整解法了吗？" onClose={() => setDialog(null)}><div className="dialog-illustration"><Lightbulb size={30} /></div><p className="dialog-copy">完整题解会包含思路、{current ? languageName(current.language) : 'C++ / Python'} 代码和复杂度分析。建议先尝试写下自己的解法，再对照理解。</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setDialog(null)}>我再想一想</button><button className="primary-button" onClick={() => { setDialog(null); void coach('solution'); }}>查看完整题解<ArrowRight size={15} /></button></div></Modal>}
    {dialog === 'notes' && current && <NotesEditor key={`${current.id}:${recordOrigin(current.created_at)}`} item={current} onSaved={item => { if (currentRef.current?.id === item.id) accept({ ...item, language: currentRef.current.language }, true); }} onClose={() => setDialog(null)} onRecap={() => { setDialog(null); void coach('recap'); }} />}
    {dialog === 'delete' && <Modal title="删除这条做题记录？" onClose={() => setDialog(null)}><p className="dialog-copy">「{deleting?.title}」的题目、双语代码、对话、笔记、优化报告及复习记录都会删除。已下载的备份可在学习设置恢复。</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setDialog(null)}>保留记录</button><button className="danger-button" disabled={busy} onClick={() => void remove()}><Trash2 size={15} /> 删除记录</button></div></Modal>}
    {dialog === 'help' && <Modal title="和知序一起做题" onClose={() => setDialog(null)}><div className="help-steps"><p><strong>1. 贴入题目</strong><span>尽量包含示例和数据范围，选择 C++ 或 Python。</span></p><p><strong>2. 一次只想通一步</strong><span>逐层查看提示，或者直接说出你卡在哪里。</span></p><p><strong>3. 尝试写代码</strong><span>两种语言的草稿分别自动保存。断网时保留本地副本，刷新可恢复。</span></p><p><strong>4. 留下自己的复盘</strong><span>记录关键观察，再到力扣提交验证。</span></p></div><p className="dialog-copy">内置三道示例支持离线分级引导。自由追问、代码审阅和新题引导需要在「学习设置」授权 ChatGPT 或连接 API。</p><button className="primary-button full-width" onClick={() => setDialog(null)}>开始我的算法旅程<ArrowRight size={16} /></button></Modal>}
  </div>;
}
