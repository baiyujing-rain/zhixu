'use client';

import { useEffect, useRef } from 'react';

export default function InkAtmosphere() {
  const effectsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let mode = 'on';
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    function clear() {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear(); effectsRef.current?.replaceChildren();
    }
    function ripple(target: EventTarget | null, x?: number, y?: number) {
      if (mode === 'off' || (mode === 'system' && motion.matches) || !(target instanceof Element) || !effectsRef.current) return;
      const rect = target.getBoundingClientRect();
      const impact = document.createElement('span');
      impact.className = 'ink-impact';
      impact.style.left = `${x ?? rect.left + rect.width / 2}px`;
      impact.style.top = `${y ?? rect.top + rect.height / 2}px`;
      const button = target.closest('.primary-button, .chatgpt-login-button, .question-box button');
      impact.style.setProperty('--bloom-color', getComputedStyle(document.documentElement).getPropertyValue(button ? '--ink-light' : '--ink-ripple'));
      const wash = document.createElement('span'); wash.className = 'ink-bloom'; impact.appendChild(wash);
      for (let i = 0; i < 3; i++) {
        const ring = document.createElement('span'); ring.className = 'ink-ring';
        ring.style.setProperty('--ring-delay', `${i * 130}ms`);
        ring.style.setProperty('--ring-size', `${150 - i * 24}px`);
        ring.style.setProperty('--ring-rotation', `${i * 57 - 23}deg`);
        impact.appendChild(ring);
      }
      while (timers.size >= 12) {
        const first = timers.keys().next().value as HTMLElement;
        clearTimeout(timers.get(first)); first.remove(); timers.delete(first);
      }
      effectsRef.current.appendChild(impact);
      timers.set(impact, setTimeout(() => { impact.remove(); timers.delete(impact); }, 1750));
    }
    function pointer(event: PointerEvent) { if (event.button === 0 && event.isPrimary !== false) ripple(event.target, event.clientX, event.clientY); }
    function keyboardClick(event: MouseEvent) { if (event.detail === 0) ripple(event.target); }
    function motionChange() { if (mode === 'system' && motion.matches) clear(); }
    function updateMode(event?: Event) {
      if (event instanceof StorageEvent && event.key !== null && event.key !== 'zhixu-ink-motion') return;
      if (event instanceof CustomEvent) mode = event.detail;
      else { try { mode = localStorage.getItem('zhixu-ink-motion') || 'on'; } catch { mode = 'on'; } }
      if (!['on', 'system', 'off'].includes(mode)) mode = 'on';
      if (effectsRef.current) effectsRef.current.dataset.motion = mode;
      clear();
    }
    updateMode();
    window.addEventListener('zhixu-ink-motion', updateMode);
    window.addEventListener('storage', updateMode);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('click', keyboardClick, true);
    motion.addEventListener('change', motionChange);
    return () => { document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('click', keyboardClick, true); motion.removeEventListener('change', motionChange); window.removeEventListener('zhixu-ink-motion', updateMode); window.removeEventListener('storage', updateMode); clear(); };
  }, []);

  return <><div className="ink-landscape" aria-hidden="true" /><div className="ink-paper-grain" aria-hidden="true" /><div ref={effectsRef} className="ink-effects" aria-hidden="true" /></>;
}
