# AIConfig → Claude Code 原生插件打包（设计）

- 日期：2026-06-24
- 状态：已确认设计，待写实现计划
- 范围：**只做插件打包（增量式）**，不做 npm CLI / CLAUDE.md 注入 / compact-shim

## 背景与目标

仓库 `ai-tools-skills`（远程 `github.com/inksnowhailong/ai-tools-skills`）当前是工具中性的 skill 库，靠 `tvs-setup`（`scripts/tvs.mjs`）把 `skills/` 软链/拷贝进各 AI 工具的用户级目录。

目标：让 **Claude Code 用户**能像安装 OMC 那样，用 `/plugin` 从 marketplace 一键安装、由 CC 原生加载并自动更新——同时 **不影响** Cursor/Codex/Cline 经 `tvs-setup` 的安装路径。

## 决策（已确认）

1. **工具范围**：双轨。CC 走原生插件；其余工具仍由 tvs-setup 服务。
2. **tvs-setup 与 CC**：tvs-setup 仍可装 CC（作降级/备选），但必须加**插件已装检测**防重复。
3. **深度**：仅插件打包（增量）。不做 npm CLI、CLAUDE.md 注入、版本横幅、compact-shim。
4. **开放项按最稳取值**：marketplace id `tvs`；plugin name `ai-tools-skills`；tvs-setup 保留在插件 skill 列表中但加运行守卫；HUD statusLine 限制文档化。

## 核心原则：单一真源，增量添加

`skills/` 保持唯一源，**不移动、不复制任何 skill**。仅在仓库根新增 `.claude-plugin/` 两个清单。同一份 `skills/` 同时服务两个渠道：

```
ai-tools-skills/
├── .claude-plugin/
│   ├── marketplace.json   ← 新增：市场清单（CC: /plugin marketplace add）
│   └── plugin.json        ← 新增：插件清单（声明 15 个 skill）
├── skills/                ← 不变，唯一真源
│   └── tvs-*/SKILL.md + scripts/
├── rules/  hooks/  commands/  README.md  ...
```

- **Claude Code**：插件清单声明 `skills/`，CC 原生加载 + marketplace autoUpdate。
- **其他工具**：`tvs-setup` 照旧 `git clone ~/ai-tools-skills` + `tvs.mjs install`（copy + always-pull）。

## 组件设计

### 1. `.claude-plugin/marketplace.json`

照 OMC 已验证 schema：

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "tvs",
  "description": "inksnow 个人 AI 助手配置库：任务账本、多项目团队、架构访谈、状态栏 HUD、记忆工程等 15 个 skill",
  "owner": { "name": "inksnowhailong" },
  "plugins": [
    {
      "name": "ai-tools-skills",
      "description": "一套工具中性的 skill 库：项目分析、架构顾问、需求访谈、代码审查、多项目团队、状态栏 HUD、任务账本、记忆系统等。",
      "version": "0.1.0",
      "author": { "name": "inksnowhailong" },
      "source": "./",
      "category": "productivity",
      "homepage": "https://github.com/inksnowhailong/ai-tools-skills",
      "tags": ["skills", "tasks", "architecture", "code-review", "memory"]
    }
  ],
  "version": "0.1.0"
}
```

### 2. `.claude-plugin/plugin.json`

```json
{
  "name": "ai-tools-skills",
  "version": "0.1.0",
  "description": "工具中性的个人 AI skill 库：项目分析、架构顾问、需求访谈、代码审查、多项目团队、状态栏 HUD、任务账本、记忆工程等 15 个 skill。",
  "author": { "name": "inksnowhailong" },
  "repository": "https://github.com/inksnowhailong/ai-tools-skills",
  "homepage": "https://github.com/inksnowhailong/ai-tools-skills",
  "license": "Apache-2.0",
  "keywords": ["skills", "tasks", "architecture", "code-review", "memory"],
  "skills": [
    "./skills/tvs-analyze/",
    "./skills/tvs-architect/",
    "./skills/tvs-boss/",
    "./skills/tvs-cc-migrator/",
    "./skills/tvs-clean-code/",
    "./skills/tvs-code-reviewer/",
    "./skills/tvs-deep-interview/",
    "./skills/tvs-hud/",
    "./skills/tvs-init-memory-system/",
    "./skills/tvs-inksnow-arch/",
    "./skills/tvs-mind-seed/",
    "./skills/tvs-pullread/",
    "./skills/tvs-setup/",
    "./skills/tvs-task/",
    "./skills/tvs-team-spawn/"
  ]
}
```

不声明 `commands`（空）、`hooks`（空）、`mcpServers`（无）。

> 版本起点 `0.1.0`：与 tvs-setup 的 git-commit 版本体系无关，是插件渠道独立语义版本。

### 3. skills 兼容性（预计零改动，需实测）

CC 调用 skill 时告知模型 "Base directory for this skill: `<plugin>/skills/<名>`"，skill 体里 `$SKILL/scripts/xxx`、`{SKILL_DIR}` 由 AI 按该基址解析 → 插件缓存路径同样成立。预计 15 个 skill **无需改动**。

实现阶段必须实测验证：抽 ≥2 个**带脚本**的 skill（如 `tvs-task` 读 `~/.tasklog`、`tvs-boss` 跑 panel）确认在插件加载下脚本路径解析正常。

### 4. tvs-setup 运行守卫（防误用）

`tvs.mjs` 靠 `import.meta.url` 反推 `REPO_ROOT`。若被从**插件缓存目录**运行（CC 用户误触），会把插件缓存当仓库。

- 守卫：启动时若 `process.env.CLAUDE_PLUGIN_ROOT` 存在，或 `SCRIPT_DIR` 路径包含 `plugins/cache`/`plugins/marketplaces`，则输出提示：「检测到在 Claude Code 插件内运行；CC 请用 `/plugin` 管理，tvs-setup 用于 Cursor/Codex/Cline 或从你自己的仓库克隆运行」并退出（非 install 的只读命令可继续）。

### 5. tvs-setup 插件感知（防重复安装）

CC 上若插件与 tvs-setup 双装，会出现同名 skill 两份。

- **检测**：查 `~/.claude/plugins/installed_plugins.json` 是否含 `ai-tools-skills@tvs`（或 cache 目录存在 `plugins/cache/tvs/ai-tools-skills/`）。
- **detect/doctor**：插件已装 + tvs-setup 又往 `~/.claude/skills` 装过 tvs-* → 报 `claude-dup-with-plugin`，建议移除 tvs-setup 的 claude 拷贝（CC 交给插件）。
- **install**：target 含 `claude` 且检测到插件 → 默认警告并跳过 claude（`--force` 仍可强装）。

### 6. HUD 状态栏限制（已知约束，文档化）

插件能声明 skills/commands/hooks/mcp，**不能写用户 `settings.json` 的 `statusLine.command`**。

- 结论：插件把 `tvs-hud` 脚本带到位；状态栏接管仍由 `/tvs-hud` + HUD doctor（本轮已建）改写 settings.json 完成。
- HUD doctor 的 `deployHudBridge` 源 = `SKILLS_DIR/tvs-hud/hud/combined-status.mjs`，在插件下指向插件缓存路径，仍可用；部署目标 `~/.claude/hud/` 不变。文档说明：CC 插件用户启用 HUD 仍需跑一次 `/tvs-hud` 接管。

### 7. 版本/发布

- `plugin.json.version` 与 `marketplace.json`（两处 version）**同步 bump**，每次发布手动对齐。
- README「手动安装/升级」加一节 CC 插件安装说明（marketplace add → install）。
- 不引入自动版本工具（YAGNI）；后续如频繁发布可再加脚本。

## 安装/更新链路（最终形态）

| 渠道 | 安装 | 更新 |
|---|---|---|
| Claude Code | `/plugin marketplace add inksnowhailong/ai-tools-skills` → `/plugin install ai-tools-skills@tvs` | marketplace autoUpdate（原生，无需 clone/pull） |
| Cursor/Codex/Cline | `git clone … ~/ai-tools-skills` + `node …/tvs.mjs install` | `tvs.mjs install/doctor` 自动 always-pull |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 清单 schema 写错致插件加载失败 | 照搬 OMC 已验证 schema；实测 `/plugin` 安装 |
| skill 脚本在插件路径下解析失败 | 实现阶段实测 ≥2 个带脚本 skill |
| CC 上插件 + tvs-setup 重复 | tvs-setup 加插件检测，detect/doctor 报 dup、install 跳过 claude |
| tvs-setup 在插件缓存内被误跑 | 运行守卫检测 CLAUDE_PLUGIN_ROOT / cache 路径 |
| HUD 状态栏插件装了却不显示 | 文档明确仍需 `/tvs-hud` 接管；HUD doctor 兼容插件路径 |
| 现有 tvs-setup 用户被破坏 | 改动纯增量，不动 skills/；tvs-setup 改动仅新增检测分支 |

## 非目标（YAGNI）

- npm CLI（`tvs` 命令）、CLAUDE.md 自动注入、启动版本横幅、compact-shim 省 token、自动发布脚本。
- 改写或重命名现有 15 个 skill。

## 实现顺序（交给 writing-plans 细化）

1. 加 `.claude-plugin/marketplace.json` + `plugin.json`（照本文 schema）。
2. 实测 `/plugin` 本地安装 + 抽样验证带脚本 skill 在插件下可用。
3. tvs-setup 加运行守卫 + 插件感知（detect/doctor/install 三处）。
4. README 加 CC 插件安装节；文档化 HUD 限制与版本同步规则。
5. 首个版本 tag/release（plugin.json + marketplace.json 对齐）。
