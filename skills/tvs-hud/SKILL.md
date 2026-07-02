---
name: tvs-hud
description: 状态栏 HUD——自包含渲染，不依赖 omc 的 HUD/IPC。两行：Claude 用量（模型/上下文占比/5小时·每周用量）+ 当前目录分支状态与情绪脸。cwd 在某个 git 仓库内才展示分支信息，情绪脸随时展示。用户主动运行 /tvs-hud 查看接管状态或重新接管。
disable-model-invocation: true
---

# tvs-hud：状态栏 HUD

Claude Code 底部状态栏的 tvs 数据源，最多两行，**完全自包含，不再合并 omc 的 HUD 输出**（旧版靠"主进程 import + 拦截 stdout"拦截 omc HUD，已废弃）。

## 状态栏输出示例

```
◆ Sonnet 5 · ctx 32% · 5h 18% · 周 3%
⎇ main ~2↑1  🌿2   (-̀ω-́)✧ 笃定
```

不在 git 仓库时第二行退化成纯情绪脸；Claude 用量哪项数据缺就跳过那项，不留占位符。

### 符号说明

**行一：Claude 用量**（读 Claude Code 原生喂给 statusLine 命令的 stdin JSON，非 omc 特有接口）

| 字段 | 含义 |
|------|------|
| 模型名 | `stdin.model.display_name` |
| `ctx N%` | 上下文窗口占用（`stdin.context_window.used_percentage`），≥70% 橙、≥85% 红 |
| `5h N%` | 5 小时滚动用量（`stdin.rate_limits.five_hour`） |
| `周 N%` | 7 天用量（`stdin.rate_limits.seven_day`） |

**行二：当前目录 git + 情绪**

| 符号 | 含义 |
|------|------|
| `⎇ branch` | 当前分支（cwd 落在任意 git 仓库内即显示，**不依赖 tvs-boss 的项目登记表**，纯 cwd 本仓库） |
| `~N` `↑N` `↓N` | 脏文件 / 领先 / 落后远端；全干净显示 `✓` |
| `🌿N` | 当前仓库有 N 个 worktree 存在脏改动或落后（数字徽标，不逐条展开——想看细节用 `/tvs-boss` 面板） |
| `{颜文字} {标签}` | 情绪脸，见下 |

## 情绪引擎（v1，不落盘）

移植自 `E:\inksnow\Thoughts\docs\tvs情绪记忆HUD-skill设计文档.md` 设计的 PAD 三轴情绪机 + 颜文字脸池（源自「思绪」`core/mind.mjs` + `core/kaomoji.mjs`，纯函数零依赖）。

**v1 简化**：不接 hook 事件捕获管线，**每次渲染直接从 `transcript_path` 尾部窗口（最近 15 分钟）+ 当前 git 状态现算**：

- **energy**（起劲/蔫）：最近工具调用密度；长时间无操作自然蔫回低位
- **valence**（顺/丧）：最近工具结果的报错率，报错越多越低
- **control**（笃定/失控）：当前 git 状态——脏文件多、落后主线多、stash 堆积都拉低；干净则拉高

三轴 → `moodBucket`（来劲/松弛/毛刺/愤世/蔫/笃定/平）→ 挑一张颜文字脸，脸池取自 `fontFace.json` 同源的「思绪」表情系统。

不落盘意味着**没有跨会话的情绪连续性**——每次渲染都是"此刻"的快照，不是"一路走来"的心电图。这是刻意的简化（原设计文档的完整版要接 hook 捕获 + `.tvs/mood/state.json` 持久化 + 潜意识消化，更接近"心电图"但工程量大得多）；要不要升级到持久化版本，之后再评估。

## 架构（自包含，无 omc 依赖）

```
Claude Code statusLine.command
        │
        ▼
~/.claude/hud/bridge.mjs  ← 部署到固定位置的薄桥接（tvs-setup 拷贝）
        │ 读 stdin(JSON) → 动态定位真身 → spawnSync 转发 stdin → 吐出 stdout
        ▼
<真实安装位置>/skills/tvs-hud/hud/tvs-status.mjs  ← 真正的渲染逻辑
        │
        ├─ scripts/lib/usage.mjs       解析 Claude Code 原生 stdin（用量/模型/cwd）
        ├─ scripts/lib/git.mjs         cwd 所在仓库的分支/状态/worktree（纯 git 查询，无登记表）
        ├─ scripts/lib/transcript.mjs  transcript 尾部活跃度信号（工具调用密度/错误率）
        ├─ scripts/lib/mood.mjs        PAD 三轴计算 + 情绪渲染
        ├─ scripts/lib/kaomoji.mjs     颜文字脸池（移植自「思绪」）
        └─ scripts/lib/render.mjs      两行拼版
```

**为什么要 bridge.mjs 这层**：插件缓存路径带版本号、软链安装路径因机器而异，都不适合硬编码进 `settings.json`；bridge 固定部署在 `~/.claude/hud/bridge.mjs`，运行时自己探测真身装在哪个版本目录，装哪个版本都不用手改配置——同一套探测逻辑沿用自旧版 `combined-status.mjs` 的 `resolveVersioned`，已验证可靠。

## 接管链路（`/tvs-hud` 触发时检查/修复）

依赖两点（不再是三点——去掉了 `--omc-hud` 这层 omc 兼容标记）：

1. `~/.claude/hud/bridge.mjs` 桥接文件存在（由 `tvs-setup doctor --fix` 部署）
2. `settings.json → statusLine.command` 指向该桥接文件

`/tvs-hud` 被触发时，你（AI）跑 `node "$SKILL/../tvs-setup/scripts/tvs.mjs" doctor --fix`（或直接告知用户跑 `tvs-setup doctor --fix`），它会检测并按需重新部署 + 接管 statusLine。

**互斥提醒**：若日后跑了 `/oh-my-claudecode:hud setup`，它会把 `statusLine.command` 改回纯 omc 的命令，tvs 状态行随之消失——这是正常的"谁在 command 里谁生效"，不是 bug，再跑一次 `doctor --fix` 即可切回来。

## 边界（明确不做）

- 不再尝试与 omc HUD 合并输出到同一状态栏——两者现在互斥（`statusLine.command` 只能指向一个）。
- 不做跨项目多仓库汇总（旧版"tvs-boss 项目行"式的多项目一次性展开已砍掉）——那类信息去 `/tvs-boss` 面板看。
- 不做任务标题预览行——去掉了任务系统集成，要看任务用 `/tvs-task`。
- 情绪引擎不做主动发言/聊天——纯只读渲染进状态栏，不抢对话。
