# Agent 角色目录

团队自带 **19 个角色**，完整定义（`systemPrompt` / 建议工具 / 模型档 / 记忆提示）在 **`scripts/team-roles.json`**，本文件是给 leader 看的索引 + spawn 规矩。

## leader 怎么 spawn 一个角色

**主路径（角色定义已生成——启动协议第 4 步保证）：**

`Agent({ subagent_type: "tvs-<角色id>", prompt: "<派工单>" })`

- **不传 model**——已钉死在 `<团队根>/.claude/agents/tvs-<id>.md` 的 frontmatter（档位：deep→opus / fast→sonnet / cheap→haiku，生成源是 `scripts/team-roles.json`）。
- 工具边界、团队红线、回执格式也都烤在定义里；leader 只负责**把派工单写全**（项目/分支/任务/背景/范围，模板见 `leader-protocol.md` 第一节）。
- 定义由 `make-agents.mjs` 生成，幂等；改了 `team-roles.json` 或红线/回执模板后重跑即同步。

**降级路径（角色定义缺失时才用）：**

1. 有 `omcSubagentType`（18/19 角色）→ `Agent({ subagent_type: "<omcSubagentType>", model: "opus|sonnet|haiku", prompt: "..." })`
   ⚠️ **此路径必须显式传 model 别名**（`opus`/`sonnet`/`haiku` 三者之一）：传全模型 ID（`claude-opus-4-8`…）或 tier 词（`deep`）会被工具**静默忽略**→队员继承 leader 的 Opus（又慢又烧）；不传也继承。取值看角色 `defaultModel` 家族，或按 `deep→opus / fast→sonnet / cheap→haiku` 映射。
2. 仅 `vision` 无 `omcSubagentType` → 取 `systemPrompt` 手动注入通用 agent。
3. 降级路径没有烤入的红线和回执模板——**红线区块和回执格式须 leader 手动贴进派工单**（从任一生成的 tvs-*.md 里抄）。

**续用 vs 新建（一句话判据）**：这一步是不是同一条需求的延续？是 → `SendMessage` 续派原队员；不是 → 新 spawn。细则见 `leader-protocol.md` 第四节。

**Agent 工具权限双轨（机制）**：
- 实现类 4 角色（executor / designer / test-engineer / code-simplifier）**保留 Agent 工具**——唯一被允许的用法是派**只读侦察**（explore / 文档检索），一层为限；派会改码的子代理、启动编排类 skill 都是红线。
- 其余 15 个共享角色的工具白名单**不含 Agent 工具**——机制焊死，想违规也调不出来。

**派工单要写全项目上下文**：dev 场景注入 `path / 分支 / 当前需求 / 背景 / 范围`；只读/分析类角色可跨项目共享。**项目增强（codegraph / 记忆）无需注入**——队员自动加载项目 `CLAUDE.md` 就拿到了（见 `leader-protocol.md` 第九节）；leader 只需确认项目装没装（没装则降级 grep/read），不往 prompt 里塞。

## 19 角色一览

**实现类**（可改码；服务项目时即"dev"）
- `executor` 实现者 —— 把确认方案落成最小、最清晰的改动
- `designer` 前端设计 —— 组件/交互/状态机/边缘情况
- `test-engineer` TDD 工程师 —— 红绿重构，先写失败用例
- `code-simplifier` 代码简化 —— 不改行为前提下化繁为简

**分析/规划类**（只读，给判断不动手）
- `architect` 架构师 —— 边界、依赖方向、复杂度治理
- `planner` 战略规划 —— 大目标拆成可交付阶段；重任务拆解时产出子任务图（每条含 范围=互斥文件簇 / 依赖 / 验收标准，见 `leader-protocol.md` 第十一节）
- `analyst` 前期分析 —— 动手前理清需求/约束/未知
- `critic` 毒舌审查 —— 主动找方案最致命的几个问题
- `explore` 代码勘察 —— 定位文件/符号/调用链
- `tracer` 追踪 —— 从现象反推根因，画因果链
- `scientist` 数据科学 —— 数据分析/统计/实验设计

**质量/安全类**（只读，给问题不动手）
- `code-reviewer` 代码审查 —— diff 的可读性/影响/契约/回归
- `security-reviewer` 安全审查 —— 权限/注入/泄露/越权/依赖
- `qa-tester` 测试 —— 设计正向/异常/边界场景，可写测试脚本
- `debugger` 调试 —— 定位编译/运行时/CI 错误并提修复

**支持类**
- `writer` 撰写 —— 文档/注释/changelog/提交信息/文案
- `document-specialist` 文档研究 —— 通读仓库内文档整理可信结论
- `vision` 视觉理解 —— 解读截图/设计稿/图表
- `git-master` Git 操作 —— 分支/合并/rebase/worktree

## 通用硬边界（盖在所有角色之上）

- **dev/实现类能 commit 到功能分支**（验收过即自动放行）；**功能分支 push 仅在 leader 闸口指令下执行**；**合并干线 / 向干线 push，任何角色都不行——必须 boss 拍板、leader 才放行**。
- 分析/质量/安全类**只读不改**，给判断和问题清单，不动代码。
- `git-master` 做不可逆操作（history rewrite / 强推 / 删分支）前必须先确认。
- 角色的最终输出=回执（格式烤在角色定义里），由 Agent 工具管道送回 leader；干完即散，不自作主张往下走。
- "只读不改"与"无权派人"对 15 个共享角色是**工具白名单机制保证**；实现类的编排禁令靠红线提示词约束，爆炸半径由"无 push 权限 + 只能在指定功能分支 commit"兜底。
