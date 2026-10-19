'use client';

import { Children, Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

type Axis = 'x' | 'y';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function save(key: string, value: unknown) { try { localStorage.setItem(`zhixu-layout-${key}`, JSON.stringify(value)); } catch {} }
function read(key: string): unknown { try { return JSON.parse(localStorage.getItem(`zhixu-layout-${key}`) || 'null'); } catch { return null; } }

/** Capture the pointer so dragging keeps working over Monaco and outside the handle. */
export function ResizeHandle({ axis = 'x', label, value, min, max, onStart, onResize, onEnd, onReset, className = '' }: {
  axis?: Axis; label: string; value: number; min: number; max: number;
  onStart: () => void; onResize: (delta: number) => void; onEnd: () => void; onReset: () => void; className?: string;
}) {
  const drag = useRef<{ id: number; origin: number } | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => () => { document.body.removeAttribute('data-resizing'); }, []);
  function finish() {
    if (!drag.current) return;
    drag.current = null; setActive(false); document.body.removeAttribute('data-resizing'); onEnd();
  }
  return <div className={`resize-handle resize-${axis} ${active ? 'is-dragging' : ''} ${className}`}
    role="separator" tabIndex={0} aria-label={label} aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
    aria-valuenow={Math.round(value)} aria-valuemin={Math.round(min)} aria-valuemax={Math.round(max)}
    title={`${label}：按住拖动，方向键微调，双击恢复`}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault(); event.currentTarget.focus(); onStart();
      drag.current = { id: event.pointerId, origin: axis === 'x' ? event.clientX : event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.dataset.resizing = axis; setActive(true);
    }}
    onPointerMove={event => { if (drag.current?.id === event.pointerId) onResize((axis === 'x' ? event.clientX : event.clientY) - drag.current.origin); }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={onReset}
    onKeyDown={event => {
      const decrease = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
      const increase = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
      if (event.key === decrease || event.key === increase) {
        event.preventDefault(); onStart(); onResize((event.key === decrease ? -1 : 1) * (event.shiftKey ? 40 : 12)); onEnd();
      } else if (event.key === 'Home' || event.key === 'Enter') { event.preventDefault(); onReset(); }
    }}><span aria-hidden="true" /></div>;
}

/** Reconcile saved proportions with the current viewport and minimum reading sizes. */
function fit(weights: number[], available: number, minimums: number[]) {
  const totalMin = minimums.reduce((a, b) => a + b, 0);
  const mins = minimums.map(size => size * Math.min(1, available / Math.max(1, totalMin)));
  const sizes = weights.map(() => 0);
  let pending = weights.map((_, index) => index), remaining = available;
  while (pending.length) {
    const sum = pending.reduce((total, index) => total + weights[index], 0);
    const locked = pending.filter(index => remaining * weights[index] / sum < mins[index]);
    if (!locked.length) { pending.forEach(index => { sizes[index] = remaining * weights[index] / sum; }); break; }
    locked.forEach(index => { sizes[index] = mins[index]; remaining -= mins[index]; });
    pending = pending.filter(index => !locked.includes(index));
  }
  return sizes;
}

export function ResizablePanels({ children, storageKey, defaults, minimums, labels, axis = 'x', breakpoint = 800, className = '' }: {
  children: ReactNode; storageKey: string; defaults: number[]; minimums: number[]; labels: string[];
  axis?: Axis; breakpoint?: number; className?: string;
}) {
  const initial = useRef({ defaults, minimums });
  const [weights, setWeights] = useState(defaults);
  const latest = useRef(weights);
  const container = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const snapshot = useRef<number[]>([]);
  const panels = Children.toArray(children);
  const sizes = fit(weights, available, initial.current.minimums);
  function update(next: number[]) { latest.current = next; setWeights(next); }
  useEffect(() => {
    const stored = read(storageKey);
    if (Array.isArray(stored) && stored.length === initial.current.defaults.length && stored.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) update(stored);
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setAvailable(Math.max(0, (axis === 'x' ? rect.width : rect.height) - (initial.current.defaults.length - 1) * 9));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [storageKey, axis]);
  // Fractional tracks respond to a viewport change immediately, before ResizeObserver
  // reconciles the minimum sizes on the next frame. Saved wide layouts never overflow.
  const tracks = weights.map((weight, index) => `minmax(0,${available > 0 ? Math.max(.01, sizes[index]) : weight}fr)`).join(' 9px ');
  return <div ref={container} className={`resizable-panels axis-${axis} split-at-${breakpoint} ${className}`}
    style={{ '--panel-tracks': tracks } as CSSProperties}>
    {panels.map((panel, index) => <Fragment key={index}>{panel}{index < panels.length - 1 && <ResizeHandle axis={axis}
      label={labels[index]} value={sizes[index]} min={Math.min(initial.current.minimums[index], sizes[index])}
      max={Math.max(sizes[index], sizes[index] + sizes[index + 1] - initial.current.minimums[index + 1])}
      onStart={() => { snapshot.current = fit(latest.current, available, initial.current.minimums); }}
      onResize={delta => {
        const next = [...snapshot.current], pair = next[index] + next[index + 1];
        const low = Math.min(initial.current.minimums[index], next[index]);
        const high = pair - Math.min(initial.current.minimums[index + 1], next[index + 1]);
        next[index] = clamp(next[index] + delta, low, high); next[index + 1] = pair - next[index];
        update(next.map(size => Math.max(.01, size)));
      }} onEnd={() => save(storageKey, latest.current)}
      onReset={() => { update(initial.current.defaults); save(storageKey, initial.current.defaults); }} />}</Fragment>)}
  </div>;
}

/** Bottom-edge resizing for cards whose natural height is the default. */
export function ResizableSection({ children, storageKey, label, min = 220, max = 900 }: {
  children: ReactNode; storageKey: string; label: string; min?: number; max?: number;
}) {
  const [height, setHeight] = useState<number | null>(null);
  const latest = useRef(height), snapshot = useRef(0), body = useRef<HTMLDivElement>(null);
  function update(next: number | null) { latest.current = next; setHeight(next); }
  useEffect(() => { const stored = read(storageKey); if (typeof stored === 'number' && Number.isFinite(stored)) update(clamp(stored, min, max)); }, [storageKey, min, max]);
  return <div className="resizable-section"><div ref={body} className="resizable-section-body" style={height === null ? undefined : { height }} data-sized={height !== null}>{children}</div>
    <ResizeHandle axis="y" className="card-resize" label={label} value={height ?? min} min={min} max={max}
      onStart={() => { snapshot.current = body.current?.getBoundingClientRect().height || min; }}
      onResize={delta => update(clamp(snapshot.current + delta, min, max))} onEnd={() => save(storageKey, latest.current)}
      onReset={() => { update(null); save(storageKey, null); }} /></div>;
}

export function SidebarResize() {
  const [width, setWidth] = useState(218), latest = useRef(218), snapshot = useRef(218);
  const [max, setMax] = useState(300);
  function update(next: number) { latest.current = next; setWidth(next); }
  useEffect(() => {
    const stored = read('sidebar');
    if (typeof stored === 'number' && Number.isFinite(stored)) update(clamp(stored, 180, 300));
    function constrain() {
      const limit = clamp(innerWidth - (document.querySelector('.work-mode') ? 740 : 620), 180, 300);
      setMax(limit); if (latest.current > limit) update(limit);
    }
    constrain(); window.addEventListener('resize', constrain);
    return () => window.removeEventListener('resize', constrain);
  }, []);
  useEffect(() => { (document.querySelector('.app-shell') as HTMLElement | null)?.style.setProperty('--sidebar-width', `${width}px`); }, [width]);
  return <ResizeHandle className="sidebar-resize" label="调整侧栏宽度" value={width} min={180} max={max}
    onStart={() => { snapshot.current = latest.current; }} onResize={delta => update(clamp(snapshot.current + delta, 180, max))}
    onEnd={() => save('sidebar', latest.current)} onReset={() => { update(Math.min(218, max)); save('sidebar', latest.current); }} />;
}
