import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { coreCode, DEFAULT_INPUTS, parseGrid } from 'zhixu-algo-viz';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'artifacts', 'demo-code-verification');
await fs.mkdir(directory, { recursive: true });
const cases = [];
function arrays(length, minimum = -2, prefix = [], result = []) {
  if (!length) { result.push(prefix); return result; }
  for (let value = minimum; value <= 2; value++) arrays(length - 1, value, [...prefix, value], result);
  return result;
}
for (let length = 0; length <= 5; length++) for (const values of arrays(length)) {
  for (let target = -5; target <= 5; target++) {
    let exists = false;
    for (let left = 0; left < values.length; left++) for (let right = left + 1; right < values.length; right++) if (values[left] + values[right] === target) exists = true;
    cases.push({ algorithm: 'two-pointers', values, target, exists });
  }
  for (let target = -4; target <= 4; target++) cases.push({ algorithm: 'binary-search', values, target, exists: values.includes(target) });
}
function reduced(text) {
  while (true) { const next = text.replace(/\(\)|\[\]|\{\}/g, ''); if (next === text) return text.length === 0; text = next; }
}
function enumerateBrackets(text, remaining) {
  cases.push({ algorithm: 'brackets', text, expected: reduced(text) });
  if (remaining) for (const char of '()[]{}') enumerateBrackets(text + char, remaining - 1);
}
enumerateBrackets('', 4);
function paths(n) { if (n === 0) return 1; if (n < 0) return 0; return paths(n - 1) + paths(n - 2); }
for (let n = 0; n <= 20; n++) cases.push({ algorithm: 'stairs', n, expected: paths(n) });
function longest(text) {
  let best = 0;
  for (let first = 0; first < text.length; first++) for (let end = first + 1; end <= text.length; end++) {
    const value = text.slice(first, end); if (new Set(value).size === value.length) best = Math.max(best, value.length);
  }
  return best;
}
function enumerateWindow(text, remaining) {
  cases.push({ algorithm: 'sliding-window', text, expected: longest(text) });
  if (remaining) for (const char of 'abc') enumerateWindow(text + char, remaining - 1);
}
enumerateWindow('', 7);
for (const text of ['Aa0Aa1Bb2', 'abcdefghijkl', 'aaaaaaaaaaaa', '012345678901']) cases.push({ algorithm: 'sliding-window', text, expected: longest(text) });
function addGrid(input) {
  const grid = parseGrid(input), distances = Array(grid.width * grid.height).fill(Infinity);
  distances[grid.start] = 0;
  // Bellman-style repeated relaxation, independent of the queue implementation.
  for (let iteration = 0; iteration < distances.length; iteration++) for (let cell = 0; cell < distances.length; cell++) {
    const row = Math.floor(cell / grid.width), col = cell % grid.width;
    if (grid.rows[row][col] === '#') continue;
    const neighbors = [];
    if (row) neighbors.push(cell - grid.width); if (row + 1 < grid.height) neighbors.push(cell + grid.width);
    if (col) neighbors.push(cell - 1); if (col + 1 < grid.width) neighbors.push(cell + 1);
    for (const adjacent of neighbors) if (grid.rows[Math.floor(adjacent / grid.width)][adjacent % grid.width] !== '#') distances[adjacent] = Math.min(distances[adjacent], distances[cell] + 1);
  }
  cases.push({ algorithm: 'bfs', grid: grid.rows, start: [Math.floor(grid.start / grid.width), grid.start % grid.width], goal: [Math.floor(grid.goal / grid.width), grid.goal % grid.width], expected: Number.isFinite(distances[grid.goal]) ? distances[grid.goal] : -1 });
}
for (let height = 1; height <= 3; height++) for (let width = 1; width <= 3; width++) {
  const size = width * height; if (size === 1) { addGrid('B'); continue; }
  for (let mask = 0; mask < 2 ** (size - 2); mask++) {
    const chars = Array.from({ length: size }, (_, index) => index === 0 ? 'S' : index === size - 1 ? 'E' : mask & (1 << (index - 1)) ? '#' : '.');
    addGrid(Array.from({ length: height }, (_, row) => chars.slice(row * width, (row + 1) * width).join('')).join('\n'));
  }
}
for (const grid of [DEFAULT_INPUTS.bfs.grid, 'S....\n.....\n.....\n.....\n....E', '..E\n.#.\nS..', 'B..\n...']) addGrid(grid);
function unordered(values, remaining) {
  for (let target = -5; target <= 5; target++) {
    let exists = false;
    for (let left = 0; left < values.length; left++) for (let right = left + 1; right < values.length; right++) if (values[left] + values[right] === target) exists = true;
    cases.push({ algorithm: 'hash-two-sum', values, target, exists });
  }
  if (remaining) for (const value of [-2, -1, 0, 1, 2]) unordered([...values, value], remaining - 1);
}
unordered([], 4);
const algorithms = ['two-pointers', 'binary-search', 'brackets', 'stairs', 'sliding-window', 'bfs', 'hash-two-sum'];
const cpp = Object.fromEntries(algorithms.map(name => [name, coreCode(name, 'cpp').map(line => line.text).join('\n')]));
const python = Object.fromEntries(algorithms.map(name => [name, coreCode(name, 'python').map(line => line.text).join('\n')]));
const fixturePath = path.join(directory, 'fixtures.json');
await fs.writeFile(fixturePath, JSON.stringify({ python, cases }));
const signatures = ['vector<int> demo0(vector<int> nums, int target)', 'int demo1(vector<int> nums, int target)', 'bool demo2(string s)', 'int demo3(int n)', 'int demo4(string s)', 'int demo5(vector<string> grid, pair<int,int> start, pair<int,int> goal)', 'vector<int> demo6(vector<int> nums, int target)'];
let source = '#include <iostream>\n#include <iomanip>\n#include <vector>\n#include <string>\n#include <queue>\n#include <utility>\n#include <algorithm>\n#include <unordered_map>\nusing namespace std;\n';
for (let index = 0; index < algorithms.length; index++) source += `${signatures[index]} {\n${cpp[algorithms[index]]}\n}\n`;
source += `int main() { int type; while (cin >> type) {
  if (type == 0 || type == 1 || type == 6) { int n, target; cin >> n >> target; vector<int> values(n); for (auto &v : values) cin >> v;
    if (type == 0 || type == 6) { auto answer = type == 0 ? demo0(values, target) : demo6(values, target); if (answer.empty()) cout << "-"; else cout << answer[0] << "," << answer[1]; }
    else cout << demo1(values, target);
  } else if (type == 2 || type == 4) { string value; cin >> quoted(value); if (type == 2) cout << (demo2(value) ? 1 : 0); else cout << demo4(value);
  } else if (type == 3) { int n; cin >> n; cout << demo3(n);
  } else { int rows, cols, sr, sc, gr, gc; cin >> rows >> cols >> sr >> sc >> gr >> gc; vector<string> grid(rows); for (auto &row : grid) cin >> row; cout << demo5(grid, {sr,sc}, {gr,gc}); }
  cout << '\\n';
} return 0; }`;
const sourcePath = path.join(directory, 'built-in-demos.cpp'), binaryPath = path.join(directory, process.platform === 'win32' ? 'built-in-demos.exe' : 'built-in-demos');
await fs.writeFile(sourcePath, source);
const compiler = process.env.ZHIXU_CXX || 'g++';
execFileSync(compiler, ['-std=c++17', '-O2', '-Wall', '-Wextra', '-pedantic', sourcePath, '-o', binaryPath], { cwd: root, timeout: 60000, encoding: 'utf-8' });
const input = cases.map(value => {
  const type = algorithms.indexOf(value.algorithm);
  if (type <= 1 || type === 6) return `${type} ${value.values.length} ${value.target} ${value.values.join(' ')}`;
  if (type === 2 || type === 4) return `${type} ${JSON.stringify(value.text)}`;
  if (type === 3) return `${type} ${value.n}`;
  return `${type} ${value.grid.length} ${value.grid[0].length} ${value.start.join(' ')} ${value.goal.join(' ')} ${value.grid.join(' ')}`;
}).join('\n') + '\n';
const output = execFileSync(binaryPath, [], { input, cwd: root, timeout: 60000, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 }).trimEnd().split(/\r?\n/);
assert.equal(output.length, cases.length);
const counts = {};
for (let index = 0; index < cases.length; index++) {
  const value = cases[index], answer = output[index];
  if (value.algorithm === 'two-pointers' || value.algorithm === 'hash-two-sum') {
    assert.equal(answer !== '-', value.exists);
    if (value.exists) { const pair = answer.split(',').map(Number); assert.equal(pair.length, 2); assert.ok(Number.isInteger(pair[0]) && Number.isInteger(pair[1]) && 0 <= pair[0] && pair[0] < pair[1] && pair[1] < value.values.length); assert.equal(value.values[pair[0]] + value.values[pair[1]], value.target); }
  } else if (value.algorithm === 'binary-search') {
    const position = Number(answer); assert.ok(Number.isInteger(position)); assert.equal(position >= 0, value.exists); if (position >= 0) assert.equal(value.values[position], value.target);
  } else assert.equal(Number(answer), Number(value.expected), JSON.stringify(value));
  counts[value.algorithm] = (counts[value.algorithm] || 0) + 1;
}
const cppResult = { language: 'C++17', total: cases.length, cases: counts };
console.log(JSON.stringify(cppResult));
const pythonPath = process.env.ZHIXU_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const pythonResult = JSON.parse(execFileSync(pythonPath, [path.join(root, 'scripts', 'verify-demo-code.py'), fixturePath], { cwd: root, timeout: 60000, encoding: 'utf-8' }));
console.log(JSON.stringify(pythonResult));
await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify({ checked_at: new Date().toISOString(), cpp: cppResult, python: pythonResult }, null, 2));
