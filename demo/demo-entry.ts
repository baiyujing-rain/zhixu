// esbuild entry point for the static demo. The public surface is kept small
// and intentionally mirrors the window.ZhixuAlgos contract documented in
// docs/system_design.md so demo/demo.js can consume a stable global object.
export { ALGORITHMS, DEFAULT_INPUTS, buildTrace, coreCode } from '@zhixu/algo-viz';
export { ALGORITHM_CATALOG, algorithmName } from '@zhixu/algo-viz';
