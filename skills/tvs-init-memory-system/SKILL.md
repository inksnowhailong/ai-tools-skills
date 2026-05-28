---
name: tvs-init-memory-system
description: 一次性为当前项目部署"记忆系统 + codegraph 分工配合"。生成 7 件产物：子 Agent / Hook 预检脚本 / hooks.json / .memory 骨架 / codegraph 自动安装 / 分工路由 rules / 初始化基线。**显式调用、不自动触发**——仅当用户明示"运行 tvs-init-memory-system / 部署记忆系统 / init memory / 初始化项目记忆"等需求时，由用户手动唤起本 Skill；AI 不得仅因 description 关键词命中就主动加载执行。
disable-model-invocation: true
---

# tvs-init-memory-system：一次性部署记忆系统 + codegraph 分工配合

> **⚠️ 调用约束**：本 Skill **不会被 AI 自动触发**（frontmatter 已声明 `disable-model-invocation: true`）。必须由用户在对话中显式说出"运行 tvs-init-memory-system / 部署记忆系统 / 初始化项目记忆"或等价指令后，AI 才应当读入本文件并按下面流程执行。如果你（AI）只是因为对话里出现了"记忆系统"四个字就想自动跑本 Skill，请**停下**——这不在本 Skill 的允许触发范围内。

你被显式调用来为当前项目**一次性安装**项目记忆维护体系（v2：与 codegraph 分工配合）。这是一次性工程动作，跑完就结束，不是日常能力。

**调用方式**：

```text
用户在对话里说"运行 tvs-init-memory-system"或等价表达（"部署记忆系统"、"初始化项目记忆"、"装一下记忆系统"等）。
AI 读入本 SKILL.md，按下面流程逐步执行；执行完毕收尾摘要并停止，不进入日常维护态。
```

**用户传入的关键词 / 参数**（可选）：用户可一并说明阈值偏好（例如"阈值更宽松"）或运行环境（例如"PowerShell 项目，hook 用 .ps1 实现"）或 preset 切换（例如"preset=python"）。无明确参数时按下面默认方案部署。

---

## 分工边界声明（codegraph × .memory）

本系统从 v2 开始**与 codegraph 协同部署、但保持各自独立**。两套系统走完全不同的方向，互为补充，**互不依赖**。

### 设计哲学

```text
codegraph  →  代码结构事实层（机器写、机器读、秒级新鲜）
.memory    →  业务领域知识层（人/子 Agent 写、长期稳定、慢更新）

二者并行、不互相侵入。子 Agent 维护 .memory 时不调用 codegraph。
codegraph 不可用时 .memory 依然完整运行。
```

### codegraph 专长（让它答这些，.memory 不重复记录）

| 问题类型 | codegraph 入口 |
|---|---|
| X 函数 / 类 / 方法在哪定义 | `codegraph_search` |
| X 调用了什么 / 被谁调用 | `codegraph_callers` / `codegraph_callees` |
| 改 X 会影响哪些代码 | `codegraph_impact` |
| 从 X 到 Y 的调用路径是什么 | `codegraph_trace` |
| 模块 X 的代码地图（barrel、文件结构） | `codegraph_context` / `codegraph_files` |
| 某个符号的源代码 / 签名 | `codegraph_node` / `codegraph_explore` |

### .memory 专长（让它答这些，codegraph 答不出）

| 问题类型 | .memory 入口 |
|---|---|
| 这个模块**业务上**负责什么 | 模块档案 - 模块职责 |
| 项目里的术语 / 别名 / 同义词 | 术语表.md |
| 哪些模块**不能**互相调用 / 跨模块协作契约 | 模块档案 - 跨模块协作契约 |
| 为什么这块代码这么设计 / 历史决策 | 模块档案 - 设计决策 |
| 哪些边界一旦破坏会出问题 / 红线 | 模块档案 - 红线 |
| 该模块当前已知的风险 / 坑 | 模块档案 - 已知风险 |
| 项目稳定的工程风格与约定 | 项目总览.md |

### 不互相侵入原则

- **.memory 不再记录纯代码结构信息**：barrel 路径、数据源/适配器、调用链这些"AST 看一眼就知道"的内容，让 codegraph 答；.memory 只在它有业务含义时才记录（如"这个 barrel 名字本身代表领域内核边界"）。
- **子 Agent 不调用 codegraph 工具**：维护 .memory 时仍使用 Glob / rg / Read 反查源码路径。我们刻意**不把 codegraph 作为子 Agent 的依赖**，原因有二：（a）让子 Agent 调用次数保持最少；（b）保证 codegraph 未装/装失败/语言不支持时 .memory 依然能跑。
- **codegraph 自带的 `.cursor/rules/codegraph.mdc` 我们不改**：那是 codegraph 自己负责的"怎么用 codegraph 工具"指南。本命令只生成一份**分工路由**规则（见产物 6），告诉 AI"业务问题查 .memory、结构问题查 codegraph"，不与之重叠。

### 为什么明明可被替代仍然不替代

| 看似可被 codegraph 替代的能力 | 为什么我们仍**不替代** |
|---|---|
| 子 Agent "反查源码路径"用 Glob/rg/Read | 替代成 codegraph 反查会让子 Agent 调用次数变多，违背"子 Agent 调用更少"目标 |
| lint-memory 字符串模式扫描旧路径 | 同上；且 lint 是 CI / 定期任务，不应依赖 MCP 服务可用性 |
| 模块档案记 barrel / 数据源 | 这是 codegraph 强项，让 .memory 让位；但**业务含义部分**仍保留 |

---

## PRESETS（按语言/框架切换的配置预设）

本 skill 的机制层（基线 / mark-done / lint-memory / 自检 / 阈值）跟项目栈无关，但触发 PATTERNS 必须按项目栈切换，否则会出现"hook 永远不触发"或"触发频率失调"。

以下是内置的 4 个起步 preset，每个 preset 定义 5 类 PATTERNS：

### preset: nodejs-frontend

INCLUDE_PATTERNS:
- `/^src\//`, `/^app\//`, `/^pages\//`, `/^components\//`, `/^lib\//`
- `/^package(-lock)?\.json$/`, `/^pnpm-lock\.yaml$/`, `/^pnpm-workspace\.yaml$/`, `/^yarn\.lock$/`
- `/^tsconfig.*\.json$/`, `/^jsconfig.*\.json$/`
- `/^next\.config\./`, `/^vite\.config\./`, `/^nuxt\.config\./`, `/^webpack\.config\./`, `/^tailwind\.config\./`, `/^postcss\.config\./`, `/^vitest\.config\./`, `/^jest\.config\./`, `/^eslint\.config\./`
- `/^middleware\./`, `/^i18n\//`, `/^public\/images\//`, `/^public\/icons\//`

CORE_CONFIG_PATTERNS:
- `/^package(-lock)?\.json$/`, `/^pnpm-lock\.yaml$/`, `/^pnpm-workspace\.yaml$/`, `/^yarn\.lock$/`
- `/^tsconfig.*\.json$/`
- `/^next\.config\./`, `/^vite\.config\./`, `/^nuxt\.config\./`, `/^middleware\./`

ARCHITECTURE_PATTERNS:
- `/^src\/lib\/(api|stores|hooks)\//`
- `/^src\/components\/(layouts|ui)\//`
- `/^src\/app\/api\//`
- `/^src\/(auth|middleware)\//`

### preset: nodejs-backend

INCLUDE_PATTERNS:
- `/^src\//`, `/^lib\//`, `/^routes\//`, `/^controllers\//`, `/^services\//`, `/^models\//`, `/^middleware\//`
- `/^package(-lock)?\.json$/`, `/^pnpm-lock\.yaml$/`, `/^yarn\.lock$/`
- `/^tsconfig.*\.json$/`, `/^jsconfig.*\.json$/`
- `/^nest-cli\./`, `/^vitest\.config\./`, `/^jest\.config\./`, `/^eslint\.config\./`

CORE_CONFIG_PATTERNS:
- `/^package(-lock)?\.json$/`, `/^pnpm-lock\.yaml$/`, `/^yarn\.lock$/`
- `/^tsconfig.*\.json$/`, `/^nest-cli\./`

ARCHITECTURE_PATTERNS:
- `/^src\/(routes|controllers|services|models|middleware)\//`
- `/^src\/(db|database|prisma|drizzle)\//`

### preset: python

INCLUDE_PATTERNS:
- `/^src\//`, `/^app\//`, `/^lib\//`, `/^[a-z_]+\/__init__\.py$/`
- `/^pyproject\.toml$/`, `/^setup\.(py|cfg)$/`, `/^requirements.*\.txt$/`, `/^Pipfile(\.lock)?$/`, `/^poetry\.lock$/`
- `/^pytest\.ini$/`, `/^mypy\.ini$/`, `/^\.flake8$/`, `/^\.pylintrc$/`, `/^tox\.ini$/`
- `/^manage\.py$/`, `/^wsgi\.py$/`, `/^asgi\.py$/`

CORE_CONFIG_PATTERNS:
- `/^pyproject\.toml$/`, `/^setup\.(py|cfg)$/`, `/^requirements.*\.txt$/`, `/^Pipfile(\.lock)?$/`, `/^poetry\.lock$/`

ARCHITECTURE_PATTERNS:
- `/^src\/(models|services|api|core)\//`
- `/^app\/(models|views|api)\//`

### preset: go

INCLUDE_PATTERNS:
- `/^cmd\//`, `/^internal\//`, `/^pkg\//`, `/^api\//`, `/^services\//`
- `/^go\.mod$/`, `/^go\.sum$/`
- `/^\.golangci\.ya?ml$/`

CORE_CONFIG_PATTERNS:
- `/^go\.mod$/`, `/^go\.sum$/`

ARCHITECTURE_PATTERNS:
- `/^internal\/(domain|usecase|adapter|infrastructure)\//`
- `/^pkg\/(http|grpc|db)\//`

### 通用 EXCLUDE_PATTERNS（所有 preset 共享）

- `/^\.memory\//`, `/^\.cursor\//`, `/^\.claude\//`, `/^\.omc\//`, `/^\.omx\//`, `/^AIConfig\//`
- `/^docs\//`, `/^README/i`, `/(^|\/)CHANGELOG/i`
- `/^\.next\//`, `/^dist\//`, `/^build\//`, `/^out\//`, `/^target\//`, `/^coverage\//`
- `/^node_modules\//`, `/^__pycache__\//`, `/^vendor\//`, `/^logs\//`
- `/\.(pyc|pyo|class)$/`

### 通用 lintMemoryStalePathPatterns 占位

每个 preset 都用占位（`src/legacy/`、`src/old/`、`src/deprecated/`）。**真实旧路径每个项目特定**，由项目首次 init 后视情况补进 hook 脚本 CONFIG。

### 扩展指南

如果你的项目栈不在上面 4 个 preset 里（如 Rust / Java / Ruby / Elixir），请直接在本节追加新 preset 定义，并在产物 2 的 `PRESET_REGISTRY` 中注册。模板鼓励社区共建 preset。

---

## 你的唯一职责

按顺序生成以下产物：

1. `.cursor/agents/project-memory-maintainer.md` — Cursor 子 Agent，后台运行
2. `.cursor/hooks/memory-precheck.mjs` — Hook 预检脚本，stop / sessionEnd 触发前判断变更是否值得维护记忆
3. `.cursor/hooks.json` — Hook 注册文件
4. `.memory/` 目录骨架 — `记忆索引.md`、`项目总览.md`、`术语表.md`、`待确认问题.md`（留空骨架，业务模块目录由子 Agent 后续按需创建）
5. **codegraph 检测与自动安装** — 检测 CLI / 索引状态，未装则 `npm i -g @colbymchenry/codegraph`，未 init 则 `codegraph init -i`（全自动一错到底，装失败不阻塞）
6. **`.cursor/rules/05-memory-vs-codegraph-routing.mdc`** — 分工路由规则文件，告诉 AI"业务问题查 .memory、结构问题查 codegraph、不要互相侵入"（只写路由，不重写工具表，工具表交给 codegraph 自带的 `.cursor/rules/codegraph.mdc`）
7. 一次性执行 `node .cursor/hooks/memory-precheck.mjs --mark-done` 把当前工作区作为初始基线

不做：

- 不修改业务代码、不修改依赖。
- 不生成**通用** `.cursor/rules/**`（那是 `/init-architecture-rules` 的职责）。**唯一破例**：分工路由规则 `05-memory-vs-codegraph-routing.mdc`，因为它跟记忆系统紧耦合，必须在此处一并部署。
- 不修改 codegraph 自带的 `.cursor/rules/codegraph.mdc`（那是 codegraph init 时自动写入的，归 codegraph 自己管）。
- 不直接写记忆内容——只搭骨架，记忆由子 Agent 后续自动维护。

---

## 前置检查

开始前先检查：

### Preset 选择

按以下优先级决定 preset：

1. **用户参数显式指定**：如果用户在调用本 Skill 时同时说明 `preset=nodejs-frontend` / `preset=python` 等（或自然语言表达"用 python preset"），按指定值。
2. **自动检测**（按文件优先级，先找到的优先）：
   - 存在 `package.json` 且含 next / vite / nuxt 依赖 → `nodejs-frontend`
   - 存在 `package.json` 且含 express / nest / fastify / koa / hono 依赖 → `nodejs-backend`
   - 存在 `package.json` 但不含上述任一 → `nodejs-backend` 默认
   - 存在 `pyproject.toml` / `requirements.txt` / `Pipfile` / `setup.py` → `python`
   - 存在 `go.mod` → `go`
   - 都没匹配 → 暂停部署，告知用户"未识别项目栈，请重新调用本 Skill 并明确指定 `preset=xxx`（如 `运行 tvs-init-memory-system，preset=python`），或在 PRESETS 节追加新 preset"
3. 输出选定的 preset 名称给用户确认，例如："检测到项目栈：nodejs-frontend。如需切换，重新运行并指定 preset=..."。

伪代码：

```text
if 用户调用参数包含 preset=<name>:
  selectedPreset = <name>
else if package.json has next/vite/nuxt:
  selectedPreset = nodejs-frontend
else if package.json has express/nest/fastify/koa/hono:
  selectedPreset = nodejs-backend
else if package.json exists:
  selectedPreset = nodejs-backend
else if pyproject.toml / requirements.txt / Pipfile / setup.py exists:
  selectedPreset = python
else if go.mod exists:
  selectedPreset = go
else:
  stop and ask user to specify preset
```

### 其它前置检查

1. 项目根是否已有 `.cursor/rules/**`？如果没有，提示用户："建议先运行 `/init-architecture-rules` 生成架构规则，再部署记忆系统"，并询问是否仍要继续。
2. 项目是否在 git 仓库内？Hook 预检脚本依赖 `git`，如果不在 git 仓库，提示用户。
3. 是否已存在 `.cursor/agents/project-memory-maintainer.md` 或 `.memory/`？如果存在，先读取并询问用户是否覆盖。
4. **codegraph 与 Node 可用性检测**（仅记录状态，不在此处执行安装；具体安装逻辑见产物 5）：
   - `node --version` / `npm --version`：判断 Node 工具链是否可用
   - `codegraph --version`（或 `where codegraph` / `which codegraph`）：判断 codegraph CLI 是否已全局安装
   - 检查 `.codegraph/codegraph.db`：判断当前项目是否已 init
   
   把这三项结果记入临时变量 `CODEGRAPH_STATE`：
   - `ready`：CLI 已装 + 索引已存在 → 产物 5 跳过执行
   - `cli_only`：CLI 已装但 `.codegraph/` 不存在 → 产物 5 只跑 `codegraph init -i`
   - `missing`：CLI 未装但 Node 可用 → 产物 5 走完整链（`npm i -g` → `codegraph init -i`）
   - `no_node`：Node/npm 都不可用 → 产物 5 跳过，并在收尾摘要标记"codegraph: 缺少 Node 工具链"

---

## 产物 1：子 Agent

写入 `.cursor/agents/project-memory-maintainer.md`，内容：

```markdown
---
name: project-memory-maintainer
model: inherit
description: 维护当前项目的中文项目记忆层。较大的代码或架构变更后应主动使用；当变更影响模块边界、API 契约、公共组件、状态、权限、数据访问或项目约定时必须使用；当用户提到项目记忆、记忆维护、项目情况或知识沉淀时必须使用。写入 .memory/** 必须由本后台子 Agent 执行，主 Agent 不得直接编辑 .memory/**。
is_background: true
---

# 项目记忆维护员

你是当前项目的"项目记忆维护员"。

## 唯一职责

自动维护当前项目的中文项目记忆层，让未来的 Agent 能统一、正确地理解项目，减少重复代码、风格漂移和错误放置。

你不是开发 Agent。
你不是代码审查 Agent。
你不是架构规则生成 Agent。
你不能修改业务代码。
你不能修改架构规范规则。
你不能提出实现方案。
你只能维护 `.memory/**` 目录下的内容。

`.memory/**` 的写入必须发生在本后台子 Agent 内。主 Agent 只能触发或委派你，不能在主流程中直接新增、删除或修改 `.memory/**`。

如果当前环境无法启动本子 Agent，必须停止并说明原因，不能由主 Agent 代替维护记忆。

## 触发时机

- stop
- sessionEnd

## 运行条件

只有当本次 Agent 工作产生较大的代码或架构相关变化时才运行。普通问答、文档修改、记忆修改、规则修改、无文件变化、小修小补，直接 no-op。

## 允许读取

- 项目源码
- 配置文件
- package / 依赖文件
- 当前 git diff
- 已有项目记忆

## 允许写入

- `.memory/**`

## 禁止写入

- 源码目录
- 配置文件
- 依赖文件
- `.cursor/rules/**`
- `.cursor/commands/**`
- 任何非 `.memory/` 目录

## 记忆层要求

1. 除根目录 `.memory` 外，内部目录名、文件名、正文内容必须全部使用中文。
2. 按业务模块或能力模块建立目录，不按源码目录机械复制。
3. 每个模块记录：模块职责、业务流程、数据契约、关键规则、已知风险。
4. 记忆文件不是变更日志，不记录"本次改了什么"。
5. 只记录项目稳定情况，不记录临时猜测。
6. 不复述代码实现细节，也不重复 codegraph 答得了的纯结构信息（调用关系、数据源路径、调用链、符号位置）——除非该结构信息**本身承载业务含义**（如"刻意只对接 X 服务以满足合规约束"）。结构信息查询请走 `codegraph_*` 工具，本档不再重复。
7. 每条重要记忆必须标注来源文件。
8. 不确定内容写入"待确认问题.md"，不能伪造成事实。
9. 没有值得沉淀的项目知识则 no-op，不要强行更新。
10. 每次只更新受影响模块，不重写整个记忆层。
11. 记忆内容应帮助 Agent 判断代码应该放哪里、该复用什么、哪些风格和边界不能破坏。

## 维护后强制自检

写入 `.memory/**` 后，维护员必须执行以下自检，**不通过则禁止刷新基线**：

1. **反查源码路径**：扫描本次新增 / 修改内容中出现的所有源码路径（`src/xxx`）、目录名、API 入口、模块名；对每个路径用 Glob / rg / Read 反查当前源码是否存在。
2. **路径不存在时三选一**：
   - 改成当前实际路径。
   - 明确标注为"历史路径（已迁出，现位置：X）"。
   - 删除该记忆。

   **禁止把不存在的路径作为当前事实保留。**
3. **历史路径特别注意**：涉及 `src/lib/`、`src/types/`、`src/components/common`、`src/stores`、`src/constants` 等已弃用路径时，必须显式写明"历史路径"或迁移到当前 `src/core` / `src/shared` / `src/ui`。

这条直接针对 2026-05-25 在 shirehub-central 项目发现的"写完后路径过期、AI 照此放错代码"问题。

## 最小可维护单元 / 信息密度

- **单次维护范围 ≤ 1 个业务模块 / 1 个横切能力**。如果变更跨多个模块，只更新索引 + 最关键模块，剩余写入"待维护清单"，不一次铺开。
- **浅文档禁令**：如果某个模块的文档只能写出"类型在哪 / API 在哪 / 页面在哪"三句话，应**合并到 `模块档案/总览.md`**，不要单独成册（不要为了"覆盖完整"凑四件套浅文档）。
- **模块档案的最低质量门**（v2 版：与 codegraph 配合，去结构化、强化业务化）：

  必填字段（全部具备才能标记为完整模块档案）：
  - **模块职责**：一句话讲清这个业务模块负责什么。
  - **术语 / 别名 / 同义词**：本模块涉及的领域名词（同一概念在 UI / API / 数据库 / 文档里的不同叫法也要列）。
  - **跨模块协作契约**：本模块可以被谁调用 / 可以调用谁；以及对应的禁止关系（谁不能调用它 / 它不能调用谁）。
  - **设计决策**：当前形态的关键设计理由（"为什么是这样而不是那样"），至少 1 条。
  - **2-5 条红线**：已知风险 / 约定 / 一旦破坏会出问题的边界。
  
  选填字段（仅当它们承载业务含义时才记录；纯结构信息已由 codegraph 接管）：
  - **当前 barrel 入口路径**——仅当入口命名本身有业务含义时（如 `core/spaces/` 表达"领域内核边界"）；否则不记，让 `codegraph_context` / `codegraph_files` 答。
  
  **不再记录**的字段（之前需要、现已划归 codegraph）：
  - 数据源 / 适配器的纯文件路径
  - 调用关系 / 调用链
  - barrel 的字面路径（不附带业务解释时）
  
  这些由 `codegraph_callers` / `codegraph_callees` / `codegraph_context` / `codegraph_files` 一查就有，本档不重复。
  
  缺任一**必填项** → 不能标记为完整模块档案，应继续完善或合并。

这条直接针对 shirehub-central 评估中发现的"spaces / members 写 300+ 行，dashboard / compliance / plans 只十几行浅描述"覆盖不均问题，以及 `.memory` 437KB 持续膨胀问题。同时 v2 版通过"去结构化、强化业务化"，让 .memory 与 codegraph 分工更清晰、子 Agent 调用频率自然降低（业务知识变化比代码结构慢得多）。

## 维护完成后

无论本轮是真维护了，还是判断 no-op，结束前都要先完成"维护后强制自检"；自检通过后执行：

```bash
node .cursor/hooks/memory-precheck.mjs --mark-done
```

这会把当前工作区作为新基线落盘，下次 hook 仅检查"自基线以来的新增量"，避免反复对同一批未提交的变更重复触发提示。

## 输出目标

让未来的 AI Agent 和开发者能快速理解当前项目的业务模块、模块边界、关键流程、工程风格、复用入口和风险点。
```

## 产物 2：Hook 预检脚本

写入 `.cursor/hooks/memory-precheck.mjs`，内容：

> 生成脚本前，必须先按"Preset 选择"确定 `selectedPreset`。
> 下面代码中的 `SELECTED_PRESET = '<selected-preset>'` 必须替换为实际 preset 名。
> `INCLUDE_PATTERNS` / `CORE_CONFIG_PATTERNS` / `ARCHITECTURE_PATTERNS` 从 `PRESET_REGISTRY[selectedPreset]` 读取；`EXCLUDE_PATTERNS` 为所有 preset 共享。
> `lintMemoryStalePathPatterns` 使用通用占位，真实旧路径由项目后续维护时按情况补进 CONFIG。

```javascript
#!/usr/bin/env node
/**
 * 项目记忆维护预检 Hook
 *
 * 由 Cursor hooks 在 stop / sessionEnd 时调用，判断是否要提示主 Agent
 * 调用 project-memory-maintainer 子代理维护 .memory/。
 *
 * 解决的核心问题：
 *   旧实现以"工作区相对 HEAD 的全量差异"为输入。
 *   长期不 commit 时差异只增不减，每次 stop 都过阈值反复触发同一批变更。
 *
 * 改进策略：
 *   1. 基线机制 —— 以"上次成功维护后的工作区快照"为基线，仅看相对基线的增量。
 *      指纹由 path:size:mtime 构成，不依赖 HEAD，适配长期不 commit 的工作流。
 *   2. 三层节流 —— 同指纹去重 + 冷却时间（默认 30 分钟）+ 增量阈值。
 *   3. 子代理协作 —— 维护成功后调用 `--mark-done` 刷新基线，下次仅看新增量。
 *   4. 手动控制 —— `--force` 强制提示一次，`--reset` 清空状态，`--status` 查看状态。
 *   5. 可选 commit-only 模式 —— `requireHeadAdvance=true` 时只在 HEAD 前进后才计入。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'

// preset: <选定的 preset 名>
// 安装时必须把 SELECTED_PRESET 替换成前置检查阶段选定的 preset。
const SELECTED_PRESET = '<selected-preset>'

const PRESET_REGISTRY = {
    'nodejs-frontend': {
        include: [
            /^src\//, /^app\//, /^pages\//, /^components\//, /^lib\//,
            /^package(-lock)?\.json$/, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^yarn\.lock$/,
            /^tsconfig.*\.json$/, /^jsconfig.*\.json$/,
            /^next\.config\./, /^vite\.config\./, /^nuxt\.config\./, /^webpack\.config\./,
            /^tailwind\.config\./, /^postcss\.config\./, /^vitest\.config\./, /^jest\.config\./, /^eslint\.config\./,
            /^middleware\./, /^i18n\//, /^public\/images\//, /^public\/icons\//,
        ],
        coreConfig: [
            /^package(-lock)?\.json$/, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^yarn\.lock$/,
            /^tsconfig.*\.json$/,
            /^next\.config\./, /^vite\.config\./, /^nuxt\.config\./, /^middleware\./,
        ],
        architecture: [
            /^src\/lib\/(api|stores|hooks)\//,
            /^src\/components\/(layouts|ui)\//,
            /^src\/app\/api\//,
            /^src\/(auth|middleware)\//,
        ],
    },
    'nodejs-backend': {
        include: [
            /^src\//, /^lib\//, /^routes\//, /^controllers\//, /^services\//, /^models\//, /^middleware\//,
            /^package(-lock)?\.json$/, /^pnpm-lock\.yaml$/, /^yarn\.lock$/,
            /^tsconfig.*\.json$/, /^jsconfig.*\.json$/,
            /^nest-cli\./, /^vitest\.config\./, /^jest\.config\./, /^eslint\.config\./,
        ],
        coreConfig: [
            /^package(-lock)?\.json$/, /^pnpm-lock\.yaml$/, /^yarn\.lock$/,
            /^tsconfig.*\.json$/, /^nest-cli\./,
        ],
        architecture: [
            /^src\/(routes|controllers|services|models|middleware)\//,
            /^src\/(db|database|prisma|drizzle)\//,
        ],
    },
    python: {
        include: [
            /^src\//, /^app\//, /^lib\//, /^[a-z_]+\/__init__\.py$/,
            /^pyproject\.toml$/, /^setup\.(py|cfg)$/, /^requirements.*\.txt$/, /^Pipfile(\.lock)?$/, /^poetry\.lock$/,
            /^pytest\.ini$/, /^mypy\.ini$/, /^\.flake8$/, /^\.pylintrc$/, /^tox\.ini$/,
            /^manage\.py$/, /^wsgi\.py$/, /^asgi\.py$/,
        ],
        coreConfig: [
            /^pyproject\.toml$/, /^setup\.(py|cfg)$/, /^requirements.*\.txt$/, /^Pipfile(\.lock)?$/, /^poetry\.lock$/,
        ],
        architecture: [
            /^src\/(models|services|api|core)\//,
            /^app\/(models|views|api)\//,
        ],
    },
    go: {
        include: [
            /^cmd\//, /^internal\//, /^pkg\//, /^api\//, /^services\//,
            /^go\.mod$/, /^go\.sum$/,
            /^\.golangci\.ya?ml$/,
        ],
        coreConfig: [
            /^go\.mod$/, /^go\.sum$/,
        ],
        architecture: [
            /^internal\/(domain|usecase|adapter|infrastructure)\//,
            /^pkg\/(http|grpc|db)\//,
        ],
    },
}

const SELECTED_PRESET_CONFIG = PRESET_REGISTRY[SELECTED_PRESET]
if (!SELECTED_PRESET_CONFIG) {
    throw new Error(`未知 memory preset: ${SELECTED_PRESET}`)
}

/** 视为代码或架构相关变化的路径，至少命中一条才纳入考量 */
const INCLUDE_PATTERNS = SELECTED_PRESET_CONFIG.include

/** 即使命中 include 也强制排除；所有 preset 共享 */
const EXCLUDE_PATTERNS = [
    /^\.memory\//, /^\.cursor\//, /^\.claude\//, /^\.omc\//, /^\.omx\//, /^AIConfig\//,
    /^docs\//, /^README/i, /(^|\/)CHANGELOG/i,
    /^\.next\//, /^dist\//, /^build\//, /^out\//, /^target\//, /^coverage\//,
    /^node_modules\//, /^__pycache__\//, /^vendor\//, /^logs\//,
    /\.(pyc|pyo|class)$/,
]

/** 命中即视为触及核心配置，自动提升优先级 */
const CORE_CONFIG_PATTERNS = SELECTED_PRESET_CONFIG.coreConfig

/** 命中即视为架构敏感区域，自动提升优先级 */
const ARCHITECTURE_PATTERNS = SELECTED_PRESET_CONFIG.architecture

/** 触发阈值与节流配置，按项目实际节奏调整 */
const CONFIG = {
    /** 自上次维护以来变更文件数 ≥ 此值才触发 */
    deltaFileThreshold: 5,
    /** 自上次维护以来变更行数 ≥ 此值才触发（按 deltaFiles 相对 HEAD 计） */
    deltaLineThreshold: 200,
    /** 距离上次提示的冷却时间（分钟）；冷却内即使有新增量也不重复提示 */
    cooldownMinutes: 30,
    /** 是否要求 HEAD 前进（commit 之后）才计入触发分数；默认关闭 */
    requireHeadAdvance: false,
    /** 旧路径占位；真实旧路径每个项目特定，请按项目情况补进 */
    lintMemoryStalePathPatterns: [
        'src/legacy/',
        'src/old/',
        'src/deprecated/',
    ],
}

const STATE_FILE = '.memory/.hook-state.json'
const LIST_LIMIT = 12

function runGit(args) {
    try {
        return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim()
    } catch (err) {
        process.stderr.write(`[memory-hook] git ${args.join(' ')} 失败：${err.message}\n`)
        return ''
    }
}

const inGitRepo = () => runGit(['rev-parse', '--is-inside-work-tree']) === 'true'
const normalizePath = (p) => p.replace(/\\/g, '/')
const isRelevant = (p) =>
    !EXCLUDE_PATTERNS.some((re) => re.test(p)) &&
    INCLUDE_PATTERNS.some((re) => re.test(p))

/** 解析 git status --porcelain 输出，兼容 rename（` -> `） */
function parseStatusPaths(status) {
    if (!status) return []
    return status.split('\n')
        .map((line) => {
            const body = line.slice(3).trim()
            const renameIdx = body.indexOf(' -> ')
            return renameIdx === -1 ? body : body.slice(renameIdx + 4)
        })
        .filter(Boolean)
        .map(normalizePath)
}

/**
 * 计算工作区中相关文件的指纹。
 * 用 path:size:mtime 而非 git diff，原因：未提交时 diff 一直在变，
 * 但只要文件 size 与 mtime 不变就不应判定为"又有新变更"。
 */
function computeWorktreeFingerprint(paths) {
    const items = []
    for (const p of paths) {
        try {
            const st = statSync(p)
            items.push(`${p}|${st.size}|${Math.floor(st.mtimeMs)}`)
        } catch {
            items.push(`${p}|missing`)
        }
    }
    items.sort()
    return {
        files: items,
        hash: createHash('sha1').update(items.join('\n')).digest('hex').slice(0, 16),
    }
}

/** 找出当前工作区中相对基线"新增或元数据变化"的文件路径 */
function computeDelta(baselineFiles, currentFiles) {
    const baselineMap = new Map()
    for (const item of baselineFiles || []) {
        const idx = item.indexOf('|')
        if (idx === -1) continue
        baselineMap.set(item.slice(0, idx), item.slice(idx + 1))
    }
    const newOrChanged = []
    for (const item of currentFiles) {
        const idx = item.indexOf('|')
        if (idx === -1) continue
        const path = item.slice(0, idx)
        const meta = item.slice(idx + 1)
        const baselineMeta = baselineMap.get(path)
        if (baselineMeta === undefined || baselineMeta !== meta) {
            newOrChanged.push(path)
        }
    }
    return newOrChanged
}

/** 仅作为辅助信号：deltaFiles 相对 HEAD 的总变更行数 */
function countLinesAgainstHead(paths) {
    if (paths.length === 0) return 0
    const numstat = runGit(['diff', '--numstat', 'HEAD', '--', ...paths])
    if (!numstat) return 0
    return numstat.split('\n').reduce((total, line) => {
        const [a, d] = line.split(/\s+/)
        const safe = (s) => {
            const n = Number.parseInt(s, 10)
            return Number.isFinite(n) ? n : 0
        }
        return total + safe(a) + safe(d)
    }, 0)
}

function readState(file) {
    if (!existsSync(file)) return {}
    try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} }
}

function writeState(file, state) {
    try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify(state, null, 2))
    } catch (err) {
        process.stderr.write(`[memory-hook] 写入状态失败：${err.message}\n`)
    }
}

const minutesSince = (iso) => {
    if (!iso) return Infinity
    return (Date.now() - new Date(iso).getTime()) / 60000
}

function emitFollowup(message) {
    process.stdout.write(JSON.stringify({ followup_message: message }))
}

function buildMessage({ deltaFiles, reasons }) {
    const shown = deltaFiles.slice(0, LIST_LIMIT)
    const remaining = deltaFiles.length - shown.length
    const fileList = shown.map((p) => `- ${p}`).join('\n') +
        (remaining > 0 ? `\n- ……还有 ${remaining} 个文件未列出` : '')

    return [
        '本轮检测到自上次记忆维护以来的累积变更已达到阈值，必须调用后台子代理 `project-memory-maintainer` 维护 `.memory/`。',
        '',
        '触发原因：',
        ...reasons.map((r) => `- ${r}`),
        '',
        '记忆维护要求：',
        '- `.memory/**` 写入必须在 `project-memory-maintainer` 后台子 Agent 内完成，主 Agent 禁止直接编辑 `.memory/**`。',
        '- 如果当前环境无法启动该子 Agent，请直接说明无法执行，不要在主流程代办。',
        '- 只记录项目稳定情况、模块边界、数据契约、工程风格、复用入口和已知风险。',
        '- 不要记录本次改了什么，不要把 `.memory` 写成 changelog。',
        '',
        'mark-done 质量闸门：',
        '- 维护完成后，先输出自检摘要：本次更新文件清单、反查过的源码路径、发现并处理的过期路径、未能确认的问题。',
        '- 未能确认的问题应写入 `待确认问题.md`，不能混入模块档案伪造成当前事实。',
        '- 如果路径不存在但被作为当前事实保留、来源标注无法在源码中找到对应文件、或模块文档只有浅描述且不达最低质量门，禁止执行 `--mark-done`。',
        '- 禁止刷新基线时，应把未解决问题写入 `待确认问题.md`，或通过回执返回 blocked。',
        '- 通过自检后再执行：`node .cursor/hooks/memory-precheck.mjs --mark-done` 刷新基线。',
        '',
        '--lint-memory 子命令：',
        '- `node .cursor/hooks/memory-precheck.mjs --lint-memory` 扫描 `.memory/**` 中是否出现旧路径模式。',
        '- 默认旧路径模式使用 CONFIG.lintMemoryStalePathPatterns 占位：`src/legacy/`、`src/old/`、`src/deprecated/`。',
        '- 命中且未带"历史" / "已迁出"等上下文时返回非零，视为 lint 失败。',
        '- 该子命令可用于 CI / 定期任务检查 memory 是否漂移；真实旧路径每个项目特定，请按项目情况补进 CONFIG。',
        '- 不刷新基线下次还会再次提示同一批变更。',
        '',
        '相关变更文件：',
        fileList,
    ].join('\n')
}

/** 子命令：把当前工作区作为新基线落盘，下次 hook 仅检查相对基线的新增量 */
function commandMarkDone(stateFile) {
    if (!inGitRepo()) {
        process.stdout.write(JSON.stringify({ ok: false, message: '当前不在 git 仓库内' }))
        return
    }
    const allRelevant = Array.from(
        new Set(parseStatusPaths(runGit(['status', '--porcelain'])).filter(isRelevant)),
    )
    const fp = computeWorktreeFingerprint(allRelevant)
    const head = runGit(['rev-parse', 'HEAD']) || 'no-head'
    const prev = readState(stateFile)
    writeState(stateFile, {
        ...prev,
        baselineHead: head,
        baselineFingerprint: fp.files,
        baselineHash: fp.hash,
        lastMaintainedAt: new Date().toISOString(),
        lastTriggerHash: null,
    })
    process.stdout.write(JSON.stringify({
        ok: true,
        message: `已刷新记忆维护基线，已纳入 ${allRelevant.length} 个相关文件`,
    }))
}

/** 子命令：清空 hook 状态，下次将作为首次触发处理 */
function commandReset(stateFile) {
    writeState(stateFile, {})
    process.stdout.write(JSON.stringify({ ok: true, message: '已清空 hook 状态' }))
}

/** 子命令：打印当前状态，便于排查"为何没触发 / 为何反复触发" */
function commandStatus(stateFile) {
    const state = readState(stateFile)
    process.stdout.write(JSON.stringify({ stateFile, config: CONFIG, state }, null, 2))
}

function listMarkdownFiles(dir) {
    if (!existsSync(dir)) return []

    const files = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = resolve(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...listMarkdownFiles(fullPath))
            continue
        }

        if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath)
        }
    }

    return files
}

function hasHistoryContext(lines, index) {
    const contextWords = ['历史', '已迁出', '历史路径', '过去路径', '迁移自']
    const from = Math.max(0, index - 2)
    const to = Math.min(lines.length - 1, index + 2)
    const context = lines.slice(from, to + 1).join('\n')
    return contextWords.some((word) => context.includes(word))
}

/**
 * 子命令：递归扫描 `.memory/` 下的 Markdown 文件中未标注历史语境的旧路径。
 *
 * 目的：阻止过期目录被继续写成"当前事实"，污染长期项目记忆。
 */
function commandLintMemory() {
    const memoryRoot = resolve('.memory')
    const files = listMarkdownFiles(memoryRoot)
    const hits = []

    for (const file of files) {
        const text = readFileSync(file, 'utf8')
        const lines = text.split(/\r?\n/)
        lines.forEach((lineContent, index) => {
            for (const pattern of CONFIG.lintMemoryStalePathPatterns) {
                if (!lineContent.includes(pattern)) continue
                if (hasHistoryContext(lines, index)) continue

                hits.push({
                    file: normalizePath(file),
                    line: index + 1,
                    lineContent,
                    pattern,
                })
            }
        })
    }

    const ok = hits.length === 0
    process.stdout.write(JSON.stringify({
        ok,
        total_files: files.length,
        hits,
        message: ok
            ? '未发现未标注历史语境的旧路径'
            : `发现 ${hits.length} 处疑似未标注历史语境的旧路径`,
    }, null, 2))
    process.exit(ok ? 0 : 1)
}

function main() {
    const argv = process.argv.slice(2)
    const stateFile = resolve(STATE_FILE)

    if (argv.includes('--mark-done')) return commandMarkDone(stateFile)
    if (argv.includes('--reset')) return commandReset(stateFile)
    if (argv.includes('--status')) return commandStatus(stateFile)
    if (argv.includes('--lint-memory')) return commandLintMemory()

    const force = argv.includes('--force')

    if (!inGitRepo()) return

    const allRelevant = Array.from(
        new Set(parseStatusPaths(runGit(['status', '--porcelain'])).filter(isRelevant)),
    )
    if (allRelevant.length === 0) return

    const state = readState(stateFile)
    const head = runGit(['rev-parse', 'HEAD']) || 'no-head'
    const currentFp = computeWorktreeFingerprint(allRelevant)

    if (CONFIG.requireHeadAdvance && state.baselineHead === head && !force) return
    if (!force && currentFp.hash === state.lastTriggerHash) return
    if (!force && minutesSince(state.lastTriggeredAt) < CONFIG.cooldownMinutes) return

    const deltaFiles = computeDelta(state.baselineFingerprint, currentFp.files)
    if (deltaFiles.length === 0 && !force) return

    const deltaLines = countLinesAgainstHead(deltaFiles)
    const touchesCoreConfig = deltaFiles.some((p) =>
        CORE_CONFIG_PATTERNS.some((re) => re.test(p)))
    const touchesArchitecture = deltaFiles.some((p) =>
        ARCHITECTURE_PATTERNS.some((re) => re.test(p)))

    const reasons = []
    if (deltaFiles.length >= CONFIG.deltaFileThreshold)
        reasons.push(`自上次维护以来变更文件数 ${deltaFiles.length} ≥ ${CONFIG.deltaFileThreshold}`)
    if (deltaLines >= CONFIG.deltaLineThreshold)
        reasons.push(`自上次维护以来变更行数 ${deltaLines} ≥ ${CONFIG.deltaLineThreshold}`)
    if (touchesCoreConfig) reasons.push('触及核心配置（依赖 / TS / 构建）')
    if (touchesArchitecture) reasons.push(`触及架构敏感区（preset: ${SELECTED_PRESET}）`)

    if (reasons.length === 0 && !force) return
    if (force && reasons.length === 0) reasons.push('手动强制触发（--force）')

    /**
     * 这里只更新触发记录，不更新 baseline；
     * baseline 仅在子代理实际维护后由 `--mark-done` 写入，
     * 否则用户没真维护就连续触发会被错误地判定为"已处理"。
     */
    writeState(stateFile, {
        ...state,
        baselineHead: state.baselineHead || head,
        baselineFingerprint: state.baselineFingerprint || [],
        baselineHash: state.baselineHash || null,
        lastTriggerHash: currentFp.hash,
        lastTriggeredAt: new Date().toISOString(),
    })

    emitFollowup(buildMessage({ deltaFiles, reasons }))
}

main()
```

## 产物 3：hooks.json

写入 `.cursor/hooks.json`，内容：

```json
{
  "version": 1,
  "hooks": {
    "stop": [
      {
        "command": "node .cursor/hooks/memory-precheck.mjs",
        "timeout": 15,
        "loop_limit": 1,
        "failClosed": false
      }
    ],
    "sessionEnd": [
      {
        "command": "node .cursor/hooks/memory-precheck.mjs",
        "timeout": 15,
        "loop_limit": 1,
        "failClosed": false
      }
    ]
  }
}
```

如果 `.cursor/hooks.json` 已存在，**不要直接覆盖**。读取已有内容、合并 stop / sessionEnd 数组、保留其他字段后写回；如果已有同名 hook command 但缺少 `timeout`、`loop_limit` 或 `failClosed`，应补齐这些保护字段。

## 产物 4：.memory/ 骨架

创建以下文件，每个文件留空骨架（包含一级标题和一句话占位说明，不填具体内容）：

```text
.memory/
  记忆索引.md         ← 一级标题"记忆索引" + 占位说明"由 project-memory-maintainer 子 Agent 自动维护"
  项目总览.md         ← 一级标题"项目总览" + 占位说明"由子 Agent 在足够大的变更后自动沉淀"
  术语表.md           ← 一级标题"术语表"
  待确认问题.md       ← 一级标题"待确认问题" + 占位说明"子 Agent 把不确定的内容写入此处，由人审定"
```

不要创建任何业务模块目录——那由子 Agent 在首次实际维护时按项目代码自动生成。

同时把以下运行期状态文件写入 `.gitignore`（不应入库）：

```text
# 项目记忆 hook 运行期状态
.memory/.hook-state.json
# codegraph 状态汇总（由产物 5 写入）
.memory/.codegraph-status.json
```

---

## 产物 5：codegraph 检测与自动安装

按前置检查阶段记录的 `CODEGRAPH_STATE` 决定执行路径。**全自动一错到底**链：未装就装、装了未 init 就 init；任何一步失败都**不阻塞**主流程，只在收尾摘要里记入降级状态。

### 执行分支

| `CODEGRAPH_STATE` | 执行动作 | 完成后 `CODEGRAPH_STATUS` |
|---|---|---|
| `ready` | 跳过整个产物 5 | `ready` |
| `cli_only` | 执行 `codegraph init -i` | `init_done`（成功）/ `init_failed`（失败） |
| `missing` | 先 `npm i -g @colbymchenry/codegraph`，成功后再 `codegraph init -i` | `ready`（全成功）/ `install_failed`（npm 失败）/ `init_failed`（init 失败） |
| `no_node` | 跳过全部 | `no_node` |

### 执行规则

- 任何一步**失败都不抛出**，而是把错误信息收集到 `CODEGRAPH_STATUS` 里供收尾摘要使用。
- `npm i -g` 失败的常见原因（无网络 / 权限不足 / 仓库 403）应当在摘要里展示原始 npm 错误前 200 字符，方便用户排查。
- `codegraph init -i` 即使没成功也不要重试——交给用户手动跑。

### 降级路径（核心约束之一）

无论 codegraph 处于哪种状态，**产物 6（rules 文件）一定要生成**，且其内容会根据 `CODEGRAPH_STATUS` 在末尾追加合适的降级提示：

- `ready` / `init_done` → rules 正常输出"分工路由：业务问题查 .memory、结构问题查 codegraph"
- `install_failed` / `init_failed` / `no_node` → rules 额外追加一段"本项目当前 codegraph 不可用，AI 遇到结构问题请回退到 Grep / Read；用户可后续手动运行 `npm i -g @colbymchenry/codegraph && codegraph init -i` 启用 codegraph 后再次跑本命令的 `--rebuild-rules` 子命令重写规则文件"

这样保证：**codegraph 不在场时 .memory 仍能完整运行**，AI 也清楚该怎么降级到原生工具。

### 项目语言不在 codegraph 支持范围内

`codegraph init -i` 自己会处理"语言不识别"的情况——跳过这些文件、仍然成功 init，只是索引内容为空。本命令**不预先判断**，把这一步交给 codegraph 自己。如果 init 成功但 `.codegraph/codegraph.db` 是空索引，AI 查 codegraph 时自然查不到东西、转而走 Grep/Read，这是预期降级行为，不视为错误。

### 状态汇总落盘

执行完毕后，把 `CODEGRAPH_STATUS` 写入 `.memory/.codegraph-status.json`（不入库，加入 `.gitignore`）：

```json
{
  "status": "ready | init_done | install_failed | init_failed | no_node",
  "checkedAt": "<ISO 时间>",
  "cliPath": "<codegraph CLI 路径 或 null>",
  "dbPath": ".codegraph/codegraph.db",
  "error": "<原始错误前 200 字符 或 null>"
}
```

后续如果用户手动装好了 codegraph，可以删掉这个文件，hook 自然不再报告"codegraph 不可用"。

---

## 产物 6：分工路由 rules（破例生成 `.cursor/rules/`）

写入 `.cursor/rules/05-memory-vs-codegraph-routing.mdc`。本规则**只写"业务问题查哪、结构问题查哪"的路由**，不重写 codegraph 工具表（那由 codegraph 自带的 `.cursor/rules/codegraph.mdc` 负责）。

> 编号 `05-` 故意排在 `04-memory-maintenance-boundary` 之后；如果项目已有更高编号的规则文件，按需调整编号。

文件内容（按 `CODEGRAPH_STATUS` 在最后追加不同的"降级提示"块）：

````markdown
---
description: .memory 与 codegraph 的分工路由 —— 业务问题查 .memory、结构问题查 codegraph，互不侵入。
alwaysApply: true
---

# 记忆层分工路由：.memory × codegraph

本项目同时部署了两套互补的"记忆"层，请按问题类型走对应入口，**不要互相侵入**。

## 路由决策表

| 你想知道 | 走哪 | 入口（举例） |
|---|---|---|
| 这个模块业务上负责什么 | `.memory` | `.memory/模块档案/<模块>/总览.md` |
| 项目里 X 是什么术语 / 别名 | `.memory` | `.memory/术语表.md` |
| 哪些模块**不能**互相调用 / 跨模块协作契约 | `.memory` | 模块档案 - 跨模块协作契约 |
| 为什么这块代码这么设计 / 决策来源 | `.memory` | 模块档案 - 设计决策 |
| 红线 / 不能跨的边界 / 已知风险 | `.memory` | 模块档案 - 红线 / 已知风险 |
| 项目稳定的工程风格与约定 | `.memory` | `.memory/项目总览.md` |
| —— | —— | —— |
| X 函数 / 类 / 方法在哪定义 | `codegraph` | `codegraph_search` |
| X 调用了什么 / 被谁调用 | `codegraph` | `codegraph_callers` / `codegraph_callees` |
| 改 X 会影响哪些代码 | `codegraph` | `codegraph_impact` |
| 从 X 到 Y 的调用路径 | `codegraph` | `codegraph_trace` |
| 模块 X 的代码地图（文件、barrel） | `codegraph` | `codegraph_context` / `codegraph_files` |
| 某个符号的源码 / 签名 | `codegraph` | `codegraph_node` / `codegraph_explore` |

## 反模式（请避免）

- ❌ 把 `.memory` 当代码地图用：去那里翻"X 在哪个文件"——`.memory` 不记纯结构信息。
- ❌ 让 codegraph 总结业务：它只看 AST，看不到"为什么这么写"。
- ❌ 同一信息两处都写：会产生漂移；纯结构归 codegraph，业务语义归 `.memory`。
- ❌ 写代码时只查一边：业务约束（.memory）和结构事实（codegraph）是互补的，复杂改动需要同时参考两者。

## 子 Agent 边界

`project-memory-maintainer` 子 Agent 维护 `.memory/**` 时**不调用 codegraph 工具**，仍使用 Glob / rg / Read 反查源码路径。这是刻意设计：

- 保持子 Agent 调用次数尽可能少
- 保证 codegraph 不可用时 `.memory` 仍能完整运行

如果你是子 Agent，请遵守这条边界。
````

### 按 `CODEGRAPH_STATUS` 在文件末尾追加降级块

- `ready` / `init_done` → 在文件末尾追加：

```markdown

## codegraph 当前状态

✅ codegraph 已就绪。请按上面的路由决策表正常使用。
```

- `install_failed` / `init_failed` / `no_node` → 在文件末尾追加：

```markdown

## codegraph 当前状态

⚠️ **本项目当前 codegraph 不可用**（状态：<install_failed | init_failed | no_node>）。

降级处理：
- AI 遇到上表中"结构问题"行的需求时，**回退到 Grep / Read** 工具。
- 用户可后续手动运行 `npm i -g @colbymchenry/codegraph && codegraph init -i` 启用 codegraph。
- 启用后请删除 `.memory/.codegraph-status.json`，下次会话 AI 即可重新走 codegraph 路由。

`.memory/` 部分不受 codegraph 状态影响，业务问题路由照常使用。
```

### 若 `.cursor/rules/05-memory-vs-codegraph-routing.mdc` 已存在

按"先读后合并"原则，**不要直接覆盖**。读取已有文件内容，识别其中是否已有"路由决策表"和"codegraph 当前状态"两节：

- 路由决策表存在 → 跳过该节（用户可能已自定义）
- 路由决策表不存在 → 在文件末尾追加
- "codegraph 当前状态"节 → 始终用本次 `CODEGRAPH_STATUS` 覆盖（这是动态信息）

---

## 产物 7：初始化记忆维护基线

四件产物全部就位后，**立即执行一次**：

```bash
node .cursor/hooks/memory-precheck.mjs --mark-done
```

这一步至关重要。它会把当前工作区作为"基线"快照落盘到 `.memory/.hook-state.json`。从此 hook 只检查"自基线以来的新增量"，而不是工作区相对 HEAD 的全量差异。

**如果跳过这一步**，第一次 stop 触发时 hook 会把所有未提交的工作区变更全部当作"新增量"提示给你，反而立刻造成一次假性触发。

---

## 收尾

七件事全部就位后，向用户输出一段简短摘要：

```text
项目记忆维护体系部署完成（v2：与 codegraph 分工配合）：
- 选定 preset: <name>
- .cursor/agents/project-memory-maintainer.md
- .cursor/hooks/memory-precheck.mjs
- .cursor/hooks.json (stop + sessionEnd 已注册)
- .memory/记忆索引.md / 项目总览.md / 术语表.md / 待确认问题.md
- .memory/.hook-state.json （已用当前工作区初始化为基线）
- .memory/.codegraph-status.json （codegraph 当前状态：<CODEGRAPH_STATUS>）
- .cursor/rules/05-memory-vs-codegraph-routing.mdc （分工路由：业务→.memory、结构→codegraph）

分工说明（v2 新增）：
- .memory 专注业务领域：术语、模块语义、跨模块协作契约、设计决策、红线、已知风险
- codegraph 专注代码结构：符号位置、调用链、影响半径
- 子 Agent 维护 .memory 时不调用 codegraph 工具，保证调用次数最少 + codegraph 不可用时仍能完整运行

codegraph 当前状态：<CODEGRAPH_STATUS>
  ready / init_done    → 已就绪，AI 会按 rules 自动分工路由
  install_failed       → npm i -g 失败（错误：<error>），rules 已写入降级提示
  init_failed          → codegraph init -i 失败（错误：<error>），rules 已写入降级提示
  no_node              → 缺少 Node 工具链，rules 已写入降级提示

触发节奏（默认值，与 v1 一致）：
- 自上次维护以来变更文件数 ≥ 5 个，或变更行数 ≥ 200 行，或触及核心配置 / 架构敏感区
- 同一段冷却期内（默认 30 分钟）只提示一次
- 工作区指纹未变就跳过（即使过了冷却时间）
- 想调阈值或冷却时间，改 memory-precheck.mjs 顶部 CONFIG 即可
（v2 不动阈值——通过"模块档案最低质量门"v2 让"什么值得记"更严，由内容定义本身降低维护频率）

日常运维命令：
- node .cursor/hooks/memory-precheck.mjs --mark-done   维护完成或判 no-op 后调用，刷新基线
- node .cursor/hooks/memory-precheck.mjs --force       绕过冷却与去重，手动强制提示一次
- node .cursor/hooks/memory-precheck.mjs --status      打印当前 CONFIG 与状态，排查触发问题
- node .cursor/hooks/memory-precheck.mjs --reset       清空 hook 状态，下次按首次触发处理
- node .cursor/hooks/memory-precheck.mjs --lint-memory 扫描 .memory 中未标注历史语境的旧路径

codegraph 相关运维（仅在 CODEGRAPH_STATUS == ready / init_done 时可用）：
- codegraph status          查看索引健康度与统计
- codegraph sync             手动同步索引（一般不需要，watcher 会自动同步）
- 详细工具表见 codegraph 自带的 .cursor/rules/codegraph.mdc

接下来：
- 你下一次较大代码变更结束时，hook 会自动检测并提示主 Agent 调用子代理。
- 子 Agent 第一次跑会按项目代码自动生成业务模块目录，按 v2 字段规范（必填：模块职责 / 术语 / 跨模块协作契约 / 设计决策 / 红线）。
- 建议把 .memory/ 加入 git；.memory/.hook-state.json 和 .memory/.codegraph-status.json 已加入 .gitignore。
```

根据情况，最后追加补充提示：

- 如果项目里没有 `.cursor/rules/**`（除了本次生成的 `05-memory-vs-codegraph-routing.mdc` 之外）：

```text
- 检测到本项目尚未生成架构规则，建议运行 /init-architecture-rules。
```

- 如果 `CODEGRAPH_STATUS` 为 `install_failed` / `init_failed` / `no_node`：

```text
- codegraph 当前不可用，rules 已自动写入降级提示。修复后请删除 .memory/.codegraph-status.json 并重新运行本命令以重写 rules 中的"codegraph 当前状态"块。
```

不要输出代码 diff、不要输出 changelog 风格的"本次修改"——这次部署是一次性安装，不是日常变更。