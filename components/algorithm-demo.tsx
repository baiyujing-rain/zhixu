'use client';

import { recordOrigin } from '@/lib/dates';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Pause, Play, RotateCcw, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react';
import { WindowScene, BFSScene, HashScene, IntervalScene } from './additional-scenes';
import { ALGORITHMS, DEFAULT_INPUTS, buildTrace, coreCode, type Algorithm, type DemoInput, type Frame, type Trace } from '@/lib/algorithm-traces';

function ArrayScene({ trace, frame }: { trace: Trace; frame: Frame }) {
  const viewport = useRef<HTMLDivElement>(null);
  const lastPositions = useRef<Record<string, number>>({ left: 0, right: 0, mid: 0 });
  const values = frame.array ?? trace.values;
  const width = Math.max(340, values.length * 56 + 40);
  const position = (index: number) => 40 + index * 56;
  useEffect(() => {
    const focus = frame.mid ?? (frame.phase === 'move-right' ? frame.right : frame.left);
    const element = viewport.current;
    if (!element || focus === undefined || focus < 0 || focus >= trace.values.length) return;
    const x = position(focus);
    if (x < element.scrollLeft + 30 || x > element.scrollLeft + element.clientWidth - 30) element.scrollLeft = Math.max(0, x - element.clientWidth / 2);
  }, [frame, trace.values.length]);
  const pointer = (label: string, index: number | undefined, y: number, kind: string) => {
    const visible = index !== undefined && index >= 0 && index < values.length;
    if (visible) lastPositions.current[kind] = index;
    return <g key={kind} className={`algo-pointer pointer-${kind}`} style={{ transform: `translate(${position(lastPositions.current[kind])}px, ${y}px)`, opacity: visible ? 1 : 0 }} aria-hidden="true">
      <rect x="-17" y="-12" width="34" height="23" rx="5" /><text y="4" textAnchor="middle">{label}</text>
      {kind === 'right' ? <path d="M0 -17V-32m-4 4 4-4 4 4" /> : <path d={`M0 15V${76 - y}m-4 -4 4 4 4 -4`} />}
    </g>;
  };
  return <><div className="algo-array-viewport" ref={viewport}><svg className="algo-array" width={width} height="200" viewBox={`0 0 ${width} 200`} style={{ minWidth: width }} role="img" aria-label={`数组 ${values.join(', ')}；left=${frame.left}，right=${frame.right}${frame.mid !== undefined ? `，mid=${frame.mid}` : ''}`}>
    {values.map((value, index) => {
      const sorting = trace.algorithm === 'merge-sort' || trace.algorithm === 'quick-sort';
      const excluded = !sorting && (index < (frame.left ?? 0) || index > (frame.right ?? values.length - 1));
      const compared = frame.compareIndices?.includes(index);
      const found = frame.phase === 'found' && (Array.isArray(frame.result) ? frame.result.includes(index) : frame.result === index);
      const kind = found ? 'found' : compared ? 'mid' : excluded ? 'excluded' : index === frame.mid ? 'mid' : index === frame.left ? 'left' : index === frame.right ? 'right' : 'candidate';
      return <g key={index} transform={`translate(${position(index)},80)`} className={`algo-cell cell-${kind}`} data-index={index} data-state={kind}>
        <rect x="-23" width="46" height="42" rx="5" /><text y="26" textAnchor="middle">{value}</text><text className="algo-index" y="62" textAnchor="middle">{index}</text>
        {found && <path d="M-7 74l5 5 10-11" className="algo-found-check" />}
      </g>;
    })}
    {pointer('L', frame.left, 23, 'left')}{pointer('R', frame.right, 182, 'right')}{pointer('mid', frame.mid, 57, 'mid')}
    {!values.length && <text x={width / 2} y="100" textAnchor="middle" className="algo-empty-text">空数组，没有候选元素</text>}
  </svg></div><div className="algo-legend"><span><i className="legend-left" />L 左端</span><span><i className="legend-right" />R 右端</span>{trace.algorithm === 'binary-search' && <span><i className="legend-mid" />mid 中点</span>}<span><i className="legend-excluded" />已排除</span></div>{values.length > 6 && <p className="algo-scroll-note">可左右滚动画布查看全部下标。</p>}</>;
}

function StackScene({ trace, frame }: { trace: Trace; frame: Frame }) {
  const stack = frame.stack || [], paired = frame.paired || [], text = trace.text || '';
  const opens = [...text].flatMap((char, index) => '([{'.includes(char) ? [{ char, index }] : []);
  const hidden = Math.max(0, stack.length - 4);
  return <div className="algo-stack-scene">
    <div className="bracket-input" aria-label="括号输入">{[...text].map((char, index) => <span key={index} className={`bracket-char ${frame.cursor === index ? 'is-current' : ''} ${paired.includes(index) ? 'is-paired' : ''} ${frame.matching === index ? 'is-matching' : ''}`}><strong>{char}</strong><small>{index}</small></span>)}{!text && <span className="algo-empty-text">空字符串</span>}</div>
    <div className="stack-tower" role="img" aria-label={`栈从底到顶：${stack.map(entry => entry.char).join(' ') || '空'}`}>
      <div className="stack-walls" />
      {opens.map(entry => {
        const index = stack.findIndex(item => item.index === entry.index), visible = index >= hidden;
        return <div key={entry.index} className={`stack-token ${entry.index === frame.matching ? 'is-matching' : ''}`} style={{ transform: `translate(${visible ? 0 : 45}px, ${visible ? 184 - (index - hidden) * 44 : 184}px) scale(${visible ? 1 : .8})`, opacity: visible ? 1 : 0 }} aria-hidden={!visible}><strong>{entry.char}</strong><small>下标 {entry.index}</small>{index === stack.length - 1 && visible && <span className="stack-top-label">← 栈顶</span>}</div>;
      })}
      {!stack.length && <span className="stack-empty">空栈</span>}
      <span className="stack-bottom">{hidden ? `栈底还有 ${hidden} 项，完整序列见变量区` : '栈底'}</span>
    </div>
    {(frame.phase === 'match' || frame.phase === 'pop') && <div className="stack-pair"><Check size={14} />配对下标 {frame.matching} <ArrowRight size={14} /> {frame.cursor}</div>}
  </div>;
}

function DPScene({ frame }: { frame: Frame }) {
  const dp = frame.dp || [], i = frame.active ?? 0, hasDependencies = i >= 2 && Boolean(frame.dependencies);
  return <div className="algo-dp-scene">
    {hasDependencies ? <div className="dp-transfer">
      <div className="dp-source"><small>最后走 2 层</small><span>dp[{i - 2}]</span><strong>{dp[i - 2]}</strong></div>
      <div className="dp-source"><small>最后走 1 层</small><span>dp[{i - 1}]</span><strong>{dp[i - 1]}</strong></div>
      <svg className={`dp-links ${frame.phase === 'dependencies' || frame.phase === 'fill' ? 'is-flowing' : ''}`} viewBox="0 0 40 160" aria-hidden="true"><path className="dp-flow" d="M0 35C25 35 13 80 36 80M0 125C25 125 13 80 36 80" /><path d="m29 74 7 6-7 6" /></svg>
      <div className={`dp-destination ${frame.phase === 'fill' ? 'is-filled' : ''}`}><small>当前要计算</small><span>dp[{i}]</span><strong>{dp[i] ?? '?'}</strong></div>
    </div> : <div className="dp-base-explanation"><span>dp[{i}]</span><strong>{dp[i] ?? '?'}</strong><small>{frame.phase === 'start' ? '先定义状态，再写基础值' : frame.phase === 'finish' ? '读取目标层的最终状态' : '基础状态不依赖尚未计算的值'}</small></div>}
    <div className="dp-table" aria-label="完整 DP 表">{dp.map((value, index) => <div key={index} className={`dp-cell ${index === i ? 'is-active' : ''} ${frame.dependencies?.includes(index) ? 'is-dependency' : ''}`} data-index={index}><small>第 {index} 层</small><strong>{value ?? '?'}</strong></div>)}</div>
    <div className="algo-legend"><span><i className="legend-mid" />当前状态</span><span><i className="legend-left" />已知依赖</span><span>？ 尚未计算</span></div>
  </div>;
}

function Variables({ trace, frame }: { trace: Trace; frame: Frame }) {
  const items: [string, string][] = trace.algorithm === 'brackets' ? [
    ['读取位置', frame.cursor !== undefined && frame.cursor < (trace.text?.length || 0) ? String(frame.cursor) : '已读完'],
    ['栈（底 → 顶）', frame.stack?.map(entry => entry.char).join(' ') || '空'],
    ['栈大小', String(frame.stack?.length || 0)],
  ] : trace.algorithm === 'hash-two-sum' ? [
    ['当前下标 i', (frame.cursor ?? -1) >= 0 ? String(frame.cursor) : '未开始'],
    ['需要补数 need', frame.needed === undefined ? '未计算' : String(frame.needed)],
    ['表中元素数', String(frame.hashEntries?.length || 0)],
    ['目标 target', String(trace.target)],
  ] : trace.algorithm === 'sliding-window' ? [
    ['当前有效窗口', (frame.left ?? 0) <= (frame.windowEnd ?? -1) ? `[${frame.left}, ${frame.windowEnd}]` : '空'],
    ['窗口长度', String(Math.max(0, (frame.windowEnd ?? -1) - (frame.left ?? 0) + 1))],
    ['最长长度', String(frame.bestLength ?? 0)],
    ['最优窗口示例', (frame.bestLength ?? 0) ? trace.text?.slice(frame.bestStart, (frame.bestEnd ?? -1) + 1) || '' : '空'],
  ] : trace.algorithm === 'bfs' ? [
    ['当前格子（行,列）', frame.current === undefined ? '无' : `(${Math.floor(frame.current / trace.grid!.width)}, ${frame.current % trace.grid!.width})`],
    ['当前最少步数', frame.current === undefined ? '—' : String(frame.distances?.[frame.current] ?? '未访问')],
    ['队列大小', String(frame.queue?.length || 0)],
    ['正在检查邻居', frame.neighbor ? `(${frame.neighbor.row}, ${frame.neighbor.col})` : '无'],
  ] : trace.algorithm === 'interval-greedy' ? [
    ['当前区间', frame.intervalCursor === undefined || frame.intervalCursor < 0 ? '未开始' : String(frame.intervalCursor + 1)],
    ['已选数量', String(frame.selected?.length || 0)],
    ['已选原始下标', frame.selected?.join(', ') || '无'],
    ['按结束时间排序', frame.intervals?.map(item => `${item.start}-${item.end}`).join(' · ') || '空'],
  ] : trace.algorithm === 'merge-sort' || trace.algorithm === 'quick-sort' ? [
    ['当前区间', frame.left === undefined ? '未开始' : `[${frame.left}, ${frame.right}]`],
    ['比较下标', frame.compareIndices?.join(', ') || '无'],
    ['当前数组', (frame.array ?? trace.values).join(', ') || '空'],
    ['已定位基准', frame.active === undefined ? '无' : String(frame.active)],
  ] : trace.algorithm === 'stairs' ? [
    ['当前层 i', frame.active === undefined ? '尚未开始' : String(frame.active)],
    ['当前 dp[i]', frame.active === undefined ? '?' : String(frame.dp?.[frame.active] ?? '?')],
    ['目标层 n', String(trace.n)],
  ] : [
    ['left', String(frame.left)], ['right', String(frame.right)],
    [trace.algorithm === 'binary-search' ? 'mid' : '当前比较的和', String((trace.algorithm === 'binary-search' ? frame.mid : frame.sum) ?? '尚未计算')],
    ['target', String(trace.target)],
  ];
  return <dl className="algo-variables">{items.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>;
}

export default function AlgorithmDemo({ sessionId, exampleId, language, createdAt, initialAlgorithm, standalone = false }: { sessionId: number | string; exampleId?: string; createdAt: string; language: 'cpp' | 'python'; initialAlgorithm?: Algorithm; standalone?: boolean }) {
  const initial: Algorithm = initialAlgorithm || (exampleId === 'binary-search' ? 'binary-search' : exampleId === 'valid-parentheses' ? 'brackets' : 'hash-two-sum');
  const [algorithm, setAlgorithm] = useState<Algorithm>(initial);
  const [applied, setApplied] = useState<DemoInput>({ ...DEFAULT_INPUTS[initial] });
  const [draft, setDraft] = useState<DemoInput>({ ...DEFAULT_INPUTS[initial] });
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1), [motion, setMotion] = useState(true);
  const [error, setError] = useState(''), [ready, setReady] = useState(false);
  const [codeOpen, setCodeOpen] = useState(standalone);
  const [inputOpen, setInputOpen] = useState(false);
  const trace = useMemo(() => buildTrace(algorithm, applied), [algorithm, applied]);
  const frame = trace.frames[Math.min(index, trace.frames.length - 1)], last = trace.frames.length - 1;
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const storageKey = `zhixu-animation-${sessionId}`;
  const scroll = useRef<HTMLDivElement>(null);
  const playbackEpoch = useRef(0);
  const metadata = ALGORITHMS[algorithm];
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.version === 1 && (!saved.origin || saved.origin === recordOrigin(createdAt)) && Object.hasOwn(ALGORITHMS, saved.algorithm) && ['values', 'target', 'brackets', 'stairs'].every(key => typeof saved.input?.[key] === 'string')) {
        const loaded = buildTrace(saved.algorithm, saved.input);
        setAlgorithm(saved.algorithm); setApplied(saved.input); setDraft(saved.input);
        setIndex(Number.isInteger(saved.index) ? Math.max(0, Math.min(saved.index, loaded.frames.length - 1)) : 0);
        if ([.5, 1, 2].includes(saved.speed)) setSpeed(saved.speed);
        if (typeof saved.motion === 'boolean') setMotion(saved.motion);
      }
    } catch { /* Invalid or old browser state falls back to the verified example. */ }
    setReady(true);
  }, [storageKey, createdAt]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, algorithm, input: applied, index, speed, motion, origin: recordOrigin(createdAt) })); } catch {}
  }, [ready, storageKey, algorithm, applied, index, speed, motion, createdAt]);
  useEffect(() => {
    if (!playing || dirty) return;
    if (index >= last) { setPlaying(false); return; }
    const epoch = playbackEpoch.current;
    const timer = setTimeout(() => { if (epoch === playbackEpoch.current && !document.hidden) setIndex(value => Math.min(last, value + 1)); }, 1700 / speed);
    return () => clearTimeout(timer);
  }, [playing, index, last, speed, dirty]);
  useEffect(() => {
    function visibility() { if (document.hidden) stop(); }
    document.addEventListener('visibilitychange', visibility);
    return () => { playbackEpoch.current++; document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { stop(); }, [language]);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    if (index === 0) element.scrollTop = 0;
    else if (!codeOpen) {
      const scene = element.querySelector<HTMLElement>('.algo-scene');
      if (scene) element.scrollTop = Math.max(0, scene.offsetTop - 12);
    }
    // Follow the frame when reading the picture; keep code readers at their place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, algorithm]);
  function stop() { playbackEpoch.current++; setPlaying(false); }
  function seek(next: number) { stop(); setIndex(Math.max(0, Math.min(last, next))); }
  function select(next: Algorithm) {
    stop(); setAlgorithm(next); setApplied({ ...DEFAULT_INPUTS[next] }); setDraft({ ...DEFAULT_INPUTS[next] }); setIndex(0); setError(''); setInputOpen(false); setCodeOpen(false);
    if (scroll.current) scroll.current.scrollTop = 0;
  }
  function edit(key: keyof DemoInput, value: string) { stop(); setError(''); setDraft(current => ({ ...current, [key]: value })); }
  function apply() {
    stop();
    try { buildTrace(algorithm, draft); setApplied({ ...draft }); setIndex(0); setError(''); setInputOpen(false); }
    catch (e) { setError((e as Error).message); }
  }
  const result = frame.result === undefined ? null : frame.result === null ? '没有数对' : Array.isArray(frame.result) ? `[${frame.result.join(', ')}]` : String(frame.result);
  return <div className={`algorithm-demo ${standalone ? 'standalone-demo' : ''}`} data-motion={motion}>
    <div className="algo-scroll" ref={scroll}>
      <div className="algo-intro"><span>把每一步，亲眼看清楚。</span><p>可修改的经典例子。演示数据独立于当前题目和代码草稿。</p></div>
      {!standalone && <><label className="algo-select-label" htmlFor={`algo-${sessionId}`}>演示算法</label><select id={`algo-${sessionId}`} className="algo-select" value={algorithm} onChange={e => select(e.target.value as Algorithm)}>{Object.entries(ALGORITHMS).map(([id, value]) => <option key={id} value={id}>{value.name}</option>)}</select></>}
      <p className="algo-condition">{metadata.condition}</p>
      <details className="algo-input-settings" open={inputOpen} onToggle={e => { setInputOpen(e.currentTarget.open); if (e.currentTarget.open) stop(); }}><summary><strong>修改输入</strong><span>{(algorithm === 'brackets' || algorithm === 'sliding-window') ? trace.text || '空串' : algorithm === 'bfs' ? `${trace.grid?.height} 行 × ${trace.grid?.width} 列` : algorithm === 'stairs' ? `${trace.n} 层台阶` : algorithm === 'interval-greedy' ? `${trace.frames[0].intervals?.length || 0} 个区间` : `${trace.values.length} 个数`}</span></summary><form className="algo-inputs" onSubmit={e => { e.preventDefault(); apply(); }}>
        {(algorithm === 'two-pointers' || algorithm === 'binary-search' || algorithm === 'hash-two-sum' || algorithm === 'merge-sort' || algorithm === 'quick-sort') && <><label>{algorithm === 'hash-two-sum' ? '原始数组（可无序）' : algorithm === 'two-pointers' || algorithm === 'binary-search' ? '升序数组' : '待排序数组'}<input aria-label={algorithm === 'hash-two-sum' ? '演示原始数组' : algorithm === 'two-pointers' || algorithm === 'binary-search' ? '演示升序数组' : '演示待排序数组'} value={draft.values} onChange={e => edit('values', e.target.value)} maxLength={120} placeholder="1, 2, 4, 7；空数组可填 []" /></label>{(algorithm === 'two-pointers' || algorithm === 'binary-search' || algorithm === 'hash-two-sum') && <label className="algo-target">目标值<input aria-label="演示目标值" value={draft.target} onChange={e => edit('target', e.target.value)} maxLength={8} inputMode="numeric" /></label>}</>}
        {algorithm === 'brackets' && <label>括号串<input aria-label="演示括号串" value={draft.brackets} onChange={e => edit('brackets', e.target.value)} maxLength={17} placeholder="如 ([{}])；也可以留空" /></label>}
        {algorithm === 'sliding-window' && <label>字符串<input aria-label="演示滑动窗口字符串" value={draft.window || ''} onChange={e => edit('window', e.target.value)} maxLength={13} placeholder="如 abcaabcbb；也可以留空" /></label>}
        {algorithm === 'bfs' && <label>网格（每行一排）<textarea aria-label="演示 BFS 网格" value={draft.grid || ''} onChange={e => edit('grid', e.target.value)} maxLength={80} rows={5} spellCheck={false} placeholder="S..\n.#.\n..E" /></label>}
        {algorithm === 'stairs' && <label>台阶数<input aria-label="演示台阶数" value={draft.stairs} onChange={e => edit('stairs', e.target.value)} maxLength={4} inputMode="numeric" /></label>}
        {algorithm === 'interval-greedy' && <label>区间列表<input aria-label="演示区间列表" value={draft.intervals || ''} onChange={e => edit('intervals', e.target.value)} maxLength={120} placeholder="如 1-3, 2-4, 3-5" /></label>}
        <button className="secondary-button" type="submit">应用输入</button>
      </form></details>
      {error && <p className="algo-error" role="alert">{error}</p>}
      {dirty && <div className="algo-dirty">输入尚未应用，当前画面保留原示例。<button onClick={() => { setDraft({ ...applied }); setError(''); setInputOpen(false); }}>取消修改</button></div>}
      <div className="lab-demo-columns"><div className="lab-visual"><div className="algo-scene" data-phase={frame.phase}>
        <div className="algo-scene-header"><strong>{metadata.name.split(' · ')[0]}</strong><span>{frame.phase === 'found' || frame.phase === 'finish' || frame.phase === 'mismatch' ? '独立例子 · 演示完成' : `独立例子 · 第 ${index + 1} 步`}</span></div>
        {algorithm === 'hash-two-sum' ? <HashScene trace={trace} frame={frame} /> : algorithm === 'sliding-window' ? <WindowScene trace={trace} frame={frame} /> : algorithm === 'bfs' ? <BFSScene trace={trace} frame={frame} /> : algorithm === 'interval-greedy' ? <IntervalScene trace={trace} frame={frame} /> : algorithm === 'brackets' ? <StackScene trace={trace} frame={frame} /> : algorithm === 'stairs' ? <DPScene frame={frame} /> : <ArrayScene trace={trace} frame={frame} />}
        {frame.expression && <div className="algo-expression">{frame.expression}</div>}
      </div>
      <div className="algo-explanation" aria-live="polite" aria-atomic="true"><div><span>{String(index + 1).padStart(2, '0')}</span><h3>{frame.title}</h3></div><p>{frame.detail}</p>{result !== null && <div className={`algo-result ${frame.result === false || frame.result === null || frame.result === -1 ? 'result-neutral' : ''}`}>结果 <strong>{result}</strong></div>}</div>
      </div><div className="lab-inspector"><Variables trace={trace} frame={frame} />
      <details className="algo-code" open={codeOpen} onToggle={e => setCodeOpen(e.currentTarget.open)}><summary>对照 {language === 'cpp' ? 'C++' : 'Python'} 核心代码</summary><p>函数内部的核心片段；高亮行对应当前步骤。{algorithm === 'bfs' && ' grid 是字符网格，start / goal 是（行, 列）坐标。'}</p><pre>{coreCode(algorithm, language).map((line, i) => <code key={line.id} className={line.id === frame.line ? 'is-active' : ''} aria-current={line.id === frame.line ? 'step' : undefined}><span>{i + 1}</span>{line.text}</code>)}</pre></details>
      <div className="algo-principle"><strong>记住这一个规则</strong><p>{metadata.principle}</p><div><span>时间 {metadata.time}</span><span>辅助空间 {metadata.space}</span></div><small>这是算法本身的复杂度；演示另外保存了每一步的状态快照。</small></div></div></div>
    </div>
    <div className="algo-player">
      <div className="algo-progress"><span>步骤 {index + 1} / {last + 1}</span><span>{playing ? '播放中' : index === last ? '已结束' : '已暂停'}</span></div>
      <input className="algo-timeline" type="range" aria-label="演示时间轴" min={0} max={last} value={index} onChange={e => seek(Number(e.target.value))} disabled={dirty} />
      <div className="algo-buttons"><button className="icon-button" aria-label="演示回到开头" onClick={() => seek(0)} disabled={index === 0 || dirty}><SkipBack size={17} /></button><button className="icon-button" aria-label="演示上一步" onClick={() => seek(index - 1)} disabled={index === 0 || dirty}><StepBack size={19} /></button><button className="primary-button algo-play" disabled={dirty || !ready} onClick={() => { if (playing) stop(); else { if (index === last) setIndex(0); setPlaying(true); } }}>{playing ? <Pause size={16} /> : index === last ? <RotateCcw size={16} /> : <Play size={16} />}{playing ? '暂停' : index === last ? '重播' : '播放'}</button><button className="icon-button" aria-label="演示下一步" onClick={() => seek(index + 1)} disabled={index === last || dirty}><StepForward size={19} /></button><button className="icon-button" aria-label="演示跳到结尾" onClick={() => seek(last)} disabled={index === last || dirty}><SkipForward size={17} /></button></div>
      <div className="algo-options"><label>速度<select aria-label="演示播放速度" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={.5}>0.5× 慢速</option><option value={1}>1×</option><option value={2}>2×</option></select></label><label><input type="checkbox" checked={motion} onChange={e => setMotion(e.target.checked)} />平滑动画</label></div>
    </div>
  </div>;
}
