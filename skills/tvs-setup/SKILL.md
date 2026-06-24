---
name: tvs-setup
description: 当用户说"安装/更新 tvs skill、tvs setup、体检一下 skill、doctor、检查 skill 安装状态、装到新机器、skill 同步了吗、有没有漂移、清理旧 skill"时使用。作用：调用随包 scripts/tvs.mjs（detect/install/doctor）完成本仓库 skills 的安装（软链优先）、更新与体检（漂移/死引用/frontmatter/孤儿/断链），并探测 omc、superpowers、codegraph 生态增强是否就绪，缺失时给出官方安装建议——tvs 专注差异化能力，重叠能力推荐生态最强者补足。
disable-model-invocation: true
---

# tvs-setup：安装、体检与生态增强

本 skill 是 AIConfig 的入口工程：**确定性动作全部由脚本完成，你（AI）只负责解读 JSON、给建议、向用户要确认**。不要绕过脚本手动复制文件——那正是本 skill 要消灭的漂移来源。

## 运行时命令

```text
node "<skill-path>/scripts/tvs.mjs" <command> [flags]
```

`<skill-path>` 用 IDE 提供的 skill 路径动态解析。脚本会自己定位仓库根（软链安装时 Node 自动解析真实路径）；若报"无法定位 AIConfig 仓库"，说明当前是拷贝安装——引导用户到仓库目录内执行。

| 命令 | 作用 |
|---|---|
| `detect` | 宿主（claude/cursor）+ 每个 skill 的安装状态 + 孤儿目录 + 第三方生态探测 |
| `install [--target claude,cursor] [--mode link\|copy] [--only a,b] [--force] [--prune] [--no-pull]` | 安装/更新；**开头自动拉取远程最新**（脏仓库自动跳过保护编辑，`--no-pull` 关闭）；**默认 copy**（消费者独立拷贝、无绝对路径泄漏）、`--mode link` 给作者改即生效（已软链的不显式 --mode 会保持软链）；默认所有已检测到的宿主 |
| `doctor [--fix]` | detect 全部内容 + 死脚本引用扫描 + frontmatter lint + README 同步检查 + HUD 接管链路检查；`--fix` 自动修复漂移拷贝、断链与 HUD 接管 |
| `update [--pull]` | 检查远程是否有新版本（落后时列出最近新提交）；`--pull` 执行更新（仅 fast-forward，仓库有未提交修改时拒绝） |

## 四种使用场景

### 1. 新机器 / 首次安装（"装一下 tvs"）

1. 跑 `detect`，把 summary 给用户看（哪个宿主、当前状态、第三方生态缺什么）。
2. 确认目标宿主后跑 `install`（默认 copy——独立拷贝、永远从远程拉最新、无 clone 常驻依赖/绝对路径泄漏。你自己开发本仓库时加 `--mode link` 改即生效）。
3. 按下面"生态增强建议"一节处理第三方推荐。

### 2. 日常体检（"体检一下 / skill 同步了吗"）

1. 跑 `doctor`，解读 issues：
   - `copy-drift`：本机拷贝与仓库不一致。**先判断方向**——如果用户刚改过仓库，是本机落后（可 `--fix` 同步）；如果用户可能在本机改过 skill，提醒先把修改合回仓库再 fix，不要静默覆盖。
   - `dead-script-ref` / `frontmatter-*` / `readme-missing-skill`：仓库本身的质量问题，需要修仓库文件，脚本不自动修。
   - `orphan`：仓库已删但本机还在的 tvs- 目录，确认后用 `install --prune` 清除。
   - `broken-link` / `linked-elsewhere`：链接失效或指向别处（仓库被移动过），`--fix` 重建或重新 install。
   - `hud-bridge-not-installed` / `hud-bridge-drift` / `statusline-not-wired` / `statusline-missing-omc-hud-flag`：状态栏 HUD 接管链路断裂（详见下节），`--fix` 自动修复。`hud-bridge-missing-in-repo` 是仓库缺源文件，脚本不自动修，需补回 `skills/tvs-hud/hud/combined-status.mjs`。
2. 修复类动作（`--fix` / `--prune` / `--force`）**先告知用户影响再执行**。`--fix` 修 HUD 会改写 `~/.claude/settings.json` 的 `statusLine.command`（仅这一个键，其余保序不动），执行前提示用户。

### 3. 版本更新（"有新版吗 / 更新一下"，或 detect/doctor 报 repo-outdated 时）

1. 跑 `update`（只检查不动仓库），解读 `repo` 字段：
   - `behind > 0`：把 `newCommits` 列表（最近新提交）展示给用户，**询问"要更新到最新版吗？"**，同意后跑 `update --pull`。
   - `behind = 0, ahead > 0`：本地领先远程，提醒用户记得 push（别人机器上才能拉到）。
   - `dirty: true` 且要 pull：脚本会拒绝，引导用户先提交/暂存本地修改。
   - `fetchOk: false`：远程不可达，结果是本地缓存比较，如实告知。
2. pull 成功后提醒：软链安装即时生效；该机器若有拷贝安装的宿主，再跑 `doctor --fix` 同步。
3. **不要未经询问就 `--pull`**——更新会改变用户仓库状态。

### 4. 生态增强建议（"怎么让 AI 更强"或 detect 发现缺失时）

detect 的 `thirdParty` 字段给出每项的 `installed` / `hint`（官方安装命令）/ `why`（为什么装）。原则：

```text
tvs 专注差异化：任务账本、字符画分析、个人代码观、思维教练访谈、
                Cursor 团队系统、入库记忆工程、配置迁移。
重叠能力让位：结构图谱 → codegraph；重编排/自治循环 → omc；
              TDD/调试纪律 → superpowers。
```

- 缺失时把 `hint` 命令和 `why` 一句话给用户，**征得同意后可以代跑安装命令**；用户拒绝不影响 tvs 任何功能（所有 tvs skill 都有降级路径）。
- 全部就绪时一句话确认即可，不要重复推销。

## HUD 状态栏接管（tvs-hud 依赖链路）

tvs-hud 要出现在 Claude Code 状态栏，依赖一条三点链路，缺一不可：

```text
1. ~/.claude/hud/combined-status.mjs   桥接文件（仓库 skills/tvs-hud/hud/ 为源，部署到此处）
2. settings.json → statusLine.command  指向该桥接文件
3. 命令末尾 --omc-hud                   让 OMC 自检 includes("omc-hud") 通过，否则 OMC HUD 退化成诊断文字
```

- `detect` / `doctor` 会输出 `HUD 接管(claude)` 状态行；断裂时报对应 issue。
- `doctor --fix`：把仓库的 combined-status.mjs 拷到 `~/.claude/hud/`（始终拷贝、独立于 skill 软链，卸载 tvs-hud 不会让状态栏报错），并改写 statusLine 指向它、补 `--omc-hud`（沿用现有 node 路径，仅当首 token 像 node 时；否则回退当前 node）。
- `install` 装了 tvs-hud 且目标含 claude 时，自动执行同样的接管。
- **复发点**：跑 `/oh-my-claudecode:hud setup` 会把 statusLine 改回纯 omc，tvs 三行随之消失——再 `doctor --fix` 即可恢复。

## 与 tvs-cc-migrator 的边界

| | tvs-setup | tvs-cc-migrator |
|---|---|---|
| 对象 | **本仓库** skills 的安装与健康 | 整个 `~/.claude/` 配置（含第三方插件、settings、agents） |
| 场景 | 装/更新/体检 tvs | 换电脑时整体备份与恢复 |

换机器的完整动作 = cc-migrator 恢复全局配置 + tvs-setup 重装本仓库 skills（软链需要本机 clone 仓库）。

## 规则

- 默认 copy 模式（消费者）；作者本地开发本仓库时用 `--mode link`（改即生效）。install/doctor 会自动拉远程最新，脏仓库自动跳过——所以作者的未提交改动不会被覆盖。
- `--force` 会覆盖可能含本地修改的漂移拷贝，必须先向用户确认方向。
- 不要自作主张安装第三方；给出命令与理由，由用户决定。
- 输出给用户的内容以 summary 为主，JSON 细节按需展开，不要整段贴 JSON。
