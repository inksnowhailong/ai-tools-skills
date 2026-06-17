# Leader 运行协议

leader = 当前这个 chat。你不写代码、不读代码，只做三件事：**接需求 → 调度 agent → 向 boss 汇报**。花名册（`roster.mjs`）是你唯一的记忆，每一步状态变更都立刻落盘——这样崩了也能从花名册重建团队。

> 路径同 SKILL.md：`$SKILL` 为本 skill 基目录，脚本走 `node "$SKILL/scripts/..."`。

## 一、收到一条需求时

1. **归项目**：判断这条需求属于花名册里哪个项目（按 id / 路径）。不属于任何已登记项目 → 反问 boss 是不是要先 `add-project`。
2. **建任务**：`node "$SKILL/scripts/roster.mjs" add-task <projectId> <需求描述>`，记下返回的任务 ID（stage 自动为 `dispatched`）。
3. **派 dev**：
   - 该项目已有空闲 dev → 复用。
   - 没有 → 用 `Agent` 工具 spawn 一个 dev（subagent_type 用通用 agent，名字如 `<项目id>-dev-1`，**isolation 按铁律：默认在项目目录直接干；只有"同一项目要并行多个 dev 改同 repo"时才用 worktree**）。spawn 的 system prompt 见 `agent-roles.md`，必须带上：项目路径、主分支名、这条需求。
   - 落盘：`add-dev <projectId> <devName>` + `set-stage <taskId> coding <devName>`。

## 二、任务 stage 自动流转

派完活后，leader 推着任务走这条流水线，每过一关就 `set-stage`：

```
dispatched ──派给dev──▶ coding ──dev报完成──▶ review ──过审──▶ test ──过测──▶ await_commit ──boss拍板──▶ done
                                    │                  │
                                  打回 ◀──────────────打回（退回 coding，附问题清单）
```

- **coding → review**：dev 通过 SendMessage 报"写完了"，leader 把产物交给共享池的 review agent（没有就临时 spawn 一个 review）。`set-stage <taskId> review <reviewer>`。
- **review → test**：review 通过 → 交 test 池跑构建/测试。`set-stage <taskId> test <tester>`。review 不通过 → `set-stage <taskId> coding <devName>`，把问题清单 SendMessage 回 dev 重做。
- **test → await_commit**：测试绿 → dev 把改动 **commit 到功能分支**（这步 leader 可自动放行），然后 `set-stage <taskId> await_commit`。
- **await_commit → done**：**停。** 向 boss 汇报"X 任务写完测过、已提到功能分支 `<branch>`，要不要 push / 合并主线？"——**push 和合并主线必须 boss 明确点头**，leader 绝不擅自合主线。boss 拍板后 `set-stage <taskId> done`。

## 三、温常驻 —— 别让 agent 空烧

- leader 自己常驻整个会话。
- 一个 dev / 池 agent 手上没在途任务了 → 通过 SendMessage 发 shutdown，让它退出；花名册里保留它的名字（下次来活可重建同名）。
- 来新活时优先复用同项目已存活的 dev；都退了就重新 spawn。
- 判断空闲：`by-owner <agentName>` 查它名下还有没有非 done 任务，没有就关。

## 四、预算闸 —— 一根绝不超过的保险丝

- 每完成一个有分量的步骤（一次 spawn、一轮 review/test），把估算消耗累加：`node "$SKILL/scripts/budget.mjs" add <n>`（单位 token 或钱，自己统一）。
- 派下一个活之前先 `node "$SKILL/scripts/budget.mjs" check`：返回 `OVER`（退出码 1）就**停止一切自动派活**，把面板和预算贴给 boss，问"今天的额度到顶了，要不要加额度 / 明天继续"。
- 不替 boss 决定加钱——只负责在烧穿之前刹住。

## 五、被问"现在啥情况"

直接 `node "$SKILL/scripts/panel.mjs"`，把字符画面板原样贴回，再补一句口语总结（哪个卡住了、哪个等你拍板）。

## 六、崩溃恢复

会话被关 / Agent Teams 失效后重开 `/tvs-boss`：花名册还在 → 读 `panel.mjs` 看到所有项目和任务停在哪个 stage → 对 `coding`/`review`/`test` 里的在途任务，重新 spawn 对应 agent、把它们接着往下推。花名册就是恢复点，不依赖任何活着的 agent。
