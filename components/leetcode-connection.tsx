'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, ExternalLink, Link2, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { api } from '@/lib/api';
import { localDateTime } from '@/lib/dates';
type Connection = { site: 'cn' | 'com'; configured: boolean; username: string; verified_at: string | null };

export default function LeetCodeConnection() {
  const [site, setSite] = useState<'cn' | 'com'>('cn'), [connection, setConnection] = useState<Connection | null>(null);
  const [cookie, setCookie] = useState(''), [show, setShow] = useState(false), [pending, setPending] = useState('load');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), epoch = useRef(0), busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  useEffect(() => {
    const generation = ++epoch.current; setPending('load'); setError(''); setNotice(''); setConnection(null); setCookie(''); setShow(false);
    api<Connection>(`/leetcode/connection?site=${site}`).then(value => { if (alive.current && epoch.current === generation) setConnection(value); }).catch(e => { if (alive.current && epoch.current === generation) setError(e.message); }).finally(() => { if (alive.current && epoch.current === generation) setPending(''); });
  }, [site]);
  async function act(kind: 'connect' | 'verify' | 'disconnect') {
    if (busy.current) return;
    busy.current = true; const generation = epoch.current; setPending(kind); setError(''); setNotice('');
    try {
      const value = await api<Connection>(kind === 'connect' ? '/leetcode/connection' : kind === 'verify' ? `/leetcode/connection/verify?site=${site}` : `/leetcode/connection?site=${site}`, kind === 'disconnect' ? 'DELETE' : 'POST', kind === 'connect' ? { site, cookie } : undefined);
      if (!alive.current || generation !== epoch.current) return;
      setConnection(value); setCookie(''); setShow(false);
      setNotice(kind === 'disconnect' ? '本机连接已移除，力扣网页登录不受影响。' : kind === 'verify' ? '力扣登录状态验证成功。' : '已连接本人力扣账号，可以运行代码和主动提交判题。');
    } catch (e) { if (alive.current && generation === epoch.current) setError((e as Error).message); }
    finally { busy.current = false; if (alive.current && generation === epoch.current) setPending(''); }
  }
  const base = site === 'cn' ? 'https://leetcode.cn' : 'https://leetcode.com';
  return <section className="card settings-card leetcode-connection">
    <div className="integration-heading"><span className="integration-mark">LC</span><div><h2>连接力扣</h2><p>导入官方题目，运行 C++ / Python，主动提交判题。</p></div><select aria-label="力扣站点" value={site} disabled={Boolean(pending)} onChange={e => setSite(e.target.value as 'cn' | 'com')}><option value="cn">力扣中国站</option><option value="com">LeetCode 国际站</option></select></div>
    {connection?.configured && <div className="integration-connected"><CheckCircle2 size={19} /><div><strong>{connection.username || '本机已保存连接'}</strong><span>最近验证：{connection.verified_at ? localDateTime(connection.verified_at) : '尚未记录'}</span></div><button className="secondary-button" disabled={Boolean(pending)} onClick={() => void act('verify')}><RefreshCw size={14} />检查连接</button><button className="text-button" disabled={Boolean(pending)} onClick={() => void act('disconnect')}><Unplug size={14} />断开</button></div>}
    <div className="cookie-form"><label htmlFor="leetcode-cookie">本人账号的 Cookie</label><div><input id="leetcode-cookie" aria-label="力扣 Cookie" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={cookie} maxLength={16000} onChange={e => setCookie(e.target.value)} placeholder="LEETCODE_SESSION=…; csrftoken=…" disabled={Boolean(pending)} /><button className="icon-button" aria-label={show ? '隐藏 Cookie' : '显示 Cookie'} onClick={() => setShow(!show)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><p>仅保存在本机凭据目录，不放进题库、浏览器缓存或学习备份。输入后先验证身份。</p><button className="primary-button" disabled={!cookie.trim() || Boolean(pending)} onClick={() => void act('connect')}>{pending === 'connect' ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}验证并连接</button></div>
    <details className="connection-howto"><summary>如何获取 Cookie</summary><ol><li>在 <a href={base} target="_blank" rel="noreferrer">力扣官方页面 <ExternalLink size={12} /></a>登录本人账号。</li><li>按 F12 打开开发者工具，在 Network（网络）中刷新题目页面。</li><li>选择该站点的 graphql 请求，在 Request Headers 中复制 Cookie 的值；只复制单行 Cookie。</li><li>粘贴到上面的输入框，点击“验证并连接”。登录过期时重新复制即可。</li></ol></details>
    <div className="integration-boundary"><strong>运行与提交分别记录</strong><p>运行验证官方示例或你填写的输入；提交由力扣系统评测，并写入力扣提交记录。只有你主动确认才会提交。完整隐藏用例不支持下载。</p></div>
    {error && <div className="auth-error" role="alert">{error}</div>}{notice && <div className="auth-message" role="status">{notice}</div>}
  </section>;
}
