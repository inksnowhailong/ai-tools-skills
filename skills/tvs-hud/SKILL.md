---
name: tvs-hud
description: 状态栏 HUD 配置——三行多线索输出：雷达告警 / 按项目 git+任务 / 任务标题预览；自适应 tvs-boss/tvs-task 是否存在，都没有时静默。用户主动运行 /tvs-hud 来配置显示项。
disable-model-invocation: true
---

# tvs-hud：状态栏 HUD

Claude Code 底部状态栏的 tvs 数据源，最多输出三行，自适应四种场景：

- **tvs-boss + tvs-task**：雷达告警行 + 按项目分组 git/任务行 + 任务标题行
- **仅 tvs-boss**：按项目显示 git 状态 + worktree
- **仅 tvs-task**：汇总任务计数
- **都没有**：静默不输出

## 状态栏输出示例

```
tvs-雷达 !6  │  shirehub_web ↑28 未合并  ·  crestrail ~1 未提交3天  ·  ! tvs-task停5天  ·  ...
tvs-boss     │  crestrail ~1 ·2  │  shirehub ✓ *1  │  shirehub_web ~5↑28 *2 !1  [feat/cdk ↓19]
tvs-tasks    │  * ShireHub发帖页面  │  * 架构重构  │  ! tvs-task优化  │  · 记忆工程  +2
```

### 符号说明

**Git 状态**

| 符号 | 含义 |
|------|------|
| `~N` | N 个未提交文件（dirty） |
| `↑N` | 领先远端 N 个提交（未合并） |
| `↓N` | 落后远端 N 个提交（需 rebase） |
| `✓` | 工作区干净 |

**任务状态**

| 符号 | 含义 |
|------|------|
| `*N` | N 个进行中任务 |
| `!N` | N 个停滞任务（进行中 > 5 天未更新） |
| `·N` | N 个待开始任务 |

**Worktree**：`[feat/branch-name ↓19]`，落后 ≥ 5 时出现在雷达。

## 配置（`/tvs-hud` 触发）

运行 `/tvs-hud` 进入多选配置，选项写入 `~/.claude/hud/tvs-hud-config.json`，立即生效。

**可选项：**

| 选项 key | 显示位置 | 默认 | 说明 |
|----------|----------|------|------|
| `git` | 项目行 | ✓ | `~N ↑N ↓N` 或 `✓` |
| `taskCounts` | 项目行 | ✓ | `*N !N ·N` 任务计数 |
| `branchName` | 项目行 | — | 当前分支名（括号内） |
| `taskLine` | 第三行 | ✓ | 任务标题预览，最多 8 条 |
| `radar` | 第一行 | ✓ | 雷达告警行 |
| `worktrees` | 项目行末 | ✓ | `[branch git状态]` |

`taskTitleLen`：任务标题截断长度（默认 18 字符）。  
`taskLineMax`：任务行最多显示条数（默认 8）。

## 配置流程

用户运行 `/tvs-hud` 时，你（AI）执行以下步骤：

1. 读取 `~/.claude/hud/tvs-hud-config.json`（不存在则视为全部默认开启）
2. 用 `AskUserQuestion`（`multiSelect: true`）让用户勾选要显示的项目
3. 将结果写入 `~/.claude/hud/tvs-hud-config.json`：
   ```json
   {
     "show": ["git", "taskCounts", "taskLine", "radar", "worktrees"],
     "taskTitleLen": 18,
     "taskLineMax": 8
   }
   ```
4. 告知用户"配置已保存，statusLine 下次刷新即生效"

## 雷达告警逻辑

雷达行只在有告警时出现，按严重度红→橙→黄排序：

| 告警类型 | 触发条件 | 示例 |
|----------|----------|------|
| 未提交太久 | dirty + 距上次提交 ≥ 2 天 | `crestrail ~1 未提交3天` |
| 领先未合并 | ahead ≥ 1 | `shirehub_web ↑28 未合并` |
| 落后需 rebase | behind ≥ 1 | `main ↓5 需rebase` |
| stash 积压 | stash ≥ 2 条 | `repo stash×3` |
| worktree 落后 | worktree behind ≥ 5 | `repo/[feat/cdk] ↓19` |
| 停滞任务 | 进行中 > 5 天未更新 | `! tvs-task停5天` |

## statusLine 集成

tvs-hud 作为 `combined-status.mjs` 的子进程运行，与 omc HUD 合并后输出到状态栏。  
配置路径：`~/.claude/settings.json` → `statusLine.command`。
