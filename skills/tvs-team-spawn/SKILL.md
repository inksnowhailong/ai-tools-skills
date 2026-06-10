---
name: tvs-team-spawn
description: 当用户提到"建一个团队、多 agent 协作、主从 chat、sub agent、leader 编排、邮箱通信、团队 chat、团队工作流"时使用。作用：对话收集团队规模与目标，从 19 个核心角色推荐配比，生成 leader/sub skill、maildir 邮箱、单写多读黑板、按事件唤醒的 stop hook；worktree 由 leader 按需建立。
---

# tvs-team-spawn：多 Agent 团队构建

把当前项目装上一套"主从多 chat"协作系统。每个团队成员是一个独立 chat（leader 一个 + N 个 sub），通过文件邮箱通信，通过黑板共享上下文，通过 stop hook 在事件到来时自动唤醒。

## 这次部署的边界

你被显式调用来**一次性安装**当前项目的团队协作系统。这是一次工程动作，跑完就结束，不是日常能力。

跑完后会得到的能力：

- 每个 chat 都能在 stop 后进入"待命"状态，邮箱来消息自动醒来
- leader 派任务给 sub，sub 把结果回给 leader，不互相直传
- 只有 leader 能写黑板（团队公共上下文），所有人都能读
- 任何代码型产出默认走 Critic 链（实现者 → 审查者）
- worktree 隔离按需启用，避免多 sub 改同一份代码冲突
- 每个 agent 有自己的私有记忆（通过 `/tvs-mind-seed` 单独初始化）

跑完不会做的事：

- 不会自动启动任何 chat
- 不会建任何 git worktree（那由 leader 在工作中按需调用）
- 不会写任何业务代码
- 不会调用 `/tvs-mind-seed`（每个成员的记忆要分别由该 chat 自己跑一次）

## 前置检查

开始前先检查这三点，缺失就先问用户：

1. 当前项目是不是 git 仓库？worktree 功能依赖 git。
2. 团队配置（`.cursor/.team/config.json` 或 `.claude/.team/config.json`，按 target）是不是已经存在？存在 = 之前已部署过；读出来给用户看，问要不要：
    - 添加新成员（add-member）
    - 重新生成 leader/sub skill（generate-leader/sub）
    - 重新写 stop hook（generate-stop-hook）
    - 全部清空重来（删除对应 target 的 `.team/` 目录后从头）
3. 用户最近一次给当前 chat 发过消息吗？bind 命令通过扫 transcripts 拿当前 conversation_id，必须先有过对话才能 bind；不过 bind 是用户进 leader chat 后才做的事，本 skill 不调用 bind。

如果前置检查不通过，**先把问题告诉用户再继续**，不要硬上。

## 运行时命令

所有动作都走同一个 runtime。无论 Windows / macOS / Linux 都是同一行命令，runtime 内部统一处理路径风格、引号转义、BOM 编码等差异：

```text
node "<skill-path>/scripts/team.mjs" <command> [args...]
```

`<skill-path>` 是本 skill 的绝对路径，通常是 `<repo>/AIConfig/skills/tvs-team-spawn`，请用你所在 IDE 提供的 skill 路径动态解析，不要硬编码。

## 目标 IDE（target）

本 runtime 同时支持 **Cursor** 与 **Claude Code**，二者的 hook 协议、skill 落盘位置、会话识别机制完全不同，靠 `--target cursor|claude` 分流。两者的运行时内核（邮箱 / 黑板 / worktree）完全共用。

判定规则（开始执行前先定下来）：

- **你（执行本 skill 的 agent）清楚自己跑在哪个 IDE**：Claude Code → `--target claude`；Cursor → `--target cursor`。不确定就直接问用户。
- `--target` **只需在 `ensure-team` 时传一次**，会持久化进 `config.json`。之后所有命令会自动探测已部署的 `.team/` 目录推断 target，不必每条都带（带上也无妨，更稳妥）。
- 缺省（既没传也探测不到）回退 `cursor`，保证老部署零影响。

各 target 的落盘差异：

| | Cursor | Claude Code |
|---|---|---|
| 运行时根目录 | `.cursor/.team/` | `.claude/.team/` |
| skill 落盘 | `.cursor/skills/` | `.claude/skills/` |
| hook 配置 | `.cursor/hooks.json` | `.claude/settings.json`（`hooks.Stop[]`） |
| stop driver | `.cursor/hooks/team-stop-driver.mjs` | `.claude/hooks/team-stop-driver.mjs` |
| 唤醒模型 | 后台 Shell + `block_until_ms: 0` | Bash 工具 `run_in_background: true` |

下文阶段里凡出现 `.cursor/...` 路径，都表示「当前 target 对应的目录」，Claude Code 下自动换成 `.claude/...`。

## 执行流程

按下面七个阶段走完。每个阶段对应明确产物，不要跳。

### 阶段 0 — 跨平台依赖检查

mailbox 监听器（mailbox-watch）依赖 `chokidar`，可显著提升 macOS / Windows / Linux 上的文件事件稳定性（特别是编辑器写入 / 重命名 / FSEvents 抖动场景）。没装也能跑（自动回退到 Node 内置 fs.watch + 5 秒轮询），但**强烈建议**在团队初始化时一次性装好。

#### 0.1 检查 chokidar 是否已全局可用

```bash
node "<skill-path>/scripts/team.mjs" check-deps
```

输出会包含：

- `nodeVersion` / `platform` / `npmGlobalRoot`
- `chokidar.available: true | false`
- 已装时 `chokidar.version`

#### 0.2 如果未装，引导安装

把检测结果展示给用户，并问：

```text
还没全局装 chokidar。要现在装吗？
- 装上能让多 agent 间消息触发更稳，编辑器原子写入 / 网络盘也基本无漏事件
- 不装也能跑（内置 fs.watch + 5 秒轮询兜底），只是 watcher 在某些场景下可能晚一两秒
```

用户同意后跑：

```bash
node "<skill-path>/scripts/team.mjs" install-deps
```

它会调用 `npm install -g chokidar`。这个动作是**全局一次性的**，所有项目都受益，所有 chat 都不会再被问第二次。

如果用户拒绝 / 没装好 / 网络问题，不要让流程卡在这；继续阶段 1，runtime 在 watcher 启动时会自动 fallback 到 fs.watch。

### 阶段 0.5 — codegraph 供给（结构知识层，团队共享）

团队里的勘察 / 架构 / 审查类角色（explore、architect、code-reviewer、tracer 等）大量需要"X 在哪定义、谁调用、改了影响谁"这类**结构事实**。交给 codegraph（AST 知识图谱）比让 agent 反复 grep 更省 token、也更准。团队初始化时一次性备好，所有 sub chat 都受益。

三层分工：**codegraph** 答代码结构（机器写、秒级新鲜）；**.memory** 答业务领域知识；**黑板** 放本团队协调态。互补不重叠。

#### 0.5.1 检测 codegraph 状态

按顺序探测，记入 `CODEGRAPH_STATE`：

- `node --version` / `npm --version` —— Node 工具链是否可用。
- `codegraph --version`（或 `where codegraph` / `which codegraph`）—— CLI 是否已装。
- 是否存在 `.codegraph/`（含 `codegraph.db`）—— 当前项目是否已建索引。

判定：

- `ready`：CLI 已装 + 索引已存在 → 跳过本阶段。
- `cli_only`：CLI 已装但无索引 → 只跑 `codegraph init -i`。
- `missing`：CLI 未装但 Node 可用 → 走官方安装器完整链。
- `no_node`：Node/npm 不可用 → 跳过，并在收尾摘要标注"缺 Node 工具链，codegraph 未装"。

#### 0.5.2 缺失则安装（征得用户同意）

把检测结果给用户，缺失时问是否现在装：

```bash
# CLI 缺失：官方安装器会自动识别当前工具并写好 MCP 配置 + 用法指南
npx @colbymchenry/codegraph
# CLI 已装但没索引（或刚装完）：为当前项目建索引
codegraph init -i
```

注意：

- codegraph 的 MCP 配置与"怎么用 codegraph 工具"的指南由**官方安装器**写（claude → `CLAUDE.md` / cursor → `.cursor/rules/codegraph.mdc`），本 skill 不自写、不重复。
- `.codegraph/`（本地索引 / 日志 / pid）是机器本地状态，应入 `.gitignore`（阶段 5 一并处理），不提交。
- 用户拒绝 / 网络问题 → 不卡流程，继续阶段 1；团队仍能跑，结构类查询只是退化为 grep。

### 阶段 1 — 用户访谈

用结构化提问或自然对话收集：

- **问 1**：要几个 sub？（1-7 个为常见值；超过 7 个先警告用户"协调成本会非线性增长"）
- **问 2**：让团队做什么？这次想完成的目标、风格、约束。
- **问 3（可选）**：用户对角色配比有偏好吗？有就直接列；没有就由你来推荐。
- **问 4**：团队名怎么叫？默认 `team-<时间戳>`，建议让用户给一个有意义的名字（例：`refactor-store`、`mvp-fullstack`）。

每轮只问 1-2 个问题，自然对话推进。优先使用环境提供的结构化提问能力（Cursor 的 `AskQuestion`、Claude Code 的 AskUserQuestion），没有时退化为文本提问。

### 阶段 2 — 列角色池 + 推荐配比

调用 `list-roles` 获取角色池：

```bash
node "<skill-path>/scripts/team.mjs" list-roles
```

返回的 19 个角色（合并自 oh-my-claudecode REFERENCE.md，去掉 tier 区分）：

- `architect` — 架构师，模块边界与复杂度治理
- `executor` — 实现者，把已确认方案落地
- `explore` — 代码勘察，定位文件与符号
- `document-specialist` — 文档研究员，通读已有文档与注释
- `designer` — 前端设计，组件与交互
- `writer` — 撰写，文档/注释/提交信息
- `vision` — 视觉理解，截图/设计稿/图表解读
- `planner` — 战略规划，拆解里程碑
- `critic` — 毒舌审查，找方案/计划弱点
- `analyst` — 前期分析，澄清需求与未知
- `qa-tester` — 测试设计，构造场景与边界数据
- `tracer` — 追踪员，从证据反推根因
- `security-reviewer` — 安全审查，找权限/注入/泄露
- `debugger` — 调试，定位编译/运行时错误
- `test-engineer` — TDD 工程师，先红再绿
- `code-reviewer` — 代码审查，看 diff 可读性与影响面
- `scientist` — 数据科学，分析与统计推断
- `git-master` — Git 操作，分支/合并/worktree
- `code-simplifier` — 代码简化，化繁为简不改行为

根据用户目标给一份推荐配比。**至少包含一个审查类角色**（critic 或 code-reviewer 或 security-reviewer 任选其一），因为 Critic 链是默认要走的。

下面是常见目标的推荐起点，**仅供你参考**，必须结合实际访谈结果调整：

- **新功能开发**：planner + executor + critic + test-engineer
- **大型重构**：architect + executor + code-reviewer + git-master
- **修 bug / 排查**：tracer + debugger + critic
- **代码审查季**：code-reviewer + security-reviewer + critic
- **前端搭页面**：designer + executor + critic
- **文档梳理**：document-specialist + writer + critic
- **数据分析**：scientist + writer + critic
- **架构评审 + 落地**：architect + analyst + critic + executor

把推荐给用户：

```text
基于你说的目标，我建议这样配：

- sub-architect — 架构师，负责...
- sub-executor — 实现者，负责...
- sub-critic — 毒舌审查，负责...

每个 sub 的 model 我会默认填角色推荐的 model，你可以稍后改 config.json。

要按这个建？还是想加减某些角色？
```

让用户确认或调整。**不要直接进入下一阶段而不等用户确认**。

### 阶段 3 — 命名每个 sub

确认角色后，给每个 sub 起名字。默认命名规则：`sub-<role>`，例如 `sub-architect`、`sub-executor`。

如果用户要同一角色多个（比如两个 executor 并行），用 `sub-<role>-1` / `sub-<role>-2`。

如果用户偏好别的命名风格（例如想叫 `alice`、`bob`），尊重用户，但提醒一下：命名只是显示用的，记忆和邮箱目录会按这个名字建。

### 阶段 4 — 生成产物

按顺序执行下面命令。每一步都打印命令、等结果、确认成功再继续。如果某步失败，停下来告诉用户原因。

#### 4.1 初始化团队目录

```bash
node "<skill-path>/scripts/team.mjs" ensure-team --workspace "<workspace>" --team-name "<teamName>" --leader-name leader --target <cursor|claude>
```

会建立：

```text
.cursor/.team/                （claude target 下为 .claude/.team/）
├── config.json              团队配置（target/teamName/subs/blackboard/bindings）
├── inbox/
│   └── leader/              leader 的收件箱根目录
├── blackboard/
│   ├── shared-context.md    （骨架）
│   ├── decisions.jsonl
│   └── conventions.md       （骨架）
├── memory/
│   └── leader/              leader 私有记忆目录（空，等 /tvs-mind-seed 填充）
├── worktrees/               git worktree 根目录（空）
└── watchers/                watcher PID 文件目录（空）
```

#### 4.2 逐个添加成员

每个 sub 都跑一次：

```bash
node "<skill-path>/scripts/team.mjs" add-member --workspace "<workspace>" <subName> <roleId>
```

可选传 `--model <modelName>` 覆盖默认 model。

每次 add-member 会在 config.json 追加成员，并在以下位置建立目录：

- `.cursor/.team/inbox/<subName>/from-leader/`（sub 的收件箱，等 leader 写入）
- `.cursor/.team/inbox/leader/from-<subName>/`（leader 的收件箱里属于此 sub 的格子）
- `.cursor/.team/memory/<subName>/`（sub 私有记忆目录）

#### 4.3 生成 leader skill

```bash
node "<skill-path>/scripts/team.mjs" generate-leader --workspace "<workspace>"
```

会写入 `.cursor/skills/team-leader-<teamName>/SKILL.md`，里面已经把：

- 启动协议
- 主循环行为规范
- 派任务的 mailbox-send 标准结构
- Critic 链编排规则
- 黑板写入规则
- Worktree 管理
- 与 tvs-mind-seed 配合
- 隐藏内部机制规则
- 退出 / 暂停流程

全部固化进去，不需要你再补充。

#### 4.4 为每个 sub 生成 skill

每个 sub 都跑一次：

```bash
node "<skill-path>/scripts/team.mjs" generate-sub --workspace "<workspace>" <subName>
```

会写入 `.cursor/skills/<subName>/SKILL.md`，里面已经把：

- 该角色的专属 system prompt（来自 team-roles.json）
- 启动协议
- 主循环：只 watch 自己的 inbox，处理积压任务
- 写回执的标准结构（status 枚举：done/failed/partial/need_more_info/rejected_role_mismatch/blocked）
- 黑板使用（只读）
- Worktree 工作（如果被分配）
- 记忆写入规则
- 隐藏内部机制规则

固化进去。

#### 4.5 写 stop hook 并合并 hooks.json

```bash
node "<skill-path>/scripts/team.mjs" generate-stop-hook --workspace "<workspace>"
```

会做两件事（按 target 自动选对的协议，无需你区分）：

- 写 stop driver 脚本：每次 stop 时检查当前 chat 对应的 agent 有没有积压消息；有就让 chat 处理，没就让 chat 启动后台 mailbox-watch 进入待命。
  - cursor → `.cursor/hooks/team-stop-driver.mjs`（输出 `followup_message`）
  - claude → `.claude/hooks/team-stop-driver.mjs`（输出 `{ decision: "block", reason }`，并用 watcher PID 存活检测防 stop 死循环——Claude Code 没有 Cursor 的 `loop_limit`）
- 合并 hook 注册，已有其它 stop hook 时只追加不覆盖：
  - cursor → 合并进 `.cursor/hooks.json` 的 `hooks.stop[]`
  - claude → 合并进 `.claude/settings.json` 的 `hooks.Stop[]`（保留 permissions/env 等其它配置原样）

### 阶段 5 — 更新 .gitignore

`.team/` 里都是运行时状态（邮箱内容、watcher pid、记忆），不应入库。按 target 把对应两行写入项目根的 `.gitignore`（如果已存在则跳过）：

```text
# cursor target
.cursor/.team/
.cursor/hooks/team-stop-driver.mjs

# claude target
.claude/.team/
.claude/hooks/team-stop-driver.mjs

# codegraph 本地索引（机器本地状态，与 target 无关）
.codegraph/
```

`team-stop-driver.mjs` 是生成产物，跟随 hook 注册文件即可（`.cursor/hooks.json` / `.claude/settings.json` 可入库让团队共享 hook 注册，stop-driver 内容由本 skill 在新机器上重新生成）。

如果你判断用户希望把 stop-driver 也提交（团队共享），不要写进 .gitignore，只忽略 `.team/` 那一行。

### 阶段 6 — 引导后续手动步骤

打印一段总结给用户：

```text
团队 <teamName> 已部署到当前项目：

- leader: leader (skill 在 .cursor/skills/team-leader-<teamName>/)
- subs:
    - sub-architect (架构师, model: claude-opus-...)
    - sub-executor  (实现者, model: claude-4.6-...)
    - sub-critic    (毒舌审查, model: claude-opus-...)

下一步你要手动做：

1. 开一个新的专用 chat 给 leader，在里面输入 `/team-leader-<teamName>`。
   leader skill 启动后会引导你跑 `/tvs-mind-seed leader` 给 leader 装上私有记忆。

2. 对每个 sub，开一个专用 chat（建议在 chat 标题前加 sub 名字方便辨认），
   在里面输入对应的 skill（例如 `/sub-architect`）。
   sub skill 启动后会引导你跑 `/tvs-mind-seed sub-architect` 装上私有记忆。

3. 所有成员的 chat 都接好后，回到 leader chat 给它布置第一个任务。
   leader 会自己派给合适的 sub。

如果中途某个 chat 崩溃，重新打开同一个 chat、再次输入它的 skill 即可恢复——
私有记忆和邮箱里的未读消息都在文件里保留着。
```

不要主动启动任何 chat，也不要替用户调用 `/tvs-mind-seed`。

## 推荐配比的判断逻辑

阶段 2 里给推荐时，按这条决策树思考：

1. **任务类型偏重哪类**？
    - 偏写代码：必须有 executor 或 test-engineer
    - 偏决策：必须有 planner 或 architect 或 analyst
    - 偏检查：必须有 critic 或 code-reviewer 或 security-reviewer
    - 偏探索：必须有 explore 或 tracer 或 document-specialist

2. **是否会动多个互相冲突的代码区域**？
    - 是 → 加 git-master，并提示 leader 可能需要 worktree 隔离
    - 否 → 不加

3. **任务跨多个阶段（设计 → 实现 → 验收）**？
    - 是 → 加 planner，让他在阶段切换时写黑板
    - 否 → 不加

4. **代码安全敏感（鉴权/密钥/外部接入）**？
    - 是 → 加 security-reviewer 而不是普通 critic
    - 否 → 普通 critic 或 code-reviewer 即可

5. **数据分析/统计/ML 类**？
    - 是 → 加 scientist
    - 否 → 不加

6. **角色总数控制**：
    - 3-4 个 sub：协调成本最低，推荐起点
    - 5-7 个：有意义但 leader 工作量增大
    - 8+ 个：警告用户"协调成本会超过编排收益，考虑拆成两个团队"

## 重要：你不是 leader

**你（本 skill 的执行者）是装配工，不是 leader**。装完团队就退出。所有后续派任务、收回执、写黑板、管 worktree 的事都由 **leader chat** 里那个 skill 负责。

如果用户在装完后还问"那现在你帮我做 X"，引导他们：「我只负责把团队装好，下一步要去 leader chat 开始干活」。

## 团队架构总览（写给你看，不给用户讲）

```text
[Leader Chat]                   [Sub Chat A]              [Sub Chat B]
     │                                │                         │
     │  mailbox-send                  │                         │
     ├───→ inbox/A/from-leader/  ─────┘                         │
     ├───→ inbox/B/from-leader/  ───────────────────────────────┘
     │                                                          │
     │             ←──── mailbox-send ──── inbox/leader/from-A/ │
     │             ←──── mailbox-send ──── inbox/leader/from-B/ │
     │
     │  blackboard-write   ┌────────────────────┐
     ├──────────────────→  │   blackboard/      │
     │                     │   shared-context.md│
     │                     │   decisions.jsonl  │
     │                     │   conventions.md   │
     │                     └────────────────────┘
     │                          ↑ 只读              ↑ 只读
     │                          A                   B
     │
     │  worktree-create / assign
     ├──→  worktrees/A   ← 由 A 在 assigned 时工作
     └──→  worktrees/B   ← 由 B 在 assigned 时工作
```

每条邮箱通信都是 **per-sender maildir** 模式：

- 每条消息一个独立 .json 文件，文件名带时间戳
- 写入是 `.tmp` 后 rename 的原子操作，绝不会读到半截 JSON
- 消费即 unlink，不留痕（不做审计日志，按用户决定）
- 同一发送者写入自己的 `from-<sender>/` 子目录，不存在多发送者抢同一文件
- watcher 监听用 fs.watch + 5 秒兜底 polling，事件即唤醒

stop hook 唤醒模型：

```text
stop hook 触发
   ↓
检查 .team/config.json 的 bindings → 当前 chat 对应哪个 agent
   ↓
扫 inbox/<agent>/from-*/ 看有没有新消息
   ├── 有 → 注入消息让 chat 调用 mailbox-consume 处理
   └── 没 → 注入消息让 chat 启 mailbox-watch 进入待命
```

注入消息的协议按 target 不同：
- cursor → 输出 `{ followup_message }`，watcher 用后台 Shell + `block_until_ms: 0` 启动；靠 `hooks.json` 的 `loop_limit:1` 防重触发。
- claude → 输出 `{ decision: "block", reason }`，watcher 用 Bash 工具 `run_in_background: true` 启动；Claude Code 没有 `loop_limit`，改靠 stop driver 检测 watcher PID 是否存活（活着就放行 idle）防死循环。

watcher 进程在 inbox 有变化或 60 分钟超时时退出，IDE 把进程结束当作"任务完成通知"再次叫醒 chat。这是把 shell + hook 拼成"event-driven 唤醒"的关键。空闲心跳超时拉长到 60 分钟是为减少空转时的上下文重摄入。

## 收尾

部署完成后只输出阶段 6 给用户的总结。不要输出 diff，不要输出 changelog，不要让用户感受到内部机制。如果用户问起架构，再展开讲。
