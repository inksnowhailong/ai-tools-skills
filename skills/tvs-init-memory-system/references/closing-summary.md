## 收尾

产物全部就位后，向用户输出一段简短摘要（路径按宿主工具替换）：

```text
项目记忆维护体系部署完成（v4：团队级 + 与 codegraph 分工）：
- 宿主工具: <cursor | claude-code | codex>
- 选定 preset: <name>
- 维护子 Agent（已按工具推荐模型: Cursor=inherit / Claude=sonnet / Codex=gpt-5.4-mini）
- 会话结束 hook 脚本 + 注册（按工具格式）
- .memory/记忆索引.md（含放置决策图 / 复用入口索引 / 完整路由表）+ 项目总览 / 术语表 / 跨分支在研功能地图 / 待确认问题
- 记忆宪法（极小常驻规则: 写入边界 + 决策前先查索引 + 分工路由 + codegraph 自愈）
- .memory 正文已入库；仅 .hook-state.json / .codegraph-status.json 被 gitignore
- codegraph 当前状态: <CODEGRAPH_STATUS>

分工说明：
- .memory 专注业务领域：术语、模块语义、跨模块协作契约、设计决策、红线、已知风险、放哪/复用
- codegraph 专注代码结构：符号位置、调用链、影响半径（缺失时按宪法第4条自愈安装，装不上则降级 grep/read）
- 子 Agent 维护主体不调用 codegraph；仅自检路径/符号时用 codegraph_search（装不上回退 git cat-file/Glob），保证调用少 + 不可用时仍完整运行
- 团队级（v4）：hook 分支感知触发 + 时间衰减 + 跨成员去重（零 AI）；维护元数据入库共享（跨分支地图的机读锚点 + 人读表格）；记忆防膨胀（H 写入黑名单事前拦 + G 增量去冗余事后删 + 体积信号）

codegraph 当前状态: <CODEGRAPH_STATUS>
  ready / init_done    → 已就绪，AI 按宪法分工路由
  install_failed       → 安装器失败（错误: <error>），宪法已写降级提示
  init_failed          → codegraph init -i 失败（错误: <error>），宪法已写降级提示
  no_node              → 缺少 Node 工具链，宪法已写降级提示

触发节奏（v4：分支感知 + 时间衰减，全程代码判断零 AI）：
- 基础阈值：变更文件数 ≥ 5、行数 ≥ 200、触及核心配置 / 架构敏感区、或当前分支领先集成线 ≥ 10 commit
- 时间衰减门槛：距上次维护 <2天 阈值×1.5、2-7天 ×1.0、>7天 ×0.5、>14天 有相关变更即触发
- 跨成员去重：当前分支 HEAD 已被入库锚点记为已维护则跳过（团队 pull 即共享上次维护点）
- 同一冷却期内（默认 30 分钟）只提示一次；工作区指纹未变则跳过
- 调阈值/衰减/集成线候选改 memory-precheck.mjs 顶部 CONFIG

日常运维命令（路径按宿主替换）：
- node .cursor/hooks/memory-precheck.mjs --mark-done   维护完成 / 判 no-op 后刷新基线
- node .cursor/hooks/memory-precheck.mjs --force       绕过冷却与去重，强制提示一次
- node .cursor/hooks/memory-precheck.mjs --status      打印 CONFIG + 状态 + v4（当前分支 / 领先提交数 / 上次维护时间 / 衰减因子 / 记忆体积）
- node .cursor/hooks/memory-precheck.mjs --reset       清空 hook 状态
- node .cursor/hooks/memory-precheck.mjs --lint-memory 扫描 .memory 旧路径 + v4 changelog 式噪音

接下来：
- 下一次较大代码变更结束时，hook 自动检测并提示（Codex 需显式唤起子 Agent）。
- 子 Agent 首次跑会按项目代码生成业务模块目录，按必填字段（模块职责 / 术语 / 跨模块协作契约 / 设计决策 / 红线）。
- .memory 正文已随仓库入库，团队拉取即获得同一份项目记忆。
```

根据情况追加：

- 项目没有架构规则（除本次宪法外）：

```text
- 检测到本项目尚未生成架构规则，建议先生成架构规则。
```

- `CODEGRAPH_STATUS` 为 `install_failed` / `init_failed` / `no_node`：

```text
- codegraph 当前不可用，宪法已写降级提示。修复后删除 .memory/.codegraph-status.json，并手动 npx @colbymchenry/codegraph + codegraph init -i 重新启用。
- 团队成员拉取后若没装 codegraph：AI 首次需要结构查询时会按宪法第4条自动提示安装；装不上则自动降级 grep/read，不阻塞。
```

不要输出代码 diff、不要输出 changelog 风格的"本次修改"——这次部署是一次性安装，不是日常变更。
