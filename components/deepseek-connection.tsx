'use client';
import { useState } from 'react';
import { ExternalLink, Loader2, Waves } from 'lucide-react';
export default function DeepSeekConnection({ provider, configured, initialModel, onChange }: { provider: string; configured: boolean; initialModel: string; onChange: () => Promise<void> }) {
  const [key, setKey] = useState(''), [model, setModel] = useState(initialModel || 'deepseek-flash'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(web: boolean) {
    setBusy(true); setError('');
    try {
      const response = await fetch(web ? '/api/settings/provider' : '/api/settings/deepseek', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(web ? { provider: 'deepseek_web' } : { model, ...(key.trim() ? { api_key: key.trim() } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '连接设置未保存。');
      setKey(''); await onChange();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="card settings-card deepseek-card"><div className="section-heading"><h2><Waves size={20} />使用 DeepSeek</h2><span className="subtle-badge">{provider === 'deepseek_web' ? '正在使用网页版转接' : provider === 'deepseek' ? '正在使用官方 API' : '两种使用方式'}</span></div>
    <h3>网页版转接</h3><p className="settings-description">使用你熟悉的 DeepSeek 网页版。知序准备提问，你在官方网页发送，再把回复粘贴回来，提示和优化记录会保存在这里。需要手动复制和粘贴。</p>
    <button className="secondary-button" disabled={busy} onClick={() => void save(true)}>{busy && <Loader2 className="spin" size={15} />}{provider === 'deepseek_web' ? '已选择网页版转接' : '使用 DeepSeek 网页版转接'}</button>
    <details className="deepseek-api"><summary>自动回复：DeepSeek 官方 API（按量计费）</summary><p className="settings-description">自动分步引导与代码优化需要官方 API 密钥。有赠送余额时优先抵扣，用完后按官方价格收费。</p>
      <label>DeepSeek 模型<select aria-label="DeepSeek 模型" value={model} onChange={e => setModel(e.target.value)}><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label>
      <label>DeepSeek API 密钥<input aria-label="DeepSeek API 密钥" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={configured ? '留空保留已保存密钥' : '从官方开放平台创建密钥'} /></label>
      <div className="settings-save"><a className="text-button" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">创建官方密钥<ExternalLink size={13} /></a><button className="primary-button" disabled={busy || (!configured && !key.trim())} onClick={() => void save(false)}>保存并使用 DeepSeek API</button></div>
      <p className="form-note"><a href="https://api-docs.deepseek.com/quick_start/pricing/" target="_blank" rel="noreferrer">查看官方计费说明</a> · 密钥仅保存在本机后端。</p>
    </details>{error && <p className="auth-error" role="alert">{error}</p>}
  </section>;
}
