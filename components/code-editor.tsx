'use client';
import Editor, { loader } from '@monaco-editor/react';
loader.config({ paths: { vs: '/monaco/vs' } });
export default function CodeEditor({ value, language, dark, readOnly, onChange }: { value: string; language: string; dark: boolean; readOnly: boolean; onChange: (value: string) => void }) {
  return <Editor height="100%" language={language === 'cpp' ? 'cpp' : 'python'} value={value} theme={dark ? 'vs-dark' : 'vs'} onChange={value => onChange(value || '')} loading={<div className="editor-loading">正在打开编辑器…</div>} options={{ readOnly, fontFamily: 'Consolas, monospace', fontSize: 13, lineHeight: 23, minimap: { enabled: false }, padding: { top: 20 }, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: 'on', tabSize: 4, renderLineHighlight: 'none', overviewRulerLanes: 0, folding: false }} />;
}
