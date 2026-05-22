# AI Tools Configuration Library

一份工具中性的 AI 助手配置仓库，用来沉淀个人常用的 skills、commands、rules 和 hooks。它不绑定某个具体 AI 工具，安装时由当前 AI 助手自己识别环境并适配到对应的全局配置目录。

仓库地址：`https://github.com/inksnowhailong/ai-tools-skills.git`

## 设计理念

- 只维护一份配置，不为 Claude Code、Cursor、Codex、Cline 等工具复制多份镜像。
- 仓库目录保持通用：`skills/`、`commands/`、`rules/`、`hooks/`。
- 安装目标是用户级全局目录，不直接污染业务项目。
- 对项目级能力，例如团队协作、项目记忆、架构规则，由对应 skill / command 在目标项目内一次性安装。

## 仓库结构

```text
AIConfig/
├── README.md
├── CLAUDE.md
├── config.json
├── LICENSE
├── skills/
│   ├── tvs-analyze/
│   ├── tvs-architect/
│   ├── tvs-cc-migrator/
│   ├── tvs-clean-code/
│   ├── tvs-code-reviewer/
│   ├── tvs-deep-interview/
│   ├── tvs-inksnow-arch/
│   ├── tvs-mind-seed/
│   ├── tvs-pullread/
│   ├── tvs-review/
│   ├── tvs-team-spawn/
│   └── tvs-verify/
├── commands/
│   └── init-memory-system.md
├── rules/
│   ├── coding-rules.md
│   ├── role.md
│   └── fontFace.json
└── hooks/
    └── hooks.json
```

## 一键安装 Prompt

把下面这段话复制给当前 AI 助手即可。现在的 AI 足够聪明，不需要把完整流程塞进 Prompt 里。

```text
请把这个仓库安装到你当前 AI 工具的用户级全局配置目录，并自动适配目录结构：

https://github.com/inksnowhailong/ai-tools-skills.git

要求：
1. 先识别你自己是 Claude Code、Cursor、Codex、Cline、Aider、Continue 还是其他 AI 工具。
2. 拉取或更新仓库，只把内容安装到用户全局目录，不要写入当前项目目录。
3. 安装 skills、commands、rules、hooks 和全局指令文件；如果当前工具不支持某类能力，就转成它能读取的规则/命令文档，并说明。
4. 覆盖前先备份用户已有同名文件。
5. 完成后报告安装目录、安装了哪些 skill / command / rule，以及哪些内容因工具不支持被跳过。
```

## 适合的 AI 工具

| 工具 | 适配方式 | 说明 |
|---|---|---|
| Cursor | 原生支持 `skills/`、`.cursor/agents`、hooks 等能力 | 最适合本仓库，`tvs-team-spawn`、`tvs-mind-seed`、`init-memory-system` 主要面向 Cursor 项目工作流 |
| Claude Code | 适合安装 skills、commands、rules、CLAUDE.md | 可使用大多数通用 skill；Cursor 专属 hooks/agents 需降级成文档或手动适配 |
| Codex / OpenAI CLI | 适合安装为规则和任务说明 | 可使用审查、验证、访谈、架构分析等文本协议型 skill |
| Cline / Roo / Continue | 适合安装为 rules、commands 或自定义工作流文档 | 交互式提问能力按各工具自己的 UI 适配 |
| Aider / 其他终端 Agent | 适合安装为全局指令和命令说明 | 不支持的自动化能力需要人工执行对应脚本 |

## Skills

### 项目理解与架构

| Skill | 简介 | 应用场景 | 适合工具 |
|---|---|---|---|
| `tvs-analyze` | 分析项目结构、依赖、主要业务、调用关系和风险点。 | 新接手项目、解释某段代码、快速建立项目全局认识。 | Cursor、Claude Code、Codex、Cline |
| `tvs-architect` | 基于真实代码证据做架构分析、复杂 bug 根因诊断和方案取舍。 | 架构评审、技术方案比较、复杂问题排查、长期可维护性判断。 | Cursor、Claude Code、Codex、Cline |
| `tvs-inksnow-arch` | 架构决策 + 规则落地一体化：先访谈生成 RFC，再生成 `.cursor/rules/*.mdc`。 | 想重构架构、改 DDD、拆模块、整理分层、让 AI 知道代码该放哪。 | Cursor 最佳；Claude Code 可用于 RFC 阶段，规则落地需适配 |

### 需求访谈与代码质量

| Skill | 简介 | 应用场景 | 适合工具 |
|---|---|---|---|
| `tvs-deep-interview` | 中文深度需求访谈，通过单问题追问、拓扑确认、歧义评分和审批闸门，把模糊想法变成规格。 | 用户需求不清、怕做错方向、需要先问清楚再实现。 | Cursor、Claude Code、Codex、Cline、Roo |
| `tvs-clean-code` | 清理代码结构、命名、冗余和注释，让意图更清晰。 | 代码可读性差、函数太乱、需要补关键中文注释。 | Cursor、Claude Code、Codex、Cline |
| `tvs-code-reviewer` | 稳定、证据驱动的代码审查，按固定通道找漏洞、坏味道和真实问题。 | 审当前 diff、审 PR、找 bug、找坏代码、毒舌审查。 | Cursor、Claude Code、Codex、Cline |
| `tvs-review` | 严格代码审查入口，偏“只骂不修”，输出问题和风险，不给修复代码。 | 用户明确要求 code review、找问题、只指出风险。 | Cursor、Claude Code、Codex、Cline |
| `tvs-verify` | 验证刚刚 AI 做的改动是否真的解决了用户原始问题。 | 用户问“刚才改好了吗”“确认是否完成”“看看是否真修好了”。 | Cursor、Claude Code、Codex、Cline |

### 协作、记忆与迁移

| Skill | 简介 | 应用场景 | 适合工具 |
|---|---|---|---|
| `tvs-team-spawn` | 一次性为 Cursor 项目安装多 Agent 团队协作系统：leader/sub、邮箱、黑板、stop hook。 | 想在 Cursor 里搭建多 chat 团队、leader 编排、sub agent 协作、邮箱通信。 | Cursor 专用 |
| `tvs-mind-seed` | 给单个 agent 初始化私有记忆系统，生成 profile/personality/active/index 等记忆文件。 | `tvs-team-spawn` 后给每个成员建记忆，或给独立 chat 建可恢复画像。 | Cursor 专用 |
| `tvs-cc-migrator` | Claude Code 配置备份与恢复工具。 | 换电脑、备份 `~/.claude`、迁移 rules/skills/commands/agents/settings。 | Claude Code 最佳；Cursor 可辅助迁移 |
| `tvs-pullread` | 拉取并通读远程代码，帮助理解远程分支/PR 的真实实现。 | 读 PR、同步远端、理解别人改了什么、分析远程业务逻辑。 | Cursor、Claude Code、Codex |

## Commands

| Command | 简介 | 应用场景 | 适合工具 |
|---|---|---|---|
| `/init-memory-system` | 为当前项目一次性部署项目记忆维护体系：后台子 Agent、hook 预检脚本、`.memory/` 骨架。 | 想让项目自动沉淀业务记忆、模块边界、风险点和复用入口。 | Cursor 最佳；其他工具需手动适配 hook/subagent |

> 架构规则初始化已经迁移到 `tvs-inksnow-arch`。它比旧的 `/init-architecture-rules` 更完整：先生成架构 RFC，用户批准后再落地 `.cursor/rules/**`。

## Rules

| 文件 | 简介 |
|---|---|
| `coding-rules.md` | 通用编码风格、TypeScript 约定、注释规范、样式和 `data-alt` 规则。 |
| `role.md` | AI 助手角色、交付方式、代码质量意识和表达风格。 |
| `fontFace.json` | 字体相关规则配置。 |

## ClawHub

如果已发布到 ClawHub，也可以通过 ClawHub CLI 搜索或安装：

```bash
clawhub search tvs
clawhub install tvs-code-reviewer
clawhub install tvs-deep-interview
```

## 手动安装

如果不想用一键安装 Prompt，可以手动放置：

```bash
# 克隆到本地缓存或全局配置目录
git clone https://github.com/inksnowhailong/ai-tools-skills.git <target-dir>

# Cursor Windows 示例
# 将 skills/ 复制到 %USERPROFILE%\.cursor\skills\
# 将 rules/、commands/、hooks/ 按 Cursor 支持情况复制到对应目录
```

项目中作为 submodule 使用：

```bash
git submodule add https://github.com/inksnowhailong/ai-tools-skills.git AIConfig
git submodule update --init --recursive
```

## 升级

```bash
# clone 安装
cd <target-dir>
git pull origin main

# submodule 安装
cd <项目根>
git submodule update --remote --merge AIConfig
```

也可以重跑顶部的一键安装 Prompt，让当前 AI 助手按最新仓库内容增量同步。

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
