# zhixu-algo-viz

智序 · 算法演示教学轨迹引擎。纯 TypeScript、零运行时依赖，产出确定、可序列化的教学演示轨迹快照（Trace）。

## 安装

```bash
npm install zhixu-algo-viz
```

## 用法

```ts
import { ALGORITHMS, DEFAULT_INPUTS, buildTrace, coreCode } from 'zhixu-algo-viz';

const trace = buildTrace('two-pointers', DEFAULT_INPUTS['two-pointers']);
// trace.frames 逐步推进，每帧含 phase / title / detail / line 与可视化坐标

const code = coreCode('two-pointers', 'cpp');
// 与帧的 line id 一一对应，用于代码高亮
```

## 主要 API

- `ALGORITHMS`：每个算法的元信息（名称 / 条件 / 原则 / 复杂度）
- `DEFAULT_INPUTS`：各算法的默认演示输入
- `ALGORITHM_CATALOG` / `algorithmName(id)`：算法目录与名称
- `buildTrace(algorithm, input)`：根据算法与输入构建演示轨迹
- `coreCode(algorithm, language)`：返回 C++ / Python 核心代码行
- 细粒度函数：`parseValues` / `parseGrid` / `parseIntervals` / `twoPointers` / `binarySearch` / `brackets` / `stairs` / `slidingWindow` / `breadthFirst` / `hashTwoSum` / `mergeSort` / `quickSort` / `intervalGreedy`

所有类型（`Algorithm` / `DemoInput` / `Phase` / `Frame` / `Trace` / `Grid` / `Interval` / `StackEntry` / `CodeLine` / `AlgorithmEntry` / `PracticePrompt`）均以类型形式导出。

## 说明

- 非法输入统一抛出中文 `Error`，消费者用 `try/catch` 承接。
- `buildTrace` 只返回纯数据快照，不执行用户代码或 AI 输出。
- 全部对外 API 一律经 `src/index.ts` 导出，请勿深路径引用内部文件。
