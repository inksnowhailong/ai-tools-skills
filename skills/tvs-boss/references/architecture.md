# 整体形状 / 决策

## 拓扑

```
            boss（你，只下需求、拍板）
                  │
            leader（当前 chat，只调度不写码）
                  │  普通 Agent 工具 spawn（回执=返回值必达）
                  │  需求内续用、需求间即弃（无常驻池）
   ┌──────────────┼───────────────────────────┐
 实现类角色(绑项目)   分析/质量/安全/支持类(只读, 跨项目共享)
 executor/designer   architect/critic/code-reviewer/
 test-engineer/...   security-reviewer/debugger/...（共 19 角色）
                  │
        各项目（E 盘上独立目录 + 独立 git，天然隔离）
```

## 三类知识分工（互不重复）

```
团队记忆 .tvs-boss/   慢变量：projects.md / rules.md / contracts.md   —— leader 调度·恢复·建团
项目记忆（各项目内部） 业务·代码风格·领域知识                          —— 绑项目角色用
git（不落盘）         谁在哪条分支干什么（快变量，现推）              —— leader 看分支即知
```

## 关键决策

1. **单 leader**——避免多调度者状态打架（多 agent 翻车的头号原因是协调，不是智力）。
2. **就近存**——团队记忆落在执行 `/tvs-boss` 的目录（团队根），不去用户主目录；扫描范围与存储同源。
3. **记忆有界**——只存慢变量，历史/活跃态不进；越存越多即冗余。
4. **状态从 git 现推**——活跃态不持久化，避免频繁改写 md 和数据过期（同 tvs-task "分支即任务"）。
5. **角色自带、零外部依赖**——19 角色复刻在 `scripts/team-roles.json`，不依赖 omc，保证可分发；由 `make-agents.mjs` 生成为带机制约束的角色定义（model / 工具边界 / 红线 / 回执烤死在 `<团队根>/.claude/agents/tvs-*.md`）。
6. **完成语义**——commit 功能分支可自动；push/合主线必须 boss 确认。
7. **回执必达 + 一次性工人**——通信走普通 Agent 工具的返回值管道（杜绝"完成了没汇报"）；工人需求内 SendMessage 续用、需求间即弃，不维护常驻池（同类型工人共享固定前缀缓存，一次性不吃亏）。leader 是唯一长寿命对话，其持久性靠 `.tvs-boss/` + git + Task，变钝可无损重启。
8. **借力双轨**——纪律类 skill 队员可自主用；编排类（autopilot/ralph/ultrawork/team）只有 leader 有权启动且先报 boss。共享角色的工具白名单从机制上掐掉再派人的能力。
9. **软约束机制化**——凡是重要且能烤进角色定义/工具边界的约束（model、红线、回执、只读），一律机制化，不靠 leader 每次自觉。

## 各模块落点
- 启动/建团：`SKILL.md`
- leader 是谁：`leader.md`
- 怎么跑：`leader-protocol.md`
- 角色：`agent-roles.md` + `scripts/team-roles.json` + `scripts/make-agents.mjs`（生成机制约束的角色定义）
- 记忆：`memory-design.md`（落到 `.tvs-boss/` 三件套）
- 跨项目：`contract-protocol.md`
- 看板：`scripts/panel.mjs`（终端 ANSI TUI，键盘 1~5 切屏）
