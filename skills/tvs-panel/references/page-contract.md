# 改 page.html 的契约

**改页面的人先读这一份，再动手。** 这里是页面已经定下来的东西——不是建议，是约束。目的只有一个：别人改完之后，页面还是同一套设计，而不是拼起来的。

改的是 `skills/tvs-panel/page.html`，单文件、无构建、无外部脚本。

## 一、颜色只能用令牌，不许写字面值

任何 `color` / `background` / `stroke` / `fill` 都必须 `var(--x)`。写死一个十六进制，那块在另一个主题下就是瞎的。

浅色是基准（定义在裸 `:root`），深色**重定义同一批令牌**，一个不少：

| 令牌 | 浅色 | 深色 | 干什么的 |
|---|---|---|---|
| `--bg` | `#F1F3F5` | `#14171C` | 页面底 |
| `--surface` | `#FFFFFF` | `#1C2027` | 卡片底 |
| `--sunk` | `#E9ECEF` | `#171B21` | 凹陷块（图表框、次级卡） |
| `--ink` | `#1A1F26` | `#DDE1E6` | 正文 |
| `--muted` | `#6B7280` | `#8A93A0` | 次要文字、标签 |
| `--line` | `#DEE2E6` | `#2B313A` | 描边、分隔 |
| `--accent` | `#3A6EA5` | `#87AFD7` | 主色（分支名、链接、焦点） |
| `--run` / `--run-soft` | `#9A6A1C` / `#F6EDDD` | `#D7AF87` / `#2B2317` | 进行中、告警 |
| `--done` / `--done-soft` | `#4A7A28` / `#E9F2E0` | `#AFD787` / `#212B18` | 已完成 |
| `--accept` / `--accept-soft` | `#1F7A4D` / `#DFF3E9` | `#6FCF97` / `#16301F` | **等你动手**（待拍板、待验收、待裁决） |
| `--stall` / `--stall-soft` | `#5C7A8A` / `#E6EDF1` | `#7D96A6` / `#1B242A` | 停滞 |
| `--c-closed` / `--c-pending` / `--c-verify` | `#4A7A28` / `#3A6EA5` / `#9A6A1C` | `#2FA36F` / `#4A90D9` / `#C98500` | **图表专用**，见下 |

配色来源：`panel.mjs` TUI 的 ANSI 色（110 蓝 / 180 琥珀 / 150 绿 / 243 灰），刻意偏灰。**别往里加鲜艳色**，那会和整页打架。

### 三处主题块必须同时改

加一个令牌要在**三个地方**都加，漏一个就会在某种状态下失效：

```css
:root { … }                                        /* 浅色基准 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { … }            /* 跟系统的深色 */
}
:root[data-theme="dark"] { … }                     /* 显式切深色 */
```

只定义在 media 块里的颜色，在"系统设置=light 但用户手动切了深色"这种状态下不存在。

### 图表色是单独选过步的，不许拿 UI 色替

`--c-closed` / `--c-pending` / `--c-verify` 跑过 `dataviz` 的六项校验，浅深各自验：

```
浅色  相邻 CVD ΔE 18.6（deutan）· 常视 ΔE 19.5 · 对比度全 ≥3:1   全通过
深色  相邻 CVD ΔE 16.9 · 常视 ΔE 18.7 · 对比度全 ≥3:1            全通过
```

深色**不是浅色翻转**，是对深底重新选的步——原来那套 ANSI 淡色做图表标记时彩度不够、亮度超带，校验直接 FAIL。

**换图表色必须重跑校验**：
```
node <dataviz skill>/scripts/validate_palette.js "#hex,#hex,#hex" --mode light
node <dataviz skill>/scripts/validate_palette.js "#hex,#hex,#hex" --mode dark --surface "#1C2027"
```
六项全 PASS 才准用。不要凭眼睛判断色觉安全。

## 二、字体

```
正文  -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif
等宽  "JetBrains Mono"（Google Fonts）, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace
```

等宽只用于：分支名、日期、数字、issue 编号、路径。**中文正文不用等宽**——系统栈的中文比任何 Google 中文字体都好，且零下载。

数字对齐处加 `font-variant-numeric: tabular-nums`。

## 三、分区与排序

区的顺序**按紧急度**，不按字母也不按数据量：

```
项目      links     通往各项目自己的板（只有总板有）
在途需求  crew      tvs-boss
议会      council   tvs-council
在册任务  tasks     tvs-task
```

每区内部：**等你动手的置顶**。这是整块面板的组织原则，加新区也照办。

各区排序权重已经写在 `taskWeight` / `crewWeight` / `councilWeight` 里，改排序改那三个函数，别在渲染处插临时判断。

## 四、红线

| 不许 | 为什么 |
|---|---|
| 写死颜色字面值 | 另一个主题下瞎掉 |
| 只在 media 块里定义令牌 | "系统 light + 手动切深色"这个状态下不存在 |
| 图表色换了不重跑校验 | 色觉不安全是看不出来的 |
| 加外部脚本/样式（除 Google Fonts） | CSP 只放行 cdnjs / jsdelivr / Google Fonts，别的静默失败 |
| 用 `style.display` 切显隐 | 骨架里 `[hidden]{display:none!important}`，用 `el.hidden` |
| 删掉 `typeof` 兜底 | 一个脏文档会让整页白 |
| 删掉契约漂移检查 | 脚本改字段名后页面会静默少渲染一整块 |
| 删掉新鲜度显示 | 过期面板比没有面板更糟 |
| 改 `<title>` | 各板共用同一份 HTML，标题一改全改 |

## 五、字段契约

页面订阅四个集合。**改字段要与对应 skill 的 `panel-data.mjs` 一起改**，单方改必炸：

| 集合 | 产出方 | 关键字段 |
|---|---|---|
| `tasks` | tvs-task | `shortName` `status` `subs[]` `progress` `accept` `stalled` `repos[]` `iters[]` `syncedAt` |
| `crew` | tvs-boss | `title` `project` `branch` `stage` `note` `pending[]` `openCount` `focusCount` `syncedAt` |
| `council` | tvs-council | `topic` `round` `draftVersion` `issues[]` `trend[]` `forOwner[]` `statusKnown` `closed` `syncedAt` |
| `links` | tvs-boss | `project` `path` `url` `openTasks` `syncedAt` |

页面顶部的 `CONTRACT` 常量是这张表的机器版——**改字段要同步改它**，否则漂移检查会报假警或漏报。

对缺字段一律给安全默认（不渲染那一行），不抛错、不白屏。

## 六、响应式

- 手机宽度（~400px）必须能用，侧边留 16px 以上。
- 只有图表能横向滚，且必须在自己的 `overflow-x: auto` 容器里；**页面本身永不横向滚动**。
- 图表用 `viewBox` + `width:100%`，不写死像素宽。

## 七、改完必做两件事

**1. 语法自检**（页面坏了不会报错，只会白屏）：

```bash
node -e 'const s=require("fs").readFileSync("skills/tvs-panel/page.html","utf8");
new Function(s.match(/<script>([\s\S]*)<\/script>/)[1]); console.log("JS OK")'
```

**2. 逐块重发**。页面是所有板共用的同一份源码，但**每块板是独立的 artifact**：

```bash
node skills/tvs-panel/scripts/panel.mjs --list    # 拿全部板，并看哪些还在跑旧版
```

对每块板用 Artifact 工具带 `url` 重发，然后 `panel.mjs --cwd <范围> --set <url>` 重新记指纹。

> 同一会话里同一个 `file_path` 永远落回同一块板，所以第二块起要先把 `page.html` 复制到带范围名的临时路径再发。

**漏发的那块会一直跑旧版，不报错**。重发完再跑一次 `--list`，确认 `pageStale` 全是 `false` 才算完。
