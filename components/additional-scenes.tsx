"use client";
import { useEffect, useRef } from 'react';
import type { Frame, Trace } from '@zhixu/algo-viz';

export function WindowScene({ trace, frame }: { trace: Trace; frame: Frame }) {
  const text = trace.text || '', entries = frame.seen || [], viewport = useRef<HTMLDivElement>(null);
  const position = (index: number) => 40 + index * 56, width = Math.max(340, text.length * 56 + 40);
  useEffect(() => {
    const element = viewport.current, focus = frame.phase === 'window-shrink' ? frame.left : frame.right;
    if (!element || focus === undefined || focus < 0) return;
    const x = position(focus);
    if (x < element.scrollLeft + 30 || x > element.scrollLeft + element.clientWidth - 30) element.scrollLeft = Math.max(0, x - element.clientWidth / 2);
  }, [frame]);
  const pointer = (name: 'L' | 'R', index: number | undefined, y: number, kind: string) => <g className={`algo-pointer pointer-${kind}`} style={{ transform: `translate(${position(Math.max(0, index ?? 0))}px,${y}px)`, opacity: index !== undefined && index >= 0 && index < text.length ? 1 : 0 }} aria-hidden="true"><rect x="-16" y="-11" width="32" height="23" rx="5" /><text y="4" textAnchor="middle">{name}</text><path d={name === 'L' ? 'M0 15V42m-4 -4 4 4 4 -4' : 'M0 -16V-61m-4 4 4-4 4 4'} /></g>;
  return <div className="window-scene">
    <div className="algo-array-viewport" ref={viewport}><svg className="algo-array window-array" width={width} height="196" viewBox={`0 0 ${width} 196`} role="img" aria-label={`字符串 ${text || '空串'}；窗口 [${frame.left},${frame.windowEnd}]；候选右端 ${frame.right}`}>
      {[...text].map((char, index) => {
        const inside = index >= (frame.left ?? 0) && index <= (frame.windowEnd ?? -1), candidate = index === frame.cursor && index > (frame.windowEnd ?? -1);
        return <g key={index} transform={`translate(${position(index)},70)`} className={`algo-cell ${inside ? 'cell-left' : ''} ${candidate ? 'cell-mid' : ''} ${index === frame.matching ? 'window-matching' : ''}`} data-index={index} data-window={inside} data-candidate={candidate}><rect x="-23" width="46" height="42" rx="5" /><text textAnchor="middle" y="26">{char}</text><text className="algo-index" textAnchor="middle" y="55">{index}</text></g>;
      })}
      {frame.left !== undefined && frame.windowEnd !== undefined && frame.left <= frame.windowEnd && <rect className="window-band" x={position(frame.left) - 23} y="135" height="5" width={(frame.windowEnd - frame.left) * 56 + 46} rx="2" />}
      {(frame.bestLength ?? 0) > 0 && <rect className="window-best-band" x={position(frame.bestStart ?? 0) - 23} y="146" height="4" width={((frame.bestEnd ?? 0) - (frame.bestStart ?? 0)) * 56 + 46} rx="2" />}
      {pointer('L', frame.left, 24, 'left')}{pointer('R', frame.right, 179, 'right')}
      {!text && <text className="algo-empty-text" x={width / 2} y="98" textAnchor="middle">空串 · 长度 0</text>}
    </svg></div>
    <div className="algo-legend"><span><i className="legend-left" />当前有效窗口</span><span><i className="legend-right" />最优窗口</span><span><i className="legend-mid" />候选字符</span></div>
    <div className="window-table"><span>字符表中为 true 的项</span><div className="window-table-values" aria-label={`窗口内字符 ${entries.map(entry => entry.char).join(' ') || '空'}`}>{entries.length ? entries.map(entry => <span key={entry.index} className={entry.index === frame.matching ? 'is-duplicate' : ''}><strong>{entry.char}</strong><small>下标 {entry.index}</small></span>) : <small>空 · 全部为 false</small>}</div></div>
    <p className="algo-scroll-note">L 是窗口左端；R 是正尝试加入的右端。表中只展示 true 的项。</p>
  </div>;
}

export function BFSScene({ trace, frame }: { trace: Trace; frame: Frame }) {
  const grid = trace.grid!, distances = frame.distances || [], queued = frame.queue || [], viewport = useRef<HTMLDivElement>(null);
  const coordinate = (index: number) => `(${Math.floor(index / grid.width)},${index % grid.width})`;
  const center = (index: number) => ({ x: 36 + (index % grid.width) * 46, y: 36 + Math.floor(index / grid.width) * 46 });
  const ids = Array.from({ length: grid.width * grid.height }, (_, index) => index), width = grid.width * 46 + 26, height = grid.height * 46 + 26;
  const queueWidth = Math.max(290, queued.length * 62 + 14);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const focus = frame.phase === 'bfs-enqueue' ? Math.max(0, queued.length - 1) * 62 : 0;
    if (focus < element.scrollLeft || focus > element.scrollLeft + element.clientWidth - 70) element.scrollLeft = Math.max(0, focus - element.clientWidth + 80);
  }, [frame.phase, queued.length]);
  const path = frame.path?.map(index => { const point = center(index); return `${point.x},${point.y}`; }).join(' ');
  const current = frame.current === undefined ? null : center(frame.current), neighbor = frame.neighbor?.index === undefined ? null : center(frame.neighbor.index);
  return <div className="bfs-scene">
    <svg className="bfs-grid" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`网格 ${grid.height} 行 ${grid.width} 列；起点 ${coordinate(grid.start)}，终点 ${coordinate(grid.goal)}，当前 ${frame.current === undefined ? '无' : coordinate(frame.current)}`}>
      {Array.from({ length: grid.width }, (_, col) => <text className="bfs-axis" key={`col${col}`} x={36 + col * 46} y="11" textAnchor="middle">{col}</text>)}
      {Array.from({ length: grid.height }, (_, row) => <text className="bfs-axis" key={`row${row}`} x="10" y={40 + row * 46} textAnchor="middle">{row}</text>)}
      {ids.map(index => {
        const point = center(index), char = grid.rows[Math.floor(index / grid.width)][index % grid.width];
        const state = char === '#' ? 'wall' : frame.path?.includes(index) ? 'path' : index === frame.current ? 'current' : queued.includes(index) ? 'queued' : distances[index] >= 0 ? 'seen' : 'unknown';
        return <g key={index} className={`bfs-cell bfs-${state} ${index === frame.neighbor?.index ? 'is-inspected' : ''}`} data-index={index} data-state={state}><rect x={point.x - 19} y={point.y - 19} width="38" height="38" rx="5" /></g>;
      })}
      {path && <polyline className="bfs-path-line" points={path} />}
      {!path && current && neighbor && <path className={`bfs-edge ${frame.phase === 'bfs-enqueue' ? 'is-flowing' : ''}`} d={`M${current.x} ${current.y}L${neighbor.x} ${neighbor.y}`} />}
      {ids.map(index => {
        const point = center(index), char = grid.rows[Math.floor(index / grid.width)][index % grid.width];
        return <g key={index} className="bfs-label"><text className={char === '#' ? 'bfs-wall-label' : 'bfs-distance'} textAnchor="middle" x={point.x} y={point.y + 5}>{char === '#' ? '×' : distances[index] >= 0 ? distances[index] : '·'}</text>{char !== '.' && char !== '#' && <text className="bfs-marker" x={point.x - 14} y={point.y - 9}>{char}</text>}</g>;
      })}
    </svg>
    <div className="algo-legend"><span><i className="legend-mid" />当前 / 检查邻居</span><span><i className="legend-left" />入队 / 路径</span><span>数字＝最少步数 · × 障碍</span></div>
    <div className="bfs-queue-heading"><strong>先进先出队列</strong><span>队首 → 队尾 · {queued.length} 格</span></div>
    <div className="bfs-queue-viewport" ref={viewport}><div className="bfs-queue" style={{ width: queueWidth }} aria-label={`队列从头到尾 ${queued.map(coordinate).join(' ') || '空'}`}>
      {ids.map(index => {
        const rank = queued.indexOf(index), visible = rank >= 0, processed = distances[index] >= 0 && !visible;
        return <div key={index} className="bfs-queue-token" style={{ transform: `translateX(${visible ? rank * 62 : processed ? -64 : queueWidth + 64}px)`, opacity: visible ? 1 : 0 }} aria-hidden={!visible}><strong>{coordinate(index)}</strong><small>距离 {distances[index]}</small></div>;
      })}{!queued.length && <span className="bfs-queue-empty">空队列</span>}
    </div></div>
    <p className="algo-scroll-note">入队时就写距离。金色连接展示当前检查；绿色折线是找到的最短路径。</p>
  </div>;
}


export function HashScene({ trace, frame }: { trace: Trace; frame: Frame }) {
  const viewport = useRef<HTMLDivElement>(null), entries = frame.hashEntries || [], width = Math.max(340, trace.values.length * 56 + 40);
  const position = (index: number) => 40 + index * 56;
  const cursor = frame.cursor ?? -1;
  useEffect(() => {
    const element = viewport.current;
    if (!element || cursor < 0) return;
    const x = position(cursor);
    if (x < element.scrollLeft + 30 || x > element.scrollLeft + element.clientWidth - 30) element.scrollLeft = Math.max(0, x - element.clientWidth / 2);
  }, [cursor]);
  return <div className="hash-scene"><div className="algo-array-viewport" ref={viewport}><svg className="algo-array" width={width} height="153" viewBox={`0 0 ${width} 153`} role="img" aria-label={`原始数组 ${trace.values.join(', ')}；当前下标 ${cursor}；目标 ${trace.target}`}>
    {trace.values.map((value, index) => {
      const found = frame.phase === 'found' && Array.isArray(frame.result) && frame.result.includes(index);
      return <g key={index} transform={`translate(${position(index)},70)`} className={`algo-cell ${found ? 'cell-found' : index === cursor ? 'cell-mid' : index < cursor ? 'cell-left' : ''}`} data-index={index} data-state={found ? 'found' : index === cursor ? 'current' : 'candidate'}><rect x="-23" width="46" height="42" rx="5" /><text textAnchor="middle" y="26">{value}</text><text className="algo-index" textAnchor="middle" y="57">{index}</text></g>;
    })}
    <g className="algo-pointer pointer-mid" style={{ transform: `translate(${position(Math.max(0, cursor))}px,24px)`, opacity: cursor >= 0 && cursor < trace.values.length ? 1 : 0 }} aria-hidden="true"><rect x="-16" y="-11" width="32" height="23" rx="5" /><text y="4" textAnchor="middle">i</text><path d="M0 15V42m-4 -4 4 4 4 -4" /></g>
    {!trace.values.length && <text className="algo-empty-text" textAnchor="middle" x={width / 2} y="90">空数组 · 没有数对</text>}
  </svg></div><div className="hash-needed"><span>当前需要的补数</span><strong>{frame.needed ?? '尚未计算'}</strong><small>target − 当前值</small></div>
    <div className="hash-table-heading"><strong>已经见过的元素</strong><span>数值 → 原始下标</span></div>
    <div className="hash-table" aria-label={`哈希表 ${entries.map(entry => `${entry.value} 对应下标 ${entry.index}`).join('；') || '空'}`}>{entries.length ? entries.map(entry => <div key={entry.value} className={frame.matching !== undefined && entry.index === frame.matching ? 'is-matching' : ''} data-value={entry.value} data-index={entry.index}><strong>{entry.value}</strong><span>→</span><small>{entry.index}</small></div>) : <p>空表 · 当前元素还没有入表</p>}</div>
    <p className="algo-scroll-note">先查询，后保存。表不是排序后的数组，保存的是原始位置。</p>
  </div>;
}

export function IntervalScene({ trace, frame }: { trace: Trace; frame: Frame }) {
  const intervals = frame.intervals || [], selected = new Set(frame.selected || []);
  return <div className="interval-scene" role="img" aria-label={`区间 ${intervals.map(item => `${item.start}-${item.end}`).join('，') || '空'}；已选择 ${frame.selected?.length || 0} 个`}>
    <div className="interval-axis"><span>时间轴</span><div><i />{intervals.length ? <>{Array.from({ length: Math.max(...intervals.map(item => item.end)) - Math.min(...intervals.map(item => item.start)) + 1 }, (_, index) => <b key={index}>{Math.min(...intervals.map(item => item.start)) + index}</b>)}</> : <em>空</em>}</div></div>
    <div className="interval-list">{intervals.map((item, index) => <div key={item.index} className={`interval-row ${selected.has(item.index) ? 'is-selected' : ''} ${index === frame.intervalCursor ? 'is-current' : ''}`}><span>{item.start}-{item.end}</span><div><i style={{ left: `${(item.start - Math.min(...intervals.map(value => value.start))) * 10}%`, width: `${Math.max(4, (item.end - item.start) * 10)}%` }} /></div><small>原下标 {item.index}</small></div>)}</div>
    <div className="algo-legend"><span><i className="legend-left" />已选择</span><span><i className="legend-mid" />当前检查</span><span>按结束时间排序</span></div>
  </div>;
}
