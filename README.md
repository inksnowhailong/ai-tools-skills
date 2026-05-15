# AI Tools Configuration Library

> 一份**工具中性**的 AI 助手配置仓库，由 AI 在安装时自适应适配 Claude Code / Cursor / Codex / Cline / Aider / Continue 等任意 AI 助手的全局配置目录。

仓库地址：`https://github.com/inksnowhailong/ai-tools-skills.git`

## 设计理念

- 仓库只维护**一份**配置，不为某个具体工具复制多份镜像。
- 仓库目录采用通用命名（`skills/` `commands/` `rules/` `hooks/`），不绑定任何具体工具的内部约定。
- 安装行为由**用户在 AI 助手里贴一段 Prompt**触发，由 AI 自己识别身份、自适应改造结构、写入全局目录。
- 仓库本身永远只读——所有改造发生在目标 AI 工具的全局目录里，不污染仓库。

## 仓库结构

```text
AIConfig/                     ← 仓库根（在你的项目里通常作为 git submodule 挂载）
├── README.md                 ← 本文档（含安装 Prompt）
├── CLAUDE.md                 ← 全局指令文档（Claude Code 默认读取，其他工具可改名）
├── config.json               ← 工具配置占位（可选）
├── LICENSE
│
├── skills/                   ← Agent Skills，每个 skill 一个文件夹
│   ├── tvs-architect/
│   │   └── SKILL.md
│   ├── tvs-code-reviewer/
│   ├── tvs-deep-interview/
│   ├── tvs-analyze/
│   ├── tvs-cc-migrator/      （含 scripts/）
│   ├── tvs-clean-code/
│   ├── tvs-pullread/
│   ├── tvs-review/
│   ├── tvs-verify/
│   └── tvs-visual-verdict/
│
├── commands/                 ← 用户主动触发的命令（slash command）
│   ├── init-architecture-rules.md
│   └── init-memory-system.md
│
├── rules/                    ← 全局编码规则、角色设定、字体设定等
│   ├── coding-rules.md
│   ├── role.md
│   └── fontFace.json
│
└── hooks/                    ← 编辑器/Agent 钩子（按需启用）
    └── hooks.json
```

## 一键安装 Prompt（核心）

把下面方框里的 Prompt **完整复制**，粘贴到你想要安装到的 AI 助手对话框（Claude Code / Cursor Agent / Codex / Cline / Aider / Continue / 任意支持自然语言指令的 AI 助手）。AI 会自己读懂仓库、识别自身、改造结构、安装到对应全局配置目录。

---

```text
你的任务：把以下 GitHub 仓库的 AI 配置安装到「当前你所在 AI 助手」的「全局用户级配置目录」，并自动适配为该工具的目录结构。

仓库：https://github.com/inksnowhailong/ai-tools-skills.git

# 第一步：识别你自己是哪个 AI 助手

请先判断你属于以下哪一类，输出判断结论与依据：

- Claude Code（Anthropic 官方 CLI / IDE 插件，全局目录 ~/.claude/）
- Cursor（Cursor IDE 内的 Agent，全局目录 ~/.cursor/，Windows 下 %USERPROFILE%\.cursor\）
- Codex（OpenAI Codex CLI，全局目录约定参考其官方文档，常见 ~/.codex/）
- Cline（VS Code 扩展，配置在 VS Code 用户目录或 ~/.cline/）
- Aider（命令行工具，全局目录 ~/.aider/）
- Continue（VS Code / JetBrains 扩展，全局目录 ~/.continue/）
- Gemini Code Assist / Cody / Copilot Chat / 其他

判断依据：你能访问的工作目录命名（如 .claude / .cursor / .codex 等）、你被赋予的工具集、配置文件读取路径。
**如果你判断不出自己是哪一种，请暂停并询问用户。**

# 第二步：拉取或更新仓库

把仓库克隆到本地缓存目录（例如 ~/.cache/ai-tools-skills 或当前工具的临时目录）。如果该位置已存在，执行 git pull origin main 更新到最新。

仓库克隆后**只读**，所有改造写到目标工具的全局目录，不要修改仓库本身。

# 第三步：读取仓库结构

仓库采用工具中性结构：

- skills/<name>/SKILL.md       Agent Skills
- commands/<name>.md           用户主动触发的命令（slash command）
- rules/                       全局编码规则、角色设定、字体配置等
- hooks/                       钩子配置
- CLAUDE.md                    全局指令文档

# 第四步：安装到全局配置目录（自适应改造）

按下表把仓库目录映射到当前工具的全局目录：

| 仓库目录            | 含义                       | 通用映射规则                                                                                                              |
|---------------------|----------------------------|---------------------------------------------------------------------------------------------------------------------------|
| skills/             | Agent Skills               | 复制到 <工具全局目录>/skills/。若该工具不支持 skills 概念，转换为 commands 或 rules（保留 SKILL.md 原始描述作为说明文档）  |
| commands/           | 主动命令                   | 复制到 <工具全局目录>/commands/。若不支持 slash command，转为可被引用的文档放入 rules/                                    |
| rules/              | 编码规则、角色设定         | 复制到 <工具全局目录>/rules/。若该工具只支持单一全局指令文件（如 AGENTS.md），把所有 .md 内容合并进该文件（保留分节）        |
| hooks/              | 钩子                       | 复制到 <工具全局目录>/hooks/。若该工具不支持 hooks，跳过并在报告中明确说明                                                 |
| CLAUDE.md           | 全局指令文档               | 适配为该工具的全局指令文件。例：Claude Code 保留原名；Cursor 可改名 AGENTS.md；其他工具按官方约定                          |
| config.json         | 工具配置占位               | 仅在该工具确实使用此格式时复制，否则跳过                                                                                  |

如果当前工具要求 SKILL.md 或 command 文件的 frontmatter 字段名与仓库不同（例如要求 title 而非 description），请在写入时自动改写字段名，**保留原内容语义**。

# 第五步：处理冲突

对每个目标位置已存在的同名文件：

1. 先把原文件备份为 <原名>.bak.<时间戳>（例：CLAUDE.md.bak.20260513-1530）
2. 备份成功后再写入新内容
3. 如果原文件包含明显的用户自定义内容（非来自本仓库的旧版本），**先暂停询问用户是否覆盖**，不要静默覆盖

# 第六步：完成报告

执行结束输出以下结构化报告：

  已安装到：<工具全局目录的绝对路径>
  当前 AI 助手识别为：<工具名>

  Skills 安装（X 个）：
    - tvs-architect
    - tvs-code-reviewer
    - ...

  Commands 安装（Y 个）：
    - /init-architecture-rules — 一次性扫描项目并生成 .cursor/rules/** 的架构规范规则
    - /init-memory-system      — 一次性部署项目记忆维护体系（subagent + hook + .memory 骨架）

  Rules 安装（Z 个）：
    - coding-rules.md
    - role.md
    - fontFace.json

  Hooks 安装（W 个）：
    - hooks.json

  全局指令文件：
    - <工具全局目录>/CLAUDE.md（或当前工具对应文件名）

  备份的原文件：
    - <列出所有 .bak.* 文件路径>

  跳过 / 改造说明：
    - <例：当前工具不支持 hooks，已跳过 hooks/ 目录>
    - <例：将 rules/*.md 合并到 AGENTS.md，因当前工具仅支持单一全局指令文件>

# 安全约束（重要）

1. **只安装到全局用户级目录**（如 ~/.claude/、~/.cursor/），不要安装到当前项目目录（如 ./.cursor/、./.claude/）。
2. **不要修改仓库本身**（克隆出来仅作读取来源）。
3. **不要静默覆盖**用户已有的全局配置——必须先备份。
4. **遇到任何无法判断的情况，先停下来询问用户**，不要凭猜测继续。
5. 完成后**不要自动 git commit / git push** 任何东西。

请严格按上述流程执行。
```

---

## AI 工具全局目录速查表

| 工具 | 平台 | 全局配置目录 |
|---|---|---|
| Claude Code | macOS / Linux | `~/.claude/` |
| Claude Code | Windows | `%USERPROFILE%\.claude\` |
| Cursor | macOS / Linux | `~/.cursor/` |
| Cursor | Windows | `%USERPROFILE%\.cursor\` |
| Codex CLI | 通用 | `~/.codex/`（以官方文档为准） |
| Cline | VS Code | VS Code 用户目录 / `~/.cline/` |
| Aider | 通用 | `~/.aider/` |
| Continue | 通用 | `~/.continue/` |

如果你的 AI 工具不在上表，让 AI 助手按其官方文档自行判断。

## 内容说明

### Skills（10 个）

| 名称 | 用途 |
|---|---|
| `tvs-architect` | 基于真实代码证据的架构分析与复杂 bug 根因诊断 |
| `tvs-code-reviewer` | 严格的代码审查，按严重程度分类问题 |
| `tvs-deep-interview` | 苏格拉底式需求访谈，把模糊想法整理成可执行规格 |
| `tvs-analyze` | 项目代码结构、依赖、业务分析 |
| `tvs-cc-migrator` | Claude Code 配置备份与恢复 |
| `tvs-clean-code` | 代码清洁与整理，添加意图清晰的注释 |
| `tvs-pullread` | 拉取并通读代码 |
| `tvs-review` | 严格的代码审查（毒舌风格） |
| `tvs-verify` | 验证功能、修复、UI 变更是否真正生效 |
| `tvs-visual-verdict` | UI 截图与参考图的视觉对比验收 |

### Commands（2 个）

| 命令 | 用途 |
|---|---|
| `/init-architecture-rules` | **一次性**扫描当前项目并生成 `.cursor/rules/**` 下的架构规范规则 |
| `/init-memory-system` | **一次性**部署项目记忆维护体系：子 Agent + Hook 预检脚本 + `.memory/` 目录骨架 |

### Rules（3 个）

| 文件 | 用途 |
|---|---|
| `coding-rules.md` | 通用编码风格、命名、结构、注释规范 |
| `role.md` | AI 助手角色与语气设定 |
| `fontFace.json` | 字体相关规则 |

## 备用：手动安装

如果你不想用 Prompt 方式，可手动操作：

```bash
# 全局安装到 Claude Code（macOS / Linux）
git clone https://github.com/inksnowhailong/ai-tools-skills.git ~/.claude

# 全局安装到 Cursor
git clone https://github.com/inksnowhailong/ai-tools-skills.git ~/.cursor

# 项目内作为 submodule 挂载（任意路径，常见 AIConfig 或 .claude）
git submodule add https://github.com/inksnowhailong/ai-tools-skills.git AIConfig
git submodule update --init --recursive
```

手动安装时仓库目录结构与 Claude Code / Cursor 默认搜索路径**1:1 对应**，可直接使用 `skills/` `commands/` `rules/` `hooks/`，无需改造。

## 升级

```bash
# 如果是 git clone 安装
cd ~/.claude  # 或 ~/.cursor / 你 clone 的位置
git pull origin main

# 如果是 submodule
cd <项目根>
git submodule update --remote --merge AIConfig
```

或者重跑一次本 README 顶部的安装 Prompt，AI 会自动 `git pull` 后增量同步。

## License

Copyright 2026 inksnowhailong

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
