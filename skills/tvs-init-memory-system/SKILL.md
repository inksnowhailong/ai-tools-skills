---
name: tvs-init-memory-system
description: 跨工具（Cursor / Claude Code / Codex）一次性部署"团队级记忆系统 + codegraph 分工配合"。生成维护子 Agent、会话结束 hook（分支感知触发判断 + 时间衰减门槛 + 跨成员去重，全程代码判断零 AI）、.memory 骨架（含团队共享维护元数据）、记忆宪法规则、codegraph 自愈安装与初始化基线。**显式调用、不自动触发**——仅当用户明示"运行 tvs-init-memory-system / 部署记忆系统 / init memory / 初始化项目记忆"等需求时，由用户手动唤起本 Skill；AI 不得仅因 description 关键词命中就主动加载执行。
disable-model-invocation: true
---

# tvs-init-memory-system：一次性部署团队级记忆系统 + codegraph 分工配合（v5）

> **v5 账本模型**：`.memory` 只存**不可推导的知识**——业务导航（术语↔入口，AI 领域理解与 codegraph 锚点）、决策日志（append-only，为什么）、红线与约定（违反即错）。可推导内容（模块职责/业务流程/数据契约）一律不存：必然过期且 codegraph 能现场推导。不建模块档案目录树，总量软上限 32KB。

> **⚠️ 调用约束**：本 Skill 不会被 AI 自动触发（`disable-model-invocation: true`）。必须由用户显式说"运行 tvs-init-memory-system / 部署记忆系统 / 初始化项目记忆"等指令后才执行。只是对话里出现"记忆系统"四个字，**不算**。

你被显式调用来为当前项目**一次性安装**项目记忆维护体系。这是一次性工程动作，跑完就结束，不是日常能力。适配 Cursor / Claude Code / Codex。

## 渐进式披露（v5 结构）

本 Skill 拆为「主流程（本文件）+ 按需细节（references/）+ 随包脚本（scripts/）」。**执行到哪一步，再读对应 reference，不要开局全部读入**：

```text
tvs-init-memory-system/
├── SKILL.md                          ← 你正在读的主流程
├── scripts/
│   └── memory-precheck.mjs           ← hook 脚本本体（复制安装，不再抄写）
└── references/
    ├── presets.md                    ← 4 个语言/框架 preset + 选择优先级
    ├── maintainer-agent.md           ← 产物1：维护子 Agent 完整定义（模型推荐 + frontmatter + 正文）
    ├── hook-install.md               ← 产物2+3：脚本安装步骤 + 三工具 hook 注册格式
    ├── memory-skeleton.md            ← 产物4：.memory/ 骨架与 gitignore 规则
    ├── codegraph-provision.md        ← 产物5：codegraph 检测/安装/状态落盘
    ├── constitution.md               ← 产物6：记忆宪法正文（极小常驻规则）
    ├── closing-summary.md            ← 收尾摘要模板
    ├── migration-v5.md               ← 存量 v4 .memory 升级 v5 账本的蒸馏迁移步骤
    └── design-notes.md               ← 设计依据：codegraph × .memory 分工边界全文（不影响执行，答疑时读）
```

## 0. 宿主工具识别（执行第一步）

判定你运行在哪个宿主，记入 `TOOL`：

- `cursor`：存在 `.cursor/`，或你就是 Cursor 内的 Agent。
- `claude-code`：存在 `.claude/`，或你是 Claude Code。
- `codex`：存在 `.codex/`，或项目以 `AGENTS.md` 为主导，或你是 Codex CLI。
- `other`：以上都不是 → 能力降级：只生成 `.memory/` 骨架 + 一份 `AGENTS.md` 记忆宪法，hook / 子 Agent 退化为文档说明，提示用户手动接入。

判不准就直接问用户，别猜。

### 工具适配矩阵（产物 × 工具）

| 逻辑产物 | Cursor | Claude Code | Codex CLI |
|---|---|---|---|
| 维护子 Agent | `.cursor/agents/project-memory-maintainer.md`（`is_background: true`） | `.claude/agents/project-memory-maintainer.md`（`model:`） | `.codex/agents/project-memory-maintainer.toml` |
| Hook 脚本 | `.cursor/hooks/memory-precheck.mjs` | `.claude/hooks/memory-precheck.mjs` | `.codex/hooks/memory-precheck.mjs` |
| Hook 注册 | `.cursor/hooks.json` | `.claude/settings.json` 的 `hooks` | `.codex/config.toml` + `.codex/hooks.json` |
| 记忆宪法 | `.cursor/rules/04-memory-constitution.mdc`（`alwaysApply: true`） | 追加到项目 `CLAUDE.md` | 追加到项目 `AGENTS.md` |
| codegraph 指令文件 | **不写**，由 codegraph 官方安装器写 | 同左 | 同左 |
| `.memory/` 骨架 + 索引 | 工具无关，三者一致 | 同 | 同 |

关键差异（必须遵守）：

- **Cursor**：子 Agent 可 `is_background: true` 后台自动跑。
- **Claude Code**：子 Agent frontmatter 里写 `Stop` hook 会被自动转成 `SubagentStop`；项目级配置可入库。
- **Codex**：子 Agent **不会自动 spawn**——记忆维护是 hook 提示 + 主 Agent/用户显式唤起，必须写进 Codex 的记忆宪法。

## 分工边界（一句话版）

```text
codegraph → 代码结构事实层（机器写、秒级新鲜）：符号位置、调用链、影响半径、签名。
.memory   → 业务领域知识层（子 Agent 写、慢更新）：模块职责、术语、协作契约、设计决策、红线、跨分支在研地图。
互补不重叠：纯结构不进 .memory（H 黑名单事前拦 + G 增量去冗余事后删）；业务语义别指望 codegraph。
维护子 Agent 仅在"自检路径/符号存在性"时用 codegraph_search，不可用时回退 git cat-file/Glob，绝不瘫痪。
```

完整设计依据与"为什么明明可替代仍不替代"的论证见 `references/design-notes.md`（答疑时再读，执行不需要）。

## 前置检查

1. **确认 `TOOL`**（上面第 0 节）。
2. **选择 preset**：读 `references/presets.md`，按「用户显式指定 > 依赖自动检测 > 暂停询问」的优先级确定 `selectedPreset`，并输出给用户确认。
3. 项目根是否已有架构规则？没有则提示"建议先生成架构规则再部署记忆系统"，询问是否继续。
4. 项目是否在 git 仓库内？hook 脚本依赖 git。
5. 是否已存在维护子 Agent 或 `.memory/`？存在则先读取并询问：是覆盖重建，还是按 `references/migration-v5.md` 做存量蒸馏升级。
6. **codegraph 与 Node 可用性检测**（仅记录状态 `CODEGRAPH_STATE`，安装动作在产物 5）：`node --version` / `codegraph --version` / 是否存在 `.codegraph/`。判定 `ready` / `cli_only` / `missing` / `no_node`。
7. **原生个人记忆探测（P4，记入 `NATIVE_MEMORY`）**：`TOOL = claude-code` → `true`（Claude Code 自带个人记忆）；其他宿主 → `false`。决定产物 4 是否创建 `个人偏好.md`、产物 6 宪法选哪个个人偏好条款。
8. **问用户：单人项目还是团队项目？**（记入 `TEAM_MODE`）单人 → 产物 2 安装时把脚本 `CONFIG.teamMode` 改为 `false`（mark-done 不往入库文件写机读锚点，避免无意义 git diff）；团队 → 保持默认 `true`。

## 产物执行流程（按顺序，路径按适配矩阵替换宿主）

### 产物 1：维护子 Agent

读 `references/maintainer-agent.md`，按宿主选 frontmatter 容器（正文三工具共用），写入对应 agents 路径。模型按文内推荐表选（Cursor=inherit / Claude=sonnet / Codex=gpt-5.4-mini）。

### 产物 2：Hook 预检脚本（复制安装）

1. 把 `<skill-path>/scripts/memory-precheck.mjs` **复制**到宿主 hooks 目录。
2. 把脚本顶部 `const SELECTED_PRESET = '<selected-preset>'` 的占位替换为选定 preset 名。
3. 若前置检查确定 `TEAM_MODE = false`（单人项目），把 `CONFIG.teamMode` 改为 `false`。
4. 跑 `node <宿主路径>/memory-precheck.mjs --status` 确认输出 JSON。

细节与注意事项见 `references/hook-install.md`。**不要从任何模板抄写脚本正文**——复制随包文件，杜绝抄写错误。

### 产物 3：Hook 注册

读 `references/hook-install.md` 的注册格式段，按宿主格式注册（Cursor `hooks.json` / Claude `settings.json` / Codex `config.toml`+`hooks.json`）。已有配置一律**先读后合并**，不覆盖。

### 产物 4：.memory/ 骨架（v5 账本）

读 `references/memory-skeleton.md`，建立六个入库文件：`记忆索引.md`（含查询流水线）、`业务导航.md`、`决策日志.md`、`红线与约定.md`、`跨分支在研功能地图.md`（含机读锚点）、`待确认问题.md`；`NATIVE_MEMORY = false` 时额外创建 gitignored 的 `个人偏好.md`。**不建模块档案目录树**。gitignore 清单见该文件。

### 产物 5：codegraph 供给（委托官方安装器）

读 `references/codegraph-provision.md`，按 `CODEGRAPH_STATE` 分支执行（ready 跳过 / cli_only 只建索引 / missing 走官方安装器 / no_node 跳过并标注）。任何失败**不阻塞**，状态写入 `.memory/.codegraph-status.json`。

### 产物 6：记忆宪法（极小常驻规则）

读 `references/constitution.md`，按宿主落到常驻指令面（Cursor `.mdc` / Claude `CLAUDE.md` 追加 / Codex `AGENTS.md` 追加）。两处占位按探测结果替换：`<个人偏好条款>` 按 `NATIVE_MEMORY` 二选一；`<codegraph 状态>` 按产物 5 结果填。已有同名段则只更新状态块，**绝不整文件覆盖**。

### 产物 7：初始化基线（必须执行）

```bash
node <宿主hooks路径>/memory-precheck.mjs --mark-done
```

把当前工作区落为基线。**跳过这步会导致首次触发把全部历史 WIP 当新增量，造成假性触发**。

## 不做

- 不修改业务代码、不修改依赖。
- 不生成通用架构规则（那是 tvs-inksnow-arch 的职责）。唯一破例：记忆宪法。
- 不写、不改 codegraph 的指令文件——交给官方安装器。
- 不直接写记忆内容——只搭骨架，记忆由子 Agent 后续自动维护。

## 存量升级（项目已有 v4 的 .memory 时）

不要直接覆盖删除——按 `references/migration-v5.md` 做**蒸馏迁移**：从旧模块档案抽出决策/红线/术语入口填进 v5 账本，其余（可推导内容）删除，迁移产物供用户 review 后入库。

## 收尾

按 `references/closing-summary.md` 的模板输出部署摘要（宿主、preset、teamMode、产物清单、codegraph 状态、触发节奏、日常运维命令），然后停止，不进入日常维护态。不输出 diff、不输出 changelog。
