# tvs-boss 文档减重实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 leader 每次启动的固定阅读税从 ~430 行压到 ≤310 行（-28%），规则条数从 15 条铁律压到 9 条，四级分流简化为三档——删表述、不删语义。

**Architecture:** 纯文档减重，四板斧：① SKILL.md 铁律合并同类项（15→9）；② 分级决策树简化（微/轻/中/重 → 微/默认/重）；③ 删"写给人看的理由段"（保行为、删动机）；④ 角色目录分层（核心 7 + 长尾一行式）。

**Tech Stack:** Markdown 编辑 + grep 交叉引用校验 + wc 行数验收。

## Global Constraints

- **安全语义零丢失**：分支闸门（新分支须 boss 批准）、干线 push/合并须拍板、编排禁令、回执必达、范围互斥、worktree 固定 `.worktree/`——每条约束的行为要求必须仍能从文档字面推出，只许合并表述，不许删含义。
- **机制文件不动**：`scripts/make-agents.mjs`（RED_LINES/RECEIPT 已验证）、`scripts/team-roles.json`、`scripts/panel.mjs`、`scripts/make-launcher.mjs`、`scripts/open-panel.mjs` 本计划一律不改。
- **节号骨架不重排**：leader-protocol 各节标题序号保持不变（只缩节内内容），避免全库节号引用连锁断裂。每个任务收尾都跑交叉引用检查。
- **基线（2026-07-27）**：SKILL.md 103 行 / leader-protocol.md 230 行 / agent-roles.md 65 行 / default-rules.md 23 行 / memory-design.md 73 行 / leader.md 32 行。启动税 = SKILL + leader + leader-protocol + agent-roles = 430 行。
- 本仓库当前在 `main`，且有上一轮未提交改动；一切修改必须在功能分支上做（Task 0）。

---

### Task 0: 功能分支 + 提交上一轮改动 + 基线留档

**Files:**
- 无新建；git 操作 + 已有未提交改动（skills/tvs-boss/* 6 个文件 + docs/）

**Interfaces:**
- Produces: 分支 `feat/tvs-boss-slim`，包含上一轮"并行优化"commit，后续任务全部在此分支上追加

- [ ] **Step 1: 建功能分支（带走未提交改动）**

```bash
cd "D:\coding\inksnow\tvs\AIConfig"
git switch -c feat/tvs-boss-slim
```

- [ ] **Step 2: 提交上一轮并行优化改动**

```bash
git add skills/tvs-boss docs/
git commit -m "feat(tvs-boss): 重任务并行流水线+微任务快通道+commit/push闸口+worktree/产出物规范"
```

- [ ] **Step 3: 记录基线行数（贴进本计划执行记录即可）**

```bash
wc -l skills/tvs-boss/SKILL.md skills/tvs-boss/references/*.md
```
Expected: 与 Global Constraints 基线一致。

---

### Task 1: SKILL.md 铁律段合并（15 条 → 9 条）

**Files:**
- Modify: `skills/tvs-boss/SKILL.md`（"## 核心铁律（已焊死）"整段替换）

**Interfaces:**
- Produces: 9 条铁律，每条"一句行为 + 细则指针"；后续任务与全库引用只依赖 leader-protocol 节号（不变），不依赖铁律条数。

- [ ] **Step 1: 用下面内容整段替换"## 核心铁律（已焊死）"的全部 bullet**（标题行保留）：

```markdown
- **单 leader 调度**；项目 = 各自独立目录 + 独立 git，天然隔离。
- **回执必达**：派活走原生 `Agent` 工具，队员最终输出=回执（≤15 行，大产出写【产出目录】带路径），由管道强制返回——绝不改回"让队员记得来汇报"的信箱模式。leader 上下文只积累回执不积累正文。
- **git 治理**：分支/worktree 按需申请、新建必须先经 boss 同意（无例外条款，先于一切执行，含编排类自治循环）；worktree 获准后固定 `<项目根>/.worktree/<分支名>/`；功能分支 commit 跟验收走、push 跟闸口走（自动）；**合并干线 / 向干线 push 必须 boss 拍板**（细则见 `leader-protocol.md` 第二、七节）。
- **spawn 纪律**：用生成的角色定义 `subagent_type: "tvs-<id>"`、不传 model（model/工具边界/红线/回执已烤死）；dev 绑项目，共享角色每单现起；同一需求 SendMessage 续派原队员、需求交付即弃，不维护常驻池（细则见 `agent-roles.md`、`leader-protocol.md` 第四节）。
- **量级分流**：微任务（机械微操作）leader 直接干，不派人——"leader 不动手"的唯一例外；重任务先拆解成范围互斥的子任务图、按依赖分波并行，不许单 dev 串行扛全部（细则见 `leader-protocol.md` 第十一、十二节）。
- **进度可见**：一条需求 = 一个原生 Task，随流水线阶段 `TaskUpdate`（细则见 `leader-protocol.md` 第八节）。
- **数据有界**：记忆只存慢变量三件套；过程产物唯一落点 `.tvs-boss/work/<需求slug>/`、需求交付即清；`.tvs-boss/` 顶层白名单化（细则见 `memory-design.md`、`leader-protocol.md` 第十三节）。
- **借力双轨**：纪律/方法类 skill 队员可自主用、leader 按复杂度点名；编排类只有 leader 有权启动且起飞前报 boss——共享角色的工具白名单已在机制上掐掉再派人的能力（细则见 `leader-protocol.md` 第三节）。
- **上下文纪律**：队员上下文三层供给（项目级自动加载 / 团队级烤进角色定义 / 单级写进派工单），leader 不重复注入、不亲自读码；变钝就建议 boss `/clear` 重启——持久状态全在 `.tvs-boss/` + git + Task，重启无损（细则见 `leader-protocol.md` 第九、十节）。
```

- [ ] **Step 2: 校验安全语义仍在**

```bash
grep -c "boss 同意\|boss 拍板" skills/tvs-boss/SKILL.md && grep -c "worktree\|干线\|回执" skills/tvs-boss/SKILL.md
```
Expected: 各计数 ≥1（关键词都还在）。

- [ ] **Step 3: Commit**

```bash
git add skills/tvs-boss/SKILL.md && git commit -m "refactor(tvs-boss): 铁律合并同类项 15→9 条"
```

---

### Task 2: SKILL.md 启动协议瘦身（删解释性段落）

**Files:**
- Modify: `skills/tvs-boss/SKILL.md`（启动协议 1/4 步、适用边界）

**Interfaces:**
- Produces: 启动协议行为不变，仅删动机说明；SKILL.md 总行数 ≤80。

- [ ] **Step 1: 压缩"### 1. 确认运行基座"**——整段（含缓存建议 blockquote）替换为：

```markdown
### 1. 确认运行基座
派活/回执内核是**原生 `Agent` 工具**（回执=返回值必达，无需实验开关）。有 `SendMessage`（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）可需求内续派；建议设 `ENABLE_PROMPT_CACHING_1H=1` 拉长前缀缓存。
```

- [ ] **Step 2: 删 make-launcher 步骤里的动机句**——删除这一行（保留其余 bullet）：

```
- 必须"按团队生成"而非塞进 skill 源码的原因：启动器是运行态产物，落在团队数据 `.tvs-boss/` 里、每个团队根各异。
```

- [ ] **Step 3: 压缩适用边界 blockquote** 为一句：

```markdown
> **适用边界（leader 要主动劝退）**：同时推进 3+ 项目/多线并行才划算；单项目单线任务直接开普通会话更快，遇到就如实建议 boss 别用团队模式。
```

- [ ] **Step 4: 行数验收 + Commit**

```bash
wc -l skills/tvs-boss/SKILL.md   # Expected: ≤80
git add skills/tvs-boss/SKILL.md && git commit -m "refactor(tvs-boss): 启动协议删动机段"
```

---

### Task 3: leader-protocol 分级简化（四级 → 三档）

**Files:**
- Modify: `skills/tvs-boss/references/leader-protocol.md`（§一 ④、§三 复杂度选择块）

**Interfaces:**
- Consumes: Task 1 的铁律指针（节号不变）
- Produces: 三档分流（微 / 默认 / 重）；"轻/中"合并为"默认"

- [ ] **Step 1: §一 ④ 整条替换为：**

```
④ 量级分流？      —— 微任务（机械微操作：无需读懂业务代码、一两个工具调用能完、
                     结果即时可验）→ 微任务快通道（第十二节）；
                     重任务（满足任一：≥3 个可独立验收的子交付；批量语义；
                     单 dev 预估要连续多轮）→ 重任务并行流水线（第十一节）；
                     其余 → 默认单线流水线（第二节）。
```

- [ ] **Step 2: §三 复杂度选择块**——把"轻量/中量/重量"三行替换为两行：

```
默认（单点改动到完整功能）：dev 直接干；中等体量在派工单点名纪律类 skill
  （writing-plans / TDD，计划落 Task 子项），卡壳时 systematic-debugging。
重量（多模块联动/可高度并行）：走第十一节「重任务并行流水线」（拆解→波次并行→汇合审查）。
  子任务 ≥8 或依赖层级 >3 时，可报 boss 一句后改用原生 Workflow 工具编排
  （agentType 仍指 tvs-* 角色定义，红线/回执随定义生效；分支已在闸门钉死）。
  不再推荐借 OMC /team：其 native 路径机制含量低，且会绕开分支/push 闸门。
```

- [ ] **Step 3: 全库扫"轻量\|中量\|轻/中"确认无残留引用**

```bash
grep -rn "轻量\|中量" skills/tvs-boss --include="*.md"
```
Expected: 0 命中（或仅历史无关处，逐条确认）。

- [ ] **Step 4: Commit**

```bash
git add skills/tvs-boss/references/leader-protocol.md && git commit -m "refactor(tvs-boss): 分级简化为微/默认/重三档"
```

---

### Task 4: leader-protocol 删解释性段落（保行为、删理由）

**Files:**
- Modify: `skills/tvs-boss/references/leader-protocol.md`（§三、§四、§五、§十一）

**Interfaces:**
- Produces: leader-protocol ≤185 行；节号骨架不变（§五保留标题、内容缩为两行）

- [ ] **Step 1: §三 删"为什么焊死"整个 bullet**（以 `- **为什么焊死**：` 开头、到"故障无法归因"结尾的一整条）。保留"机制保障"与"leader 自己动用编排类"两条。

- [ ] **Step 2: §四 删"为什么不心疼"整个 bullet**（以 `- **为什么不心疼**：` 开头的一整条）。保留其后"唯一常驻的是 leader"句。

- [ ] **Step 3: §五 整节内容替换为两行**（标题"## 五、被问"现在啥情况""保留）：

```markdown
首选看原生 Task 列表（第八节），再对每个项目 `git -C <path> branch --show-current` / 最近 commit 现场印证，汇总成人话报给 boss——哪条线在推进、哪个等他拍板。Task 是进度视图，git 是客观事实。
```

- [ ] **Step 4: §十一 删开头动机段**——删除这一段（保留流程图及其后内容）：

```
单线流水线的瓶颈是"每一棒都回 leader 排队"；重任务改为**先拆解、按依赖分波、波内全并行**，leader 的回合数从"棒数"降到"波数+审查"。回执必达与分支闸门不变。
```
替换为一句：`回执必达与分支闸门不变，leader 回合数从"棒数"降到"波数+审查"。`

- [ ] **Step 5: §十二 删税率解释**——把第 1 条里"这类活 spawn 本身就是错的（出生仪式税远超正事）。"删去，直接以"leader 直接用 Bash/Edit 执行"起句；其余保留。

- [ ] **Step 6: 行数验收 + 交叉引用检查 + Commit**

```bash
wc -l skills/tvs-boss/references/leader-protocol.md   # Expected: ≤185
grep -rn "第五节" skills/tvs-boss --include="*.md"     # 确认引用§五处仍成立（§五仍存在）
git add skills/tvs-boss/references/leader-protocol.md && git commit -m "refactor(tvs-boss): protocol 删动机段落"
```

---

### Task 5: agent-roles.md 角色分层（核心 7 + 长尾一行式）

**Files:**
- Modify: `skills/tvs-boss/references/agent-roles.md`（"## 19 角色一览"整段替换）

**Interfaces:**
- Consumes: `scripts/team-roles.json`（完整定义仍在，本任务只改索引文档）
- Produces: 主文档只展开核心 7 角色；长尾 12 角色压成一行式；spawn 规矩段不动

- [ ] **Step 1: 把"## 19 角色一览"到"## 通用硬边界"之间的内容整段替换为：**

```markdown
## 19 角色一览（核心 7 + 长尾 12）

**核心角色（日常 90% 的活）：**
- `executor` 实现者 —— 把确认方案落成最小、最清晰的改动（实现类）
- `designer` 前端设计 —— 组件/交互/状态机/边缘情况（实现类）
- `test-engineer` TDD 工程师 —— 红绿重构，先写失败用例（实现类）
- `explore` 代码勘察 —— 定位文件/符号/调用链（只读）
- `planner` 战略规划 —— 大目标拆成可交付阶段；重任务拆解产出子任务图（每条含 范围=互斥文件簇 / 依赖 / 验收标准，见 `leader-protocol.md` 第十一节）（只读）
- `code-reviewer` 代码审查 —— diff 的可读性/影响/契约/回归（只读）
- `debugger` 调试 —— 定位编译/运行时/CI 错误并提修复（只读）

**长尾角色（按需点用，完整定义见 `scripts/team-roles.json`）：**
`code-simplifier`(化繁为简·实现类) / `architect`(架构边界) / `analyst`(前期分析) / `critic`(毒舌审查) / `tracer`(根因因果链) / `scientist`(数据分析) / `security-reviewer`(安全审查) / `qa-tester`(测试场景) / `writer`(文档文案) / `document-specialist`(仓库文档研究) / `vision`(截图/设计稿解读) / `git-master`(分支/合并/worktree 操作)
```

- [ ] **Step 2: 校验角色数一致**

```bash
grep -c '"id"' skills/tvs-boss/scripts/team-roles.json   # Expected: 19
grep -o 'tvs-[a-z-]*' skills/tvs-boss/references/agent-roles.md | sort -u | head
```
Expected: json 仍 19 角色；md 中核心 7 + 长尾 12 名字与 json 的 id 一一对应（人工比对一遍）。

- [ ] **Step 3: 行数验收 + Commit**

```bash
wc -l skills/tvs-boss/references/agent-roles.md   # Expected: ≤55
git add skills/tvs-boss/references/agent-roles.md && git commit -m "refactor(tvs-boss): 角色目录分层 核心7+长尾12"
```

---

### Task 6: default-rules.md 预填守则压缩

**Files:**
- Modify: `skills/tvs-boss/references/default-rules.md`（预填内容代码块内 3 条）

**Interfaces:**
- Produces: 预填守则语义不变、行数 ≤18；模型档 4 子弹压 2 行

- [ ] **Step 1: "允许队友用全局 skill"条替换为一行：**

```markdown
- **允许队友用全局 skill**：派活时 leader 主动告知可用全局 skill 并点名当下最相关的几个——合适的 skill 该用就用。
```

- [ ] **Step 2: "按任务难易选模型"条（含 4 个子弹与 fork 注意）替换为：**

```markdown
- **按任务难易选模型，别一律 opus**：haiku=纯机械零风险（改常量/跑命令/git/文档）；sonnet=正确性敏感与常规实现（SQL/接口字段/组件/CRUD，下限不低于 sonnet）；opus=高难度（架构/复杂推理/审查/棘手 bug/跨系统权衡）。
- **机械/低难度活不用 fork**（fork 继承 leader 的 opus 且无法降档）——改派指定低档模型的 fresh agent；fork 只留给"需继承 leader 满上下文 + 高难度"的活。
```

- [ ] **Step 3: 行数验收 + Commit**

```bash
wc -l skills/tvs-boss/references/default-rules.md   # Expected: ≤18
git add skills/tvs-boss/references/default-rules.md && git commit -m "refactor(tvs-boss): 默认守则压缩"
```

---

### Task 7: 终验：行数汇总 + 交叉引用全扫 + 生成验证

**Files:**
- 只读校验，无修改（发现问题回对应 Task 修）

**Interfaces:**
- Consumes: Task 1-6 全部产物

- [ ] **Step 1: 启动税验收**

```bash
wc -l skills/tvs-boss/SKILL.md skills/tvs-boss/references/leader.md skills/tvs-boss/references/leader-protocol.md skills/tvs-boss/references/agent-roles.md
```
Expected: 四文件合计 ≤310 行。

- [ ] **Step 2: 节号引用全扫**

```bash
grep -rn "第[一二三四五六七八九十]*节" skills/tvs-boss --include="*.md" | grep -v "leader-protocol.md:"
```
Expected: 每条引用的节在 leader-protocol.md 中仍存在同号标题（逐条人工核对，§一~§十三 全在）。

- [ ] **Step 3: 安全语义关键词清单核验**（每个关键词在 skills/tvs-boss 下命中 ≥1）：

```bash
for kw in "boss 同意" "拍板" "干线" "回执" "范围互斥" ".worktree/" "work/" "编排类" "不传 model"; do printf "%s: " "$kw"; grep -rc "$kw" skills/tvs-boss --include="*.md" --include="*.mjs" | awk -F: '{s+=$2} END {print s}'; done
```
Expected: 全部 ≥1。

- [ ] **Step 4: make-agents 生成回归**（确认文档改动没碰坏脚本引用）

```bash
node skills/tvs-boss/scripts/make-agents.mjs --root "$TMPDIR/tvs-slim-test" && rm -rf "$TMPDIR/tvs-slim-test"
```
Expected: "已生成 19 个角色定义"。

- [ ] **Step 5: 最终 Commit（如有终验修正）**

```bash
git add -A skills/tvs-boss && git commit -m "refactor(tvs-boss): 减重终验修正" || echo "无修正，跳过"
```

---

### Task 8（可选，建议独立会话跑）: tvs-skill-audit 语义审计

- [ ] 对减重后的 tvs-boss 跑 `/tvs-skill-audit`，验证是否仍有"写给人看的整段设计理由"漏网；有则按审计结果二次精简。
- 不放进本计划自动执行：审计器与被审对象不该在同一上下文里自我评分（写作与评审分离）。

---

## Self-Review 记录

- 覆盖检查：评估结论的三个过重点（规则密度→Task 1/2/4；分级开销→Task 3；角色长尾→Task 5）全部有对应任务；default-rules 压缩（Task 6）是顺带收益。
- 占位符检查：所有替换文本均为可直接粘贴的完整内容，无 TBD。
- 一致性检查：节号骨架不重排（Global Constraints），Task 7 Step 2 兜底全扫；铁律指针只指节号与文件名，不指条目序号。
