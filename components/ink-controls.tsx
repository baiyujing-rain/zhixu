'use client';
import { useEffect, useState } from 'react';
type Mode = 'on' | 'system' | 'off';
export default function InkControls() {
  const [mode, setMode] = useState<Mode>('on');
  useEffect(() => { try { const saved = localStorage.getItem('zhixu-ink-motion'); if (saved === 'on' || saved === 'system' || saved === 'off') setMode(saved); } catch {} }, []);
  function change(next: Mode) {
    setMode(next); try { localStorage.setItem('zhixu-ink-motion', next); } catch {}
    window.dispatchEvent(new CustomEvent('zhixu-ink-motion', { detail: next }));
  }
  return <div className="setting-row ink-preference"><div><strong>点击水墨波纹</strong><p>动态模式始终播放水波；也可以跟随系统或关闭。</p></div><div className="language-switch" aria-label="点击动画模式">{([['on', '动态'], ['system', '跟随系统'], ['off', '关闭']] as const).map(([value, label]) => <button key={value} className={mode === value ? 'selected' : ''} aria-pressed={mode === value} onClick={() => change(value)}>{label}</button>)}</div></div>;
}
