import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('public/monaco', { recursive: true });
cpSync('node_modules/monaco-editor/min/vs', 'public/monaco/vs', { recursive: true });
