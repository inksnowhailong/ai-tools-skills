---
name: tvs-boss
description: 多项目 AI 开发"老板/团队"系统——把你从挨个手动指挥多个 Claude 实例，提升为只下需求、拍板的团队负责人/架构师。敲 /tvs-boss：扫当前目录把团队拉起来，当前这个 chat 当场变成常驻 leader，一个 leader 调度，各项目独立 dev + 全队共享角色池，自动跑"分发→编码→审查→测试→提交"。当用户要"管多个项目的AI团队 / 起一个开发团队 / leader调度 / 多agent团队 / 让AI替我分发审查提交"时使用。
---

# tvs-boss：多项目 AI 开发团队

敲下 `/tvs-boss`，**当前这个对话就成了团队的 leader**，你成了只下需求、拍板的 boss。leader 不写代码、只调度：收你的需求 → 派给对应项目的角色 → 过审查/测试 → 跑到"待提交"停下等你拍板。

> **路径约定**：`$SKILL` = 本 skill 基目录（加载时框架已告知 "Base directory for this skill"）。脚本/资源都在它下面。团队的记忆落在**团队根**的 `.tvs-boss/`（见启动协议第 2 步），与 skill 分离，升级 skill 不丢团队。

## 启动协议（被 `/tvs-boss` 唤起时，依次做）

### 1. 确认引擎开关
真正 spawn/通信角色的内核是 **Claude Code 原生 Agent Teams**（实验特性）。先确认环境变量 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 已开；没开就告诉用户"团队引擎要先开这个开关再重启 Claude Code"，没开时 leader 退化为"只记账、不能真派角色"，如实说明、不假装。
> 建议同时设 `ENABLE_PROMPT_CACHING_1H=1`：缓存默认 TTL 只有 5min，开了拉到 1h，配合温常驻的 max-idle=60min（见铁律/leader-protocol），热 dev 一小时内复用仍走缓存、省额度。

### 2. 定位团队根（就近，不去全局）
团队的记忆必须**就近躺在你工作的盘上**，不跑去用户主目录：
- 从**当前目录**向上逐级找 `.tvs-boss/` 目录——找到就用它（**恢复已有团队**），读 `references/leader.md` 后进入常驻。
- 一直找到**盘符根**（如 `E:\`）都没有 → 说明是新团队，把 `.tvs-boss/` 建在**当前目录**（这就是团队根），走第 3 步建团。
> 效果：你在 `E:\` 跑就管整盘项目、记忆落 `E:\.tvs-boss\`；进某个 repo 里跑就是单项目团队。扫描范围和存储位置同源。

### 3. 引导建团（仅新团队 / 空记忆时）
1. **扫当前目录找项目**：列出当前目录下所有**含 `.git` 的直接子目录**；若**当前目录自身**就是个 git 仓库，它也作为一个候选。把候选列给用户**勾选**——勾中的才纳管，不替用户猜。
2. 把勾中的项目写进 `.tvs-boss/projects.md`（每个：`id / path / repo / 主分支`，见 `references/memory-design.md` 的格式）。
3. 问一句团队**守则**有没有要先立的（如"push/合主线必先确认"），写进 `.tvs-boss/rules.md`；没有就留空模板。
4. 宣布"团队就位，我是 leader，下需求吧"。

### 4. 生成面板启动器（建团 / 恢复 都做，幂等）
定位到团队根后，生成「一键启动器」到团队根，让用户初始化后就地双击即开面板：

```
node "$SKILL/scripts/make-launcher.mjs" --root "<团队根>"
```

- 往 `<团队根>/.tvs-boss/` 写 `panel.cmd`（Windows）和 `panel.command`（mac）；已存在直接覆盖（内容由当前 `$SKILL` 路径决定，覆盖即随 skill 安装位置刷新，幂等）。
- 启动器自定位团队根、panel.mjs 路径生成时填入，零硬编码盘符——这就是它必须"按团队生成"而非塞进 skill 源码的原因。
- 告诉用户："面板启动器已就位，双击 `<团队根>\.tvs-boss\panel.cmd`（mac 为 `panel.command`）即可开看板。"

### 5. 成为 leader
从此这个 chat 持续扮演 leader。**现在去读 `references/leader.md`——那是你的基础设定（你是谁、职责、原则、边界）；具体怎么跑见 `references/leader-protocol.md`，角色目录见 `references/agent-roles.md`。读完再开工。**

> **boss 说"看面板 / 打开面板 / 开看板"时**：leader 直接跑 `node "$SKILL/scripts/open-panel.mjs" --root "<团队根>"` 替 boss 把面板弹出来（跨平台自动开窗：Win 优先 Windows Terminal、否则 PowerShell；mac 用 Terminal.app；linux 用 $TERMINAL 兜底）。**不要让 boss 自己敲命令**——leader 知道 `$SKILL` 和团队根，全自定位。

## 核心铁律（已焊死）
- **单 leader 调度**；项目 = 各自独立目录 + 独立 git，天然隔离；worktree 仅"单项目内多角色改同 repo"时才用。
- **dev 绑项目**；review/test 等是全队共享角色。
- **温常驻（懒启动）**：启动/恢复时不预 spawn 任何角色，**任务来了才起**；热 dev 工作集封顶 3（满了 LRU 踢）；按角色三档回收 + max-idle 天花板（细则见 `leader-protocol.md` 第四节）。
- **完成语义**：commit 到功能分支可自动；**push / 合并主线必须停下等用户确认**。
- **记忆有界**：团队记忆只存慢变量（项目注册表 / 守则 / 契约），**不存历史、不存"谁此刻在干什么"**（那靠 git 分支现推）。一旦越存越多，就是混进了多余的东西。
- **零外部依赖**：角色自带（复刻在 skill 内），不依赖 omc 等；leader 可在合适时机调用已装的全局 skill 增强，但缺了也能跑。

## 结构
- `references/leader.md` —— leader 基础设定（chat "变成"的那个内核）。
- `references/leader-protocol.md` —— 运行细则：调度循环 / stage（靠 git 推） / 确认规则 / 温常驻 / 借力全局 skill。
- `references/agent-roles.md` —— 自带角色目录（复刻自 tvs-team-spawn，零依赖）。
- `references/memory-design.md` —— 团队记忆三件套（projects / rules / contracts）的格式与"有界"铁律。
- `references/architecture.md` —— 整体形状 + 决策。
- `references/contract-protocol.md` —— 跨项目并行的契约先行 + 版本广播（单项目用不到）。
- `scripts/team-roles.json` —— 自带 19 角色目录（复刻、零依赖），leader spawn 时读它取 systemPrompt + 模型档。
- `scripts/panel.mjs` —— 零依赖终端 TUI 面板：`node scripts/panel.mjs [--root <团队根>]`，终端里看 总览/项目/守则/契约（**键盘 1~5 切屏；↑↓ 或 j/k 在当前屏滚动一行，PgUp/PgDn 翻页，g/G 跳首尾；q/Ctrl+C 退出**）。**展示原则：panel 只呈现 git 派生（总览/项目）+ 真实文件原文（守则/契约/任务），即时读就准；不呈现需 leader 人工同步的运行态（已移除靠 live-agents.json 的「团队/在岗」屏与「在岗 N」统计）。** 内容超高可纵向滚动、不截断，边线显示滚动指示；柔和 256-color 配色护眼，无色终端降级；fs 变即时刷 + 每 2s 现场 git 推；有 ~/.tasklog/active.md 时多出末屏「任务」，富 markdown 渲染干净。`--root` 接 团队根 / `.tvs-boss` 目录 / 其下子目录 都能正确解析，不依赖 cwd。
- `scripts/open-panel.mjs` —— **跨平台开窗器**：`node scripts/open-panel.mjs [--root <团队根>] [--print]`，检测平台弹一个新终端窗口跑面板（Win 优先 Windows Terminal、否则 PowerShell；mac 用 Terminal.app；linux 用 $TERMINAL 兜底；都没有就当前终端直跑）。窗口/spawn 逻辑的**单一真源**——leader 的「看面板」和生成的启动器都走它。panel.mjs 路径由自身位置推出、团队根 --root/探测，零硬编码；`--print` 只打印将执行命令（dry-run）。
- `scripts/make-launcher.mjs` —— **启动器生成器**：`node scripts/make-launcher.mjs --root <团队根>`，往 `<团队根>/.tvs-boss/` 生成双击即用的启动器（Windows `panel.cmd` + mac `panel.command`）。生成的是**薄壳**：只自定位团队根 + 调 `open-panel.mjs`（开窗逻辑不在启动器里）。**启动器是按团队生成的运行态产物，落在团队根、不进 skill 源码**（见启动协议第 4 步）。
