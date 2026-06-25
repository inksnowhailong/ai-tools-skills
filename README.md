# AIConfig — 个人 AI 助手配置库

一份工具中性的配置仓库，沉淀个人常用的 skills、rules 和 hooks。  
一套代码，适配 Claude Code、Cursor、Codex、Cline 等多种 AI 工具。

---

## 安装

> 选哪种安装？**Claude Code 用户首选方式零（原生插件）**，无需 clone/node、自动更新、自带自举。
> Cursor/Codex/Cline 用户走方式一/二（默认 copy 拷贝安装，独立副本、无路径依赖）。
>
> ⚠️ 仅当你用 `--mode link` **软链安装**（作者本地开发态）时，才要求仓库常驻固定位置：请克隆到
> `~/ai-tools-skills`（家目录下），**别放临时目录或某个项目里**——否则该目录一删/一换软链全断（会看到指向别人机器的怪路径）。插件与 copy 安装无此约束。

### 方式零：Claude Code 插件（CC 用户首选）

Claude Code 用户直接走原生插件，无需 clone/node，安装后自动更新：

```text
/plugin marketplace add inksnowhailong/ai-tools-skills
/plugin install tvs-inksnow@tvs-inksnow
```

装完重启会话即可用全部 skill。Cursor/Codex/Cline 用户走下面的方式一/二。

> 自动自举：插件自带 SessionStart 钩子，首次安装（或插件升级）后会在会话开头提示 AI 跑一次 `tvs-setup bootstrap`——它静默把 `skillListingBudgetFraction` 归一到 `0.02`，并按"激进全自动"原则处理依赖：`oh-my-claudecode`（npm）、`codegraph`（npx）征得同意后直接装，`superpowers`（纯插件）打印 `/plugin` 命令交你手点。装好后写 marker，不再重复提示。

> 命名说明：`add` 后面 `inksnowhailong/ai-tools-skills` 是 **GitHub 仓库坐标**（CC 去这里 clone）；`install` 的 `tvs-inksnow@tvs-inksnow` 是 **插件名@市场名**——本插件这两者都叫 `tvs-inksnow`，所以 `@` 前后一样。三者分属仓库/插件/市场不同命名系统，仓库名与它们不同是正常的。

> 注意：`tvs-hud` 状态栏需额外一步——插件只把脚本带到位，**接管状态栏仍需运行 `/tvs-hud`**（Claude Code 插件不能直接改用户 `statusLine` 设置，这是平台限制）。

### 方式一：直接命令（推荐，结果确定）

需要 `git` 和 `node`。复制粘贴即可：

```bash
# macOS / Linux / Git Bash
git clone https://github.com/inksnowhailong/ai-tools-skills.git ~/ai-tools-skills
node ~/ai-tools-skills/skills/tvs-setup/scripts/tvs.mjs install
```

```powershell
# Windows PowerShell
git clone https://github.com/inksnowhailong/ai-tools-skills.git "$HOME/ai-tools-skills"
node "$HOME/ai-tools-skills/skills/tvs-setup/scripts/tvs.mjs" install
```

默认 **copy 安装**：把 skills 拷进你的全局配置目录，不依赖 clone 常驻、跨机器无绝对路径泄漏。`install` / `doctor` 每次都会**先自动从远程拉最新**——你永远跑在最新版上（仓库有本地改动时自动跳过，保护开发态）。

> 开发本仓库的人：加 `--mode link` 软链安装，改仓库即时生效。

### 方式二：让 AI 帮你装

把下面这段**原样**发给当前 AI 助手（它已包含固定克隆位置，不要让 AI 自行决定克隆到哪）：

```
请按以下步骤把这个仓库装到我当前 AI 工具的用户级全局配置目录，全程不要改动当前项目目录：

1. 先把仓库克隆到固定位置 ~/ai-tools-skills（务必是这个家目录路径，不要放临时目录或当前项目里——
   软链安装要求仓库常驻）：
   git clone https://github.com/inksnowhailong/ai-tools-skills.git ~/ai-tools-skills
   （若该目录已存在且是本仓库，跳过克隆，直接 git -C ~/ai-tools-skills pull --ff-only）
2. 识别你自己是 Claude Code / Cursor / Codex / Cline 还是其他工具。
3. Claude Code / Cursor：直接运行安装脚本（它会把 skills 软链到你的用户级配置目录，不要手动拷贝文件）：
   node ~/ai-tools-skills/skills/tvs-setup/scripts/tvs.mjs install
4. 其他工具：把 ~/ai-tools-skills 里的 skills / rules 安装到你的用户全局目录（不是项目目录）；
   你不支持的能力转成你能读取的规则/命令文档，并说明。
5. 覆盖前先备份同名文件。完成后报告：仓库克隆到了哪、装了哪些 skill / rule、哪些因工具不支持被跳过。
```

安装完成后，说 **"tvs setup / 体检一下"** 即可由 `tvs-setup` 接管日常维护与更新。

---

## 推荐生态

AIConfig 专注差异化能力（任务账本、多项目团队、架构访谈、状态监控）。  
以下三个第三方工具与本仓库深度协同，**`tvs-setup` 安装时会自动检测并给出安装建议**：

| 工具 | 定位 | 与 AIConfig 的协同 |
|---|---|---|
| [**omc**](https://github.com/sschepis/oh-my-claudecode) (oh-my-claudecode) | Claude Code 多 Agent 编排层，协调专属 agent、HUD 状态栏、自治循环 | `tvs-hud` 与 omc HUD 合并输出到同一状态栏；`tvs-boss` 的 Leader 可借用 omc agent 类型调度 |
| [**superpowers**](https://github.com/just-every/superpowers) | TDD 纪律、系统化调试、代码审查工作流 | 与 `tvs-code-reviewer`、`tvs-architect` 形成互补——superpowers 管过程纪律，tvs 管决策与记忆 |
| [**codegraph**](https://github.com/nickvdyck/codegraph) | tree-sitter 解析的代码知识图谱，亚毫秒级符号/调用链查询 | `tvs-init-memory-system` 配置 codegraph 作为项目记忆的结构层；`tvs-architect` 和 `tvs-analyze` 优先走 codegraph 做代码理解 |

> 三者均为可选增强，缺失时 AIConfig 所有功能正常降级运行。

---

## Skills

### 项目理解与架构

**`tvs-analyze`** — 新项目破冰利器

> 接手陌生代码库时最怕的不是代码量，是不知道从哪看起。`tvs-analyze` 系统性扫描项目结构、核心依赖、主要业务流和模块间调用关系，输出一份可以直接对话的全局地图。复杂项目 5 分钟内建立基本认知，再也不用从 README 猜架构。

---

**`tvs-architect`** — 架构级问题的首席顾问

> 普通 AI 只会给你代码，`tvs-architect` 会给你**带证据的判断**。它锚定真实代码、拒绝空谈，做架构评审、技术方案取舍、复杂 bug 根因分析时，每个结论都对应具体的文件和调用链。想知道"为什么这样设计"、"改这里会影响哪里"——问它。

---

**`tvs-inksnow-arch`** — 架构决策从访谈到落地一体化

> 架构重构最难的不是写代码，是想清楚。`tvs-inksnow-arch` 先用深度访谈逼你把模糊想法变成 RFC，批准后再自动生成 `.cursor/rules/*.mdc` 落地到项目。不再有"口头说好的架构，代码里从来没人遵守"——规则直接进 AI 上下文，每次写代码都会被检查。

---

### 需求访谈与代码质量

**`tvs-deep-interview`** — 把"大概是这样"变成可执行的规格

> AI 做错方向是因为问题没说清，不是因为 AI 不够聪明。`tvs-deep-interview` 模拟专业需求访谈：单次只问一个问题、追问歧义、画拓扑确认、最后给出评分和审批闸门。走完一遍，你手里有规格文档，AI 手里有明确任务——双方都不再靠猜。

---

**`tvs-clean-code`** — 让代码说人话

> 能跑的代码和好读的代码之间，往往差的不是功能，而是命名、结构和一句关键注释。`tvs-clean-code` 系统性清理函数命名、消除冗余逻辑、补上让下一个读代码的人不骂娘的中文注释。重构前跑一遍，技术债少一半。

---

**`tvs-code-reviewer`** — 挑剔的代码审查员，不讲情面

> 不是"看起来没问题"，而是**证据驱动地找问题**。`tvs-code-reviewer` 按固定通道逐轮扫描：安全漏洞 → 逻辑缺陷 → SOLID 原则 → 性能隐患 → 代码坏味道，每条问题都标明严重等级和位置。PR 合并前过一遍，比队友 review 更稳、更快、更狠。

---

### 多项目团队与状态监控

**`tvs-boss`** — 一个 Chat 统管所有项目的 AI 开发团队

> 你有多个项目同时在推进，每次都要开新对话、重新说背景——这是在浪费你最宝贵的注意力。`tvs-boss` 把当前目录下所有 git 项目纳为一个团队，你只需要下需求，Leader 自动调度 dev/review/test 等角色 Agent 协同开工。内置 ANSI TUI 面板，进行中的分支、任务状态、git 健康度一眼尽收，push 和合主线前必停等你拍板。

---

**`tvs-hud`** — 状态栏里的项目健康仪表盘

> 不想为了看 git 状态去开终端，也不想为了看任务进度去开面板——`tvs-hud` 把这些信息直接打到 Claude Code 底部状态栏。三行多线索输出：**雷达行**告警未提交太久/领先未合/worktree 落后等风险；**项目行**按项目分组展示 git 状态和任务计数；**任务行**预览进行中的任务标题。与 omc HUD 共存，互不干扰。

---

### 协作、记忆与迁移

**`tvs-task`** — 用自然语言记任务，AI 帮你整理

> 脑子里有个任务，打开任务管理软件又嫌麻烦——直接告诉 AI "帮我记一下，下午要改登录页"，`tvs-task` 把它结构化写入 `~/.tasklog/active.md`，支持迭代追加、git 合并检测、宽表渲染。任务账本跨项目全局，`tvs-hud` 和 `tvs-boss` 面板都能读取展示。

---

**`tvs-init-memory-system`** — 让 AI 真正"记住"这个项目

> 每次开新对话都要重新介绍项目背景，是因为 AI 没有持久记忆。`tvs-init-memory-system` 为当前项目一次性部署结构化记忆体系：`.memory/` 存只有人才知道的业务契约，codegraph 存可以自动查的代码结构——分工明确，AI 每次都能快速召回上下文，不再靠你重复喂背景。

---

**`tvs-team-spawn`** — 为 Cursor 项目搭建多 Agent 协作系统

> 一个 Chat 干所有事效率有上限。`tvs-team-spawn` 为 Cursor 项目一次性安装 leader/sub agent 协作基础设施：邮箱通信、共享黑板、stop hook，让多个 Agent 真正能分工并行、有序交接，而不是各说各话。

---

**`tvs-mind-seed`** — 给 Agent 一个可恢复的画像

> `tvs-team-spawn` 之后，每个成员 Agent 只是个空壳。`tvs-mind-seed` 给它初始化私有记忆系统：profile、personality、active 任务、记忆索引——让 Agent 知道自己是谁、负责什么、上次干到哪，会话重开后秒速恢复状态。

---

**`tvs-pullread`** — 真正读懂别人的 PR

> "看一下这个 PR 改了什么"——大多数时候 AI 只会读你贴过来的 diff，看不到上下文。`tvs-pullread` 直接拉取远程分支，通读真实代码变更，理解业务意图、分析潜在影响，给你一份有判断的阅读报告，不是 diff 的复读机。

---

**`tvs-cc-migrator`** — Claude Code 配置一键迁移

> 换新电脑最怕的就是把 `~/.claude` 里精心积累的配置全丢掉。`tvs-cc-migrator` 把 rules、skills、commands、agents、settings、hooks 打包备份，到新机器一键恢复。搭配 `tvs-setup` 重装 skill 软链，五分钟复原完整工作环境。

---

**`tvs-setup`** — 本仓库的安装、体检与生态大管家

> AIConfig 的唯一入口。软链安装（仓库即真相，`git pull` 即更新，零漂移）、漂移检测、死引用扫描、孤儿清理，以及探测 omc / superpowers / codegraph 生态并给出安装建议。日常说"体检一下 skill"就够了，它会告诉你哪里有问题、怎么修。

---

## Rules

| 文件 | 说明 |
|---|---|
| `role.md` | AI 助手角色定位、交付方式、代码质量意识与颜文字风格 |
| `coding-rules.md` | 编码风格、TypeScript 约定、注释规范、Tailwind/UnoCSS 样式规则、`data-alt` 规范 |
| `fontFace.json` | 字体相关配置数据（按需查阅） |

---

## 手动安装 / 升级

```bash
# 克隆到固定位置并安装（软链，仓库即真相）
git clone https://github.com/inksnowhailong/ai-tools-skills.git ~/ai-tools-skills
node ~/ai-tools-skills/skills/tvs-setup/scripts/tvs.mjs install

# 体检（含 HUD 接管链路检查）
node ~/ai-tools-skills/skills/tvs-setup/scripts/tvs.mjs doctor

# 更新
node ~/ai-tools-skills/skills/tvs-setup/scripts/tvs.mjs update --pull
```

> 发布维护者注意：`.claude-plugin/plugin.json` 与 `.claude-plugin/marketplace.json` 的 `version`（marketplace 有两处）必须同步 bump，CC 插件渠道靠它判断更新。

---

## License

Apache License 2.0 © 2026 inksnowhailong
