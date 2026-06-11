## 产物 6：记忆宪法（极小常驻规则）

只写**必须每轮在场**的极小内容，详细路由表已在 `记忆索引.md`（按需加载）。按宿主落到常驻指令面：Cursor 写 `.cursor/rules/04-memory-constitution.mdc`（`alwaysApply: true`）；Claude 追加到 `CLAUDE.md`；Codex 追加到项目 `AGENTS.md`。Claude / Codex 用清晰分隔标记追加，不覆盖既有内容。

> v3 降固定税：旧版有 `04-边界` + `05-路由` 两条 alwaysApply（约 3.4K 字符），把详细路由表、反模式、子 Agent 边界全常驻。现在合并压成下面一条极小宪法（约 0.6K 字符），详细表下沉到按需加载的 `记忆索引.md`，固定税砍约 75%。

宪法正文（Cursor 版含 frontmatter；Claude / Codex 去掉 frontmatter，作为「记忆系统宪法」段追加）：

````markdown
---
description: 记忆系统宪法 —— 写入边界 + 决策前先查索引 + 分工路由 + codegraph 自愈。
alwaysApply: true
---

# 记忆系统宪法（始终生效）

## 1. 写入边界
主 Agent **禁止**直接增删改 `.memory/**`。只有 `project-memory-maintainer` 子 Agent 能写；hook 提示时由主 Agent 委派它。唯一例外：用户明确说"你直接改"且仅 ≤1 行 typo，改完要声明已绕过维护员。

## 2. 决策前先查记忆（写代码 / 做架构决策的第一步）
动手写新代码或做架构决策前，先读 `.memory/记忆索引.md`，据它判断：**放哪、复用什么、碰哪条红线**。索引会指给你该读的模块档案。别跳过这步直接写。

## 3. 分工路由（一句话；细表在记忆索引）
- 业务 / 语义 / 为什么 / 红线 / 放哪 / 复用 → 查 `.memory`（从 `记忆索引.md` 进）。
- 代码结构 / 定义 / 调用 / 影响 / 调用链 / 签名 → 有 codegraph 用 `codegraph_*`；没有就 grep / read。
- 不要互相侵入：纯结构别写进 `.memory`，业务语义别指望 codegraph。

## 4. codegraph 是必需组件（缺失则自愈安装）
codegraph 不仅供主 Agent 做结构查询，**v4 起也是维护子 Agent 自检路径/符号的依赖**。需要结构查询、或维护子 Agent 自检，但 `codegraph_*` 不可用（未注册 / 未安装 / 索引未建）时：
1. 先告知用户：「正在安装记忆系统必需组件 codegraph，请稍候」。
2. 运行 `npx @colbymchenry/codegraph`（自动识别并配置当前工具）+ `codegraph init -i` 建索引，提示重启使 MCP 生效。
3. 装失败（无 node / 无网络 / 受限机器）→ 降级到 grep / read，并明确告诉用户"codegraph 没装上，结构查询暂用原生搜索，可手动 `npx @colbymchenry/codegraph`"，**不阻塞当前工作**。

## codegraph 当前状态
<由产物 5 按 CODEGRAPH_STATUS 填：就绪 / 降级提示>
````

> **Codex 专属补充**（写进 Codex 的宪法段）：Codex 子 Agent 不会自动 spawn，记忆维护由 hook 提示后**显式唤起** `project-memory-maintainer`，不要等它自动后台跑。

### "codegraph 当前状态"块由产物 5 填

- `ready` / `init_done` → 填：✅ codegraph 已就绪，按分工路由正常使用。
- `install_failed` / `init_failed` / `no_node` → 填：⚠️ 本项目 codegraph 暂不可用，结构查询回退 grep/read；可手动 `npx @colbymchenry/codegraph` 后删除 `.memory/.codegraph-status.json` 重新启用。`.memory/` 不受影响。

### 若宿主已有同名常驻规则 / CLAUDE.md / AGENTS.md

"先读后合并"：识别是否已有「记忆系统宪法」段——有就只更新"codegraph 当前状态"块（动态信息），没有就在末尾追加整段。绝不整文件覆盖。
