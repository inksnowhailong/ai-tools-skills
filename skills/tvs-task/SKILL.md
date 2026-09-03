---
name: tvs-task
description: 当用户显式提到任务账本时使用：说"记任务/建任务 xxx"、"看任务/任务表/进度怎样"、"xxx 验收了/确认完成/归档"、"继续搞 xxx（某在册任务）"、"上周做了啥"，或 SessionStart 注入的「tvs-task 在册任务」摘要出现在上下文时。作用：跨会话持久任务账本（~/.tasklog）——两层结构（任务→子项），状态与 Claude Code 内置 Task 同构（pending/in_progress/completed），进度/待验收/停滞从 git 现推；会话内通过播种协议接入内置 Task UI 实时展示，会话结束 hook 自动回收。禁止从日常对话语义里猜任务——账本写入只走显式指令。
---

# 任务账本（tvs-task v2）

跨会话持久层，存 git 推不出的慢变量。存储 `~/.tasklog/`：`active.md`（活跃）、`archive.md`（归档留 30 天）、`ignore.txt`（候选忽略，`路径<TAB>分支` 每行一条）。

## 环境前置（首次使用必查）

1. **内置 Task 工具门控**：播种依赖 TaskCreate/TaskUpdate，Claude Code 默认关闭。检查全局 `~/.claude/settings.json` 的 `env` 块含 `"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"`——没有则提醒用户（经同意后帮加），重启会话生效；SessionStart hook 也会在注入摘要里对缺失告警。工具不在时播种降级为文本清单，其余流程不受影响。
2. **`tasks` 快捷命令（可选，问过用户再装）**：`node "{SKILL_DIR}/scripts/install-launcher.mjs"` 给 shell 注册 `tasks` 命令（写 PowerShell/zsh/bash 配置，幂等；PATH 冲突时自动落备选名 `tvst` 并告知）。装后用户在 Claude 里敲 `! tasks` 即弹独立面板窗口。**未经用户同意不得改 shell 配置。**

## 铁律

1. **写入只走显式指令**——用户说"记任务/建任务/挂个子项"，或对 hook 注入的新分支候选点头。对话里出现任务字眼≠指令，一律不写。
2. **任务级 completed 只有用户能给**——任何自动过程最多把任务推到 ⏳待验收（派生标注），归档必须等用户确认。
3. **ID 是机器的，标题是用户的**——T-xxx 与子项 id 只进 metadata 锚点和账本文件，任何用户可见输出（回复、内置 Task subject、面板）只用标题/短名。
4. **状态只有三值** `pending / in_progress / completed`（与内置 Task 同构）。"待验收/停滞/进度"是渲染时从 git 现算的派生标注，永不写入文件。

## 账本格式

```markdown
# 任务清单

_下个ID：T-044_

---

## T-021 · ShireHub 项目架构重构
- 短名：架构重构
- 状态：in_progress
- 创建：2026-06-12
- repo：D:\coding\shirehub

### 子项
| id | 子项 | 分支 | 状态 |
|----|------|------|------|
| 1 | store A组迁移 | refactor/store-follow-relation-20260714 | completed |
| 2 | http 层迁移 | — | pending |

### 迭代记录
- 2026-07-14 · followStore/userInfoStore 迁移完成合入 test/dev
```

- **短名 ≤6 字**（播种 subject 用；与标题相同可省略该行）；多 repo 任务写多行 `- repo：`，子项分支列用 `repo目录名:分支`。
- **子项两类**：绑分支的（completed 由 git 合主分支判定，scan 自动标）；无分支的（completed 靠用户显式说或会话锚回收）。
- 子项 id 任务内自增不复用；分支为空写 `—`。
- `archive.md` 格式相同，任务多一行 `- 完成：YYYY-MM-DD`。
- **层级只有两层**。子项内部的细步骤活在会话内置 Task 里，不落盘。

## 操作

### 建任务（显式指令才做）
1. 读 active.md 查重（标题/短名相近 → 问"是不是已有的 xxx？"，是则走挂子项）。
2. 从 `_下个ID_` 取号并 +1；标题、短名（≤6字）、repo（当前上下文可识别则填）、子项（用户说了就拆，没说就建一条同名子项）。
3. 非代码任务（无 repo/分支）照建，子项全部无分支。

### 挂子项 / 毕业制候选确认
- 用户说"给 xxx 加个子项 yyy" → 定位任务追加行。
- hook 注入的新分支候选被用户认领 → 挂为指定任务的新子项（绑该分支）；用户拒绝 → 把 `仓库路径<TAB>分支名` 追加进 ignore.txt。

### 看任务 + 播种（`/tvs-task` 无参的固定动作，三步连跑）
```bash
node "{SKILL_DIR}/scripts/scan.mjs" --apply      # ① git 事实落地（子项合并标记）
node "{SKILL_DIR}/scripts/render.mjs"            # ② 全量树视图（含派生标注），原样贴进回复
node "{SKILL_DIR}/scripts/render.mjs" --seed     # ③ 播种计划：按 cwd 命中列出父/子行 subject + 锚 + 状态，照单 TaskCreate（见播种协议）
node "{SKILL_DIR}/scripts/render.mjs" --archive  # 附最近归档（用户问归档时）
node "{SKILL_DIR}/scripts/open-panel.mjs"        # 弹独立终端窗口跑面板（用户说"开面板"时 AI 直接跑这个，零配置）
```
**第③步不是可选项**：`/tvs-task` 一执行就播种，播完在回复末尾加一行"已播种 N 个任务到内置 Task"。命中规则由脚本定（任务 repo 与 cwd 互为前缀；无 repo 的任务只在 cwd 不是 git 仓库时命中）——在项目里跑只播该项目的，在多 repo 父目录（如 tvs-boss 团队根）跑就全播。
面板是交互 TUI（r 刷新 / s 扫描报告 / q 退出），必须有独立 TTY——不要在会话内直接跑 panel.mjs。装过 `tasks` 命令的用户可自己敲 `! tasks`（见环境前置）。脚本坏了按账本格式手动渲染兜底（同样不显示 ID）。

### 验收 / 归档（唯一的任务关闭路径）
用户说"xxx 验收了/确认完成/归档"：任务标 `completed` + 加 `- 完成：今日` → 整块移入 archive.md 置顶。分支未全合主分支时提示一句再执行。归档超 30 天由 scan --apply 自动清理。

### reopen
scan 报告"归档任务分支又领先主分支" → 告知用户，确认后移回 active.md（去完成行、状态 in_progress、迭代记录加一条"合并后又改"）。completed 子项的 reopen 由 scan --apply 自动转回 in_progress。

### 周回顾
archive.md 按完成日期筛近一周 + 各 repo `git log --since="1 week ago" --oneline` 汇总清单；不写周报正文。

## 播种协议（接入内置 Task UI 的实时层）

SessionStart hook 只向命中仓库的会话注入在册任务摘要与本协议摘要，**不播种**。播种只有一个触发点：**用户显式执行 `/tvs-task`**（含 tvs-boss 启动协议里替用户跑的那一次）。播种范围 = `render.mjs --seed` 输出的全部命中任务，不挑状态、不分组同屏；用户点名"继续搞 xxx"时若该任务尚未播过，也按同样方式补播。执行：

0. **锚只准来自脚本**：`render.mjs --seed` 逐行给出 subject / anchor / status，照单 TaskCreate；**禁止自己编 ID**（真实事故：AI 把 E批锚成了 T-005，而 T-005 在账本里是 G批，回收会把完成状态写到别的任务上）。本会话 Task 列表里已有同锚行的跳过。
1. **父行**：`subject="<短名> ｜ <一句当前阶段>"`（脚本给的初始尾巴是"进行中 1/7"这类，开工后改写成人话，例：`架构重构 ｜ store 层已迁完，http 层进行中`）、`metadata {"anchor":"T-021"}`；in_progress 的任务父行全程保持 in_progress——父行 ID 最小 + in_progress 使它锁死列表顶端，树形不散；pending 的任务父行保持 pending，用户点名开工时再转。
2. **子行**：该任务每个未完成子项一条，`subject="│ <子项标题> — <一句进展/结论>"`、`metadata {"anchor":"T-021.3"}`；状态照脚本给的，动工转 in_progress，做完转 completed。尾巴初始可空，有进展就补（例：`│ kop 改中台地址后重验 — 真机已确认商城正常`）。
3. **会话新长出的步骤**：属于该任务 → 同样 `│ `前缀+锚；临时杂务（顺手修 lint 等）→ 不带锚，随会话蒸发。
4. **subject 纪律**：列表横向空间充裕，subject 上限 **90 字符**，写满一句自足可读的话（业务对象+动作+当前进展，别人不看上下文也懂）；禁止缩写暗语（"批次B 五条接入"这类只有当事人懂的黑话要展开）；绝不出现锚/ID；进度条 ▰▰▱▱ 只出现在渲染视图，不进 subject；更长的细节/结论写 description。账本子项标题同标准——它会被原样播种成 subject 主干。
4.5 **更新纪律（最容易忘、忘了账本进度就延后）**：每完成一个动作（跑通/改完/验过），**当轮**就 TaskUpdate 对应子行——状态转了就转，没转就刷 subject 尾巴；不许"攒到最后一起标"。自检时机三个：一个子项刚做完、准备回复用户前、切去做下一个子项前。SessionEnd 只回收你已经标过的，忘标的它救不回来。
5. **列表卫生**：命中的任务全播，不为浮层折叠删行——账本子项已完成的脚本自然不播；会话里已 completed 的子行不删（回收要读）。用户说"把 xxx 从列表拿掉"才 deleted。
6. **无 TaskCreate 工具的环境**：退化为普通文本清单跟进，其余流程不变。

会话结束后 SessionEnd hook 自动回收（无需手动）：无分支子项的 completed 状态、迭代记录（当日完成条目压缩为一行）、pending 任务转 in_progress。绑分支子项的完成永远以 git 为准，会话里说完成不算。

## git 扫描（scan.mjs）

```bash
node "{SKILL_DIR}/scripts/scan.mjs"            # 只读报告四段：已合子项 / 待验收 / reopen / 新分支候选
node "{SKILL_DIR}/scripts/scan.mjs" --apply    # 落地：子项 completed 标记 + 子项 reopen + 归档 30 天清理
node "{SKILL_DIR}/scripts/scan.mjs" --repo <路径>  # 限扫命中该路径的任务（hook 快速路径）
```

- 主分支动态识别（origin/HEAD → main/master），完成判定只认主分支，合入 develop/test 等不算。
- squash merge 祖先检测查不到 → 按未合处理，不打扰（宁漏勿误）。
- **scan 永不归档任务、永不改任务级状态**——它只动子项和归档清理。

## 迁移（旧格式账本）

旧版（emoji 状态 + 进度节点 checkbox + `#### vN` 迭代块）→ 新版映射：📋→pending、🔄→in_progress、✅→completed；「项目」分支对 + 进度节点合并折算成子项；`#### vN` 块压缩成 `- 日期 · 摘要` 单行；优先级/更新日期字段删除（派生可得）。迁移前备份 `active.md.bak-<日期>`。
