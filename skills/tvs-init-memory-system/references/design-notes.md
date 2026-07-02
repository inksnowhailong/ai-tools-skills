### codegraph 专长（让它答这些，.memory 不重复记录）

| 问题类型 | codegraph 入口 |
|---|---|
| X 函数 / 类 / 方法在哪定义 | `codegraph_search` |
| X 调用了什么 / 被谁调用 | `codegraph_callers` / `codegraph_callees` |
| 改 X 会影响哪些代码 | `codegraph_impact` |
| 从 X 到 Y 的调用路径是什么 | `codegraph_trace` |
| 模块 X 的代码地图（barrel、文件结构） | `codegraph_context` / `codegraph_files` |
| 某个符号的源代码 / 签名 | `codegraph_node` / `codegraph_explore` |

### .memory 专长（让它答这些，codegraph 答不出）

| 问题类型 | .memory 入口 |
|---|---|
| 这个模块**业务上**负责什么 | 模块档案 - 模块职责 |
| 项目里的术语 / 别名 / 同义词 | 术语表.md |
| 哪些模块**不能**互相调用 / 跨模块协作契约 | 模块档案 - 跨模块协作契约 |
| 为什么这块代码这么设计 / 历史决策 | 模块档案 - 设计决策 |
| 哪些边界一旦破坏会出问题 / 红线 | 模块档案 - 红线 |
| 该模块当前已知的风险 / 坑 | 模块档案 - 已知风险 |
| 项目稳定的工程风格与约定 | 项目总览.md |
| 各个分支在迭代什么功能 / 某功能在哪个分支 | 跨分支在研功能地图.md |

### 不互相侵入原则

- **.memory 不再记录纯代码结构信息**：barrel 路径、数据源/适配器、调用链、**函数签名 / 参数 / 返回值 / 类型**这些"AST 看一眼就知道"的内容，让 codegraph 答；.memory 只在它有业务含义时才记录（如"这个 barrel 名字本身代表领域内核边界"）。
- **子 Agent 自检会用 codegraph（v4 调整，仅限路径/符号校验）**：维护 .memory 的主体逻辑仍用 Glob / rg / Read，但**维护后强制自检的"路径/符号是否存在"校验，优先用 `codegraph_search` 替代 git cat-file/Glob**（更准、且 sub-ms + 只回结构事实，比 grep/read 试错更省 token）。这是 v4 相对 v3 的有意调整——codegraph 因此升级为**维护子 Agent 自检的依赖**。**硬安全网**：codegraph 不可用（未装/装失败/语言不支持）时，自检**回退** git cat-file/Glob，维护能力下降但**绝不瘫痪**。除路径校验外，子 Agent 不主动用 codegraph 做契约/影响面/调用链（控制调用次数）。
- **记忆防膨胀是双向的（v4 新增 G + H）**：除"不再记录"的事前规则（H 写入准入黑名单），子 Agent 在**维护某模块时顺手删掉该模块档案里 codegraph 已能回答的存量结构冗余**（G 增量去冗余，零额外扫描）；hook 用代码统计 .memory 体积超标即提示精简（零 AI）。**不做定期全量 AI 去冗余扫描**——那会为省 token 反而狂耗 token。
- **codegraph 的指令文件我们不写、不改**：codegraph 官方安装器（`npx @colbymchenry/codegraph`）会自动给当前工具写好"怎么用 codegraph 工具"的指南（Cursor `.cursor/rules/codegraph.mdc` / Claude `CLAUDE.md` / Codex `~/.codex/AGENTS.md`）。本 Skill 只在"记忆宪法"里写一句分工路由（业务查 .memory、结构查 codegraph），不与之重叠。


---
