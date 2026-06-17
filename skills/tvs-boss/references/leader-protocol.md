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

## 四、温常驻 —— 别让角色空烧

- leader 自己常驻整个会话。
- 一个角色手上没在途活了 → SendMessage 发 shutdown 让它退出；来新活再 spawn。
- 判断空闲：看它名下还有没有没跑完的事（从你的会话上下文 + git 状态判断），没有就关。

## 五、被问"现在啥情况"

现场扫：对每个项目 `git -C <path> branch --show-current` / 最近 commit，汇总成人话报给 boss——哪个项目哪条分支在推进、哪个等他拍板。（将来由网页面板替你渲染，当前先口述。）

## 六、崩溃恢复

会话被关 / Agent Teams 失效后重开 `/tvs-boss`：
1. 启动协议会定位到团队根、读 `.tvs-boss/` 记忆（projects/rules/contracts）——你立刻知道管着哪些项目、守则是什么。
2. 对每个项目扫 git 分支，现推出"还有哪些活在半途"。
3. 按需重新 spawn 对应角色接着干。
记忆（慢变量）+ git（活跃态）两者合起来就是完整恢复点，不依赖任何活着的角色、也不依赖一个会过期的状态文件。
