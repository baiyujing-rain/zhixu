'use client';
import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Loader2, X } from 'lucide-react';
import { api } from '@/lib/api';
export type ExternalExchange = { external: true; id: string; session_id: number; mode: 'coach' | 'optimize'; prompt: string };
export default function DeepSeekTransfer({ exchange, onClose, onImported, beforeImport }: {
  exchange: ExternalExchange; onClose: () => void; onImported: (result: unknown) => void; beforeImport: () => Promise<unknown>;
}) {
  const [reply, setReply] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null), closeRef = useRef(onClose);
  closeRef.current = busy ? () => {} : onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    function keys(event: KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const list = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a, textarea, summary') || []);
        if (event.shiftKey && document.activeElement === list[0]) { event.preventDefault(); list.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === list.at(-1)) { event.preventDefault(); list[0]?.focus(); }
      }
    }
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); previous?.focus(); };
  }, []);
  async function copy() {
    setError('');
    try {
      try { await navigator.clipboard.writeText(exchange.prompt); }
      catch {
        // Some embedded browsers do not grant the Clipboard API. Keep a native
        // selection-based fallback inside the active dialog, during the user action.
        const textarea = document.createElement('textarea');
        textarea.value = exchange.prompt; textarea.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
        const previous = document.activeElement as HTMLElement | null;
        let success = false;
        try { ref.current?.appendChild(textarea); textarea.focus(); textarea.select(); success = document.execCommand('copy'); }
        finally { textarea.remove(); previous?.focus(); }
        if (!success) throw new Error('clipboard unavailable');
      }
      setCopied(true);
    } catch { setError('复制未完成，请展开提问内容后手动复制。'); }
  }
  async function submit() {
    setBusy(true); setError('');
    try {
      await beforeImport();
      const data = await api<unknown>(`/sessions/${exchange.session_id}/external/${exchange.id}`, 'POST', { reply });
      onImported(data);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><div className="modal deepseek-transfer" ref={ref} role="dialog" aria-modal="true" aria-label="DeepSeek 网页版转接">
    <div className="modal-header"><h2>用 DeepSeek 网页版继续</h2><button className="icon-button" onClick={onClose} disabled={busy} aria-label="暂时收起 DeepSeek 转接"><X size={19} /></button></div>
    <p className="dialog-copy">这里使用手动转接：复制带题目、代码和学习进度的提问，去官方网页发送，再粘贴回复回来。知序不会自动调用付费 API。</p>
    <div className="transfer-actions"><button className="secondary-button" onClick={() => void copy()}><Copy size={15} />{copied ? '提问已复制' : '复制提问'}</button><a className="primary-button" href="https://chat.deepseek.com/" target="_blank" rel="noreferrer">打开 DeepSeek 网页版<ExternalLink size={15} /></a></div>
    <details className="transfer-prompt"><summary>查看完整提问</summary><textarea aria-label="DeepSeek 提问内容" value={exchange.prompt} readOnly /></details>
    <label className="transfer-label" htmlFor="deepseek-reply">粘贴 DeepSeek 的完整回复{exchange.mode === 'optimize' ? '（JSON 分析报告）' : ''}</label>
    <textarea id="deepseek-reply" value={reply} onChange={e => setReply(e.target.value)} maxLength={120000} placeholder="从 DeepSeek 复制回复，粘贴到这里…" disabled={busy} />
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="secondary-button" disabled={busy} onClick={onClose}>稍后继续</button><button className="primary-button" disabled={busy || !reply.trim()} onClick={() => void submit()}>{busy && <Loader2 size={15} className="spin" />}导入并保存回复</button></div>
    <small>转接任务已保存在本机，刷新后可以继续。网页版使用条件以 DeepSeek 当前说明为准。</small>
  </div></div>;
}
