import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

// Bundle the three pure-TypeScript algorithm modules into a single browser
// global so the static demo page shares the exact same data/logic as the app.
// No React, backend, or AI code is imported by these modules.
mkdirSync('demo', { recursive: true });

await build({
  entryPoints: ['demo/demo-entry.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'ZhixuAlgos',
  target: ['es2020'],
  outfile: 'demo/algos.js',
  logLevel: 'info',
});

console.log('demo/algos.js built (window.ZhixuAlgos).');
