# 产物 6：记忆宪法（极小常驻规则，v6）

只写**必须每轮在场**的极小内容，详细说明在 `记忆索引.md`（按需加载）。按宿主落到常驻指令面：Cursor 写 `.cursor/rules/04-memory-constitution.mdc`（`alwaysApply: true`）；Claude 追加到 `CLAUDE.md`；Codex 追加到项目 `AGENTS.md`。Claude / Codex 用清晰分隔标记追加，不覆盖既有内容。

> 生成时按部署探测结果替换两处占位：`<个人偏好条款>`（见下方两个变体）、`<codegraph 状态>`（产物 5 结果）。

宪法正文（Cursor 版含 frontmatter；Claude / Codex 去掉 frontmatter，作为「记忆系统宪法」段追加）：

````markdown
---
description: 记忆系统宪法 —— 写入边界 + 查询流水线 + 分工路由 + codegraph 自愈。
alwaysApply: true
---

# 记忆系统宪法（始终生效）

## 1. 写入边界
主 Agent **禁止**直接增删改 `.memory/**`，只有 `project-memory-maintainer` 子 Agent 能写；hook 提示时由主 Agent 委派它。两个例外：① 用户明确说"你直接改"且仅 ≤1 行 typo（改完声明已绕过维护员）；② `.memory/个人偏好.md`（如存在）由主 Agent 直接读写。

## 2. 查询流水线（写代码 / 做架构决策的第一步）
```text
用户用业务词提需求 → 查 .memory/业务导航.md 拿正确术语和代码入口
                  → codegraph 从入口展开结构
                  → 动手前过一遍 .memory/红线与约定.md 该模块一节
```
别跳过导航直接 grep 业务词——术语错配是最贵的错误。

读到带分数的条目按分行事：1 分且阻断型（数据源方向/状态流转/资金库存增减）→ 先问再写；
1 分数值类 → 照写 + 插 `// TODO(业务待确认)`；带 `[冲突待仲裁]` → 先向用户求证。
推断撞上 `墓碑.md` 记录 → 沿用纠正结论，禁止重新推断。

## 3. 分工路由（一句话）
- 业务叫法 / 入口 / 为什么 / 红线 / 在哪个分支 → 查 `.memory`（从 `记忆索引.md` 进）。
- 代码结构 / 定义 / 调用 / 影响 / 签名 → 有 codegraph 用 `codegraph_*`；没有就 grep / read。
- 不要互相侵入：可推导的结构信息不写进 `.memory`，业务语义别指望 codegraph。

## 4. codegraph 缺失则自愈安装
需要结构查询但 `codegraph_*` 不可用时：① 告知用户正在安装；② `npx @colbymchenry/codegraph` + `codegraph init -i`；③ 装失败降级 grep/read 并告知，不阻塞工作。

## 5. 个人偏好分流
<个人偏好条款>

## codegraph 当前状态
<codegraph 状态>
````

## `<个人偏好条款>` 两个变体（按宿主探测结果选一）

**宿主有原生个人记忆（Claude Code）**：

```text
个人偏好、用户纠正过的做法 → 记入宿主原生个人记忆（跟人走）。
团队业务知识（导航/决策/红线）→ 由维护员写入 .memory（跟仓库走）。
两边冲突时，以入库的 .memory 为准。
```

**宿主无原生个人记忆（Cursor / Codex / 其他）**：

```text
个人偏好、用户纠正过的做法 → 主 Agent 直接写入 .memory/个人偏好.md（gitignored 单机文件）。
团队业务知识（导航/决策/红线）→ 由维护员写入 .memory 入库文件。
个人偏好绝不写入入库文件；两边冲突时，以入库的 .memory 为准。
```

> **Codex 专属补充**（写进 Codex 的宪法段）：Codex 子 Agent 不会自动 spawn，记忆维护由 hook 提示后**显式唤起** `project-memory-maintainer`，不要等它自动后台跑。

## `<codegraph 状态>` 由产物 5 填

- `ready` / `init_done` → ✅ codegraph 已就绪，按分工路由正常使用。
- `install_failed` / `init_failed` / `no_node` → ⚠️ 本项目 codegraph 暂不可用，结构查询回退 grep/read；可手动 `npx @colbymchenry/codegraph` 后删除 `.memory/.codegraph-status.json` 重新启用。`.memory/` 不受影响。

## 若宿主已有同名常驻规则 / CLAUDE.md / AGENTS.md

"先读后合并"：识别是否已有「记忆系统宪法」段——有就只更新"codegraph 当前状态"块（动态信息），没有就在末尾追加整段。绝不整文件覆盖。
