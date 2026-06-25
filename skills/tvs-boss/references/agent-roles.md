# Agent 角色目录

团队自带 **19 个角色**，完整定义（`systemPrompt` / 建议工具 / 模型档 / 记忆提示）在 **`scripts/team-roles.json`**，本文件是给 leader 看的索引 + spawn 规矩。

## leader 怎么 spawn 一个角色

1. 查 `scripts/team-roles.json` 该角色是否有 `omcSubagentType` 字段。

   **⚠️ model 取值铁律（最常见的坑）**：`model` 参数**只能**是 Agent 工具认的别名之一——`opus` / `sonnet` / `haiku`（还有 `fable`，本系统不用）。
   - **绝不要**传全模型 ID（`claude-opus-4-8`、`claude-sonnet-4-6` 等），**也不要**传 tier 词（`deep`/`fast`/`cheap`）——这两类都不是合法值，会被工具**静默忽略**，导致队员继承 leader 的 Opus（"改 model 无效、全 Opus、又慢又烧 token"就是这么来的）。
   - 取值方法（任选其一，结果一致）：① 直接看角色 `defaultModel` 属于哪个家族——含 `opus`→传 `opus`、含 `sonnet`→传 `sonnet`、含 `haiku`→传 `haiku`；② 或按 tier 映射 `deep→opus`、`fast→sonnet`、`cheap→haiku`（等价于查 `modelsByTarget.claude[tier]`，该表已是别名）。
   - **必须显式传**——不传也会继承 leader 的 Opus。

   **有 `omcSubagentType`（18/19 角色）→ 优先路径：**
   `Agent({ subagent_type: "<omcSubagentType>", model: "opus|sonnet|haiku", prompt: "..." })`
   omc agent 自带 systemPrompt，无需手动注入；但 **model 必须按上面铁律显式传别名**。

   **无 `omcSubagentType`（仅 `vision`）→ 降级路径：**
   取 `systemPrompt` 手动注入通用 agent：
   `Agent({ model: "opus|sonnet|haiku", prompt: "<systemPrompt>\n\n<任务上下文>" })`

2. **无论哪条路径，dev 场景都要通过 prompt 补注项目上下文**：`path / 主分支 / 当前需求`；只读/分析类角色可跨项目共享。
3. **按需注入项目增强感知（见 `leader-protocol.md` 第九节）**：探测目标项目有没有 `.memory/` / `.codegraph/`，有就在 prompt 里告诉队员"结构问题优先用 `codegraph_*`、需要业务语义时按 `.memory/记忆索引.md` 查"——但**只在任务用得上时提，不强制每个任务都读记忆**。结构类/勘察/分析/实现角色尤其应优先用 codegraph 而非 grep。

## 19 角色一览

**实现类**（可改码；服务项目时即"dev"）
- `executor` 实现者 —— 把确认方案落成最小、最清晰的改动
- `designer` 前端设计 —— 组件/交互/状态机/边缘情况
- `test-engineer` TDD 工程师 —— 红绿重构，先写失败用例
- `code-simplifier` 代码简化 —— 不改行为前提下化繁为简

**分析/规划类**（只读，给判断不动手）
- `architect` 架构师 —— 边界、依赖方向、复杂度治理
- `planner` 战略规划 —— 大目标拆成可交付阶段
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

- **dev/实现类能 commit 到功能分支**（leader 可自动放行）；**push / 合并主线，任何角色都不行——必须 boss 拍板、leader 才放行**。
- 分析/质量/安全类**只读不改**，给判断和问题清单，不动代码。
- `git-master` 做不可逆操作（history rewrite / 强推 / 删分支）前必须先确认。
- 角色干完即向 leader（"main"）报结果，不自作主张往下走。
