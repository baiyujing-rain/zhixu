'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleUserRound, ExternalLink, Loader2, LogOut, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';

type AuthStatus = {
  connected: boolean; plan_enabled: boolean; pending: boolean; error: string | null;
  account: { id: string; email: string; model?: string | null } | null;
  accounts: { id: string; email: string; connected: boolean }[];
};
type Catalog = { models: { slug: string; display_name: string }[]; selected: string };
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch { throw new Error(response.ok ? '登录服务返回了无效的结果，请刷新页面后重试。' : `登录服务暂时不可用（HTTP ${response.status}），请稍后重试。`); }
  if (!response.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : `请求没有完成（HTTP ${response.status}），请稍后重试。`);
  return result as T;
}

export default function ChatGPTConnection({ provider, onChange }: { provider: string; onChange: () => Promise<void> }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [welcome, setWelcome] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;
  const lastAccount = useRef('');
  const welcomedAccounts = useRef(new Set<string>());

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const result = await request<AuthStatus>('/auth/status');
        if (stopped) return;
        setStatus(result);
        const identity = `${result.account?.id || ''}:${result.connected}:${result.plan_enabled}`;
        if (lastAccount.current !== identity) {
          lastAccount.current = identity;
          await callbackRef.current();
        }
        if (result.plan_enabled && result.account) {
          const marker = `zhixu-plan-welcome:${result.account.id}`;
          if (!welcomedAccounts.current.has(result.account.id)) {
            try { if (!localStorage.getItem(marker)) setWelcome(true); }
            catch { setWelcome(true); }
          }
        }
      } catch (e) { if (!stopped) setError((e as Error).message); }
      finally { if (!stopped) timer = setTimeout(check, 2000); }
    }
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let stopped = false;
    if (!status?.plan_enabled) { setCatalog(null); return; }
    setModelsBusy(true);
    setError('');
    request<Catalog>('/auth/models').then(async result => { if (!stopped) { setCatalog(result); await callbackRef.current(); } }).catch(e => { if (!stopped) setError(e.message); }).finally(() => { if (!stopped) setModelsBusy(false); });
    return () => { stopped = true; };
  }, [status?.account?.id, status?.plan_enabled]);

  async function refreshModels() {
    setModelsBusy(true); setError('');
    try { setCatalog(await request<Catalog>('/auth/models')); await onChange(); } catch (e) { setError((e as Error).message); } finally { setModelsBusy(false); }
  }
  async function useChatGPT() {
    await request('/settings/provider', 'PUT', { provider: 'chatgpt' });
    await onChange();
  }
  async function login(options: { account_id?: string; add_account?: boolean; reconsent?: boolean } = {}) {
    // Open synchronously from the click so normal popup protection doesn't discard it.
    const loginWindow = window.open('about:blank', '_blank');
    if (loginWindow) loginWindow.opener = null;
    setBusy(true); setError(''); setMessage('');
    try {
      if (location.hostname !== '127.0.0.1') throw new Error('请使用 http://127.0.0.1:3000 打开知序，再授权 ChatGPT。');
      await useChatGPT();
      const result = await request<{ authorization_url: string }>('/auth/start', 'POST', options);
      if (!result.authorization_url.startsWith('/api/auth/authorize?')) throw new Error('授权地址未通过校验，请重新尝试。');
      setStatus(await request<AuthStatus>('/auth/status'));
      if (loginWindow) loginWindow.location.href = new URL(result.authorization_url, location.origin).href;
      else location.assign(result.authorization_url);
    } catch (e) { loginWindow?.close(); setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function selectAccount(id: string) {
    setBusy(true); setError('');
    try { setStatus(await request<AuthStatus>('/auth/account', 'POST', { account_id: id })); setCatalog(null); await useChatGPT(); setShowAccounts(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function chooseModel(model: string) {
    setBusy(true); setError('');
    try { setStatus(await request<AuthStatus>('/auth/model', 'PUT', { model })); setCatalog(previous => previous ? { ...previous, selected: model } : null); await onChange(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try { const result = await request<{ message: string }>('/auth/logout', 'POST', {}); setMessage(result.message); setStatus(await request<AuthStatus>('/auth/status')); setCatalog(null); await onChange(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function cancel() {
    try { setStatus(await request<AuthStatus>('/auth/cancel', 'POST', {})); setMessage('已取消本次登录。'); } catch (e) { setError((e as Error).message); }
  }
  function dismissWelcome() {
    if (status?.account) { welcomedAccounts.current.add(status.account.id); try { localStorage.setItem(`zhixu-plan-welcome:${status.account.id}`, 'seen'); } catch {} }
    setWelcome(false);
  }

  return <section className="card settings-card chatgpt-card">
    <div className="section-heading"><h2><ShieldCheck size={20} /> 使用你的 ChatGPT 账号</h2><span className={`status-badge ${status?.plan_enabled && provider === 'chatgpt' ? 'mastered' : 'learning'}`}>{status?.plan_enabled ? provider === 'chatgpt' ? '正在使用 ChatGPT 订阅' : '已授权，尚未启用' : status?.connected ? '需要订阅授权' : '尚未登录'}</span></div>
    <div className="chatgpt-intro"><div><h3>熟悉的账号，新的思考空间。</h3><p>在 OpenAI 官方页面登录并授权，让知序通过你的 ChatGPT 套餐提供算法引导。无需填写 API 密钥。</p></div><span className="auth-shield"><ShieldCheck size={28} strokeWidth={1.5} /></span></div>
    {welcome && <div className="plan-welcome" role="dialog" aria-label="ChatGPT 订阅使用说明"><div><Check size={20} /><strong>你正在使用 ChatGPT 订阅</strong></div><p>符合条件的 AI 请求将使用你的 ChatGPT 套餐或你允许的额度。可以随时在 ChatGPT 设置中管理知序的用量和权限。</p><button className="primary-button" onClick={dismissWelcome}>知道了</button></div>}
    {status?.account && <div className="chatgpt-account"><span className="account-avatar"><CircleUserRound size={24} /></span><div><strong>{status.account.email}</strong><small>本机保存的 ChatGPT 账号</small></div><button className="text-button" disabled={busy} onClick={() => setShowAccounts(!showAccounts)}>选择账号</button>{status.connected && <button className="icon-button" aria-label="退出 ChatGPT 登录" title="退出登录" onClick={() => void logout()} disabled={busy}><LogOut size={17} /></button>}</div>}
    {showAccounts && <div className="saved-accounts">{status?.accounts.map((account, i) => <button key={account.id} disabled={busy} onClick={() => void selectAccount(account.id)}><CircleUserRound size={17} /><span>{account.email}<small>账号 {i + 1} · {account.connected ? '已登录' : '需重新登录'}</small></span>{status.account?.id === account.id && <Check size={16} />}</button>)}<button disabled={busy} onClick={() => void login({ add_account: true })}><Plus size={16} />添加 ChatGPT 账号</button></div>}
    {status?.pending ? <div className="auth-pending"><Loader2 size={18} className="spin" /><div><strong>等待你在浏览器中完成授权</strong><p>完成后这里会自动更新。登录链接十分钟内有效。</p></div><button className="icon-button" aria-label="取消授权" onClick={() => void cancel()}><X size={17} /></button></div> : <div className="auth-actions">{!status?.connected ? <button className="chatgpt-login-button" disabled={busy || status === null} onClick={() => void login()}>{busy ? <Loader2 size={17} className="spin" /> : <CircleUserRound size={18} />} Continue with ChatGPT <ArrowUpRight size={15} /></button> : !status.plan_enabled ? <button className="chatgpt-login-button" disabled={busy} onClick={() => void login({ reconsent: true })}>开启订阅授权 <ArrowUpRight size={15} /></button> : provider !== 'chatgpt' ? <button className="primary-button" disabled={busy} onClick={() => { void useChatGPT().catch(e => setError(e.message)); }}>使用此 ChatGPT 账号</button> : null}{!status?.connected && status !== null && <button className="text-button" disabled={busy} onClick={() => void login({ add_account: true })}><Plus size={14} /> 使用另一个账号</button>}</div>}
    {status?.plan_enabled && <div className="chatgpt-model"><label>用于算法引导的模型<select aria-label="ChatGPT 模型" value={catalog?.selected || ''} disabled={busy || modelsBusy || !catalog} onChange={event => void chooseModel(event.target.value)}>{!catalog ? <option value="">{modelsBusy ? '正在加载可用模型…' : '请刷新模型列表'}</option> : catalog.models.map(model => <option key={model.slug} value={model.slug}>{model.display_name}</option>)}</select></label><button className="secondary-button" disabled={modelsBusy || busy} onClick={() => void refreshModels()}>{modelsBusy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} 刷新模型</button></div>}
    {(error || status?.error) && <div className="auth-error" role="alert">{error || status?.error}</div>}
    {message && <div className="auth-message" role="status">{message}</div>}
    <div className="auth-footer"><span>授权仅用于模型调用。做题记录仍保存在本机，账号密码由 OpenAI 处理。</span><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">管理 ChatGPT 用量 <ExternalLink size={12} /></a></div><p className="auth-eligibility">是否可用由 OpenAI 根据账号、套餐、工作区和地区判断。当前官方方案主要面向符合条件的 Plus / Pro 用户。</p>
  </section>;
}
