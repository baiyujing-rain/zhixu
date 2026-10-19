'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, children, onClose, locked = false, className = '' }: { title: string; children: React.ReactNode; onClose: () => void; locked?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = locked ? () => {} : onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const targets = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    targets()[0]?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const list = targets(); const first = list[0], last = list[list.length - 1];
        if (!list.length) { event.preventDefault(); ref.current?.focus(); }
        else if (!ref.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      }
    };
    document.addEventListener('keydown', listener);
    return () => { document.removeEventListener('keydown', listener); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (!locked && e.target === e.currentTarget) onClose(); }}><div className={`modal ${className}`} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} disabled={locked} aria-label="关闭"><X size={20} /></button></div>{children}</div></div>;
}

