import { build } from 'esbuild';

// Bundle the single public entry into self-contained ESM and CJS builds.
// tsc (run before this script) produces the matching .d.ts declarations.
const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  sourcemap: true,
  target: ['es2020'],
  logLevel: 'info',
};

await build({ ...shared, format: 'esm', outfile: 'dist/index.mjs' });
await build({ ...shared, format: 'cjs', outfile: 'dist/index.cjs' });
