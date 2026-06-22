# AIConfig — 个人 AI 助手配置库

一份工具中性的配置仓库，沉淀个人常用的 skills、rules 和 hooks。  
一套代码，适配 Claude Code、Cursor、Codex、Cline 等多种 AI 工具。

---

## 安装

把下面这段话直接发给当前 AI 助手：

```
请把这个仓库安装到你当前 AI 工具的用户级全局配置目录，并自动适配目录结构：

https://github.com/inksnowhailong/ai-tools-skills.git

要求：
1. 先识别你自己是 Claude Code、Cursor、Codex、Cline 还是其他 AI 工具。
2. Claude Code / Cursor 优先运行仓库自带脚本：node <repo>/skills/tvs-setup/scripts/tvs.mjs install
3. 其他工具：拉取仓库后只把内容安装到用户全局目录，不要写入当前项目目录；
   工具不支持的能力转成它能读取的规则/命令文档，并说明。
4. 覆盖前先备份用户已有同名文件。
5. 完成后报告安装目录、安装了哪些 skill / rule，以及哪些内容因工具不支持被跳过。
```

安装完成后，说 **"tvs setup / 体检一下"** 即可由 `tvs-setup` 接管日常维护与更新。

---

## Skills

### 项目理解与架构

| Skill | 用途 |
|---|---|
| `tvs-analyze` | 分析项目结构、依赖、调用关系和风险点 |
| `tvs-architect` | 基于真实代码证据做架构分析、复杂 bug 根因诊断 |
| `tvs-inksnow-arch` | 访谈生成架构 RFC，批准后落地 `.cursor/rules` |

### 需求访谈与代码质量

| Skill | 用途 |
|---|---|
| `tvs-deep-interview` | 单问题深度追问，把模糊想法变成规格文档 |
| `tvs-clean-code` | 清理命名、冗余和结构，补关键中文注释 |
| `tvs-code-reviewer` | 证据驱动的代码审查，找漏洞、坏味道和真实问题 |

### 多项目团队与状态监控

| Skill | 用途 |
|---|---|
| `tvs-boss` | 多项目 AI 开发团队 Leader，调度 Agent 开工、TUI 面板跟进进度 |
| `tvs-hud` | Claude Code 状态栏多行 HUD：雷达告警 / 项目 git+任务 / 任务标题预览 |

### 协作、记忆与迁移

| Skill | 用途 |
|---|---|
| `tvs-task` | 自然语言转结构化任务账本（`~/.tasklog/active.md`） |
| `tvs-init-memory-system` | 为项目部署记忆维护体系，配置 codegraph 分工路由 |
| `tvs-team-spawn` | 为 Cursor 项目安装多 Agent 团队协作系统 |
| `tvs-mind-seed` | 给单个 Agent 初始化私有记忆系统 |
| `tvs-pullread` | 拉取并通读远程分支/PR，理解别人改了什么 |
| `tvs-cc-migrator` | Claude Code 配置备份与恢复，换机器用 |
| `tvs-setup` | 安装/更新/体检入口，软链优先、漂移检测、生态探测 |

---

## Rules

| 文件 | 说明 |
|---|---|
| `role.md` | AI 助手角色定位、交付方式、代码质量意识 |
| `coding-rules.md` | 编码风格、TypeScript 约定、注释规范、`data-alt` 规则 |
| `fontFace.json` | 字体相关配置数据 |

---

## 手动安装 / 升级

```bash
# 克隆并安装（软链，仓库即真相）
git clone https://github.com/inksnowhailong/ai-tools-skills.git
node ai-tools-skills/skills/tvs-setup/scripts/tvs.mjs install

# 更新
node ai-tools-skills/skills/tvs-setup/scripts/tvs.mjs update --pull
```

---

## License

Apache License 2.0 © 2026 inksnowhailong
