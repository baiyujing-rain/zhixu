"use client";
import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { localDateTime } from '@/lib/dates';
import type { ForeignDraft } from './use-text-draft';
export default function ForeignDrafts({ entries, disabled, label, onRestore }: { entries: ForeignDraft[]; disabled: boolean; label: string; onRestore: (key: string) => void }) {
  const [selection, setSelection] = useState('');
  if (!entries.length) return null;
  const selected = entries.find(item => item.key === selection) || entries[0];
  return <div className="foreign-drafts"><details><summary><History size={13} />发现其他窗口或之前页面的{label}草稿 · {entries.length} 份</summary><p>各窗口独立保留。恢复时会与当前服务器版本比较；请先保存当前编辑。</p><select aria-label={`选择其他窗口的${label}草稿`} value={selected.key} disabled={disabled} onChange={event => setSelection(event.target.value)}>{entries.map((item, index) => <option key={item.key} value={item.key}>{index + 1} · {item.updatedAt ? localDateTime(item.updatedAt) : '日期未知'}</option>)}</select><pre>{selected.code.slice(0, 2000)}{selected.code.length > 2000 ? '\n…预览已截取，恢复将读取完整内容' : ''}</pre><button className="text-button" disabled={disabled} onClick={() => onRestore(selected.key)}><RotateCcw size={12} />恢复这份{label}草稿</button></details></div>;
}
