---
name: tvs-setup
description: 当用户说"安装/更新 tvs skill、tvs setup、体检一下 skill、doctor、检查 skill 安装状态、装到新机器、skill 同步了吗、有没有漂移、清理旧 skill、启用/开启某条规则、调整规则、打开反哺、feedback-loop"时使用。作用：调用随包 scripts/tvs.mjs（detect/install/doctor）完成本仓库 skills 的安装（软链优先）、更新与体检（漂移/死引用/frontmatter/孤儿/断链），并探测 omc、superpowers、codegraph 生态增强是否就绪，缺失时给出官方安装建议——tvs 专注差异化能力，重叠能力推荐生态最强者补足。
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
| `install [--target claude,cursor] [--mode link\|copy] [--only a,b] [--rules a,b\|none] [--force] [--prune] [--no-pull]` | 安装/更新；**开头自动拉取远程最新**（脏仓库自动跳过保护编辑，`--no-pull` 关闭）；**默认 copy**（消费者独立拷贝、无绝对路径泄漏）、`--mode link` 给作者改即生效（已软链的不显式 --mode 会保持软链）；默认所有已检测到的宿主。**`--rules`**＝选哪些个人规则注入 claude 全局 CLAUDE.md（见"可选规则"节）：不给＝保留现有选择、首装用 `default:on`；`--rules none` 全不装 |
| `doctor [--fix]` | 只读体检：detect 全部内容 + 死脚本引用 + frontmatter + README 同步 + HUD 链路；**每个问题标 `fixClass`**（auto/auto-confirm/guided）；`--fix` 自动修复 auto 类（漂移/断链/HUD）。输出 `installForm`（当前安装形式）|
| `repair [--prune] [--prune-stale-claude]` | **自愈入口** = `doctor --fix` + 破坏性清理（需显式 flag、先告知用户）：`--prune` 清孤儿、`--prune-stale-claude` 删"插件已装却又在 ~/.claude/skills 的旧目录安装"（mixed 形式去重，只删本仓库 skill、留用户自有）。可在插件形式下运行（自愈正需如此）|
| `update [--pull]` | 检查远程是否有新版本（落后时列出最近新提交）；`--pull` 执行更新（仅 fast-forward，仓库有未提交修改时拒绝） |
| `bootstrap` | 插件消费者一次性自举：静默归一 `skillListingBudgetFraction=0.02` + 写 marker + 输出依赖安装计划（见下节"插件自举"）。由 SessionStart 钩子自动提示触发 |

## 四种使用场景

### 1. 新机器 / 首次安装（"装一下 tvs"）

1. 跑 `detect`，把 summary 给用户看（哪个宿主、当前状态、第三方生态缺什么）。
2. 确认目标宿主后跑 `install`（默认 copy——独立拷贝、永远从远程拉最新、无 clone 常驻依赖/绝对路径泄漏。你自己开发本仓库时加 `--mode link` 改即生效）。
3. **【必经步骤·规则勾选】** 读 detect 的 `rules` 字段：只要存在 `default:off 且未选中` 的可选规则（summary 里那行 `💡 可选规则未启用`），就**必须**用 AskUserQuestion 多选问用户启用哪些（详见"可选规则"节），不能跳过。用户全不选也行——但要主动问，别让可选规则隐形。
4. 按下面"生态增强建议"一节处理第三方推荐。

### 2. 日常体检（"体检一下 / skill 同步了吗"）

1. 跑 `doctor`，解读 issues：
   - `copy-drift`：本机拷贝与仓库不一致。**先判断方向**——如果用户刚改过仓库，是本机落后（可 `--fix` 同步）；如果用户可能在本机改过 skill，提醒先把修改合回仓库再 fix，不要静默覆盖。
   - `dead-script-ref` / `frontmatter-*` / `readme-missing-skill`：仓库本身的质量问题，需要修仓库文件，脚本不自动修。
   - `orphan`：仓库已删但本机还在的 tvs- 目录，确认后用 `install --prune` 清除。
   - `broken-link` / `linked-elsewhere`：链接失效或指向别处（仓库被移动过），`--fix` 重建或重新 install。
   - `hud-bridge-not-installed` / `hud-bridge-drift` / `statusline-not-wired` / `statusline-missing-omc-hud-flag`：状态栏 HUD 接管链路断裂（详见下节），`--fix` 自动修复。`hud-bridge-missing-in-repo` 是仓库缺源文件，脚本不自动修，需补回 `skills/tvs-hud/hud/combined-status.mjs`。
   - `claude-dup-with-plugin`：CC 已装 `tvs-inksnow` 插件，且 tvs-setup 又往 `~/.claude/skills` 装过本仓库 skill → 重复。CC 建议交给插件：手动删 `~/.claude/skills/tvs-*`，或之后只 `install --target cursor`（脚本不自动删 claude skills，避免误伤用户自有内容）。
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

### 5. 调整规则开关（"开启 feedback-loop / 调整规则 / 打开反哺 / 关掉某条规则"）

用户想单独开/关某条规则时（不是整体重装），标准三步——**不要让用户自己背 `--rules` 全量覆盖语义**：

1. 跑 `detect`，读 `rules.items`（每条带 `id/selected/installed/default/drift/description`）。
2. 用 **AskUserQuestion 多选**列出全部规则，**预勾选＝当前 `selected`**，让用户增删。
3. 把用户最终勾选的**全集**传给 `install --target claude --rules <逗号分隔 id>`。
   - ⚠️ `--rules` 是**全量覆盖**：没列进去的会被移除。所以必须带上用户仍要保留的核心规则（role、coding-rules），漏写会误删人格。AskUserQuestion 预勾选就是为了防这个。
   - 用户想"全关"才传 `--rules none`。

个人规则（`rules/*.md`）不是 skill——它们注入 **claude 全局 `~/.claude/CLAUDE.md`** 的托管段（`<!-- TVS_RULES_START -->`…`<!-- TVS_RULES_END -->`），用 `@rules/x.md` 引入，文件拷到 `~/.claude/rules/`。每条规则靠自身 frontmatter 自注册（`name` / `description` / `default: on|off`），丢个新 `.md` 进 `rules/` 就能在安装时被勾选，无需维护清单。`default: on`＝核心默认装（如 `role`、`coding-rules`），`default: off`＝可选默认不装（如 `feedback-loop`）。

**确定性动作全在脚本**（拷贝、托管段幂等重写、漂移检测），你只负责**问用户勾选哪些**，再把结果传给脚本：

- **首次安装（场景1）/ repair 收尾**：跑 `detect`（或 doctor）读 `rules` 字段——每条含 `selected/installed/drift/default/description`。若有 `default: off` 的可选规则尚未选中，用 **AskUserQuestion 多选**问用户要启用哪些（预勾选＝各自 `default`），把最终选择（含已选的核心规则）传给 `install --target claude --rules <逗号分隔的 id>`。
- **不想改动规则**就别带 `--rules`：安装会**保留现有选择**（首装才用 `default:on`），所以日常更新不会动用户的规则取舍。
- ⚠️ AskUserQuestion 多选上限 4 项，规则数 ≤4 时直接用；**超过 4 条**改为打印清单 + 让用户报 `--rules a,b,c`（现在 3 条，YAGNI 不预建）。
- **opt-out 永远不是故障**：是否选某规则＝用户选择，不进体检；只有"已装规则内容与仓库漂移"（`rule-drift`，auto 类）才被 doctor 报、repair 自动同步。
- 规则独立于插件：即便 CC 装了 `tvs-inksnow` 插件（插件不管 rules），`install --target claude` 仍会处理规则。

## 自愈框架（doctor / repair 的设计理念）

目标：让整套 skill **自检 + 自愈到可运行**，而不是用户每次列举一个个坏点。三块：

1. **健康契约（分类表 `FIX_CLASS`）**：每类问题声明能否自动修——`auto`（无副作用，repair 直接修：漂移/断链/HUD 链路）、`auto-confirm`（破坏性，需 flag + 先告知用户：孤儿、mixed 去重）、`guided`（需人/AI 判断或改仓库源：死引用/frontmatter/linked-elsewhere/repo 落后）。doctor 给每个问题打上分类，AI 据此决定怎么处理。**新增一类故障，只需往契约表加一条，从此全机器自动检测——这是"不用用户列举"的关键。**
2. **形式感知（`installForm`）**：先判当前是 `plugin` / `link`（作者）/ `copy`（消费者）/ `mixed`（插件+旧目录并存=重复）/ `none`，因为"什么叫健康"随形式不同。所有检测按形式判对错。
3. **修复引擎（`repair`）**：跑契约、自动修 auto 类、对 auto-confirm 类要 flag、guided 类交 AI/用户。可在插件形式下运行。

### 安装形式相关的处置（detect/doctor 会给出 `installForm`）

- **`mixed`（插件已装 + 旧 AI/目录安装并存）**：报 `claude-dup-with-plugin`。CC 建议交给插件——**告知用户后**用 `repair --prune-stale-claude` 删旧目录安装（只删本仓库 skill、保留孤儿与用户自有，绝不误伤）。
- **`plugin`（纯插件）**：健康，`install` 默认会跳过 claude（防重复），不主动往 ~/.claude/skills 装。
- **`link` / `copy`（一直用 AI/脚本安装、没装插件）**：**维持现状**，绝不硬推插件；正常 install/repair 即可。
- 判断"该不该清旧安装"只看 `mixed`：插件与目录安装同时存在才清；只有其一不动。

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

## 插件自举（bootstrap，仅 Claude Code 插件消费者）

用户用 `/plugin install tvs-inksnow` 装了插件后，插件自带的 SessionStart 钩子（`hooks/hooks.json` → `bootstrap-check.mjs`）会探测 marker（`~/.claude/.tvs-inksnow/bootstrap.json`）：未自举或插件升级时，向会话注入提示，要你（AI）跑一次自举。流程：

1. 跑 `node "${CLAUDE_PLUGIN_ROOT}/skills/tvs-setup/scripts/tvs.mjs" bootstrap`，解读返回 JSON。
2. 脚本已**确定性**完成两件事：静默把 `skillListingBudgetFraction` 归一到 `0.02`（仅这一个键，保序回写）、写 marker（之后不再提示，除非插件升级）。
3. 依赖按 `deps` 分类处理——**激进全自动**原则：
   - `auto:true`（omc 走 npm、codegraph 走 npx）：缺失时**征得用户同意后直接代跑** `cmd`（`npm i -g oh-my-claudecode && omc setup` / `npx @colbymchenry/codegraph`）。codegraph 的 `codegraph init -i` 是按项目交互建索引，留给用户。
   - `auto:false`（superpowers 纯插件）：脚本和 AI 都跑不了 `/plugin`，把 `cmd` 打印给用户手动执行。
4. `missingAuto` / `missingManual` 直接告诉你还差哪些、各自怎么补。

> **边界**：只有脚本能确定性完成的配置改动（如上面第 2 步的归一化+写 marker）才允许静默做；涉及安装/执行外部命令（第 3 步 `auto:true`/`auto:false`）必须先经用户确认才能代跑，不能把"确定性配置可静默"泛化到整个 bootstrap 流程。

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
