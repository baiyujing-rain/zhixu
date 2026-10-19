"use client";

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, Download, Eye, FilePenLine, ListPlus, Loader2, Save } from 'lucide-react';
import Modal from './modal';
import ForeignDrafts from './foreign-drafts';
import { useTextDraft } from './use-text-draft';

type Item = { id: number; created_at?: string; title: string; content: string; language: 'cpp' | 'python'; drafts: Record<string, string>; notes: string };
const OUTLINE = `## 我想到的关键观察


## 为什么这样做是对的


## 复杂度与取舍

- 输入规模：
- 时间复杂度及依据：
- 额外空间（包含递归栈）：
- 输出空间：

## 容易出错的边界


## 下次看到这类题，我会

`;
function fenced(code: string, language: string) {
  const longest = Math.max(2, ...(code.match(/`+/g) || []).map(run => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}
${code}
${fence}`;
}

export default function NotesEditor<T extends Item>({ item, onSaved, onClose, onRecap }: { item: T; onSaved: (item: T) => void; onClose: () => void; onRecap: () => void }) {
  const draft = useTextDraft<T>(onSaved, {
    key: record => `zhixu-notes-${record.id}`,
    value: record => record.notes,
    payload: (_, notes, base) => ({ notes, expected_notes: base }),
    mergeRemote: (server, captured) => ({ ...server, language: captured.language }),
    replace: (record, notes) => ({ ...record, notes }),
    maxLength: 10000, label: '笔记',
  });
  const [tab, setTab] = useState<'write' | 'preview'>('write'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [includeCode, setIncludeCode] = useState(false);
  useEffect(() => { draft.accept(item, true); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    function protect(event: BeforeUnloadEvent) { if (draft.dirty && !draft.cacheAvailable) event.preventDefault(); }
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [draft.dirty, draft.cacheAvailable]);
  async function save(close = false, keepLocal = false) {
    setBusy(true); setError('');
    try { await draft.save(keepLocal); setNotice('笔记已保存。'); if (close) onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function close() {
    if (busy || draft.status === 'saving') return;
    if (draft.dirty && !draft.cacheAvailable) await save(true);
    else onClose();
  }
  function outline() {
    const text = `${draft.code.trim() ? draft.code + `

` : ''}${OUTLINE}`;
    if (text.length > 10000) { setError('追加提纲会超过 10,000 字符，原有笔记保持原样。'); return; }
    draft.edit(text); setTab('write'); setError(''); setNotice('提纲已插入，留白由你填写。');
  }
  function download() {
    let content = `# ${item.title} · 我的复盘

${draft.code || '尚未填写复盘笔记。'}

---

## 题目

${item.content}
`;
    if (includeCode) {
      content += `

## 我的已保存草稿
`;
      for (const language of ['cpp', 'python']) if (item.drafts[language]) content += `
### ${language === 'cpp' ? 'C++' : 'Python'}

${fenced(item.drafts[language], language)}
`;
    }
    const name = item.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || '学习记录';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${name}-复盘.md`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('复盘 Markdown 已开始下载，包含当前编辑的笔记。');
  }
  const locked = busy || draft.status === 'saving';
  return <Modal className="notes-editor-modal" title="把思路留下来" locked={locked} onClose={() => void close()}>
    <p className="dialog-copy">写下让你想通的那一步，以及下次需要留意的边界。笔记自动保存。{draft.cacheAvailable ? '未保存的编辑保留在当前浏览器。' : '此浏览器无法暂存，请保存或导出后再离开。'}</p>
    <div className="notes-editor-toolbar"><div className="notes-editor-tabs"><button className={tab === 'write' ? 'selected' : ''} onClick={() => setTab('write')}><FilePenLine size={14} />写笔记</button><button className={tab === 'preview' ? 'selected' : ''} onClick={() => setTab('preview')}><Eye size={14} />预览</button></div><button className="text-button" disabled={locked} onClick={outline}><ListPlus size={14} />{draft.code.trim() ? '追加复盘提纲' : '插入复盘提纲'}</button></div>
    {tab === 'write' ? <textarea className="notes-input" aria-label="复盘笔记" value={draft.code} onChange={event => { draft.edit(event.target.value); setError(''); setNotice(''); }} maxLength={10000} placeholder={`我的关键观察：

我卡住的地方：

下次看到这类题，我会：`} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!locked) void save(); } }} /> : <div className="notes-preview markdown">{draft.code.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.code}</ReactMarkdown> : <p>写下第一句关键观察，就能在这里预览排版。</p>}</div>}
    <div className="notes-editor-status"><span>{draft.status === 'saving' ? <><Loader2 size={12} className="spin" />正在保存…</> : draft.status === 'conflict' ? '版本冲突 · 本地笔记保留' : draft.status === 'offline' ? '保存失败 · 请重试' : draft.dirty ? '等待保存…' : '已保存'}</span><span>{draft.code.length.toLocaleString('zh-CN')} / 10,000 · Ctrl + S 保存</span></div>
    {(draft.error || error || !draft.cacheAvailable) && <div className="draft-notice" role="alert">{error || draft.error || '当前浏览器无法缓存笔记，请保存到后端或导出 Markdown 再离开。'}{!draft.cacheAvailable && (error || draft.error) && <p>浏览器也无法缓存当前笔记，请先复制或导出 Markdown 再离开。</p>}{draft.status === 'conflict' && <><details><summary>比较服务器笔记</summary><pre>{draft.remoteCode || '（空笔记）'}</pre></details><div><button className="secondary-button" disabled={locked || !draft.canResolve} onClick={() => void save(false, true)}>保留本地并保存</button><button className="text-button" disabled={locked || !draft.canResolve} onClick={() => { setError(''); draft.useRemote(); setNotice('已使用服务器笔记，版本已切换。'); }}>使用服务器版本</button>{!draft.canResolve && <button className="text-button" disabled={locked} onClick={() => void draft.refreshRemote().catch(e => setError(e.message))}>重新读取服务器版本</button>}</div></>}</div>}
    <ForeignDrafts entries={draft.foreignDrafts} label="笔记" disabled={locked || draft.dirty} onRestore={draft.restoreForeign} />
    {draft.hasRecovery && <button className="text-button draft-recovery" disabled={locked} onClick={() => { setError(''); draft.restoreRecovery(); }}>找回此前的本地笔记</button>}
    <div className="notes-export"><label><input type="checkbox" checked={includeCode} onChange={event => setIncludeCode(event.target.checked)} />导出时包含两种语言的已保存代码</label><button className="text-button" onClick={download}><Download size={14} />导出复盘 Markdown</button></div>
    {notice && <div className="notes-editor-notice" role="status">{notice}</div>}
    <div className="dialog-actions"><button className="secondary-button" disabled={locked} onClick={() => { setBusy(true); void draft.save().then(onRecap).catch(e => { setError(e.message); setBusy(false); }); }}><BookOpen size={14} />教练帮我总结</button><button className="primary-button" disabled={locked} onClick={() => void save(true)}><Save size={15} />保存笔记</button></div>
  </Modal>;
}
