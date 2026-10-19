'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert, Loader2, Play, ShieldAlert, SquarePlay } from 'lucide-react';
import { api } from '@/lib/api';

type Verdict = 'accepted' | 'wrong_answer' | 'setup_error' | 'error';
type JudgeCase = {
  index: number;
  input: Record<string, unknown>;
  expected: unknown;
  actual: unknown;
  passed: boolean;
  stdout: string;
  error: string | null;
};
type JudgeResult = {
  session_id: number;
  example_id: string;
  language: string;
  status: string;
  verdict: Verdict;
  passed: number;
  total: number;
  cases: JudgeCase[];
  verification: string;
  error?: string;
};

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export default function LocalJudge({ sessionId, exampleId, language, code, createdAt, onSave }: {
  sessionId: number;
  exampleId: string | undefined;
  language: 'cpp' | 'python';
  code: string;
  createdAt: string;
  onSave: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [error, setError] = useState('');

  if (!exampleId) return null;
  const cppDisabled = language === 'cpp';

  async function run() {
    if (running || cppDisabled || !code.trim()) return;
    setRunning(true); setError(''); setResult(null);
    try {
      const saved = await onSave() as { drafts?: Record<string, string> } | null;
      const expectedCode = saved?.drafts?.[language] ?? code;
      const value = await api<JudgeResult>(`/sessions/${sessionId}/judge`, 'POST', { language, expected_code: expectedCode }, undefined, createdAt);
      setResult(value);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const verdictLabel: Record<Verdict, string> = {
    accepted: '全部样例通过',
    wrong_answer: '有样例未通过',
    setup_error: '代码未能加载',
    error: '运行未完成',
  };

  return (
    <section className="local-judge">
      <button className="local-judge-toggle" onClick={() => setOpen(!open)}>
        <span><SquarePlay size={16} />本地运行样例 · 内置示例题</span>
        <span>
          {result ? <span className={`local-judge-badge ${result.verdict}`}>{result.passed}/{result.total}</span> : '未运行'}
          <ChevronDown className={open ? 'is-open' : ''} size={16} />
        </span>
      </button>
      {open && (
        <div className="local-judge-body">
          {cppDisabled ? (
            <p className="local-judge-hint"><ShieldAlert size={14} />本地运行样例当前仅支持 Python；C++ 请用静态审阅或力扣验证。</p>
          ) : (
            <button className="secondary-button local-judge-run" disabled={running || !code.trim()} onClick={() => void run()}>
              {running ? <Loader2 className="spin" size={15} /> : <Play size={15} />}运行样例
            </button>
          )}
          {error && <div className="auth-error" role="alert">{error}</div>}
          {result && (
            <div className={`local-judge-result local-judge-${result.verdict}`} aria-live="polite">
              <div className="local-judge-summary">
                <strong>
                  {result.verdict === 'accepted' ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
                  {verdictLabel[result.verdict]} · {result.passed}/{result.total}
                </strong>
                {result.error && <p className="local-judge-error-text">{result.error}</p>}
              </div>
              {result.cases.length > 0 && (
                <ul className="local-judge-cases">
                  {result.cases.map(item => (
                    <li key={item.index} className={item.passed ? 'passed' : 'failed'}>
                      <div className="local-judge-case-head">
                        <span>样例 {item.index + 1}</span>
                        <span>{item.passed ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}{item.passed ? '通过' : '未通过'}</span>
                      </div>
                      <dl>
                        <div><dt>输入</dt><dd><code>{formatValue(item.input)}</code></dd></div>
                        <div><dt>期望</dt><dd><code>{formatValue(item.expected)}</code></dd></div>
                        <div><dt>实际</dt><dd><code>{formatValue(item.actual)}</code></dd></div>
                      </dl>
                      {item.stdout && <div className="local-judge-stdout"><span>输出</span><pre>{item.stdout}</pre></div>}
                      {item.error && <div className="local-judge-error-text">{item.error}</div>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="local-judge-verification">{result.verification}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
