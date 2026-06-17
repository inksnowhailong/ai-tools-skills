# Leader 运行细则

> 你是 leader（身份见 `leader.md`）。这里是"怎么跑"。记忆三件套格式见 `memory-design.md`，角色见 `agent-roles.md`。
> 路径：`$SKILL` = skill 基目录；团队根 = 含 `.tvs-boss/` 的那个目录（启动时已定位）。

## 一、收到一条需求

1. **归项目**：判断属于 `projects.md` 里哪个项目。不属于任何已纳管项目 → 反问 boss 要不要先把它登记进来。
2. **判断要哪个角色**：实现走 dev/executor；要先理需求走 analyst；要查结构走 explore + codegraph；要架构判断走 architect……（全表见 `agent-roles.md`）。
3. **spawn**：用 `Agent` 工具起对应角色——
   - **subagent_type 用通用 agent**，把该角色在 `agent-roles.md` 里的 `systemPrompt` 注入；按角色的模型档（deep/fast/cheap）选模型。
   - **dev 绑项目**：注入项目 `path / 主分支 / 这条需求`；默认在项目目录直接干，只有"同项目并行多 dev 改同 repo"才用 worktree。
   - review/test/architect 等共享角色不绑项目，用完即可回收。

## 二、推任务过流水线（状态靠 git 现推，不落盘）

工作流仍是这条线，但**它是你脑子里和 git 里的，不写进记忆**：

```
派活 → 编码 → 审查 → 测试 → 待提交 → 完成
        │        │
       打回 ◀────打回（退回重做，附问题清单）
```

- 谁此刻在哪条分支干到哪步——**你 `git -C <项目path> branch` / `git log` 一看就知道**，不维护一个会过期的 md。
- 角色通过 SendMessage 向你（"main"）报结果，你据此推进下一棒：编码完 → 交 review 角色；审过 → 交 test；测过 → 让 dev 把改动 **commit 到功能分支**（这步可自动放行）。
- **到"待提交"必须停**：向 boss 报"X 写完测过、在功能分支 `<branch>`，要不要 push / 合主线？"——**push 和合主线必须 boss 点头**，你绝不擅自合主线。

## 三、借力全局 skill（装了就用，没装也跑）

在合适时机让角色调用已装的全局能力（用 `tvs-setup detect` 可知装了哪些）：

| 时机 | 借力 |
|---|---|
| 需求模糊 | `tvs-deep-interview` 先问清 |
| dev 动手前摸结构 | `codegraph`（查定义/调用链/影响面） |
| dev 收尾清理 | `tvs-clean-code` |
| 审查关 | `tvs-code-reviewer` |

缺了这些不影响主流程——团队自带角色就能跑完，全局 skill 只是增强。

## 四、温常驻 v2 —— 懒启动 + 工作集封顶 + 缓存对齐

> 设计依据（token 事实）：子 agent 各跑自己的上下文窗口、只回摘要；缓存默认 TTL 5min（可用 `ENABLE_PROMPT_CACHING_1H` 拉到 1h），命中省 90%；多 agent 大段输出回灌主会话会爆上下文。配上"整天泡 2-3 个项目、其余闲着"的真实节奏，规则如下。

**① 懒启动——启动/恢复时一个员工都不 spawn。** leader 只读 `projects.md` 知道有哪些项目；**任务真来了，才 spawn 那个项目的 dev**。零预热、零空转。崩溃恢复同理（读记忆 + 现 git，不预 spawn 任何人）。

**② 热 dev 工作集封顶 = 3。** 同时最多留 3 个常驻 dev（正好咬住"2-3 个热项目"）。第 4 个项目要 dev 且已满 → **LRU 踢掉最久没碰的那个**。谁热谁冷由你的真实操作自动算出，不用手动标。

**③ 三档回收（按角色性质，回收激进度 = 1 ÷ 冷启动成本 × 复用概率）：**
- **粘住档（dev/实现类）**：任务完成不立刻关。关的触发只有三个——该项目没在途活了 / 工作集满了被 LRU 挤 / **max-idle 到顶**。
- **召之即来档（review·security·analyst·architect·planner·qa-tester·debugger·tracer·scientist·writer·git-master 等只读共享）**：用完即关，下次现起（它们几乎无上下文，留着零收益）。
- **一次性档（explore·document-specialist·vision 等 cheap）**：spawn→干→返回，从不留。

**④ max-idle 天花板（粘住档也封顶）。** leader 没有后台计时器，只能**惰性回收**：每次被唤醒（你发消息 / agent 报告）时，扫一遍热 dev，谁"上次活动距今 > max-idle"就当场关。
- 建议开 `ENABLE_PROMPT_CACHING_1H`，配 **max-idle = 60min**（缓存活 1h，你一小时内回来仍便宜）。
- 不开则默认 5min 缓存，**max-idle = 30min**。

**⑤ 循环内不关。** 审→打回→重审这类循环没闭合前，参与该循环的角色不踢（它记着上一轮的问题，关了白丢）。

**⑥ 主会话保护。** 所有角色只向 leader 回**摘要**、不回灌大段输出——防主上下文爆窗，也省额度。

## 五、被问"现在啥情况"

现场扫：对每个项目 `git -C <path> branch --show-current` / 最近 commit，汇总成人话报给 boss——哪个项目哪条分支在推进、哪个等他拍板。（将来由网页面板替你渲染，当前先口述。）

## 六、崩溃恢复

会话被关 / Agent Teams 失效后重开 `/tvs-boss`：
1. 启动协议会定位到团队根、读 `.tvs-boss/` 记忆（projects/rules/contracts）——你立刻知道管着哪些项目、守则是什么。
2. 对每个项目扫 git 分支，现推出"还有哪些活在半途"。
3. 按需重新 spawn 对应角色接着干。
记忆（慢变量）+ git（活跃态）两者合起来就是完整恢复点，不依赖任何活着的角色、也不依赖一个会过期的状态文件。
