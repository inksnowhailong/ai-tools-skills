# Agent 角色目录

团队自带 **19 个角色**，复刻自 `tvs-team-spawn`、**零外部依赖**（不靠 omc）。完整定义（`systemPrompt` / 建议工具 / 模型档 / 记忆提示）在 **`scripts/team-roles.json`**，本文件是给 leader 看的索引 + spawn 规矩。

## leader 怎么 spawn 一个角色

1. 从 `scripts/team-roles.json` 取该角色的 `systemPrompt`。
2. 用 `Agent` 工具起一个 **subagent_type 为通用 agent** 的成员，把 `systemPrompt` 注入；
3. **按角色的模型档选模型**（`team-roles.json` 的 `modelsByTarget.claude`）：
   - `deep` = `claude-opus-4-8`（架构/审查/分析这类重推理角色）
   - `fast` = `claude-sonnet-4-6`（常规实现）
   - `cheap` = `claude-haiku-4-5-20251001`（只读探索：explore / document-specialist / vision）
   - 角色有显式 `tier` 用它，否则按 `defaultModel` 反推。
   - ⚠️ **`Agent` 工具的 `model` 参数填短枚举**（`opus`/`sonnet`/`haiku`），不是上面的全 ID：`deep→opus`、`fast→sonnet`、`cheap→haiku`。传全 ID（如 `claude-opus-4-8`）会被拒。
4. **dev 场景绑项目**：实现类角色服务某项目时，注入项目 `path / 主分支 / 需求`；只读/分析类角色可跨项目共享。

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
