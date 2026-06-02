---
name: tvs-init-memory-system
description: 跨工具（Cursor / Claude Code / Codex）一次性部署"团队级记忆系统 + codegraph 分工配合"。生成维护子 Agent、会话结束 hook（分支感知触发判断 + 时间衰减门槛 + 跨成员去重，全程代码判断零 AI）、.memory 骨架（含团队共享维护元数据）、记忆宪法规则、codegraph 自愈安装与初始化基线。**显式调用、不自动触发**——仅当用户明示"运行 tvs-init-memory-system / 部署记忆系统 / init memory / 初始化项目记忆"等需求时，由用户手动唤起本 Skill；AI 不得仅因 description 关键词命中就主动加载执行。
disable-model-invocation: true
---

# tvs-init-memory-system：跨工具一次性部署团队级记忆系统 + codegraph 分工配合（v4）

> **v4 团队化要点**（相对 v3 的增量）：① hook 的"是否唤起维护子 Agent"判断**新增分支维度**（当前分支 / 分支领先集成线提交数 / 距上次维护时间），按**时间衰减门槛**缩放，全程代码判断、零 AI；② 维护元数据（上次谁/何时/哪分支维护了什么 + 各分支负责人）落在**入库共享**的 `跨分支在研功能地图.md`（hook 写机读锚点 + 子 Agent 写人读表格），团队成员间**跨成员去重**避免重复维护；③ codegraph 从"可选解耦层"升级为**维护子 Agent 自检的依赖**（仅路径/符号校验，装不上回退 git cat-file/Glob），安装提示更强；④ 记忆**防膨胀**：事前准入黑名单（H）+ 事后增量去冗余（G），双向压住 .memory 膨胀导致的 token 浪费。

> **⚠️ 调用约束**：本 Skill **不会被 AI 自动触发**（frontmatter 已声明 `disable-model-invocation: true`）。必须由用户在对话中显式说出"运行 tvs-init-memory-system / 部署记忆系统 / 初始化项目记忆"或等价指令后，AI 才应当读入本文件并按下面流程执行。如果你（AI）只是因为对话里出现了"记忆系统"四个字就想自动跑本 Skill，请**停下**——这不在本 Skill 的允许触发范围内。

你被显式调用来为当前项目**一次性安装**项目记忆维护体系（v3：跨工具 + 与 codegraph 分工配合）。这是一次性工程动作，跑完就结束，不是日常能力。本 Skill 适配 Cursor / Claude Code / Codex（三者都有子 Agent + hook + MCP 能力），先识别宿主工具再按对应格式落地。

**调用方式**：

```text
用户在对话里说"运行 tvs-init-memory-system"或等价表达（"部署记忆系统"、"初始化项目记忆"、"装一下记忆系统"等）。
AI 读入本 SKILL.md，按下面流程逐步执行；执行完毕收尾摘要并停止，不进入日常维护态。
```

**用户传入的关键词 / 参数**（可选）：用户可一并说明阈值偏好（例如"阈值更宽松"）或运行环境（例如"PowerShell 项目，hook 用 .ps1 实现"）或 preset 切换（例如"preset=python"）。无明确参数时按下面默认方案部署。

---

## 0. 宿主工具识别（执行第一步）

本 Skill 跨工具通用。开始前先判定你（执行本 Skill 的 AI）运行在哪个宿主里，记入 `TOOL`：

- `cursor`：存在 `.cursor/`，或你就是 Cursor 内的 Agent。
- `claude-code`：存在 `.claude/`，或你是 Claude Code。
- `codex`：存在 `.codex/`，或项目以 `AGENTS.md` 为主导，或你是 Codex CLI。
- `other`：以上都不是 → 按"能力降级"处理：只生成 `.memory/` 骨架 + 一份 `AGENTS.md` 记忆宪法，hook / 子 Agent 退化为文档说明，提示用户手动接入。

判不准就直接问用户当前用哪个工具，别猜。后续所有"产物"按下表落到对应路径与格式。

## 工具适配矩阵（产物 × 工具）

| 逻辑产物 | Cursor | Claude Code | Codex CLI |
|---|---|---|---|
| 维护子 Agent | `.cursor/agents/project-memory-maintainer.md`（`is_background: true`） | `.claude/agents/project-memory-maintainer.md`（`model:`） | `.codex/agents/project-memory-maintainer.toml`（`model` / `model_reasoning_effort`） |
| Hook 脚本 | `.cursor/hooks/memory-precheck.mjs` | `.claude/hooks/memory-precheck.mjs` | `.codex/hooks/memory-precheck.mjs` |
| Hook 注册 | `.cursor/hooks.json`（`stop` / `sessionEnd`） | `.claude/settings.json` 的 `hooks`（`Stop` / `SessionEnd`） | `.codex/config.toml`（`[features] hooks=true`）+ `.codex/hooks.json`（`SessionStart` / `PostToolUse`） |
| 记忆宪法（始终生效） | `.cursor/rules/04-memory-constitution.mdc`（`alwaysApply: true`） | 追加到项目 `CLAUDE.md` 的「记忆系统宪法」段 | 追加到项目 `AGENTS.md` 的「记忆系统宪法」段 |
| codegraph 指令文件 | **不写**，由 codegraph 安装器写 `.cursor/rules/codegraph.mdc` | 由安装器写 `CLAUDE.md` | 由安装器写 `~/.codex/AGENTS.md` |
| `.memory/` 骨架 + 索引 | 工具无关，三者一致 | 同 | 同 |

下面正文以 Cursor 路径举例；写入其它工具时，按本表替换路径与容器格式（frontmatter / settings.json / config.toml）。**产物的"内容逻辑"三工具一致，只有"容器"不同。**

### 各工具关键差异（必须遵守）

- **Cursor**：子 Agent 可 `is_background: true` 后台自动跑；hook `stop` / `sessionEnd` 触发。
- **Claude Code**：子 Agent frontmatter 里写 `Stop` hook 会被自动转成 `SubagentStop`；项目级 `.claude/settings.json`、`.mcp.json`、`CLAUDE.md` 均可入库随仓库走。
- **Codex**：子 Agent **不会自动 spawn**（官方明确"只在用户显式要求时才用子 Agent"）。所以 Codex 上记忆维护是 **hook 提示 + 主 Agent/用户显式唤起** 维护员，不能假设它像 Cursor 那样后台自动跑——这点必须写进 Codex 的记忆宪法。

---

## 分工边界声明（codegraph × .memory）

本系统**与 codegraph 协同部署、但保持各自独立**。两套系统走完全不同的方向，互为补充，**互不依赖**。

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
| 各个分支在迭代什么功能 / 某功能在哪个分支 | 跨分支在研功能地图.md |

### 不互相侵入原则

- **.memory 不再记录纯代码结构信息**：barrel 路径、数据源/适配器、调用链、**函数签名 / 参数 / 返回值 / 类型**这些"AST 看一眼就知道"的内容，让 codegraph 答；.memory 只在它有业务含义时才记录（如"这个 barrel 名字本身代表领域内核边界"）。
- **子 Agent 自检会用 codegraph（v4 调整，仅限路径/符号校验）**：维护 .memory 的主体逻辑仍用 Glob / rg / Read，但**维护后强制自检的"路径/符号是否存在"校验，优先用 `codegraph_search` 替代 git cat-file/Glob**（更准、且 sub-ms + 只回结构事实，比 grep/read 试错更省 token）。这是 v4 相对 v3 的有意调整——codegraph 因此升级为**维护子 Agent 自检的依赖**。**硬安全网**：codegraph 不可用（未装/装失败/语言不支持）时，自检**回退** git cat-file/Glob，维护能力下降但**绝不瘫痪**。除路径校验外，子 Agent 不主动用 codegraph 做契约/影响面/调用链（控制调用次数）。
- **记忆防膨胀是双向的（v4 新增 G + H）**：除"不再记录"的事前规则（H 写入准入黑名单），子 Agent 在**维护某模块时顺手删掉该模块档案里 codegraph 已能回答的存量结构冗余**（G 增量去冗余，零额外扫描）；hook 用代码统计 .memory 体积超标即提示精简（零 AI）。**不做定期全量 AI 去冗余扫描**——那会为省 token 反而狂耗 token。
- **codegraph 的指令文件我们不写、不改**：codegraph 官方安装器（`npx @colbymchenry/codegraph`）会自动给当前工具写好"怎么用 codegraph 工具"的指南（Cursor `.cursor/rules/codegraph.mdc` / Claude `CLAUDE.md` / Codex `~/.codex/AGENTS.md`）。本 Skill 只在"记忆宪法"里写一句分工路由（业务查 .memory、结构查 codegraph），不与之重叠。

### 为什么明明可被替代仍然不替代

| 能力 | v4 处理 |
|---|---|
| 子 Agent 维护主体"反查源码路径"用 Glob/rg/Read | **仍用 Glob/rg/Read**（控制调用次数）；但**自检阶段的路径/符号存在性校验改用 `codegraph_search`**（更准更省 token，装不上回退 git cat-file/Glob） |
| lint-memory 字符串模式扫描旧路径 / changelog 关键词 | **不用 codegraph**：lint 是 CI / 定期任务，纯代码字符串扫描，不应依赖 MCP 服务可用性 |
| 模块档案记 barrel / 数据源 / 函数签名参数 | 这是 codegraph 强项，**.memory 完全让位**（H 黑名单事前拦 + G 事后删存量）；仅**业务含义部分**保留 |

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

- `/^\.memory\//`, `/^\.cursor\//`, `/^\.claude\//`, `/^\.codex\//`, `/^\.omc\//`, `/^\.omx\//`, `/^AIConfig\//`
- `/^docs\//`, `/^README/i`, `/(^|\/)CHANGELOG/i`
- `/^\.next\//`, `/^dist\//`, `/^build\//`, `/^out\//`, `/^target\//`, `/^coverage\//`
- `/^node_modules\//`, `/^__pycache__\//`, `/^vendor\//`, `/^logs\//`
- `/\.(pyc|pyo|class)$/`

### 通用 lintMemoryStalePathPatterns 占位

每个 preset 都用占位（`src/legacy/`、`src/old/`、`src/deprecated/`）。**真实旧路径每个项目特定**，由项目首次 init 后视情况补进 hook 脚本 CONFIG。

### 扩展指南

如果你的项目栈不在上面 4 个 preset 里（如 Rust / Java / Ruby / Elixir），请直接在本节追加新 preset 定义，并在产物 2 的 `PRESET_REGISTRY` 中注册。模板鼓励社区共建 preset。

---

## 你的职责：按工具落地以下产物

按顺序生成（路径按"工具适配矩阵"对应宿主替换；下面以 Cursor 为例）：

1. **维护子 Agent** `project-memory-maintainer`，按宿主推荐模型（见产物 1 的模型推荐表）。
2. **Hook 预检脚本** `memory-precheck.mjs` — 会话结束类 hook 触发前判断变更是否值得维护记忆（脚本三工具通用，只换路径）。
3. **Hook 注册** — 按宿主格式注册脚本（Cursor `hooks.json` / Claude `settings.json` / Codex `config.toml`+`hooks.json`）。
4. **`.memory/` 骨架** — `记忆索引.md`（含复用入口索引 + 放置决策图 + 完整分工路由表）、`项目总览.md`、`术语表.md`、`跨分支在研功能地图.md`、`待确认问题.md`；**只 gitignore 两个运行期 json，正文入库**（团队共享 + 版本历史）。
5. **codegraph 供给（委托官方安装器）** — 检测缺失则跑 `npx @colbymchenry/codegraph`（自动识别并配置当前工具）+ `codegraph init -i`；不自写各工具 MCP 配置。
6. **记忆宪法（始终生效的极小规则）** — 写入宿主常驻指令面（Cursor `.mdc` / Claude `CLAUDE.md` / Codex `AGENTS.md`）：写入边界 + 决策前先查索引 + 一句分工路由 + codegraph 自愈安装。详细路由表下沉到 `记忆索引.md`，不进常驻规则。
7. **初始化基线** — 跑一次 `memory-precheck.mjs --mark-done`。

不做：

- 不修改业务代码、不修改依赖。
- 不生成**通用**架构规则（那是架构规则初始化的职责）。**唯一破例**：记忆宪法，因为它跟记忆系统紧耦合。
- 不写、不改 codegraph 的指令文件——交给 codegraph 官方安装器。
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

1. **确认 `TOOL`**（见"0. 宿主工具识别"）。后续所有路径/格式按它走。
2. 项目根是否已有架构规则（`.cursor/rules/**` 等）？没有则提示"建议先生成架构规则再部署记忆系统"，并询问是否仍要继续。
3. 项目是否在 git 仓库内？Hook 预检脚本依赖 `git`，不在 git 仓库要提示用户。
4. 是否已存在维护子 Agent 或 `.memory/`？存在则先读取并询问是否覆盖。
5. **codegraph 与 Node 可用性检测**（仅记录状态，安装在产物 5）：
   - `node --version` / `npm --version`：Node 工具链是否可用。
   - `codegraph --version`（或 `where codegraph` / `which codegraph`）：codegraph CLI 是否已装。
   - 是否存在 `.codegraph/`（含 `codegraph.db`）：当前项目是否已建索引。

   记入 `CODEGRAPH_STATE`：
   - `ready`：CLI 已装 + 索引已存在 → 产物 5 跳过。
   - `cli_only`：CLI 已装但无索引 → 产物 5 只跑 `codegraph init -i`。
   - `missing`：CLI 未装但 Node 可用 → 产物 5 走官方安装器完整链。
   - `no_node`：Node/npm 不可用 → 产物 5 跳过并在摘要标注"缺少 Node 工具链"。

---

## 产物 1：维护子 Agent

### 模型推荐（按维护员任务画像选）

维护员是**"读多写少的蒸馏型"任务**：读源码 + git diff + 旧记忆，反查路径，产出结构化中文业务文档。需要稳的指令遵循、保守判断（不编造、必反查），**不需要顶级推理**；且后台高频跑、**成本敏感**。所以中端模型是甜点区——顶配浪费，最便宜档在"判断哪些值得记 / 语义消歧"上偏弱。

| 工具 | 推荐默认 | 字段写法 | 升 / 降档 |
|---|---|---|---|
| Cursor | `inherit`（或固定一个 Sonnet 档） | `model: inherit` | 想稳定质量就固定 Sonnet 档 |
| Claude Code | Sonnet | `model: sonnet`（= claude-sonnet-4-6） | 小项目降 `haiku`；超大/超复杂要高质量蒸馏才上 `opus`（默认别上，贵且过剩） |
| Codex | gpt-5.4-mini | `model = "gpt-5.4-mini"` + `model_reasoning_effort = "low"`（或 medium） | 复杂项目升 `gpt-5.5` |

> 依据：Anthropic 官方建议 haiku 用于只读探索、sonnet 用于常规工作、opus 用于架构/安全；OpenAI 官方点名 `gpt-5.4-mini` 适合 "read-heavy scans / large-file review / 返回蒸馏结果的 worker"——正是维护员画像。

### 子 Agent 文件（按工具选 frontmatter，正文三工具共用）

**Cursor** → `.cursor/agents/project-memory-maintainer.md`：

```markdown
---
name: project-memory-maintainer
model: inherit
description: 维护当前项目的中文项目记忆层。较大的代码或架构变更后应主动使用；当变更影响模块边界、API 契约、公共组件、状态、权限、数据访问或项目约定时必须使用；当用户提到项目记忆、记忆维护、项目情况或知识沉淀时必须使用。写入 .memory/** 必须由本子 Agent 执行，主 Agent 不得直接编辑 .memory/**。
is_background: true
---
```

**Claude Code** → `.claude/agents/project-memory-maintainer.md`：

```markdown
---
name: project-memory-maintainer
description: 维护当前项目的中文项目记忆层。较大代码/架构变更后使用；影响模块边界、API 契约、公共组件、状态、权限、数据访问或项目约定时必须使用。写入 .memory/** 必须由本子 Agent 执行。
model: sonnet
---
```

**Codex** → `.codex/agents/project-memory-maintainer.toml`（Codex 不自动 spawn，需主 Agent/用户显式唤起）：

```toml
model = "gpt-5.4-mini"
model_reasoning_effort = "low"
instructions = """
（把下面"项目记忆维护员"正文粘进这里）
"""
```

正文（三工具共用，紧跟各自 frontmatter 之后 / 填进 Codex 的 `instructions`）：

````markdown
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

- 由宿主工具的"会话结束类" hook 提示触发：Cursor `stop` / `sessionEnd`；Claude Code `Stop`（自动转 `SubagentStop`）/ `SessionEnd`；Codex 因不自动 spawn，由 hook 提示后主 Agent/用户显式唤起。

## 运行条件

只有当本次 Agent 工作产生较大的代码或架构相关变化时才运行。普通问答、文档修改、记忆修改、规则修改、无文件变化、小修小补，直接 no-op。

## 允许读取

- 项目源码
- 配置文件
- package / 依赖文件
- 当前 git diff
- 已有项目记忆
- `codegraph_*` 工具（v4：**仅自检阶段**校验路径/符号是否存在；不可用时回退 git plumbing / Glob）

## 允许写入

- `.memory/**`

## 禁止写入

- 源码目录
- 配置文件 / 依赖文件
- 工具配置目录：`.cursor/**` / `.claude/**` / `.codex/**`（规则、commands、agents、hooks 都不许动）
- 任何非 `.memory/` 目录

## 记忆层要求

1. 除根目录 `.memory` 外，内部目录名、文件名、正文内容必须全部使用中文。
2. 按业务模块或能力模块建立目录，不按源码目录机械复制。
3. 每个模块记录：模块职责、业务流程、数据契约、关键规则、已知风险。
4. 记忆文件不是变更日志，不记录"本次改了什么"。
5. 只记录项目稳定情况，不记录临时猜测。
6. 不复述代码实现细节，也不重复 codegraph 答得了的纯结构信息（调用关系、数据源路径、调用链、符号位置）——除非该结构信息**本身承载业务含义**（如"刻意只对接 X 服务以满足合规约束"）。结构信息查询请走 `codegraph_*` 工具，本档不再重复。另严格挡掉这些（H 写入黑名单）：函数签名 / 参数 / 返回值 / 类型、代码注释或 JSDoc 的转述、临时进度 / TODO、低复用价值的过度细节、changelog 式「本次改了什么」记录。
7. 来源标注降为**模块级**（标到"本模块"即可），不必每条堆具体文件路径 / 行号——精确符号定位交给 codegraph。
8. 不确定内容写入"待确认问题.md"，不能伪造成事实。
9. 没有值得沉淀的项目知识则 no-op，不要强行更新。
10. 每次只更新受影响模块，不重写整个记忆层。
11. 记忆内容应帮助 Agent 判断代码应该放哪里、该复用什么、哪些风格和边界不能破坏。
12. **多分支工作流：记忆不锚定当前检出分支**。分支切换频繁，"当前检出分支恰好没有某文件"不代表该能力不存在或已废弃。
    - "当前事实"以**集成线**（通常 dev / develop / main，按项目实际）为准，而非临时检出的 feature 分支。
    - 某能力只在 feature 分支迭代、尚未并入集成线时，记入 `跨分支在研功能地图.md`（功能 → 分支 → 一句话状态），**不写成模块档案的当前事实，也绝不写"当前分支没有 X"这种无用噪音**。
    - "哪个分支在迭代什么"对开发者和 AI 都是高价值导航信息，而 codegraph 只索引当前检出、给不了——这是 .memory 的独特价值。
13. **维护即去冗余（增量，不全量）**：维护某模块时，顺手删掉该模块档案里 codegraph 已能回答的存量结构冗余（旧函数签名、纯文件路径、调用关系）。只清理你正在维护的这个模块，**不为去冗余单独全量扫描整个 .memory**（那会反向耗 token）。

## 维护后强制自检

写入 `.memory/**` 后，维护员必须执行以下自检，**不通过则禁止刷新基线**：

1. **反查源码路径 / 符号（v4：优先 codegraph，回退 git plumbing）**：扫描本次新增 / 修改内容中出现的所有源码路径（`src/xxx`）、目录名、API 入口、模块名、符号名，校验它们当前是否真实存在。
   - **首选 codegraph（更准、sub-ms、只回结构事实，比 grep/read 试错省 token）**：`codegraph_search <符号/文件>` 确认存在与位置。这是 v4 把 codegraph 设为维护依赖的**唯一**用途。
   - **codegraph 不可用时回退 git plumbing**（判定基线是**集成线** dev/develop/main，首次运行确认一次，不锚定当前检出分支）：`git cat-file -e <集成线>:<path>` 成功 = 该路径在集成线存在 = 可作为当前事实；某能力在集成线存在但不在当前工作树时，用 `git show <集成线>:<path>` 读集成线版本写准内容。
   - 无论用哪条，都**不要只看当前工作树、也不要切分支**。
2. **路径在集成线不存在时四选一**：
   - 改成集成线上的实际路径。
   - 只在某 feature 分支存在 → 移到 `跨分支在研功能地图.md`（功能 → 分支 → 状态），不要当模块档案的当前事实。
   - 明确标注为"历史路径（已迁出，现位置：X）"。
   - 删除该记忆。

   **禁止把集成线不存在的路径当当前事实保留；也禁止记录"当前检出分支缺少 X"这种噪音。**
3. **历史路径特别注意**：涉及 `src/lib/`、`src/types/`、`src/components/common`、`src/stores`、`src/constants` 等已弃用路径时，必须显式写明"历史路径"或迁移到当前 `src/core` / `src/shared` / `src/ui`。

这条直接针对两类事故：① 2026-05-25 在 shirehub-central 发现的"写完后路径过期、AI 照此放错代码"；② 2026-05-29 在 shirehub 发现的"以临时 feature 分支为基线、把别的分支在研功能误判为过期路径、并写入大量'当前分支缺少 X'噪音"。

## 最小可维护单元 / 信息密度

- **单次维护范围 ≤ 1 个业务模块 / 1 个横切能力**。如果变更跨多个模块，只更新索引 + 最关键模块，剩余写入"待维护清单"，不一次铺开。
- **浅文档禁令**：如果某个模块的文档只能写出"类型在哪 / API 在哪 / 页面在哪"三句话，应**合并到 `模块档案/总览.md`**，不要单独成册（不要为了"覆盖完整"凑四件套浅文档）。
- **模块档案的最低质量门**（与 codegraph 配合，去结构化、强化业务化）：

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

这条直接针对 shirehub-central 评估中发现的"spaces / members 写 300+ 行，dashboard / compliance / plans 只十几行浅描述"覆盖不均问题，以及 `.memory` 437KB 持续膨胀问题。同时通过"去结构化、强化业务化"，让 .memory 与 codegraph 分工更清晰、子 Agent 调用频率自然降低（业务知识变化比代码结构慢得多）。

## 维护完成后

**v4 先更新跨分支地图人读表格**：若本轮维护涉及某分支在研功能，在 `.memory/跨分支在研功能地图.md` 表格里登记/更新 功能 / 分支 / 负责人（`git config user.name`）/ 状态 / 上次维护。机读锚点 `<!-- mem-meta -->` 由下面 `--mark-done` 自动写（who/when/branch/head），你只管人读那几列。

无论本轮是真维护了，还是判断 no-op，结束前都要先完成"维护后强制自检"；自检通过后执行（路径按宿主工具替换 `.cursor/` → `.claude/` / `.codex/`）：

```bash
node .cursor/hooks/memory-precheck.mjs --mark-done
```

这会把当前工作区作为新基线落盘，下次 hook 仅检查"自基线以来的新增量"，避免反复对同一批未提交的变更重复触发提示。

## 输出目标

让未来的 AI Agent 和开发者能快速理解当前项目的业务模块、模块边界、关键流程、工程风格、复用入口和风险点。
````

## 产物 2：Hook 预检脚本

写入宿主对应路径（Cursor `.cursor/hooks/memory-precheck.mjs` / Claude `.claude/hooks/memory-precheck.mjs` / Codex `.codex/hooks/memory-precheck.mjs`）。脚本三工具**通用**，内容：

> 生成脚本前，必须先按"Preset 选择"确定 `selectedPreset`。
> 下面代码中的 `SELECTED_PRESET = '<selected-preset>'` 必须替换为实际 preset 名。
> **路径替换**：脚本以 Cursor 路径为示例；写入非 Cursor 工具时，把脚本内 followup 文案里出现的 `node .cursor/hooks/memory-precheck.mjs`（共 2 处）替换为对应工具路径。脚本逻辑本身与工具无关。
> `INCLUDE_PATTERNS` / `CORE_CONFIG_PATTERNS` / `ARCHITECTURE_PATTERNS` 从 `PRESET_REGISTRY[selectedPreset]` 读取；`EXCLUDE_PATTERNS` 为所有 preset 共享。
> `lintMemoryStalePathPatterns` 使用通用占位，真实旧路径由项目后续维护时按情况补进 CONFIG。

```javascript
#!/usr/bin/env node
/**
 * 项目记忆维护预检 Hook
 *
 * 由会话结束类 hook（Cursor stop/sessionEnd、Claude Code Stop/SessionEnd 等）调用，
 * 判断是否要提示主 Agent 调用 project-memory-maintainer 子代理维护 .memory/。
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
 *
 *   ── v4 团队化增量（全程代码判断、零 AI）──
 *   6. 分支感知触发 —— 纳入「当前分支 / 分支领先集成线提交数 / 距上次维护时间」三维度。
 *   7. 时间衰减门槛 —— 距上次维护越久，文件/提交阈值越低（连续缩放，非硬阈值）：
 *      <2天 ×1.5（更难触，别烦）；2-7天 ×1.0；>7天 ×0.5；>14天 有相关变更即触发。
 *   8. 跨成员去重 —— 上次维护到的 commit 记在入库的 `跨分支在研功能地图.md` 机读锚点
 *      `<!-- mem-meta: {...} -->` 里；当前分支 HEAD 已被该锚点 head 覆盖则跳过（团队成员 pull 即共享）。
 *   9. 防膨胀信号 —— 统计 `.memory/**.md` 体积，单文件/总量超阈值即在提示里追加精简建议（零 AI）。
 *  10. lint 增 changelog 检测 —— `--lint-memory` 额外扫描"本次改了什么"式 changelog 噪音。
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
    /^\.memory\//, /^\.cursor\//, /^\.claude\//, /^\.codex\//, /^\.omc\//, /^\.omx\//, /^AIConfig\//,
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
    /** 自上次维护以来变更文件数 ≥ 此值才触发（会被时间衰减因子缩放） */
    deltaFileThreshold: 5,
    /** 自上次维护以来变更行数 ≥ 此值才触发（按 deltaFiles 相对 HEAD 计；会被时间衰减因子缩放） */
    deltaLineThreshold: 200,
    /** 距离上次提示的冷却时间（分钟）；冷却内即使有新增量也不重复提示 */
    cooldownMinutes: 30,
    /** 是否要求 HEAD 前进（commit 之后）才计入触发分数；默认关闭 */
    requireHeadAdvance: false,
    // ── v4 团队化配置 ──
    /** 集成线候选；探测时取第一个本地存在的分支作为"集成线"，用于算分支领先提交数 */
    integrationBranchCandidates: ['dev', 'develop', 'main', 'master'],
    /** 当前分支领先集成线的提交数 ≥ 此值即独立触发（攒了不少活该维护了；会被时间衰减缩放） */
    branchAheadThreshold: 10,
    /** 距上次维护 > 此天数且有任何相关变更即触发（长期不维护的兜底；与时间衰减 >14天 规则一致） */
    staleMaintenanceDays: 14,
    /** 单个 .memory md 文件软上限（字节）；超过即在提示里追加"该文件膨胀了考虑精简" */
    memoryFileSoftLimitBytes: 8192,
    /** .memory md 总量软上限（字节）；超过即在提示里追加整体精简建议 */
    memoryTotalSoftLimitBytes: 102400,
    /** 旧路径占位；真实旧路径每个项目特定，请按项目情况补进 */
    lintMemoryStalePathPatterns: [
        'src/legacy/',
        'src/old/',
        'src/deprecated/',
    ],
    /** changelog 式噪音关键词；--lint-memory 命中（且无"历史"语境）即判 lint 失败，逼记忆别写成变更日志 */
    lintChangelogPatterns: [
        '本次修改', '本次改动', '本次新增', '本次变更', '## 变更记录', '## 更新日志', '本轮改了',
    ],
}

const STATE_FILE = '.memory/.hook-state.json'
/** 团队共享维护元数据载体：人读表格 + 机读锚点共处一个入库文件 */
const CROSS_BRANCH_MAP_FILE = '.memory/跨分支在研功能地图.md'
/** 机读锚点正则：从跨分支地图里提取 <!-- mem-meta: {...} --> 的 JSON（比解析 md 表格稳健） */
const MEM_META_RE = /<!--\s*mem-meta:\s*(\{[\s\S]*?\})\s*-->/
const LIST_LIMIT = 12

function runGit(args, { silent = false } = {}) {
    try {
        return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim()
    } catch (err) {
        // silent：探测候选分支是否存在这类"预期可能失败"的调用，不打 stderr 噪音
        if (!silent) process.stderr.write(`[memory-hook] git ${args.join(' ')} 失败：${err.message}\n`)
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

const daysSince = (iso) => minutesSince(iso) / 1440

/**
 * 时间衰减因子：距上次维护越久，阈值缩放越小（越容易触发）。
 * <2天 ×1.5（刚维护完，别拿小变动烦人）；2-7天 ×1.0；>7天 ×0.5；>14天 →0（有相关变更即触发）。
 * 返回 0 表示阈值归零：任意相关变更都过门槛。
 */
function decayFactor(days) {
    if (days < 2) return 1.5
    if (days <= 7) return 1.0
    if (days <= 14) return 0.5
    return 0
}

/** 探测集成线：取第一个本地存在的候选分支（dev/develop/main/master）。算分支领先提交数用。 */
function resolveIntegrationBranch() {
    for (const b of CONFIG.integrationBranchCandidates) {
        if (runGit(['rev-parse', '--verify', '--quiet', b], { silent: true })) return b
    }
    return null
}

/** 当前检出分支名（detached 时回退 'HEAD'） */
const currentBranch = () => runGit(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD'

/** 当前分支领先集成线的提交数 = git rev-list --count <集成线>..HEAD */
function branchAheadCount(integration) {
    if (!integration) return 0
    const n = Number.parseInt(runGit(['rev-list', '--count', `${integration}..HEAD`]), 10)
    return Number.isFinite(n) ? n : 0
}

/** 读入库跨分支地图里的机读锚点（团队共享的维护元数据）。无则返回 null。 */
function readMemMeta() {
    const f = resolve(CROSS_BRANCH_MAP_FILE)
    if (!existsSync(f)) return null
    try {
        const m = readFileSync(f, 'utf8').match(MEM_META_RE)
        return m ? JSON.parse(m[1]) : null
    } catch {
        return null
    }
}

/**
 * 把机读锚点写/更新进跨分支地图（hook 的职责；人读表格由子 Agent 维护，两者共处一文件互不覆盖）。
 * 已有锚点就原地替换，没有就插到第一个一级标题之后；文件不存在则建最小骨架。
 */
function writeMemMetaIntoMap(meta) {
    const f = resolve(CROSS_BRANCH_MAP_FILE)
    const anchor = `<!-- mem-meta: ${JSON.stringify(meta)} -->`
    let text = existsSync(f)
        ? readFileSync(f, 'utf8')
        : '# 跨分支在研功能地图\n\n> 记录各分支在迭代的功能：功能 → 分支 → 负责人 → 状态。由 project-memory-maintainer 维护人读表格；机读锚点由 hook 维护。\n'
    if (MEM_META_RE.test(text)) {
        text = text.replace(MEM_META_RE, anchor)
    } else {
        const lines = text.split('\n')
        const idx = lines.findIndex((l) => l.startsWith('# '))
        if (idx >= 0) lines.splice(idx + 1, 0, anchor)
        else lines.unshift(anchor)
        text = lines.join('\n')
    }
    try {
        mkdirSync(dirname(f), { recursive: true })
        writeFileSync(f, text)
    } catch (err) {
        process.stderr.write(`[memory-hook] 写入跨分支地图锚点失败：${err.message}\n`)
    }
}

/** 统计 .memory 下 md 体积，找出超软上限的文件（防膨胀信号，零 AI） */
function computeMemorySizes() {
    const files = listMarkdownFiles(resolve('.memory'))
    let total = 0
    const oversized = []
    for (const f of files) {
        try {
            const sz = statSync(f).size
            total += sz
            if (sz > CONFIG.memoryFileSoftLimitBytes) oversized.push({ file: normalizePath(f), bytes: sz })
        } catch { /* ignore */ }
    }
    return { total, oversized, fileCount: files.length }
}

function emitFollowup(message) {
    process.stdout.write(JSON.stringify({ followup_message: message }))
}

function buildMessage({ deltaFiles, reasons, sizeInfo }) {
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
        '- 写入黑名单（严格挡在 .memory 外）：代码注释/JSDoc 转述、临时进度/TODO、低复用价值的过度细节、函数签名/参数/返回值、纯文件路径定位——这些查 codegraph 或源码，不进记忆。',
        '- 维护某模块时顺手删掉该模块档案里 codegraph 已能回答的存量结构冗余（增量去冗余，别全量扫）。',
        '- 来源标注降为模块级：标到"本模块"即可，不必每条堆具体文件/行。',
        '- 维护后同步更新本文件（跨分支在研功能地图.md）的人读表格：功能 / 分支 / 负责人（git user.name）/ 状态 / 上次维护。',
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
        ...(sizeInfo && (sizeInfo.oversized.length > 0 || sizeInfo.total > CONFIG.memoryTotalSoftLimitBytes) ? [
            '记忆体积提醒（防膨胀，零 AI 统计）：',
            ...(sizeInfo.total > CONFIG.memoryTotalSoftLimitBytes
                ? [`- .memory 总量 ${(sizeInfo.total / 1024).toFixed(0)}KB 超软上限 ${(CONFIG.memoryTotalSoftLimitBytes / 1024).toFixed(0)}KB，维护时优先精简冗余。`]
                : []),
            ...sizeInfo.oversized.map((o) => `- ${o.file} 已 ${(o.bytes / 1024).toFixed(1)}KB 超单文件软上限，考虑拆分或删 codegraph 已覆盖的结构冗余。`),
            '',
        ] : []),
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
    const branch = currentBranch()
    const by = runGit(['config', 'user.name']) || 'unknown'
    const nowIso = new Date().toISOString()
    const prev = readState(stateFile)
    writeState(stateFile, {
        ...prev,
        baselineHead: head,
        baselineFingerprint: fp.files,
        baselineHash: fp.hash,
        lastMaintainedAt: nowIso,
        lastTriggerHash: null,
    })
    // v4：把"谁/何时/在哪个分支维护到哪个 commit"写进入库的机读锚点，供团队跨成员去重 + 时间衰减判断。
    // 合并现有锚点，只更新当前分支这一项，保留其他分支的已维护记录。
    const prevMeta = readMemMeta() || {}
    const lastMaintained = { ...(prevMeta.lastMaintained || {}), [branch]: head }
    writeMemMetaIntoMap({ lastMaintained, updatedAt: nowIso, by, branch })
    process.stdout.write(JSON.stringify({
        ok: true,
        message: `已刷新记忆维护基线（分支 ${branch} @ ${head.slice(0, 8)}，维护者 ${by}），纳入 ${allRelevant.length} 个相关文件`,
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
    const meta = readMemMeta()
    const inRepo = inGitRepo()
    const branch = inRepo ? currentBranch() : null
    const integration = inRepo ? resolveIntegrationBranch() : null
    const aheadCount = integration ? branchAheadCount(integration) : null
    const lastMaintainedIso = meta?.updatedAt || state.lastMaintainedAt || null
    const days = lastMaintainedIso ? daysSince(lastMaintainedIso) : null
    const sizes = computeMemorySizes()
    process.stdout.write(JSON.stringify({
        stateFile,
        config: CONFIG,
        state,
        v4: {
            branch,
            integrationBranch: integration,
            branchAheadCount: aheadCount,
            lastMaintainedAt: lastMaintainedIso,
            daysSinceMaintained: days != null ? Number(days.toFixed(2)) : null,
            decayFactor: days != null ? decayFactor(days) : null,
            memMeta: meta,
            memorySize: {
                totalKB: Number((sizes.total / 1024).toFixed(1)),
                fileCount: sizes.fileCount,
                oversized: sizes.oversized,
            },
        },
    }, null, 2))
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

/** changelog 关键词豁免：否定/指令语境（"不要写本次改了什么"）或关键词被引号包裹（作为反例引用）时不算噪音 */
function isChangelogException(line, keyword) {
    if (/不要|不应|不得|禁止|别[写记把]|勿|避免/.test(line)) return true
    const quoted = [`"${keyword}"`, `“${keyword}”`, `「${keyword}」`, `'${keyword}'`]
    return quoted.some((q) => line.includes(q))
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
                    kind: 'stale-path',
                    file: normalizePath(file),
                    line: index + 1,
                    lineContent,
                    pattern,
                })
            }
            // v4：changelog 式噪音（"本次改了什么"）本就不该进长期记忆，命中即判失败，无历史语境豁免
            for (const pattern of CONFIG.lintChangelogPatterns) {
                if (!lineContent.includes(pattern)) continue
                if (isChangelogException(lineContent, pattern)) continue
                hits.push({
                    kind: 'changelog',
                    file: normalizePath(file),
                    line: index + 1,
                    lineContent,
                    pattern,
                })
            }
        })
    }

    const ok = hits.length === 0
    const staleCount = hits.filter((h) => h.kind === 'stale-path').length
    const changelogCount = hits.filter((h) => h.kind === 'changelog').length
    process.stdout.write(JSON.stringify({
        ok,
        total_files: files.length,
        hits,
        message: ok
            ? '未发现旧路径或 changelog 噪音'
            : `发现 ${staleCount} 处疑似未标注历史语境的旧路径 + ${changelogCount} 处 changelog 式噪音`,
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

    // ── v4 分支感知 + 时间衰减 + 跨成员去重（全程代码判断，零 AI）──
    const meta = readMemMeta()
    const branch = currentBranch()
    // 上次维护时间优先取入库锚点（团队共享），回退单机 state
    const lastMaintainedIso = meta?.updatedAt || state.lastMaintainedAt
    const days = daysSince(lastMaintainedIso)
    const factor = decayFactor(days)

    // 跨成员去重：当前分支 HEAD 已被锚点标记为已维护、且工作区无新增量 → 别人已维护过，跳过
    const maintainedHead = meta?.lastMaintained?.[branch]
    if (!force && maintainedHead && maintainedHead === head && deltaFiles.length === 0) return

    // 时间衰减后的有效阈值（factor=0 时阈值归零：有相关变更即过门槛，对应 >14 天兜底）
    const fileThreshold = Math.ceil(CONFIG.deltaFileThreshold * factor)
    const lineThreshold = Math.ceil(CONFIG.deltaLineThreshold * factor)
    const aheadThreshold = Math.ceil(CONFIG.branchAheadThreshold * factor)

    const deltaLines = countLinesAgainstHead(deltaFiles)
    const integration = resolveIntegrationBranch()
    const aheadCount = branchAheadCount(integration)
    const touchesCoreConfig = deltaFiles.some((p) =>
        CORE_CONFIG_PATTERNS.some((re) => re.test(p)))
    const touchesArchitecture = deltaFiles.some((p) =>
        ARCHITECTURE_PATTERNS.some((re) => re.test(p)))

    const reasons = []
    if (deltaFiles.length >= fileThreshold)
        reasons.push(`自上次维护以来变更文件数 ${deltaFiles.length} ≥ ${fileThreshold}（距上次 ${days.toFixed(1)} 天，衰减×${factor}）`)
    if (deltaLines >= lineThreshold)
        reasons.push(`自上次维护以来变更行数 ${deltaLines} ≥ ${lineThreshold}（衰减×${factor}）`)
    if (integration && aheadThreshold > 0 && aheadCount >= aheadThreshold)
        reasons.push(`当前分支 ${branch} 领先集成线 ${integration} ${aheadCount} commit ≥ ${aheadThreshold}`)
    if (days > CONFIG.staleMaintenanceDays)
        reasons.push(`距上次维护 ${days.toFixed(0)} 天 > ${CONFIG.staleMaintenanceDays} 天（长期未维护兜底）`)
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

    emitFollowup(buildMessage({ deltaFiles, reasons, sizeInfo: computeMemorySizes() }))
}

main()
```

## 产物 3：Hook 注册（按宿主格式）

三工具的脚本相同，**注册格式不同**。已存在配置时一律"先读后合并"，不直接覆盖。

### Cursor → `.cursor/hooks.json`

```json
{
  "version": 1,
  "hooks": {
    "stop": [
      { "command": "node .cursor/hooks/memory-precheck.mjs", "timeout": 15, "loop_limit": 1, "failClosed": false }
    ],
    "sessionEnd": [
      { "command": "node .cursor/hooks/memory-precheck.mjs", "timeout": 15, "loop_limit": 1, "failClosed": false }
    ]
  }
}
```

合并规则：已存在则合并 `stop` / `sessionEnd` 数组，保留其它字段；缺 `timeout` / `loop_limit` / `failClosed` 则补齐。

### Claude Code → `.claude/settings.json` 的 `hooks`

Claude Code 的 hook schema 与 Cursor 不同（事件名首字母大写、`hooks` 数组里每项是 `{type:"command", command}`）。`Stop` 表示主 Agent 回复结束、`SessionEnd` 表示会话结束：

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node .claude/hooks/memory-precheck.mjs" } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "node .claude/hooks/memory-precheck.mjs" } ] }
    ]
  }
}
```

`.claude/settings.json` 可入库随仓库走（团队共享）。已存在则合并对应事件数组。

### Codex → `.codex/config.toml` + `.codex/hooks.json`

Codex 需先在 `config.toml` 打开 hooks 特性，再在 `hooks.json` 定义：

```toml
# .codex/config.toml
[features]
hooks = true
```

```json
// .codex/hooks.json
{
  "hooks": {
    "SessionStart": [
      { "command": "node .codex/hooks/memory-precheck.mjs" }
    ],
    "PostToolUse": [
      { "command": "node .codex/hooks/memory-precheck.mjs" }
    ]
  }
}
```

> 说明：Codex hooks 事件集与 Cursor/Claude 不完全一致（以 `SessionStart` / `PostToolUse` 等为主），且子 Agent 不自动 spawn。所以 Codex 上 hook 的作用是"提示该维护了"，真正的维护由主 Agent/用户**显式唤起** `project-memory-maintainer`。若当前 Codex 版本 hooks 仍为实验特性或事件名有变，按其文档调整，并在记忆宪法里写明"Codex 下记忆维护需显式触发"。

## 产物 4：.memory/ 骨架

除 `记忆索引.md` 给出**结构骨架**外，其余文件留空骨架（一级标题 + 一句占位说明）。

`记忆索引.md` 是 `.memory` 的活跃入口，也是宪法第 2 条"决策前先查"的落点。写入以下骨架（内容由子 Agent 后续填，但**章节结构现在就建好**）：

````markdown
# 记忆索引

> `.memory/` 入口。写代码 / 做架构决策前先读本文件：判断**放哪、复用什么、碰哪条红线**。由 project-memory-maintainer 子 Agent 维护。

## 放置决策图（新代码该放哪）
> 子 Agent 维护：常见改动类型 → 该进哪层 / 哪个目录 / 哪个 barrel。先占位。

## 复用入口索引（想做 X，先看有没有现成的 Y）
> 子 Agent 维护：高频能力 → 现有实现入口，避免重复造轮子。先占位。

## 专题与模块档案
> 子 Agent 维护：各全局文件与 `模块档案/<模块>/总览.md` 的一句话职责 + 推荐阅读顺序。

## 完整分工路由表（业务 → .memory / 结构 → codegraph）
| 你想知道 | 走哪 | 入口 |
|---|---|---|
| 模块业务上负责什么 | `.memory` | `模块档案/<模块>/总览.md` |
| 术语 / 别名 / 同义词 | `.memory` | `术语表.md` |
| 跨模块协作契约 / 谁不能调谁 | `.memory` | 模块档案 - 跨模块协作契约 |
| 为什么这么设计 / 决策来源 | `.memory` | 模块档案 - 设计决策 |
| 红线 / 已知风险 | `.memory` | 模块档案 - 红线 / 已知风险 |
| 工程风格与约定 | `.memory` | `项目总览.md` |
| 某功能在哪个分支在研 | `.memory` | `跨分支在研功能地图.md` |
| 符号定义 / 调用 / 影响 / 调用链 / 签名 | `codegraph` | `codegraph_search/callers/callees/impact/trace/node/explore/context/files`；无 codegraph 则 grep/read |

## 反模式
- ❌ 把 `.memory` 当代码地图翻"X 在哪个文件"——纯结构信息查 codegraph。
- ❌ 让 codegraph 总结业务——它只看 AST，看不到"为什么"。
- ❌ 同一信息两处都写，会漂移：纯结构归 codegraph，业务语义归 `.memory`。
````

> 把"详细路由表 / 反模式"放进按需加载的索引、而非常驻规则，是 v3 降固定税的关键：常驻只留极小宪法，AI 真要决策时才来读这张表。

其余骨架文件（留空，一级标题 + 一句占位）：

```text
.memory/
  项目总览.md          ← "项目总览" + "由子 Agent 在足够大的变更后自动沉淀"
  术语表.md            ← "术语表"
  跨分支在研功能地图.md ← v4 团队共享维护元数据载体（骨架见下方，含机读锚点 + 负责人列）
  待确认问题.md        ← "待确认问题" + "子 Agent 把不确定内容写此处，由人审定"
```

其中 **`跨分支在研功能地图.md` 是 v4 团队共享维护元数据载体**，不留空，按下面骨架建（人读表格 + 机读锚点共处一文件）：

```markdown
# 跨分支在研功能地图
<!-- mem-meta: {"lastMaintained":{},"updatedAt":null,"by":null} -->

> 记录各分支在迭代的功能：功能 → 分支 → 负责人 → 状态。
> 人读表格由 project-memory-maintainer 维护；机读锚点 `<!-- mem-meta -->` 由 hook `--mark-done` 自动写（who/when/branch/head），**勿手改**。

| 功能 | 分支 | 负责人 | 状态 | 上次维护 |
|---|---|---|---|---|
| （示例占位）权限重构 | feat-x | moxue | 进行中 | 2026-06-02 |
```

不要创建任何业务模块目录——那由子 Agent 首次实际维护时按项目代码自动生成。

### gitignore：只忽略两个运行期 json，正文入库

`.memory/` 正文（索引、总览、术语表、模块档案……）**应当入库**，让团队共享同一份项目记忆、并有版本历史与 review。只有两个机器本地的运行期状态文件不入库：

```text
# 项目记忆 hook 运行期状态（机器本地，不入库）
.memory/.hook-state.json
# codegraph 状态汇总（机器本地，由产物 5 写入）
.memory/.codegraph-status.json
```

> v3 变更：旧做法常把整个 `.memory/` 忽略掉，导致记忆退化成单机草稿、无法团队共享。除非用户明确要求"记忆只留本地"，否则默认正文入库。

---

## 产物 5：codegraph 供给（委托官方安装器）

codegraph 自带**跨工具安装器**，会自动识别 Cursor / Claude Code / Codex 并写好各自的 MCP 配置与指令文件。**本 Skill 不自写任何 MCP 配置**，只按 `CODEGRAPH_STATE` 调它的官方命令。任何一步失败都**不阻塞**，记入 `CODEGRAPH_STATUS` 供收尾摘要。

### 执行分支

| `CODEGRAPH_STATE` | 执行动作 | 完成后 `CODEGRAPH_STATUS` |
|---|---|---|
| `ready` | 跳过 | `ready` |
| `cli_only` | `codegraph init -i` | `init_done` / `init_failed` |
| `missing` | 跑官方安装器，再 `codegraph init -i` | `ready` / `install_failed` / `init_failed` |
| `no_node` | 跳过 | `no_node` |

### 官方安装命令

- 交互一行（自动识别并配置当前工具、提示装 PATH）：`npx @colbymchenry/codegraph`
- 非交互（自动化部署推荐）：`npm i -g @colbymchenry/codegraph` → `codegraph install --target=<tool> --yes`（`<tool>` = cursor / claude / codex）→ `codegraph init -i`
- 安装器会自动写好当前工具的 codegraph 指令文件（Cursor `.cursor/rules/codegraph.mdc` / Claude `CLAUDE.md` / Codex `~/.codex/AGENTS.md`）——**这些不由本 Skill 写**。

### 执行规则

- 任何一步失败都不抛出，把原始错误前 200 字符收进 `CODEGRAPH_STATUS`。
- `codegraph init -i` 即使失败也不重试，交给用户 / 宪法第 4 条的自愈规则。
- 语言不被 codegraph 支持时，init 仍会成功但索引为空——AI 查不到自然走 grep/read，是预期降级，不算错误。

### 强制 + 兜底（v4 强化）

codegraph 在 v4 里**不再只是主 Agent 的可选结构层，而是维护子 Agent 自检路径/符号的依赖**——所以安装更强、更主动；但**装不上仍不阻塞工作**（子 Agent 自检回退 git cat-file/Glob、主 Agent 结构查询回退 grep/read）。另在 `CODEGRAPH_STATE=missing/no_node` 时，于收尾摘要把"codegraph 未就绪"列为**显著待办**（团队每位成员本地都需装，`.codegraph/` 不入库）。下面状态写法不变：

- 成功（`ready` / `init_done`）→ 宪法的"codegraph 当前状态"块写"已就绪"。
- 失败（`install_failed` / `init_failed` / `no_node`）→ 宪法的"codegraph 当前状态"块写降级提示：AI 结构查询回退 grep/read，并提示用户手动 `npx @colbymchenry/codegraph`。

### 状态汇总落盘

写入 `.memory/.codegraph-status.json`（已 gitignore）：

```json
{
  "status": "ready | init_done | install_failed | init_failed | no_node",
  "checkedAt": "<ISO 时间>",
  "tool": "<cursor | claude-code | codex>",
  "dbPath": ".codegraph/codegraph.db",
  "error": "<原始错误前 200 字符 或 null>"
}
```

后续用户手动装好后删掉此文件，hook / 宪法即不再报告"codegraph 不可用"。

---

## 产物 6：记忆宪法（极小常驻规则）

只写**必须每轮在场**的极小内容，详细路由表已在 `记忆索引.md`（按需加载）。按宿主落到常驻指令面：Cursor 写 `.cursor/rules/04-memory-constitution.mdc`（`alwaysApply: true`）；Claude 追加到 `CLAUDE.md`；Codex 追加到项目 `AGENTS.md`。Claude / Codex 用清晰分隔标记追加，不覆盖既有内容。

> v3 降固定税：旧版有 `04-边界` + `05-路由` 两条 alwaysApply（约 3.4K 字符），把详细路由表、反模式、子 Agent 边界全常驻。现在合并压成下面一条极小宪法（约 0.6K 字符），详细表下沉到按需加载的 `记忆索引.md`，固定税砍约 75%。

宪法正文（Cursor 版含 frontmatter；Claude / Codex 去掉 frontmatter，作为「记忆系统宪法」段追加）：

````markdown
---
description: 记忆系统宪法 —— 写入边界 + 决策前先查索引 + 分工路由 + codegraph 自愈。
alwaysApply: true
---

# 记忆系统宪法（始终生效）

## 1. 写入边界
主 Agent **禁止**直接增删改 `.memory/**`。只有 `project-memory-maintainer` 子 Agent 能写；hook 提示时由主 Agent 委派它。唯一例外：用户明确说"你直接改"且仅 ≤1 行 typo，改完要声明已绕过维护员。

## 2. 决策前先查记忆（写代码 / 做架构决策的第一步）
动手写新代码或做架构决策前，先读 `.memory/记忆索引.md`，据它判断：**放哪、复用什么、碰哪条红线**。索引会指给你该读的模块档案。别跳过这步直接写。

## 3. 分工路由（一句话；细表在记忆索引）
- 业务 / 语义 / 为什么 / 红线 / 放哪 / 复用 → 查 `.memory`（从 `记忆索引.md` 进）。
- 代码结构 / 定义 / 调用 / 影响 / 调用链 / 签名 → 有 codegraph 用 `codegraph_*`；没有就 grep / read。
- 不要互相侵入：纯结构别写进 `.memory`，业务语义别指望 codegraph。

## 4. codegraph 是必需组件（缺失则自愈安装）
codegraph 不仅供主 Agent 做结构查询，**v4 起也是维护子 Agent 自检路径/符号的依赖**。需要结构查询、或维护子 Agent 自检，但 `codegraph_*` 不可用（未注册 / 未安装 / 索引未建）时：
1. 先告知用户：「正在安装记忆系统必需组件 codegraph，请稍候」。
2. 运行 `npx @colbymchenry/codegraph`（自动识别并配置当前工具）+ `codegraph init -i` 建索引，提示重启使 MCP 生效。
3. 装失败（无 node / 无网络 / 受限机器）→ 降级到 grep / read，并明确告诉用户"codegraph 没装上，结构查询暂用原生搜索，可手动 `npx @colbymchenry/codegraph`"，**不阻塞当前工作**。

## codegraph 当前状态
<由产物 5 按 CODEGRAPH_STATUS 填：就绪 / 降级提示>
````

> **Codex 专属补充**（写进 Codex 的宪法段）：Codex 子 Agent 不会自动 spawn，记忆维护由 hook 提示后**显式唤起** `project-memory-maintainer`，不要等它自动后台跑。

### "codegraph 当前状态"块由产物 5 填

- `ready` / `init_done` → 填：✅ codegraph 已就绪，按分工路由正常使用。
- `install_failed` / `init_failed` / `no_node` → 填：⚠️ 本项目 codegraph 暂不可用，结构查询回退 grep/read；可手动 `npx @colbymchenry/codegraph` 后删除 `.memory/.codegraph-status.json` 重新启用。`.memory/` 不受影响。

### 若宿主已有同名常驻规则 / CLAUDE.md / AGENTS.md

"先读后合并"：识别是否已有「记忆系统宪法」段——有就只更新"codegraph 当前状态"块（动态信息），没有就在末尾追加整段。绝不整文件覆盖。

---

## 产物 7：初始化记忆维护基线

前面产物全部就位后，**立即执行一次**（路径按宿主替换 `.cursor/` → `.claude/` / `.codex/`）：

```bash
node .cursor/hooks/memory-precheck.mjs --mark-done
```

这一步至关重要。它会把当前工作区作为"基线"快照落盘到 `.memory/.hook-state.json`。从此 hook 只检查"自基线以来的新增量"，而不是工作区相对 HEAD 的全量差异。

**如果跳过这一步**，第一次触发时 hook 会把所有未提交的工作区变更全部当作"新增量"提示给你，反而立刻造成一次假性触发。

---

## 收尾

产物全部就位后，向用户输出一段简短摘要（路径按宿主工具替换）：

```text
项目记忆维护体系部署完成（v4：团队级 + 与 codegraph 分工）：
- 宿主工具: <cursor | claude-code | codex>
- 选定 preset: <name>
- 维护子 Agent（已按工具推荐模型: Cursor=inherit / Claude=sonnet / Codex=gpt-5.4-mini）
- 会话结束 hook 脚本 + 注册（按工具格式）
- .memory/记忆索引.md（含放置决策图 / 复用入口索引 / 完整路由表）+ 项目总览 / 术语表 / 跨分支在研功能地图 / 待确认问题
- 记忆宪法（极小常驻规则: 写入边界 + 决策前先查索引 + 分工路由 + codegraph 自愈）
- .memory 正文已入库；仅 .hook-state.json / .codegraph-status.json 被 gitignore
- codegraph 当前状态: <CODEGRAPH_STATUS>

分工说明：
- .memory 专注业务领域：术语、模块语义、跨模块协作契约、设计决策、红线、已知风险、放哪/复用
- codegraph 专注代码结构：符号位置、调用链、影响半径（缺失时按宪法第4条自愈安装，装不上则降级 grep/read）
- 子 Agent 维护主体不调用 codegraph；仅自检路径/符号时用 codegraph_search（装不上回退 git cat-file/Glob），保证调用少 + 不可用时仍完整运行
- 团队级（v4）：hook 分支感知触发 + 时间衰减 + 跨成员去重（零 AI）；维护元数据入库共享（跨分支地图的机读锚点 + 人读表格）；记忆防膨胀（H 写入黑名单事前拦 + G 增量去冗余事后删 + 体积信号）

codegraph 当前状态: <CODEGRAPH_STATUS>
  ready / init_done    → 已就绪，AI 按宪法分工路由
  install_failed       → 安装器失败（错误: <error>），宪法已写降级提示
  init_failed          → codegraph init -i 失败（错误: <error>），宪法已写降级提示
  no_node              → 缺少 Node 工具链，宪法已写降级提示

触发节奏（v4：分支感知 + 时间衰减，全程代码判断零 AI）：
- 基础阈值：变更文件数 ≥ 5、行数 ≥ 200、触及核心配置 / 架构敏感区、或当前分支领先集成线 ≥ 10 commit
- 时间衰减门槛：距上次维护 <2天 阈值×1.5、2-7天 ×1.0、>7天 ×0.5、>14天 有相关变更即触发
- 跨成员去重：当前分支 HEAD 已被入库锚点记为已维护则跳过（团队 pull 即共享上次维护点）
- 同一冷却期内（默认 30 分钟）只提示一次；工作区指纹未变则跳过
- 调阈值/衰减/集成线候选改 memory-precheck.mjs 顶部 CONFIG

日常运维命令（路径按宿主替换）：
- node .cursor/hooks/memory-precheck.mjs --mark-done   维护完成 / 判 no-op 后刷新基线
- node .cursor/hooks/memory-precheck.mjs --force       绕过冷却与去重，强制提示一次
- node .cursor/hooks/memory-precheck.mjs --status      打印 CONFIG + 状态 + v4（当前分支 / 领先提交数 / 上次维护时间 / 衰减因子 / 记忆体积）
- node .cursor/hooks/memory-precheck.mjs --reset       清空 hook 状态
- node .cursor/hooks/memory-precheck.mjs --lint-memory 扫描 .memory 旧路径 + v4 changelog 式噪音

接下来：
- 下一次较大代码变更结束时，hook 自动检测并提示（Codex 需显式唤起子 Agent）。
- 子 Agent 首次跑会按项目代码生成业务模块目录，按必填字段（模块职责 / 术语 / 跨模块协作契约 / 设计决策 / 红线）。
- .memory 正文已随仓库入库，团队拉取即获得同一份项目记忆。
```

根据情况追加：

- 项目没有架构规则（除本次宪法外）：

```text
- 检测到本项目尚未生成架构规则，建议先生成架构规则。
```

- `CODEGRAPH_STATUS` 为 `install_failed` / `init_failed` / `no_node`：

```text
- codegraph 当前不可用，宪法已写降级提示。修复后删除 .memory/.codegraph-status.json，并手动 npx @colbymchenry/codegraph + codegraph init -i 重新启用。
- 团队成员拉取后若没装 codegraph：AI 首次需要结构查询时会按宪法第4条自动提示安装；装不上则自动降级 grep/read，不阻塞。
```

不要输出代码 diff、不要输出 changelog 风格的"本次修改"——这次部署是一次性安装，不是日常变更。