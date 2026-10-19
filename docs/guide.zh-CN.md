# 知序 · 算法学习工作台 — 中文详解

> 面向 C++ / Python 学习者的个人本地应用。复制力扣题目，逐层获得引导，
> 在编辑器里尝试解法，并保存学习记录与复盘。英文首屏见 [`README.md`](../README.md)。

## 目录

- [启动](#启动)
- [使用 ChatGPT 账号授权](#使用-chatgpt-账号授权)
- [使用 DeepSeek](#使用-deepseek)
- [兼容其他服务的 API 密钥](#兼容其他服务的-api-密钥可选)
- [已实现功能](#已实现功能)
- [算法动态演示](#算法动态演示)
- [解法优化与复杂度分析](#解法优化与复杂度分析)
- [自动保存与复盘笔记](#自动保存与复盘笔记)
- [学习备份与恢复](#学习备份与恢复)
- [复习安排与回想练习](#复习安排与回想练习)
- [验证（QA）](#验证qa)
- [架构与边界](#架构与边界)
- [开源传播与部署（Docker / CI / 静态 Demo）](#开源传播与部署)

---

## 启动

需要 Node.js 20+、Python 3.11+。Windows 双击 `start.cmd`，首次缺少依赖时会
自动安装；脚本构建正式版本，准备好后打开 http://127.0.0.1:3000。使用
Ctrl+C 停止服务。日志保存在 `artifacts/`。后端依赖版本由
`backend/constraints-tested.txt` 固定，启动器会检查与准备已验证的依赖集。

重复双击 `start.cmd` 会打开正在运行的知序，避免重复启动。代码更新后双击
`restart.cmd`：它先确认端口占用属于本项目，再停止旧服务、重新构建并启动。
旧版本启动器遗留的本项目服务也会自动清理；若端口属于其他程序，脚本会明确
报错并保留该程序。此过程不删除数据库或账号凭据。服务意外退出会提示日志
位置。不要同时启动多份后端。

也可以在项目根目录分别启动：

```powershell
# 后端
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

# 另一个终端：前端
npm install
npm run dev
```

## 使用 ChatGPT 账号授权

重新启动项目后，进入「学习设置」，点击 **Continue with ChatGPT**。浏览器
打开 OpenAI 官方页面，由你本人登录、选择工作区并同意授权；页面返回本机
回调后，知序自动更新状态并读取此账号可用的模型。新题、追问和代码审阅会
使用所选账号的 ChatGPT 授权，不自动改用 API 密钥计费。

是否可用取决于 OpenAI 的账号、套餐、工作区、地区和预览权限判断，不能保证
所有账号都能授权。符合条件的请求使用 ChatGPT 套餐或用户允许的额度；用量和
应用权限可在 [ChatGPT 用量设置](https://chatgpt.com/settings/usage) 中管理。
此方式不会继承你在 ChatGPT / Codex 的现有对话。

必须通过 `http://127.0.0.1:3000` 打开本地应用，后端监听 `127.0.0.1:8000`；
官方回调为 `http://127.0.0.1:8000/auth/callback`。OAuth 使用 state、nonce、
PKCE、签名 / issuer / audience / 有效期校验；首次动态注册后保存实际 issued
client ID，并在之后的登录中复用。授权中断或身份验证失败不会替换原账号。

Windows 的账号凭据保存在 `%LOCALAPPDATA%\Zhixu\chatgpt\credentials.dat`，
使用 Windows DPAPI 加密并绑定当前 Windows 用户；不写入题目数据库，不返回
浏览器，不读取 Codex 登录信息或 ChatGPT cookies。其他系统使用仅当前用户
可读的本地文件。重启后复用账号注册并在需要时续期。此后端仅支持单进程运行，
以串行刷新 rotating refresh token。

设置页支持选择保存的账号、添加账号、重新授权、从当前账号目录选择模型、
退出登录。退出会尝试远程撤销，失败时明确提醒并清除本机 tokens，保留账号
注册和学习数据。更换 Windows 用户或迁移电脑时需要重新授权；备份学习数据
只需复制数据库，不能依靠复制加密凭据迁移登录。

可通过 `ZHIXU_AUTH_DIR` 指定凭据目录，通过 `CHATGPT_CALLBACK_PORT` /
`ZHIXU_FRONTEND_PORT` 配置测试端口。线上网站不能照搬本地回调方案，需要
相应注册和访问控制。

实现依据：[官方注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、
[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、
[账号与续期](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、
[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。
ChatGPT OAuth 使用公开 `POST /v1/responses`，`store=false`、`stream=true`，
读取成功终止事件后才保存讲解。

## 使用 DeepSeek

进入「学习设置 → 使用 DeepSeek」，有两种明确不同的方式：

- **网页版转接**：点击「使用 DeepSeek 网页版转接」。做题或优化时，知序准备
  包含题目、C++ / Python 代码、学习进度与讲解偏好的提问。复制后到
  [官方网页版](https://chat.deepseek.com/) 发送，再将完整回复粘贴回知序。
  这个流程需要手动复制和粘贴，不自动调用 API；网页版是否免费、可用及其
  限制以 DeepSeek 当前说明为准。
- **官方 API 自动回复**：展开「自动回复：DeepSeek 官方 API」，填写开放平台
  密钥并选择 Flash 或 V4 Pro。官方 API 按用量收费，赠送余额优先抵扣，不保证
  账户有赠额或永久免费。[官方接入说明](https://api-docs.deepseek.com/)、
  [官方计费说明](https://api-docs.deepseek.com/quick_start/pricing/)。

DeepSeek API 密钥独立保存在本机 `backend/.env` 的 `DEEPSEEK_API_KEY`，不会
覆盖其他服务的密钥或 ChatGPT 授权。保存配置不代表已经完成真实推理测试。

网页版待导入任务存入 SQLite `external_exchanges` 表，刷新或重启可继续。导入
时检查题目、语言、当前代码和学习进度，成功导入才推进提示；优化分成分析与
生成两阶段，要求完整 JSON，格式失败不覆盖代码或生成虚假报告。用户可以收起
任务，稍后点击「继续 DeepSeek 转接」。

## 兼容其他服务的 API 密钥（可选）

打开「学习设置」，展开「其他连接方式：API 密钥」，填写兼容 OpenAI Chat
Completions 的服务地址（包含 `/v1` 或服务商要求的对应路径）、模型名称和 API
密钥，点击「保存并使用 API 模式」。密钥保存到 `backend/.env`，不返回给浏览器，
不在版本控制中。API 调用单独计费，不使用 ChatGPT 套餐。页面保存状态不代表
已经测试连通；首次请求时会校验实际连接。

也可将 `backend/.env.example` 复制为 `backend/.env` 后填写，将 `AI_PROVIDER`
设为 `api_key` 并重启后端。模型默认名称是配置示例，可替换为服务商账户实际
可用的模型。

尚未授权 ChatGPT 或配置 API 时，两数之和、有效的括号、二分查找提供人工编写
的四层提示、C++ / Python 完整解答和已学内容总结。示例不是实时 AI 回复。任意
新题、自由追问、讲简单一点和代码审阅需要模型连接，未配置时会明确提示。

## 已实现功能

- 首页题目输入、示例题入口、真实学习统计、继续上次学习；记录可手动刷新，
  导航读取最新列表。服务读取失败不会显示虚假的零数量。
- 三栏工作台，手机端切换题目 / 引导 / 代码，支持深色模式。
- 四层提示：理解、朴素思路、关键观察、伪代码。完整题解由用户主动打开。
- 模型根据语言、基础、讲解偏好、历史消息、题目和代码提供引导。
- 本地 Monaco 编辑器，C++ / Python 草稿分别自动保存；断网时保留各窗口独立
  的本地副本，重载可恢复，版本冲突先比较再保存。
- 题目记录搜索、学习中 / 已掌握筛选、删除、复盘笔记与教练总结。
- SQLite 持久化，刷新可通过 URL 恢复会话；设置页可下载并预览恢复学习 JSON
  备份。数据库位于 `backend/zhixu.db`，停止服务后也可复制数据库备份。
- 模型错误不推进提示层级，重试不会凭空产生成功回复。

## 三大创新功能

### 1. 离线优先读缓存

题目列表、学习记录、题库与学习偏好在成功读取后会自动写入浏览器 IndexedDB
（命名空间 `zhixu-read-cache`，与 localStorage 的写侧草稿完全隔离）。断网或
后端未启动时，这些只读数据会自动回退到上次缓存，页面顶部 / 题库页会提示
「当前显示离线缓存」。缓存只读、不回写：离线时未保存的代码 / 笔记 / 输入
仍由原有草稿体系负责，二者互不干扰。缓存上限 200 条并做 30 天懒清理，SSR、
隐私模式或旧浏览器下自动降级为进程内 Map，不影响正常使用。

### 2. 算法演示分享链接与嵌入卡片

算法演示支持把「算法 + 输入 + 播放位置」编码进 URL hash：

```text
#alg=two-pointers&values=1,2,4,7,11,15&target=15&step=5
```

在主应用的算法演示与算法实验室点「分享 / 复制链接」即可复制；静态 demo 页
还提供「嵌入代码」，可粘贴为 `<iframe>` 嵌入任意网页。打开分享链接会直接进入
对应演示并定位到指定步骤；非法链接自动回落到画廊，绝不报错。`#embed=1` 或
被 iframe 引用时会隐藏站点页眉页脚，只保留演示画面。

### 3. 题目知识图谱关联

打开一道题时，题目面板底部会自动给出「相关题目」：同分类的其他算法（可一键
打开实验室演示）、匹配算法的配套练习（入门 / 强化题意建议），以及「这题用的
技巧之前在哪几题见过」（按共同标签数、难度递进与最近更新时间排序，可点击
跳回原记录）。纯前端推导，不新增后端接口。

## 算法动态演示

在做题页中央选择「算法演示」。算法实验室支持十种独立经典例子：无序两数之和
的哈希表、有序两数之和的双指针、闭区间二分查找、有效括号栈、爬楼梯动态规划、
最长不重复子串滑动窗口、网格最短路径 BFS，以及归并排序、快速排序、区间调度
贪心。每张算法卡片同时给出一道入门理解题和一道强化题，方便从看懂步骤过渡到
独立练习。内置「两数之和」默认选择哈希表，保持原数组下标；有序双指针作为
另一种明确需要升序条件的演示保留。无需连接 AI；演示不自动解析任意粘贴题目，
也不执行或替换当前草稿。

画面展示指针位置、候选区间、栈的出入、DP 的来源与写入，同时说明每一步为什么
成立。可播放 / 暂停、回退 / 单步、调整速度、拖动时间轴、跳到开头或结尾；可
展开 C++ / Python 核心代码查看当前执行行。播放时优先显示画布与步骤说明；查看
核心代码时保持阅读位置。切换标签、改变输入或离开可见页面时停止旧计时器，刷新
恢复为暂停。

点击「修改输入」可以改数组、目标、括号、台阶数、区间列表或网格，再点击「应用
输入」重置演示。数组最多 12 个整数，允许重复值与空数组；哈希表演示允许无序且
保留原始下标，双指针 / 二分必须升序，归并排序 / 快速排序允许无序；括号只接受
英文 `()[]{}`，最多 16 个字符；台阶范围为 0～20，0 层按一种空路径定义。区间
调度最多 10 个 `start-end` 区间，按结束时间排序后展示贪心选择。非法输入不覆盖
当前演示。有序两数之和返回从 0 开始的下标，不能直接套到无序原题；二分重复值
返回其中一个匹配位置。滑动窗口限定最多 12 个英文字母 / 数字、大小写不同，空串
长度为 0，使用固定的 128 项 ASCII 字符表。BFS 最大 5×5 格，. 为通路、# 为
障碍、S / E 为唯一起点 / 终点；一个 B 表示两者同格。每次上下左右移动一格，
返回最少移动次数，不可达为 -1，同格为 0。

每题已应用的示例、当前位置、速度和平滑动画选择存入当前浏览器的
`zhixu-animation-题目ID`，刷新或服务重启可继续。动画平滑过渡默认开启，以回应
用户明确要求；关闭「平滑动画」可直接读取静态步骤。页面显示的复杂度指算法本身，
状态快照另占演示存储。

示例定义参考：[有序两数之和](https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/)、
[二分区间约定](https://cp-algorithms.com/num_methods/binary_search.html)、
[有效括号](https://leetcode.com/problems/valid-parentheses/)、
[爬楼梯](https://leetcode.com/problems/climbing-stairs/)。0 层、空数组 / 空串与
重复值是演示补充的边界例子，使用规则在界面内明确说明。

## 解法优化与复杂度分析

写出自己的完整解法后，在中央面板切换到「解法优化」，或点击编辑器下方的
「我已写出解法，分析复杂度并优化」。选择效率与可读性兼顾、优先时间、优先
空间或优先精炼代码；可以声明此版本已经在力扣通过。

1. 点击「分析当前解法」：保存当前草稿，解释输入规模、当前时间与辅助空间
   复杂度、瓶颈、逐步优化方案、目标复杂度与取舍。第一阶段不提供完整替换代码。
2. 点击「生成精炼代码」：根据同一份代码快照和分析，生成 C++17 或 Python 3
   优化版本，提供复杂度推导、正确性依据、命名与结构改动、具体边界检查。
3. 点击「采用此版本」才会替换并保存当前编辑器代码。采用后可以「恢复原代码」；
   报告中也可以展开或复制原版本。

优化记录存放在 SQLite 的 `optimization_reports` 表中，重启和刷新后仍可查看。
每份记录包含语言、目标、阶段、完整原代码和结构化分析 / 优化代码。代码、语言
或目标变化后，不能直接沿用旧分析生成新代码；报告与当前草稿不一致时禁止直接
采用，避免覆盖新修改。删除题目时一起删除其报告。

优化支持已连接的 ChatGPT、DeepSeek / 兼容 API 或 DeepSeek 网页版转接，示例题
不会仅凭题目名称套用固定优化结论。分析是静态 AI 推导，不执行代码，不编造跑分、
力扣排名或测试通过。已经达到合理最优时可以保留算法，只改善清晰度；更短的代码
不等同于更低复杂度。

## 自动保存与复盘笔记

代码与笔记编辑 900ms 后自动保存。保存期间继续输入保留最新内容；断网 / 服务
错误保留本地副本并说明失败。每个页面的代码、笔记、题目输入、提问和复习观察
缓存独立，重载可找回该页的草稿，新页面也可以预览并恢复其他窗口保留的草稿。
浏览器禁止存储时会明确提示，已保存的数据仍在 SQLite。

另一个窗口改过同一字段时，选择比较服务器版本、保留本地或使用服务器版本；通常
会保留原本地内容的恢复副本。题目创建时间与代码 / 笔记版本共同校验，删除后
复用编号也不能把旧窗口的编辑写进新题。只有其他字段同时保存、当前字段仍匹配时
才做有限重试。

「复盘笔记」支持可填写的提纲、Markdown 预览、Ctrl+S、下载 Markdown。提纲不生成
虚假观察 / 复杂度；导出可附带已保存的 C++ / Python 代码。AI 总结出现在引导对话
中，由你决定怎样写进笔记。

## 学习备份与恢复

进入学习设置 → 学习数据备份，下载带完整性校验值的 JSON。包含题目、双语代码、
对话、笔记、优化报告、复习安排 / 历史与学习偏好；不包含账号凭据、API 密钥、
浏览器布局、尚未上传的本地编辑和待导入转接任务。

选择备份后先预览，可挑选恢复的记录，学习偏好单独勾选。完全相同的记录跳过，
改过的已有记录保留，旧版本作为新记录追加；不会用备份覆盖已有数据。预览后数据
变化要求重新预览；导入整批提交，失败回滚。格式 v2 兼容原始 v1，单次最多 20 MB、
2,000 条记录。

也提供本机一致性快照脚本 `python scripts/database-snapshot.py backup`（建议使用
`.venv` 中的 Python）。它通过 SQLite 在线备份生成数据库副本和逐表校验清单，不
复制账号凭据。升级后可用 `check --baseline backups/对应文件.verification.json`
核对；比较失败时只报告差异，不覆盖数据库。

## 复习安排与回想练习

在题目操作菜单「加入复习计划」，或在我的复盘页从已有题目选择。计划来自你明确
加入的题目，没有自动编造默认计划。

回想练习先显示题目，笔记由你主动展开；可以记下这次的卡点，再按实际感受自评。
规则直接展示：忘了 10 分钟后重试，还不熟 1 天后；基本想起依次间隔
1 / 3 / 7 / 14 / 30 天，很熟悉跳一档。规则是本应用的透明固定安排，不声称科学
预测个人记忆。自评不会自动改变代码、提示阶段或掌握标签。

待复习 / 接下来 / 全部安排可筛选搜索。今日复习统计按北京时间计算真实记录。
暂停计划保留历史，重新加入从第一次回想开始。多个窗口不能把同一次自评重复计入。

新增演示定义参考：[最长不重复子串题目](https://leetcode.com/problems/longest-substring-without-repeating-characters/)、
[BFS 作者教程](https://cp-algorithms.com/graph/breadth-first-search.html)、
[C++ 无序关联容器复杂度要求](https://eel.is/c++draft/unord.req)。滑动窗口的
字符范围与长度、BFS 小网格和 B 同格标记是为了清晰演示而采用的输入约定，未声称
覆盖原题的全部输入范围。

## 验证（QA）

```powershell
npm run typecheck
npm run build
npm run test:algorithms
npm run test:demo-code # 本机需要 g++；实际核对内置 C++17 / Python 片段
.\.venv\Scripts\python.exe -m pytest backend\tests -q
# 建议使用独立数据库与凭据目录的 QA 服务（另一个终端运行）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/qa-start.ps1
# QA ready 后运行
npx playwright install chromium
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3001"
npm run test:e2e
# 可选的长时间实际浏览器检查，只操作 3001 的独立 QA 数据
node scripts/soak-workspace.mjs --minutes 90
# 精确进程识别、实际隔离启停（需要先构建 QA）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-service-ownership.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-service-lifecycle.ps1
```

后端测试使用临时独立数据库、配置文件及凭据目录；模型成功 / 失败路径用模拟接口
验证，不产生付费模型调用。浏览器测试创建并删除自己的测试会话。截图输出到
`artifacts/`。QA 服务使用 3001 / 8001、`.next-qa`、`artifacts/qa/zhixu.db` 与
隔离的 `.env` / 凭据，不改正式 3000 / 8000 服务。`ZHIXU_CONFIG_FILE` 可指定
独立后端配置文件。

## 架构与边界

前端 Next.js + React + TypeScript；`/api` 代理到 FastAPI；SQLAlchemy 管理数据。
`BACKEND_URL` 可配置前端代理目标。`DATABASE_URL` 可配置其他 SQLAlchemy 数据库
地址；PostgreSQL 需要额外安装驱动，首次建表自动完成。当前没有数据库版本迁移
系统，更新表结构前应备份并添加迁移。

这是个人本地版本，服务绑定到 `127.0.0.1`，没有账号系统。公开部署前需要登录
鉴权、请求配额、正式数据库迁移和密钥管理，不能直接把当前管理接口公开到互联网。

代码审阅是 AI 静态分析，没有代码执行沙箱，不声称测试通过；请到力扣提交验证。
ChatGPT 接口以 SSE 流读取，前端在收到完整成功回复后整段展示。提示进度表示已
阅读的提示深度，不等同于能力评分；掌握状态由用户自行标记。

视觉设计参考安装的 Anthropic `frontend-design` skill，具体方案在 `docs/design.md`。
图形用原生 SVG 实现。编辑器静态资源在安装时从本地依赖复制，不依赖 Monaco CDN；
Google 字体不可访问时自动使用系统中文字体。

界面采用宣纸纹理、淡墨山水、竹影与朱砂印章，配有深色夜墨主题。桌面光标为 32px
小毛笔，笔尖对应点击位置；任意位置点击均有动态淡墨水波，支持鼠标、键盘、触屏。
「学习设置」可选动态 / 跟随系统 / 关闭；动态默认开启，即使 Windows 关闭系统动画
也仍然播放。装饰资源存放在 `public/ink/`，无需外部图片服务。

进入做题页后，桌面仅显示题目、引导、代码三个区域，铺满浏览器视口。题目栏左侧
返回首页，右侧操作菜单提供笔记、加入复习、掌握状态、连接设置和说明。手机保留
三个区域的切换标签。

桌面可按住模块之间的细线拖动：侧栏、首页与设置分栏、做题的题目 / 引导 / 代码
三栏均可调整宽度；引导内容 / 追问区、代码 / 操作区、优化报告 / 操作区可调整
高度，首页和设置卡片的底部边界也可以拖动。双击边界恢复默认，聚焦边界后用方向键
微调（Shift 加速，Home 或 Enter 恢复）。布局保存到当前浏览器，刷新和重新启动后
继续使用；手机采用单栏自然高度与标签切换。

## 开源传播与部署

### Docker 一条命令启动

```bash
docker compose up --build
```

- 前端：`node:22-alpine` 两阶段构建，容器内监听 `0.0.0.0:3000`，宿主机仅映射
  `127.0.0.1:3000`。
- 后端：`python:3.13-slim`，容器内监听 `0.0.0.0:8000`，宿主机仅映射
  `127.0.0.1:8000`；数据库固定在卷 `/data` 的 `zhixu.db`。
- 前端通过 Next rewrite 把 `/api/*` 代理到 `http://backend:8000`。

> Docker 内默认不携带 `.env`，AI 未配置时会走「无模型提示 + 算法演示」的降级
> 路径，属预期行为。ChatGPT OAuth 凭据在 Linux 容器内降级为 0600 文件（非
> DPAPI），如需持久化 OAuth 请挂载 `ZHIXU_AUTH_DIR` 卷。

### CI

`.github/workflows/ci.yml` 在 push / PR 到 `main` 时运行：

- frontend：`npm ci` → `typecheck` → `test:algorithms` → `test:demo-code` →
  `build:demo`。
- backend：`pip install -r backend/requirements.txt` → `pytest backend/tests -q`。
- E2E：`workflow_dispatch` 手动触发占位，默认不跑浏览器测试。

### 静态算法演示 Demo

`demo/` 是一个纯静态、零依赖的独立页面，用 esbuild 把 `lib/algorithm-traces.ts`、
`lib/additional-traces.ts`、`lib/algorithm-catalog.ts` 打包成 `window.ZhixuAlgos`，
因此**演示数据与主应用完全同源**，不复制任何算法逻辑。

```bash
npm run build:demo     # 产出 demo/algos.js（构建产物，不入库）
# 然后直接用任意静态服务器打开 demo/ 目录，例如：
# npx serve demo
```

`.github/workflows/pages.yml` 在推送到 `main` 且改动 `demo/` / `lib/` 时，把
`demo/` 部署到 GitHub Pages（`baiyujing-rain/zhixu`）。

> 注意：仓库为 Private 时，GitHub Pages 需要付费套餐（Pro / Team / Enterprise）。
> 若想免费发布 Demo，需先将仓库转为 Public。P0 已把 `pages.yml` 与
> `build:demo` 准备好，发布动作由仓库所有者决定可见性后执行。

### License

[MIT](../LICENSE) · © 2026 zhixu contributors
