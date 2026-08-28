# mind-seed 子流程：单 Agent 记忆初始化

（tvs-team-spawn 的内置子流程，经 `/tvs-team-spawn mind-seed <agent>` 或用户说"给 X 建记忆/初始化记忆"进入。定位：主要服务 Cursor 团队场景；Claude Code 下的独立 chat 记忆建议优先用其原生记忆能力。）

为一个 chat 装上可跨 chat 崩溃恢复的私有记忆。完成后该 chat 即使被关掉再开，下一次启动也能读回画像、人设、活跃边界。

`<agent>` 是该 chat 对应的身份标识。常见值：

- `leader`（tvs-team-spawn 默认的 leader 名）
- `sub-architect` / `sub-executor` / `sub-critic` 等（tvs-team-spawn 生成的 sub 名）
- 任意自定义名字（不在 team 里也可以用，作为 standalone 记忆）

## 这次初始化的边界

你被显式调用来**一次性建立**当前 chat 的私有记忆。完成后立刻退出，不主动维护记忆，也不替 agent 干活，也不进入 tvs-team-spawn 的团队部署流程。

会做的事：

- 检查 `.cursor/.team/memory/<agent>/` 是否已存在（claude target 下为 `.claude/.team/...`）
- 通过 4-6 轮对话收集这个 agent 的角色定位、关注点、沟通风格、边界
- 把对话结果拼成 JSON 写入 identity（身份画像，合并了旧 profile+personality）+ memory-active（硬约束）
- 创建 memory-raw.md 骨架（index/sources/consolidated 懒创建，不预先铺空文件）

不会做的事：

- 不会写业务代码
- 不会动用户的源码
- 不会替用户给 leader 派任务
- 不会修改其他 agent 的记忆

## 运行时命令

```text
node "<skill-path>/scripts/memory.mjs" <command> <workspace> <agent> [--flag value]
```

`<skill-path>` 是 **tvs-team-spawn** 的 skill 根目录（memory.mjs 与 team.mjs 同在其 `scripts/` 下），用你所在 IDE 提供的 skill 路径动态解析，不要硬编码。

**目标 IDE（target）**：记忆必须落在和团队一致的目录（cursor→`.cursor/.team`、claude→`.claude/.team`），否则团队 skill 读不到。runtime 会自动探测已部署的 `.team/` 目录——**团队场景无需传 target**。仅当为「无团队的独立 chat」首次建记忆、且你运行在 Claude Code 时，给命令加 `--target claude`（否则默认 cursor）。下文 `.cursor/.team/...` 路径在 claude target 下都对应 `.claude/.team/...`。

## 执行流程

### 阶段 0 — 解析 agent 与先验

#### 0.1 没传 agent 名

如果进入本子流程时没带 agent 名，先列出当前项目已经存在的 agents（如果有），让用户选或新建：

```bash
node "<skill-path>/scripts/memory.mjs" list-agents "<workspace>"
```

输出会包含已建过 identity/active（或旧 profile/personality）的 agent 名。

如果项目根本没团队配置，提示用户：「你可以现在就给这个 chat 起一个 agent 名（例如 leader / planner / researcher / 个人助理），后面就用这个名字。」

#### 0.2 拿到 agent 名后查先验

```bash
node "<skill-path>/scripts/memory.mjs" role-hints "<workspace>" "<agent>"
```

返回情况：

- `inTeam: true, kind: "leader"` → 这是 tvs-team-spawn 团队的 leader，提示用户该走偏编排向的画像（关注点是"派活而不是干活"、"边界是不替 sub 决策"）
- `inTeam: true, kind: "sub"` → 这是 sub，从返回的 `role` / `roleDisplayName` / 角色专属提示带入访谈先验
- `inTeam: false` → 这是 standalone 记忆，所有问题完全开放

#### 0.3 检查记忆是否已存在

```bash
node "<skill-path>/scripts/memory.mjs" check "<workspace>" "<agent>"
```

输出会列出 7 个文件分别是否存在：

- 全空 → 进入正常引导流程。
- 部分存在 → 问用户：「<agent> 已经有部分记忆。要全部重建（旧的会被覆盖），还是只补缺失的，还是直接退出？」
- 全齐 → 问用户：「<agent> 已经有完整记忆。要更新某一项，还是退出？」

不要无声覆盖用户已有的记忆。

### 阶段 1 — 访谈

用 4-6 轮自然对话或结构化提问收集下面 6 项内容。**每轮只问 1-2 个问题**。优先使用环境提供的结构化提问能力（Cursor 的 `AskQuestion`、Claude Code 的 AskUserQuestion 等），没有时退化为文本提问。

#### 必收集项

1. **角色定位（positioning）**
    - 1 句话："在你的工作流里，<agent> 主要是干什么的？"
    - 如果是 team 里的 sub，从 role 先验出发反问："team 里它是 ${roleDisplayName}，你这次想让它聚焦哪一面？"
2. **关注什么（focus）**
    - "<agent> 在工作时应该重点看哪些方面？"（3-5 条）
3. **不关注什么 / 不该越权（outOfScope）**
    - "<agent> 应该避免做什么、避免操心什么？"（2-4 条）
4. **沟通风格（communicationStyle）**
    - 给几个选项：`简洁直接` / `详细解释` / `技术导向` / `平易近人` / `毒舌不留情` / `自定义`
    - 自定义可继续问"是什么样的风格"
5. **边界（boundaries）**
    - "有哪些线 <agent> 绝对不能跨？"（例：不擅自部署、不写没批准的接口、不替用户拍板）

#### 可选项（用户主动提及才记，不强问）

6. **codename / 简短人设**
    - "想给它一个昵称或人设吗？比如名字、口头禅、小癖好？"
    - 用户说不需要就跳过；不要硬塞 AI 风的"小可爱"。

#### 提问范式（参考）

```text
我先列三个我想确认的事，你回我答案就行：

1. 在你的工作流里，<agent> 主要是干什么的？（一句话即可）
2. 它工作时重点要看哪些方面？（列 3-5 条）
3. 哪些事它应该避免做？（列 2-4 条）

完了我再问沟通风格和边界。
```

不要把六项一次性问完，分 2-3 轮收集，期间允许用户补充。

### 阶段 2 — 总结确认

把收集到的内容用 1-2 句话回放给用户，让他确认或调整：

```text
我整理了一下，看看对不对：

<agent> 在团队里负责 X，重点关注 [A, B, C]，
避免 [D, E]，沟通风格是 Y，边界是 [F, G]。

要按这个建？还是想调一下？
```

**用户确认后再写入**。不要确认前先调 write-* 命令。

### 阶段 3 — 写入

依次执行四步。每步打印命令、等结果、确认成功再继续。

#### 3.1 建立骨架（含 md 文件）

```bash
node "<skill-path>/scripts/memory.mjs" ensure-root "<workspace>" "<agent>"
```

会建立 memory-raw.md 骨架（已有则跳过）。index / sources / consolidated 改为懒创建，不在此预建空文件。

#### 3.2 写 identity.json（合并了旧 profile + personality）

把访谈结果拼成一个 JSON（身份画像，启动时只读它 + memory-active 两个文件即可恢复）：

```json
{
    "codename": "可选昵称或 null",
    "role": "<roleId 或 null>",
    "roleDisplayName": "<roleDisplayName 或 null>",
    "positioning": "<一句话角色定位>",
    "focus": ["<3-5 条关注点>"],
    "outOfScope": ["<2-4 条不该做>"],
    "communicationStyle": "<concise|detailed|technical|warm|sharp|custom>",
    "communicationStyleNote": "<custom 时用户原话，否则可省略>",
    "tone": "<沟通基调的自然语言描述>",
    "traits": ["<2-4 个性格特征，用户提到才写；否则空数组>"],
    "catchphrase": "<口头禅或 null>",
    "quirks": "<小癖好或 null>",
    "boundaries": ["<明确的硬边界>"],
    "roleSeed": "<sub 时填 role.systemPrompt，否则 null>",
    "notes": "<其他用户主动说的画像信息，否则空字符串>"
}
```

**推荐 file 模式**（先用 Write 工具把 JSON 写到临时文件，避免 PowerShell / 各种 shell 引号坑）：

```bash
node "<skill-path>/scripts/memory.mjs" write-identity "<workspace>" "<agent>" --identity-file <tmpPath>
```

退化方案（JSON 简单无嵌套引号时）：`--identity '<上面的 JSON 字符串>'`。两种输入都 BOM-tolerant 解析，不用担心 PowerShell 默认带 BOM。

#### 3.3 写 memory-active.json

把"必须立刻生效"的硬约束写进去：

```json
{
    "role": "<roleId 或 null>",
    "hardConstraints": [
        "<从 profile.outOfScope 和 profile.boundaries 提炼的硬约束>"
    ],
    "ongoingTasks": [],
    "recentDecisions": [],
    "memoryHints": [
        "<sub 时填 role.memoryHints；leader/standalone 时为空或填用户特别指定的>"
    ],
    "lastSeenBlackboardHashes": {}
}
```

调用（推荐 file 模式）：

```bash
node "<skill-path>/scripts/memory.mjs" write-active "<workspace>" "<agent>" --active-file <tmpPath>
```

### 阶段 4 — 反馈

打印一段简短的总结：

```text
<agent> 的私有记忆已经就位：

- identity.json        身份画像：定位/关注/边界/人设/风格（首次进入 / 崩溃恢复时读）
- memory-active.json   当前硬约束 + lastSeenBlackboardHashes（每轮唤醒都读，很小）
- memory-raw.md        候选记忆池（agent 工作中按需追加）
- （index / sources / consolidated 懒创建，当前无自动整理流程，先不建）

下次这个 chat 启动时（或者它崩溃后再开），
对应的 skill 会自动检测到这些文件，把硬约束注入工作上下文。

如果工作中你希望它记住某事，跟它说"记住 ..."，
它会追加到 memory-raw.md，由后续整理流程晋升到 active / index / consolidated。
```

退出，不主动启动下一步动作。

## 三件套设计要点（写给你，不给用户讲）

**三件套设计**：静态的 profile + personality 合并成 identity，默认只留三件套；index/sources/consolidated 改懒创建（当前无自动整理流程，不预先铺空文件）：

| 文件 | 角色 | 谁写 | 何时读 |
|---|---|---|---|
| identity.json | 静态身份画像：定位、关注、边界、人设、沟通风格（合并了旧 profile+personality） | mind-seed 子流程一次性写，偶尔更新 | **仅首次进入 / 崩溃恢复读一次** |
| memory-active.json | 当前活跃约束 + ongoingTasks + lastSeenBlackboardHashes | agent 工作中按需更新 | **每轮唤醒都读（很小）** |
| memory-raw.md | 候选记忆池，待整理 | agent 工作中追加 | 整理时输入 |
| （懒创建）index / sources / consolidated | 长期索引 / 证据 / 摘要 | 未来的整理流程 | 有了再说 |

关键省 token 原则：**identity 静态、只读一次；每轮唤醒只摄入小小的 memory-active + 黑板的变更门控索引**，绝不每轮重摄入全量画像和黑板全文。兼容旧七件套部署（identity 不存在时回退 profile + personality）。

## 不要做的事

- **不要把访谈记录全部写进 memory**。只把已确认的、稳定的信息写入 identity / active。访谈过程本身丢弃。
- **不要给 agent 编故事**。用户没说的不要替他补"喜欢咖啡"、"摩羯座"这种乱七八糟的设定。
- **不要碰其他 agent 的 memory 目录**。这次调用只服务一个 agent。
- **不要在 hardConstraints 里写软约束**。"建议"、"尽量"、"通常"都不是硬约束。硬约束 = 越线即错。
- **不要复制 role.systemPrompt 到 profile.notes**。role.systemPrompt 已经在生成 sub skill 时注入到 SKILL.md，重复存储只会让 agent 启动时读两遍。

## standalone 模式细节

如果 `role-hints` 返回 `inTeam: false`，意味着用户在为一个不在 team 里的 chat 建记忆。这种情况下：

- profile.role / profile.roleDisplayName 都设为 null
- personality.roleSeed 设为 null
- memory-active.memoryHints 为空数组，除非用户特别指定

standalone 的记忆同样有效，可被任意 chat 通过约定路径 `.cursor/.team/memory/<agent>/` 读到。
