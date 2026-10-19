'use client';
import { localDateTime } from '@/lib/dates';
import { api as request } from '@/lib/api';
import { type ExternalExchange } from './deepseek-transfer';
import { ResizablePanels } from './resizable-layout';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, CheckCheck, Clipboard, Code2, Gauge, History, Lightbulb, Loader2, RotateCcw, Sparkles, WandSparkles } from 'lucide-react';

type Goal = 'balanced' | 'time' | 'space' | 'readability';
type Complexity = { time: string; space: string; time_reason: string; space_reason: string };
export type Report = {
  id: number; session_id: number; language: string; goal: Goal; phase: 'analyze' | 'refine'; input_code: string; created_at: string; verification: string;
  data: { assessment: 'correct' | 'needs_fix' | 'uncertain'; summary: string; variables: string[]; current: Complexity; target: Complexity; bottlenecks: string[]; steps: string[]; changes: string[]; tradeoffs: string[]; checks: string[]; proof: string; optimized_code: string | null };
};
const goals: Record<Goal, string> = { balanced: '效率与可读性兼顾', time: '优先降低时间复杂度', space: '优先降低空间占用', readability: '优先精炼和美化代码' };

function Content({ text }: { text: string }) { return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>; }
function List({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null;
  const Tag = ordered ? 'ol' : 'ul';
  return <section className="opt-section"><h3>{title}</h3><Tag>{items.map((item, index) => <li key={index}><Content text={item} /></li>)}</Tag></section>;
}

export default function OptimizationPanel({ sessionId, createdAt, language, code, busy, configured, provider, onSave, onApply, onBusyChange, onSettings, onExternal, importedReport }: {
  sessionId: number; createdAt: string; language: string; code: string; busy: boolean; configured: boolean; provider: string;
  onSave: () => Promise<unknown>; onApply: (code: string) => Promise<void>; onBusyChange: (busy: boolean) => void; onSettings: () => void; onExternal: (exchange: ExternalExchange) => void; importedReport: Report | null;
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [goal, setGoal] = useState<Goal>('balanced');
  const [passed, setPassed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<'analyze' | 'refine' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    request<Report[]>(`/sessions/${sessionId}/optimizations`, 'GET', undefined, undefined, createdAt).then(result => { if (!stopped) { setReports(result); setSelected(result[0]?.id || null); if (result[0]) setGoal(result[0].goal); } }).catch(e => { if (!stopped) setError(e.message); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [sessionId]);

  useEffect(() => {
    if (!importedReport || importedReport.session_id !== sessionId) return;
    setReports(previous => [importedReport, ...previous.filter(item => item.id !== importedReport.id)]);
    setSelected(importedReport.id); setGoal(importedReport.goal); setNotice('DeepSeek 分析已导入并保存。');
  }, [importedReport, sessionId]);

  const report = reports.find(item => item.id === selected);
  const analysis = reports.find(item => item.phase === 'analyze' && item.language === language && item.input_code === code && item.goal === goal);
  const adopted = Boolean(report?.data.optimized_code && report.language === language && report.data.optimized_code === code);
  const stale = Boolean(report && (report.language !== language || report.input_code !== code));

  async function optimize(phase: 'analyze' | 'refine') {
    if (busy || pending) return;
    setPending(phase); onBusyChange(true); setError(''); setNotice('');
    try {
      const saved = await onSave() as { drafts?: Record<string, string> } | null;
      const result = await request<Report | ExternalExchange>(`/sessions/${sessionId}/${provider === 'deepseek_web' ? 'external/optimize' : 'optimize'}`, 'POST', { goal, phase, passed, language, expected_code: saved?.drafts?.[language] ?? code, ...(phase === 'refine' ? { analysis_id: analysis?.id } : {}) }, undefined, createdAt);
      if ('external' in result) { onExternal(result); return; }
      setReports(previous => [result, ...previous]); setSelected(result.id);
      setNotice(phase === 'analyze' ? '复杂度分析已保存。接下来可以生成优化版本。' : '优化版本已保存，原代码仍保留在编辑器中。');
    } catch (e) { setError((e as Error).message); }
    finally { setPending(null); onBusyChange(false); }
  }
  async function apply(value: string, restore = false) {
    onBusyChange(true); setError('');
    try { await onApply(value); setNotice(restore ? '已恢复本报告的原代码。' : '已采用并保存优化代码，可以到力扣验证。'); } catch (e) { setError((e as Error).message); } finally { onBusyChange(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('代码已复制。'); } catch { setNotice('无法访问剪贴板，请在下方代码中手动复制。'); }
  }
  function selectReport(id: number) { setSelected(id); const item = reports.find(report => report.id === id); if (item) setGoal(item.goal); setNotice(''); setError(''); }

  return <div className="optimization-panel">
    <div className="opt-toolbar"><label htmlFor="optimization-goal">这次想优化什么？</label><select id="optimization-goal" value={goal} disabled={busy} onChange={e => { setGoal(e.target.value as Goal); setNotice(''); }}>{Object.entries(goals).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><label className="opt-passed"><input type="checkbox" checked={passed} disabled={busy} onChange={e => setPassed(e.target.checked)} />此版本已在力扣通过</label></div>
    {reports.length > 0 && <div className="opt-history"><History size={14} /><select aria-label="选择优化报告" value={selected || ''} disabled={busy} onChange={event => selectReport(Number(event.target.value))}>{reports.map((item, i) => <option value={item.id} key={item.id}>{i === 0 ? '最新 · ' : ''}{item.language === 'cpp' ? 'C++' : 'Python'} {item.phase === 'analyze' ? '复杂度分析' : '优化版本'} · {localDateTime(item.created_at)}</option>)}</select></div>}
    <ResizablePanels axis="y" className="optimization-body-split" storageKey="optimization-rows" defaults={[4, 1]} minimums={[180, 145]} labels={["调整优化报告与操作区域高度"]}><div className="opt-scroll" aria-live="polite">
      {loading ? <div className="opt-loading"><Loader2 size={20} className="spin" />正在读取优化记录…</div> : !report ? <div className="opt-empty"><span><Gauge size={30} strokeWidth={1.6} /></span><h3>做出来之后，再想好一步。</h3><p>把你的完整解法写在右侧，先看清复杂度，再决定哪一步值得优化。</p><div className="opt-empty-flow"><span>分析瓶颈</span><ArrowDown size={14} /><span>推导复杂度与取舍</span><ArrowDown size={14} /><span>写出精炼的优化版本</span></div><small>每份报告保留原代码，采用后也能恢复。</small></div> : <>
        <div className="opt-report-heading"><span className={`opt-assessment ${report.data.assessment}`}>{report.data.assessment === 'correct' ? '静态分析：逻辑合理' : report.data.assessment === 'needs_fix' ? '先修复正确性问题' : '需要进一步验证'}</span><span className="opt-report-language">{report.language === 'cpp' ? 'C++17' : 'Python 3'}</span><h3>{report.phase === 'analyze' ? '先看清你的解法' : '更好的解法，为什么更好'}</h3><Content text={report.data.summary} /></div>
        {stale && <div className={`opt-stale ${adopted ? 'adopted' : ''}`}>{adopted ? <><CheckCheck size={14} />已采用此优化版本，原代码保留在报告中。</> : <><History size={14} />报告基于另一份代码快照。修改代码或切换语言后，请重新分析。</>}</div>}
        <div className="opt-variables">{report.data.variables.map((variable, i) => <Content text={variable} key={i} />)}</div>
        <div className="complexity-comparison"><section><h4>当前解法</h4><div><span>时间</span><strong>{report.data.current.time}</strong></div><div><span>辅助空间</span><strong>{report.data.current.space}</strong></div><details><summary>查看复杂度推导</summary><Content text={report.data.current.time_reason} /><Content text={report.data.current.space_reason} /></details></section><section><h4>{report.phase === 'analyze' ? '建议目标' : '优化版本'}</h4><div><span>时间</span><strong>{report.data.target.time}</strong></div><div><span>辅助空间</span><strong>{report.data.target.space}</strong></div><details><summary>查看复杂度推导</summary><Content text={report.data.target.time_reason} /><Content text={report.data.target.space_reason} /></details></section></div>
        <List title="瓶颈在哪里" items={report.data.bottlenecks} /><List title="一步步优化" items={report.data.steps} ordered /><List title="你需要知道的取舍" items={report.data.tradeoffs} /><List title="代码怎样变得更清楚" items={report.data.changes} />
        {report.data.optimized_code && <section className="opt-section opt-code"><div className="opt-code-heading"><h3>精炼代码</h3><button className="text-button" onClick={() => void copy(report.data.optimized_code!)}><Clipboard size={13} />复制代码</button></div><Content text={`\`\`\`${report.language}\n${report.data.optimized_code}\n\`\`\``} /><div className="opt-code-actions"><button className="secondary-button" disabled={busy || stale || adopted} onClick={() => void apply(report.data.optimized_code!)}><CheckCheck size={14} />{adopted ? '已采用此版本' : '采用此版本'}</button>{adopted && <button className="text-button" disabled={busy} onClick={() => void apply(report.input_code, true)}><RotateCcw size={13} />恢复原代码</button>}</div></section>}
        <section className="opt-section"><h3>为什么仍然正确</h3><Content text={report.data.proof} /></section><List title="提交前，再检查这些例子" items={report.data.checks} /><details className="opt-original"><summary><Code2 size={14} />查看本报告的原代码</summary><Content text={`\`\`\`${report.language}\n${report.input_code}\n\`\`\``} /></details><p className="opt-verification">{report.verification}</p>
      </>}
      {pending && <div className="opt-thinking"><Loader2 size={17} className="spin" />{pending === 'analyze' ? '正在分析循环、数据结构和复杂度…' : '正在核对优化思路，生成精炼代码…'}</div>}
      {error && <div className="auth-error" role="alert">{error}{provider === 'chatgpt' && error.includes('额度') && <a className="text-button" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">管理 ChatGPT 用量</a>}</div>}
      {notice && <div className="opt-notice" role="status">{notice}</div>}
    </div>
    <div className="opt-controls">{configured ? <><button className="secondary-button" disabled={busy || !code.trim() || loading} onClick={() => void optimize('analyze')}><Gauge size={15} />分析当前解法</button><button className="primary-button" disabled={busy || !analysis || loading} onClick={() => void optimize('refine')}><WandSparkles size={15} />生成精炼代码</button><small>{analysis ? '已分析当前代码，生成后由你决定是否采用。' : '先分析当前代码，才能生成对应的优化版本。'}</small></> : <><button className="primary-button full-width" onClick={onSettings}><Sparkles size={15} />连接 AI，分析我的解法</button><small>已有优化报告可以随时查看。</small></>}</div>
  </ResizablePanels></div>;
}
