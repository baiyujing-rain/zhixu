"use client";

import { useEffect, useRef, useState } from 'react';
import { Archive, Check, Download, FileJson, Loader2, RefreshCw, Upload } from 'lucide-react';
import { ApiError, api } from '@/lib/api';

type Envelope = { payload: { exported_at: string }; checksum: string };
type Entry = { source_id: number; title: string; language: string; messages: number; reports: number; reviews: number; duplicate_id: number | null; repeated_in_file: boolean };
type Preview = { entries: Entry[]; new_count: number; duplicate_count: number; preview_hash: string; profile: { language: string; level: string; style: string } };
type Imported = { imported: { id: number; title: string }[]; skipped: unknown[]; profile_restored: boolean };
const MAX_BYTES = 20 * 1024 * 1024;

export default function DataArchive({ onRestored, onRecords }: { onRestored: () => Promise<void>; onRecords: () => void }) {
  const [pending, setPending] = useState<'export' | 'preview' | 'import' | null>(null);
  const [archive, setArchive] = useState<Envelope | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<number[]>([]), [restoreProfile, setRestoreProfile] = useState(false), [stale, setStale] = useState(false);
  const [filename, setFilename] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function download() {
    setPending('export'); setError(''); setNotice('');
    try {
      const data = await api<Envelope>('/data/export');
      if (!alive.current) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      const stamp = data.payload.exported_at.slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
      anchor.href = url; anchor.download = `zhixu-learning-${stamp}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('备份已生成并开始下载。请把文件保存到你熟悉的位置。');
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setPending(null); }
  }
  async function prepare(data: Envelope) {
    const plan = await api<Preview>('/data/preview', 'POST', data);
    if (!alive.current) return;
    setArchive(data); setPreview(plan); setSelected(plan.entries.filter(item => item.duplicate_id === null && !item.repeated_in_file).map(item => item.source_id));
    setRestoreProfile(false); setStale(false);
  }
  async function choose(file?: File) {
    if (!file || pending) return;
    setPending('preview'); setError(''); setNotice(''); setPreview(null); setArchive(null);
    try {
      if (file.size > MAX_BYTES) throw new Error('请选择 20 MB 以内的知序 JSON 备份文件。');
      let data: Envelope;
      try { data = JSON.parse(await file.text()) as Envelope; }
      catch { throw new Error('文件不是有效的 JSON，请选择知序导出的备份文件。'); }
      await prepare(data); if (alive.current) setFilename(file.name);
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) { setPending(null); if (input.current) input.current.value = ''; } }
  }
  async function recheck() {
    if (!archive || pending) return;
    setPending('preview'); setError('');
    try { await prepare(archive); }
    catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setPending(null); }
  }
  async function restore() {
    if (!archive || !preview || pending || stale) return;
    setPending('import'); setError(''); setNotice('');
    try {
      const result = await api<Imported>('/data/import', 'POST', { archive, source_ids: selected, preview_hash: preview.preview_hash, restore_profile: restoreProfile });
      if (!alive.current) return;
      setPreview(null); setArchive(null); setSelected([]);
      setNotice(`已恢复 ${result.imported.length} 条学习记录${result.skipped.length ? `，跳过 ${result.skipped.length} 条相同记录` : ''}${result.profile_restored ? '，并恢复学习偏好' : ''}。原有记录已保留。`);
      try { await onRestored(); } catch (e) { if (alive.current) setError(`恢复已完成，更新页面时连接中断：${(e as Error).message}`); }
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 409) setStale(true);
      setError((e as Error).message);
    } finally { if (alive.current) setPending(null); }
  }
  const selectable = preview?.entries.filter(item => item.duplicate_id === null && !item.repeated_in_file) || [];
  return <section className="card settings-card archive-card">
    <div className="section-heading"><h2><Archive size={20} />学习数据备份</h2><span className="subtle-badge">由你保管的思考记录</span></div>
    <p className="settings-description">题目、C++ / Python 草稿、对话、复盘笔记、优化报告与复习安排，一起装进一个可恢复的文件。</p>
    <div className="archive-actions"><button className="secondary-button" disabled={Boolean(pending)} onClick={() => void download()}>{pending === 'export' ? <Loader2 size={16} className="spin" /> : <Download size={16} />}下载学习备份</button><button className="secondary-button" disabled={Boolean(pending)} onClick={() => input.current?.click()}>{pending === 'preview' ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}选择备份并预览</button><input ref={input} className="archive-file-input" type="file" hidden accept=".json,application/json" aria-label="选择知序学习备份文件" disabled={Boolean(pending)} onChange={event => void choose(event.target.files?.[0])} /></div>
    <p className="form-note">只备份已保存的学习内容与学习偏好。账号凭据、API 密钥、浏览器布局和待导入转接任务不包含在内。单次最多 20 MB、2,000 条记录。</p>
    {preview && <div className="archive-preview">
      <div className="archive-preview-heading"><FileJson size={19} /><div><strong>{filename}</strong><span>{preview.new_count} 条可恢复 · {preview.duplicate_count} 条相同记录会跳过</span></div><button className="text-button" disabled={Boolean(pending)} onClick={() => { setArchive(null); setPreview(null); setError(''); }}>收起预览</button></div>
      {selectable.length > 0 && <label className="archive-select-all"><input type="checkbox" checked={selected.length === selectable.length} disabled={Boolean(pending) || stale} onChange={event => setSelected(event.target.checked ? selectable.map(item => item.source_id) : [])} />选择全部可恢复记录</label>}
      <div className="archive-records" role="group" aria-label="备份中的学习记录">{preview.entries.length ? preview.entries.map(item => {
        const duplicate = item.duplicate_id !== null || item.repeated_in_file;
        return <label className={`archive-record ${duplicate ? 'duplicate' : ''}`} key={item.source_id}><input type="checkbox" aria-label={`恢复 ${item.title}（备份编号 ${item.source_id}）`} checked={selected.includes(item.source_id)} disabled={Boolean(pending) || duplicate || stale} onChange={event => setSelected(previous => event.target.checked ? [...previous, item.source_id] : previous.filter(id => id !== item.source_id))} /><span><strong>{item.title}</strong><small>{item.language === 'cpp' ? 'C++' : 'Python'} · {item.messages} 条对话 · {item.reports} 份优化报告{item.reviews ? ` · ${item.reviews} 次复习` : ''}</small></span>{duplicate && <small className="archive-duplicate"><Check size={13} />相同记录，跳过</small>}</label>;
      }) : <p className="form-note">这份备份没有题目记录，可以选择恢复学习偏好。</p>}</div>
      <label className="archive-profile"><input type="checkbox" checked={restoreProfile} disabled={Boolean(pending) || stale} onChange={event => setRestoreProfile(event.target.checked)} /><span>同时恢复学习偏好<small>{preview.profile.language === 'cpp' ? 'C++' : 'Python'} · {preview.profile.level === 'beginner' ? '刚刚起步' : '有一些基础'} · {preview.profile.style === 'guided' ? '一步步提问' : '多举点例子'}</small></span></label>
      <div className="archive-confirm"><p>恢复会追加记录，已有内容保持原样。</p>{stale ? <button className="secondary-button" disabled={Boolean(pending)} onClick={() => void recheck()}><RefreshCw size={15} />重新预览</button> : <button className="primary-button" disabled={Boolean(pending) || (!selected.length && !restoreProfile)} onClick={() => void restore()}>{pending === 'import' ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}确认恢复{selected.length ? ` ${selected.length} 条记录` : '学习偏好'}</button>}</div>
    </div>}
    {error && <div className="auth-error" role="alert">{error}</div>}
    {notice && <div className="archive-notice" role="status"><Check size={16} /><span>{notice}</span><button className="text-button" onClick={onRecords}>查看做题记录</button></div>}
  </section>;
}
