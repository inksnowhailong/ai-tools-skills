# tvs-inksnow Claude Code 插件打包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AIConfig 仓库增量打包成 Claude Code 原生插件 `tvs-inksnow`（marketplace `tvs`），CC 用户经 `/plugin` 安装并自动更新，同时不破坏 Cursor/Codex/Cline 经 tvs-setup 的安装。

**Architecture:** 仓库根新增 `.claude-plugin/marketplace.json` + `plugin.json` 声明现有 `skills/`（唯一真源，不移动/复制）。tvs-setup 增加运行守卫（防在插件缓存内误跑）与插件感知（防 CC 上插件+tvs-setup 双装重复）。HUD statusLine 限制文档化。

**Tech Stack:** Node.js（零依赖 .mjs）、Claude Code 插件清单 JSON、git。

## Global Constraints

- 只做插件打包；不引入 npm CLI / CLAUDE.md 注入 / 版本横幅 / compact-shim（YAGNI）。
- 不移动、不重命名、不修改现有 15 个 skill 的内容。
- 清单 schema 照搬 OMC 已验证结构（`$schema`、字段名一致）。
- plugin name = `tvs-inksnow`；marketplace name = `tvs`；安装标识 `tvs-inksnow@tvs`；version 起点 `0.1.0`，`plugin.json` 与 `marketplace.json` 两处 version 必须一致。
- 仓库远程：`github.com/inksnowhailong/ai-tools-skills`（仓库名不变，仅插件名为 tvs-inksnow）。
- 提交信息不加 Co-Authored-By（用户规则）。
- 现有 15 skill 目录名（plugin.json skills 数组需逐一列全）：tvs-analyze, tvs-architect, tvs-boss, tvs-cc-migrator, tvs-clean-code, tvs-code-reviewer, tvs-deep-interview, tvs-hud, tvs-init-memory-system, tvs-inksnow-arch, tvs-mind-seed, tvs-pullread, tvs-setup, tvs-task, tvs-team-spawn。

---

## File Structure

- `.claude-plugin/marketplace.json` — 新增。市场清单，列 1 个插件，源 `./`。
- `.claude-plugin/plugin.json` — 新增。插件清单，声明 15 个 skill。
- `skills/tvs-setup/scripts/tvs.mjs` — 修改。加运行守卫 + 插件感知（detect/doctor/install）。
- `skills/tvs-setup/SKILL.md` — 修改。补 dup issue 说明。
- `README.md` — 修改。加 CC 插件安装节 + HUD 限制 + 版本同步规则。

---

### Task 1: 新增插件清单（marketplace.json + plugin.json）

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `.claude-plugin/plugin.json`

**Interfaces:**
- Produces: 仓库根成为合法 Claude Code marketplace + plugin；plugin 名 `tvs-inksnow`，marketplace 名 `tvs`。

- [ ] **Step 1: 创建 `.claude-plugin/marketplace.json`**

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "tvs",
  "description": "inksnow 个人 AI 助手配置库：项目分析、架构顾问、需求访谈、代码审查、多项目团队、状态栏 HUD、任务账本、记忆工程等 15 个 skill",
  "owner": { "name": "inksnowhailong" },
  "plugins": [
    {
      "name": "tvs-inksnow",
      "description": "一套工具中性的 skill 库：项目分析、架构顾问、需求访谈、代码审查、多项目团队、状态栏 HUD、任务账本、记忆系统等。",
      "version": "0.1.0",
      "author": { "name": "inksnowhailong" },
      "source": "./",
      "category": "productivity",
      "homepage": "https://github.com/inksnowhailong/ai-tools-skills",
      "tags": ["skills", "tasks", "architecture", "code-review", "memory"]
    }
  ],
  "version": "0.1.0"
}
```

- [ ] **Step 2: 创建 `.claude-plugin/plugin.json`**

```json
{
  "name": "tvs-inksnow",
  "version": "0.1.0",
  "description": "工具中性的个人 AI skill 库：项目分析、架构顾问、需求访谈、代码审查、多项目团队、状态栏 HUD、任务账本、记忆工程等 15 个 skill。",
  "author": { "name": "inksnowhailong" },
  "repository": "https://github.com/inksnowhailong/ai-tools-skills",
  "homepage": "https://github.com/inksnowhailong/ai-tools-skills",
  "license": "Apache-2.0",
  "keywords": ["skills", "tasks", "architecture", "code-review", "memory"],
  "skills": [
    "./skills/tvs-analyze/",
    "./skills/tvs-architect/",
    "./skills/tvs-boss/",
    "./skills/tvs-cc-migrator/",
    "./skills/tvs-clean-code/",
    "./skills/tvs-code-reviewer/",
    "./skills/tvs-deep-interview/",
    "./skills/tvs-hud/",
    "./skills/tvs-init-memory-system/",
    "./skills/tvs-inksnow-arch/",
    "./skills/tvs-mind-seed/",
    "./skills/tvs-pullread/",
    "./skills/tvs-setup/",
    "./skills/tvs-task/",
    "./skills/tvs-team-spawn/"
  ]
}
```

- [ ] **Step 3: 校验两份 JSON 合法、版本一致、skills 路径全部存在**

Run:
```bash
node -e "
const fs=require('fs');
const mk=JSON.parse(fs.readFileSync('.claude-plugin/marketplace.json','utf8'));
const pg=JSON.parse(fs.readFileSync('.claude-plugin/plugin.json','utf8'));
const a=new Error('断言失败');
if(mk.plugins[0].name!=='tvs-inksnow') throw a;
if(mk.name!=='tvs') throw a;
if(mk.version!==pg.version||mk.plugins[0].version!==pg.version) throw new Error('version 不一致');
for(const s of pg.skills){ const d=s.replace(/^\.\//,'').replace(/\/$/,''); if(!fs.existsSync(d+'/SKILL.md')) throw new Error('缺 SKILL.md: '+d); }
console.log('OK: 清单合法，version='+pg.version+'，skills='+pg.skills.length+' 个全部存在');
"
```
Expected: `OK: 清单合法，version=0.1.0，skills=15 个全部存在`

- [ ] **Step 4: 提交**

```bash
git add .claude-plugin/marketplace.json .claude-plugin/plugin.json
git commit -m "feat(plugin): 新增 tvs-inksnow 插件清单（marketplace tvs）

仓库根增量加 .claude-plugin/ 两清单，声明现有 15 个 skill；
skills/ 保持唯一源，同时服务 CC 原生插件与 tvs-setup 多工具。"
```

---

### Task 2: tvs-setup 运行守卫（防在插件缓存内误跑）

**Files:**
- Modify: `skills/tvs-setup/scripts/tvs.mjs`（`main()` 内，`SKILLS_DIR` 存在性检查之前）

**Interfaces:**
- Consumes: 已有常量 `SCRIPT_DIR`、`norm()`、`parseArgs` 产出的 `cmd`。
- Produces: 在插件缓存内运行 install/update 时报错退出；只读命令（detect/doctor/update 中 update 属变更，故仅 detect/doctor）放行。

- [ ] **Step 1: 在 `main()` 找到 `const cmd = args._[0]` 之后、`if (!existsSync(SKILLS_DIR))` 之前插入守卫**

当前 `main()` 开头结构：
```js
function main() {
    const args = parseArgs(process.argv.slice(2))
    const cmd = args._[0]
    // 拷贝安装的 skill 里跑本脚本时无法定位仓库（软链安装无此问题：Node 自动解析真实路径）
    if (!existsSync(SKILLS_DIR)) {
```
在 `const cmd = args._[0]` 与注释行之间插入：
```js
    // 插件缓存守卫：tvs-setup 被从 Claude Code 插件目录内误跑时，引导用 /plugin 而非本脚本。
    // 仅拦截会改动文件的命令（install/update）；detect/doctor 只读，放行以便诊断。
    const inPluginCache = !!process.env.CLAUDE_PLUGIN_ROOT
        || /[\\/]plugins[\\/](cache|marketplaces)[\\/]/.test(SCRIPT_DIR)
    if (inPluginCache && (cmd === 'install' || cmd === 'update')) {
        process.stdout.write(JSON.stringify({
            error: '检测到 tvs-setup 正从 Claude Code 插件内运行。Claude Code 请用 /plugin 管理本插件（install/update/uninstall）；tvs-setup 仅用于 Cursor/Codex/Cline，或从你自己克隆的仓库（如 ~/ai-tools-skills）运行。',
        }, null, 2) + '\n')
        process.exit(1)
    }
```

- [ ] **Step 2: 模拟插件环境验证守卫触发**

Run（用 CLAUDE_PLUGIN_ROOT 模拟插件内运行 install，应被拦）:
```bash
CLAUDE_PLUGIN_ROOT="/fake/plugin" node skills/tvs-setup/scripts/tvs.mjs install --no-pull 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.error?('拦截✓ '+j.error.slice(0,30)):'未拦截✗')})"
```
Expected: 以 `拦截✓` 开头

- [ ] **Step 3: 验证只读命令不被守卫拦（detect 正常）**

Run:
```bash
CLAUDE_PLUGIN_ROOT="/fake/plugin" node skills/tvs-setup/scripts/tvs.mjs detect 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.error?'被误拦✗':'detect 放行✓')})"
```
Expected: `detect 放行✓`

- [ ] **Step 4: 验证正常环境（非插件）install 不受影响**

Run（无 CLAUDE_PLUGIN_ROOT，--only 一个不存在的 skill 名快速返回，避免真装）:
```bash
node skills/tvs-setup/scripts/tvs.mjs install --only __none__ --no-pull 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.error?'误拦✗':'正常环境放行✓')})"
```
Expected: `正常环境放行✓`

- [ ] **Step 5: 提交**

```bash
git add skills/tvs-setup/scripts/tvs.mjs
git commit -m "feat(tvs-setup): 加插件缓存运行守卫

tvs-setup 被从 CC 插件目录内误跑 install/update 时引导改用 /plugin；
detect/doctor 只读命令放行。"
```

---

### Task 3: tvs-setup 插件感知（防 CC 上插件 + tvs-setup 双装重复）

**Files:**
- Modify: `skills/tvs-setup/scripts/tvs.mjs`（`detect()`、`doctor()`、`install()`）

**Interfaces:**
- Consumes: 已有函数 `pluginInstalled(name)`（扫 `~/.claude/plugins/cache/<marketplace>/<plugin>/` 两层匹配名）、`detect()` 产出的 `skills[s].claude.state`、`hosts()`。
- Produces: detect 输出新增 `pluginDup` 布尔与摘要行；doctor 新增 `claude-dup-with-plugin` issue；install 在插件已装时默认从 targets 移除 claude。

- [ ] **Step 1: detect() 计算并报告 pluginDup**

在 `detect()` 中，`const repo = repoStatus(true)` 之后、`const summary = []` 之前插入：
```js
    // CC 插件已装且 tvs-setup 又往 ~/.claude/skills 装过本仓库 skill → 重复
    const INSTALLED_STATES = ['linked', 'copy-synced', 'copy-drift']
    const pluginDup = pluginInstalled('tvs-inksnow')
        && repoSkills.some((s) => INSTALLED_STATES.includes(skills[s].claude?.state))
```
并在 `summary.push(\`HUD 接管(claude): ${hudLabel(hud)}\`)` 之后插入：
```js
    if (pluginDup) summary.push('⚠️ 重复：CC 插件 tvs-inksnow 已装，且 tvs-setup 也往 ~/.claude/skills 装过——CC 建议交给插件，移除 tvs-setup 的 claude 安装')
```
并把 `pluginDup` 加进 detect 的返回对象：
```js
    return { repoRoot: norm(REPO_ROOT), hosts: H, skills, orphans, thirdParty, hud, pluginDup, repo, summary }
```

- [ ] **Step 2: doctor() 把 pluginDup 转成 issue**

在 `doctor()` 中，`det.orphans` 循环之后、HUD issue 块之前（即 `if (!det.hud?.skipped ...` 之前）插入：
```js
    if (det.pluginDup) {
        issues.push({ kind: 'claude-dup-with-plugin', skill: 'Claude Code 重复安装', host: 'claude',
            hint: 'CC 已装 tvs-inksnow 插件；手动删 ~/.claude/skills/tvs-* 或 install --target cursor 只装其他工具。脚本不自动删 claude skills（避免误伤）' })
    }
```

- [ ] **Step 3: install() 在插件已装时默认跳过 claude**

在 `install()` 中，`const targets = (...)`.filter(...) 这一句之后插入：
```js
    // CC 已装插件时，默认不再用 tvs-setup 装 claude（防重复）；--force 可强装
    let targetsEffective = targets
    const skippedClaudeForPlugin = targets.includes('claude') && pluginInstalled('tvs-inksnow') && !args.force
    if (skippedClaudeForPlugin) targetsEffective = targets.filter((t) => t !== 'claude')
```
然后把后续 `for (const t of targets)` 改为 `for (const t of targetsEffective)`；并把循环外 HUD 接管块的守卫 `if (targets.includes('claude') && repoSkills.includes('tvs-hud'))` 改为 `if (targetsEffective.includes('claude') && repoSkills.includes('tvs-hud'))`（跳过 claude 时不再由 tvs-setup 接管 HUD，交给插件用户用 `/tvs-hud`）。再在 install 返回的 summary 数组最前面（`...fresh.summary` 之后）加入提示：把
```js
        summary: [...fresh.summary, `安装完成：${actions.length} 项动作，${skipped.length} 项跳过`, ...actions, ...skipped, ...hudActions],
```
改为
```js
        summary: [
            ...fresh.summary,
            ...(skippedClaudeForPlugin ? ['⚠️ 检测到 CC 已装 tvs-inksnow 插件，已跳过 claude（用 --force 可强装）；CC 请用 /plugin 管理'] : []),
            `安装完成：${actions.length} 项动作，${skipped.length} 项跳过`, ...actions, ...skipped, ...hudActions,
        ],
```

- [ ] **Step 4: 校验脚本语法 + detect 正常运行**

Run:
```bash
node skills/tvs-setup/scripts/tvs.mjs detect 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('detect 正常，pluginDup='+j.pluginDup)})"
```
Expected: `detect 正常，pluginDup=false`（本机当前未装 tvs-inksnow 插件，故 false）

- [ ] **Step 5: 模拟插件已装，验证 dup 检测 + install 跳过 claude**

Run（造一个假插件缓存目录让 pluginInstalled 命中，用隔离 USERPROFILE 不污染真实环境）:
```bash
TH="$HOME/AppData/Local/Temp/tvs-plugincheck"
rm -rf "$TH"; mkdir -p "$TH/.claude/plugins/cache/tvs/tvs-inksnow/0.1.0" "$TH/.claude/skills/tvs-task"
echo '{}' > "$TH/.claude/skills/tvs-task/SKILL.md"
UP="$(cygpath -w "$TH" 2>/dev/null || echo "$TH")"
echo "--- install --target claude（应跳过 claude）---"
USERPROFILE="$UP" node skills/tvs-setup/scripts/tvs.mjs install --target claude --no-pull 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.summary.some(l=>l.includes('已跳过 claude'))?'跳过 claude✓':'未跳过✗')})"
rm -rf "$TH"
```
Expected: `跳过 claude✓`

- [ ] **Step 6: 提交**

```bash
git add skills/tvs-setup/scripts/tvs.mjs
git commit -m "feat(tvs-setup): 插件感知防重复

检测 CC 已装 tvs-inksnow 插件：detect/doctor 报 claude-dup-with-plugin，
install 默认跳过 claude（--force 可强装），CC 交给插件管理。"
```

---

### Task 4: SKILL.md + README 文档

**Files:**
- Modify: `skills/tvs-setup/SKILL.md`（doctor issue 列表加 dup 项）
- Modify: `README.md`（CC 插件安装节 + HUD 限制 + 版本同步规则）

**Interfaces:**
- Consumes: 无（纯文档）。
- Produces: 用户可见的 CC 插件安装说明与约束。

- [ ] **Step 1: SKILL.md doctor issue 列表补 dup 说明**

在 `skills/tvs-setup/SKILL.md` 场景 2 的 issue 列表里（`hud-bridge-not-installed ...` 那条之后）追加一条：
```markdown
   - `claude-dup-with-plugin`：CC 已装 `tvs-inksnow` 插件，且 tvs-setup 又往 `~/.claude/skills` 装过本仓库 skill → 重复。CC 建议交给插件：手动删 `~/.claude/skills/tvs-*`，或之后只 `install --target cursor`（脚本不自动删 claude skills，避免误伤用户自有内容）。
```

- [ ] **Step 2: README 加 CC 插件安装节**

在 `README.md` 的「方式一 / 方式二」安装块之前，插入一节「方式零：Claude Code 插件（CC 用户首选）」：
```markdown
### 方式零：Claude Code 插件（CC 用户首选）

Claude Code 用户直接走原生插件，无需 clone/node，安装后**自动更新**：

\```text
/plugin marketplace add inksnowhailong/ai-tools-skills
/plugin install tvs-inksnow@tvs
\```

装完重启会话即可用全部 skill。Cursor/Codex/Cline 用户走下面的方式一/二。

> 注意：`tvs-hud` 状态栏需额外一步——插件只把脚本带到位，**接管状态栏仍需运行 `/tvs-hud`**（Claude Code 插件不能直接改用户 `statusLine` 设置，这是平台限制）。
```

- [ ] **Step 3: README「手动安装/升级」补版本同步规则**

在 `README.md` 的「手动安装 / 升级」节末尾追加：
```markdown

> 发布维护者注意：`.claude-plugin/plugin.json` 与 `.claude-plugin/marketplace.json` 的 `version`（marketplace 有两处）必须同步 bump，CC 插件渠道靠它判断更新。
```

- [ ] **Step 4: 校验文档关键串存在**

Run:
```bash
grep -q "plugin install tvs-inksnow@tvs" README.md && grep -q "claude-dup-with-plugin" skills/tvs-setup/SKILL.md && echo "文档✓" || echo "缺串✗"
```
Expected: `文档✓`

- [ ] **Step 5: 提交**

```bash
git add README.md skills/tvs-setup/SKILL.md
git commit -m "docs: README 加 CC 插件安装节 + HUD 限制 + 版本同步规则；SKILL.md 补 dup issue"
```

---

### Task 5: 真机插件加载验收（人工执行，Claude Code 交互）

> 本任务无法由脚本自动完成——`/plugin` 是 Claude Code 交互命令。由用户在 Claude Code 中执行并回报结果。失败则回到对应任务修复。

**Files:** 无（验收）

- [ ] **Step 1: 推送后从本地仓库添加 marketplace 并安装**

在 Claude Code 中执行（先 `git push` 让远程含 `.claude-plugin/`）：
```text
/plugin marketplace add inksnowhailong/ai-tools-skills
/plugin install tvs-inksnow@tvs
```
Expected: 安装成功、提示重启会话。

- [ ] **Step 2: 重启会话后确认 skill 被原生加载**

重启 Claude Code 会话，检查 skill 列表是否出现 `tvs-*`（如输入 `/` 看补全，或问"列出可用 skills"）。
Expected: 15 个 tvs-* skill 出现在插件提供的列表里。

- [ ] **Step 3: 抽样验证带脚本的 skill 在插件路径下可用**

调用 `tvs-task`（记一条任务）与 `tvs-boss`（开面板/状态），确认其 node 脚本能在 `${CLAUDE_PLUGIN_ROOT}/skills/...` 下正确解析运行（不报"找不到脚本/模块"）。
Expected: 两个 skill 的脚本正常执行。

- [ ] **Step 4: 验证 HUD 仍需 /tvs-hud 接管**

确认插件装好后状态栏**不会**自动出现 tvs 三行（符合 statusLine 限制）；运行 `/tvs-hud` 后再确认三行出现。
Expected: 接管前无、接管后有，与设计一致。

- [ ] **Step 5: 验证 tvs-setup 在 CC 下的防护**

在 Claude Code（已装插件）中让 tvs-setup `doctor`：应报 `claude-dup-with-plugin`（若你也曾用 tvs-setup 装过 claude）或正常；尝试 `install` 应被守卫拦或跳过 claude。
Expected: 与 Task 2/3 行为一致。

---

## 验收标准

- `.claude-plugin/` 两清单合法、version 一致、15 skill 路径齐全。
- tvs-setup 守卫与插件感知三处行为经隔离测试通过。
- 文档串校验通过。
- 真机 `/plugin` 安装、skill 原生加载、抽样脚本运行、HUD 接管行为均符合设计。
