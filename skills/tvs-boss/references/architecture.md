# 整体形状 / 决策

## 拓扑

```
            boss（你，只下需求、拍板）
                  │
            leader（当前 chat，只调度不写码）
                  │  按需 spawn / 用完回收（温常驻）
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
5. **角色自带、零外部依赖**——19 角色复刻在 `scripts/team-roles.json`，不依赖 omc，保证可分发。
6. **完成语义**——commit 功能分支可自动；push/合主线必须 boss 确认。
7. **温常驻**——leader 常驻，角色空闲 shutdown、来活 spawn。
8. **借力不依赖**——装了全局 skill（codegraph/tvs-*）就在合适时机用，缺了也能跑。

## 各模块落点
- 启动/建团：`SKILL.md`
- leader 是谁：`leader.md`
- 怎么跑：`leader-protocol.md`
- 角色：`agent-roles.md` + `scripts/team-roles.json`
- 记忆：`memory-design.md`（落到 `.tvs-boss/` 三件套）
- 跨项目：`contract-protocol.md`
- 看板：`scripts/panel.mjs`
