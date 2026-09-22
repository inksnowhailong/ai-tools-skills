---
name: tvs-panel
description: 当用户说"开个面板 / 建个面板 / 可视化一下当前在做的事 / 我看不清全局了 / 开面板看进度 / 面板刷一下"，或某个 tvs skill 需要把数据同步到指挥台时使用。作用：为当前会话建一块随对话演进的可视化面板（形态由这场工作的形状当场决定），并持有 tvs-task / tvs-council / tvs-boss 三家共用的标准面板页与「范围→地址」地址簿。仅支持 Claude Code。
hosts: claude
---

# tvs-panel：面板

对话是一条时间线，只有先后没有并列；一件事做久了，几条并行的线、几个悬着的决策、一张关系网都会被往上顶到看不见。面板补的是这一维——**对话继续做事件流，面板呈现当前状态**。

两种模式，入口不同，不要混：

```
用户直接敲 skill      → 会话面板：形态当场判断，读 references/session-panel.md
tvs-task / council /   → 标准面板：三家各有固定页面形式，走本文下半部分
tvs-boss 调用
```

## 红线：HTML 不由主实例写（两种模式都适用）

**凡是要产出或修改 HTML 的那一步——建会话面板页、改 `page.html`——一律派 sonnet 子 agent。**
主实例不用 Write / Edit 碰任何 `.html`，只做两件事：接住用户的话（对话里说的、面板上评论的），
把它变成派工单发下去。

> **发布一份现成的 `page.html` 不在此列**，直接发就行。`Artifact` 工具收的是 `file_path`，
> 文件内容不经过你的上下文——标准面板首次建板就是这种，派个子 agent 反而白花一次 spawn。
> 分界是**这一步要不要写 HTML**：要写（会话面板的定制页、改 `page.html` 的内容）才派。

```
Agent({ subagent_type: "general-purpose", model: "sonnet", prompt: "<派工单>" })
```

⚠ **`model` 必须显式传 `"sonnet"` 这个别名。** 不传会静默继承主实例的 Opus（又慢又烧）；
传全模型 ID（`claude-sonnet-5`…）或档位词（`fast`）会被工具**静默忽略**，同样退回 Opus。
**本 skill 派出去的所有子 agent 一律 `"sonnet"`，没有第二个档位**——看到 `haiku` / `opus`
出现在本 skill 的任何派工单里，那是串位，不许拿。

焊死的理由是 token 账：页面本身 16k，逐块重发还要乘板数；主实例为一次改动只付
"写派工单 + 读回执"的几千 token，HTML 与数据 JSON **全程不进主实例上下文**。

## 模式一：会话面板（默认）

用户直接要面板时走这条。**形态不套模板**——先问"这场工作里他最需要一眼看到的是什么关系"，从答案反推该画成什么样；三段固定骨架（现在在做什么 / 等你定的 / 已经确定的）不可省。

形态由**主实例**判断（子 agent 看不到这场对话），HTML 由 **sonnet 子 agent** 落地——切法与派工单模板见 `references/session-panel.md` 第三步。

完整规则见 `references/session-panel.md`，**开工前整篇读一遍**。

## 模式二：标准面板（三家依赖）

页面与地址簿归本 skill，业务数据谁产谁管：

```
skills/tvs-task/scripts/panel-data.mjs      →  tasks    集合（在册任务）
skills/tvs-boss/scripts/panel-data.mjs      →  crew     集合（在途需求）
skills/tvs-council/scripts/panel-data.mjs   →  council  集合（议会）
                                    ↓
                              ArtifactData 写库
                                    ↓
                      page.html 订阅 db，实时渲染
```

三个数据出口互不认识，只共用 `~/.tvs-panel.json` 一个地址簿。新接一样东西 = 加一个出口 + 页面加一区，不动别人。

### 一个范围一块板，认址不认会话

范围由 cwd 决定：

```
在项目目录跑       -> 该项目的板。日后在同一个项目里再跑，直接开回这一块
在多 repo 父目录跑  -> 总板（tvs-boss 团队根就是这种）
```

三个项目就是三块板，各留各的。分板是**物理隔离**：各板各自一个 db，两个 Claude 实例各管一个项目时删不着对方、watch 不串、看不见彼此的噪音——不靠任何约定去协调。

```bash
node "{SKILL_DIR}/scripts/panel.mjs"                           # 按当前目录算范围 → {scope,label,url,pageStale}
node "{SKILL_DIR}/scripts/panel.mjs" --cwd <路径>               # 指定范围
node "{SKILL_DIR}/scripts/panel.mjs" --cwd <路径> --set <URL>   # 记录地址（同时记下当时的页面指纹）
node "{SKILL_DIR}/scripts/panel.mjs" --list                    # 列出全部面板，并标出哪些在跑旧版页面
```

**范围键只有这一处实现。** 三个数据脚本不自己算、也不读地址簿——它们收 `--scope <键>`。

> 这条是踩出来的：原先四个脚本各写一份，其中 tvs-council 和 tvs-boss 少做了仓库根规整，
> 在 `项目/子目录` 里跑会算出与 tvs-task 不同的键 → 找不到板 → 下一步给子目录另建一块孤儿板，
> 全程不报错。**靠纪律保证的一致性等于没有**，只能靠"只有一处实现"。

标准同步流程因此固定为两步：

```
① node panel.mjs --cwd <路径>          拿 scope 与 url
② node <某 skill>/panel-data.mjs --scope <上一步的 scope>
```

### 发布与更新页面

**首次**（某范围 `url` 为空）：发布 `{SKILL_DIR}/page.html`，带 `capabilities: {"db":{}}` 与 `icon: "checklist"`，拿到地址后 `--cwd <同一范围> --set <URL>` 记下。

> ⚠ **同一会话里想建第二块板，必须换文件路径。** Artifact 工具认路径：同一会话里用同一个 `file_path` 再发一次，永远落回同一块板，不会新建。所以为第二个范围建板时，先把 `page.html` 复制到暂存目录的一个带范围名的路径（`panel-<范围名>.html`）再从那儿发布。跨会话不受此限——那时只要不传 `url` 就是新建。

**范围已有 `url` 时不要重新发布**——那会另开一块板，旧板上的数据就成了孤儿。

> ⚠ **重发时 `<title>` 永远赢过 `title` 参数。** 各板共用同一份 HTML，所以标题也一样。想让某块板有自己的名字，只能改那份复制出去的 HTML 里的 `<title>`；`description` 参数倒是每块板可以各写各的。

**改过 page.html 之后**：页面是所有标准面板共用的同一份源码，但**每块板是独立的 artifact**——要**逐块带 `url` 重发**。库里的数据不受影响。

`--set` 会记下当时的页面指纹，`--list` 拿它和当前 `page.html` 比，**直接告诉你哪几块板还在跑旧版**：

```
⚠ 2 块板在跑旧版页面，需要带 url 重发：
   coding    https://claude.ai/artifact/...
   shirehub  https://claude.ai/artifact/...
```

同步前先看一眼这个——"记得逐块重发"从此是看得见的状态，不是靠记性。

### 写库

`ArtifactData` 的 `batch`，每个文档一条 `set`，`stale` 里每个 id 一条 `delete`。三条硬规则：

1. **已存在的文档必须带 `if_version`**（值取先 `list` 拿到的 version），否则整批被乐观锁拒绝、**一个字都不写**。被拒就重新 `list` 拿新 version 再发一次。
2. **`doc_id` 只收 ASCII**（`[A-Za-z0-9_-.~:@+]`）。中文标题必须先转成安全 id（议会用的是「日期-哈希8位」）。
3. **`stale` 必须删干净**。库里留着已归档/已交付的东西，面板展示的就是过期真相。

### 面板之间的跳转（tvs-boss 专用）

tvs-boss 管多个项目，它的总板上要能**直接跳到各项目自己的 task 板**——boss 看完团队全局，想知道"shirehub 那边还有什么任务没完"，点一下就到。

实现：boss 同步时，除了写 `crew`，再写一个 `links` 集合，每个纳管项目一条：

```json
{ "project": "shirehub", "path": "D:/coding/shirehub", "url": "https://claude.ai/artifact/...", "openTasks": 3 }
```

boss 的脚本只给 `project` 与 `path`（它不读地址簿），另外两个字段由你合并：

- `url` —— 跑一次 `panel.mjs --list`，按 `path` 对上范围键就有。**该项目还没有板时留空串**，页面渲染成灰的虚线框、标"未建板"、不可点，而不是死链。要建板就在那个项目目录下跑一次 `tvs-task`。
- `openTasks` —— 跑 `tvs-task/scripts/panel-data.mjs --scope <该项目范围键>` 取 `taskCount`。忘了填就是不显示数字，入口照样能点。

页面把 `links` 渲染成一排项目入口，带各自的未完成任务数。这是三个 skill 环环相扣的那一环：**boss 给你团队全局，task 给你项目细节，面板之间一步可达。**

## 评论回流：主实例接，子 agent 改

红线在本文开头，这里只说标准面板上评论怎么走完一圈：

```
你在面板上选中某块评论并发给 Claude
        │
        ▼
主实例（持有 watch，子 agent 拿不到）
  读评论 → 想清楚要改什么 → 写派工单
        │
        ▼
sonnet 子 agent
  先读 references/page-contract.md → 改 page.html → 语法自检 → 逐块重发
        │
        ▼
主实例 回评论、resolve 线程
```

### 派工单 A：改 page.html —— **sonnet**

```
Agent({ subagent_type: "general-purpose", model: "sonnet", prompt: <下面这张单> })
```

**必须让它先读契约**，否则它看不到色板令牌、图表色的校验结果、红线：

```
【页面】skills/tvs-panel/page.html
【先读】skills/tvs-panel/references/page-contract.md —— 颜色令牌、三处主题块、
        图表色校验、红线、字段契约、改完必做两件事，全在里面
【要改什么】<用户的原话 + 你的理解；具体到哪个区、什么行为>
【范围】只动 page.html，不碰任何 panel-data.mjs
【改完】① 跑契约里那条语法自检命令
        ② panel.mjs --list 拿全部板，逐块带 url 重发，再 --set 重记指纹
        ③ 再跑一次 --list，确认 pageStale 全为 false
【回执】改了哪几处、重发了几块板、--list 的最终状态。不贴 HTML。
```

**不要只转发用户原话**。用户说"议会那块看着乱"，派工单要写成"议会卡的状态构成条与收敛图之间缺间距，且三级折叠的视觉层次不够分"——子 agent 看不到面板，判断得你来做。

### 派工单 B：只跑数据同步脚本 —— **同样 sonnet**

```
Agent({ subagent_type: "general-purpose", model: "sonnet", prompt: <下面这张单> })
```

照单办事，无判断：

```
【面板】<url>
【范围】<scope>
【脚本】node <某 skill>/scripts/panel-data.mjs --scope <scope>
【做什么】跑脚本 → docs 逐个落成 JSON 文件 → ArtifactData 的 list 读现存 id
         → 回带 --known 重跑拿 stale → batch 一次写完（set 用 file_path，
         已存在的带 if_version，stale 里每个一条 delete）
【回执】写了几条、删了几条、失败的原文照抄。不要复述面板内容。
```

### 子 agent 能做什么，实测过

`ToolSearch` 加载 `ArtifactData` → `list` / `set` / `delete` 全通；`Artifact` 工具带 `url` 重发也可用。

**唯一拿不到的是 watch**（只有主循环会话能持有）——所以评论回流必须落在主实例，这也正是主实例存在的理由。

### 纪律

面板的价值等于同步的及时性，**过期的面板比没有面板更糟**——它会让你以为自己看到了真相。

每条文档自带 `syncedAt`，页面按**区内最旧的那条**报"N 分钟前同步"，超 30 分钟转警示色。看到它发黄就是漏同步了。时间戳落在每条文档上而不是一个全局字段，是因为同一块板上几个区由不同流程写入，全局字段会被互相覆盖成假新鲜度。

### 页面字段契约

`page.html` 对每个集合的期望字段，由对应 skill 的 `panel-data.mjs` 单方定义。**改字段要两边一起改**，页面对缺字段一律给安全默认（不渲染那一行），不会因为一个脏文档整页白。

| 集合 | 关键字段 |
|---|---|
| `tasks` | `shortName` `status` `subs[]` `progress` `accept` `stalled` `repos[]` `iters[]` `syncedAt` |
| `crew` | `title` `project` `branch` `stage` `note` `pending[]` `openCount` `focusCount` `syncedAt` |
| `council` | `topic` `round` `draftVersion` `issues[]` `trend[]` `forOwner[]` `statusKnown` `closed` `syncedAt` |
| `links` | `project` `path` `url` `openTasks` `syncedAt` |

`statusKnown: false` 是明确的"状态解析不出来"信号，页面据此显示"状态未解析"而不是一个错数字——**宁可显示不全，不显示错的**。

### 页面本身

单文件 `page.html`，无构建。各区按紧急度排：在途需求 → 议会 → 在册任务，每区内部"等你动手的"置顶。

收敛走势（议会区）是标准页上唯一放了视觉重量的地方：单序列面积折线图，图表色与 UI 色分开选步、浅深各自验证过对比度与色觉安全。别的地方保持安静。
