---
description: 一次性为当前项目部署项目记忆维护体系：生成子 Agent + Hook 预检脚本 + .memory/ 目录骨架 + hooks.json 注册。
---

# /init-memory-system

你被显式调用来为当前项目**一次性安装**项目记忆维护体系。这是一次性工程动作，跑完就结束，不是日常能力。

参数 `$ARGUMENTS` 可选：用户可指定阈值偏好（例如"阈值更宽松"）或运行环境（例如"PowerShell 项目，hook 用 .ps1 实现"）。无参数时按下面默认方案部署。

---

## 你的唯一职责

按顺序生成以下产物：

1. `.cursor/agents/project-memory-maintainer.md` — Cursor 子 Agent，后台运行
2. `.cursor/hooks/memory-precheck.mjs` — Hook 预检脚本，stop / sessionEnd 触发前判断变更是否值得维护记忆
3. `.cursor/hooks.json` — Hook 注册文件
4. `.memory/` 目录骨架 — `记忆索引.md`、`项目总览.md`、`术语表.md`、`待确认问题.md`（留空骨架，业务模块目录由子 Agent 后续按需创建）

不做：

- 不修改业务代码、不修改依赖。
- 不生成 `.cursor/rules/**`（那是 `/init-architecture-rules` 的职责）。
- 不直接写记忆内容——只搭骨架，记忆由子 Agent 后续自动维护。

---

## 前置检查

开始前先检查：

1. 项目根是否已有 `.cursor/rules/**`？如果没有，提示用户："建议先运行 `/init-architecture-rules` 生成架构规则，再部署记忆系统"，并询问是否仍要继续。
2. 项目是否在 git 仓库内？Hook 预检脚本依赖 `git`，如果不在 git 仓库，提示用户。
3. 是否已存在 `.cursor/agents/project-memory-maintainer.md` 或 `.memory/`？如果存在，先读取并询问用户是否覆盖。

---

## 产物 1：子 Agent

写入 `.cursor/agents/project-memory-maintainer.md`，内容：

```markdown
---
name: project-memory-maintainer
model: inherit
is_background: true
---

# 项目记忆维护员

你是当前项目的"项目记忆维护员"。

## 唯一职责

自动维护当前项目的中文项目记忆层，让未来的 Agent 能统一、正确地理解项目，减少重复代码、风格漂移和错误放置。

你不是开发 Agent。
你不是代码审查 Agent。
你不是架构规则生成 Agent。
你不能修改业务代码。
你不能修改架构规范规则。
你不能提出实现方案。
你只能维护 `.memory/**` 目录下的内容。

## 触发时机

- stop
- sessionEnd

## 运行条件

只有当本次 Agent 工作产生较大的代码或架构相关变化时才运行。普通问答、文档修改、记忆修改、规则修改、无文件变化、小修小补，直接 no-op。

## 允许读取

- 项目源码
- 配置文件
- package / 依赖文件
- 当前 git diff
- 已有项目记忆

## 允许写入

- `.memory/**`

## 禁止写入

- 源码目录
- 配置文件
- 依赖文件
- `.cursor/rules/**`
- `.cursor/commands/**`
- 任何非 `.memory/` 目录

## 记忆层要求

1. 除根目录 `.memory` 外，内部目录名、文件名、正文内容必须全部使用中文。
2. 按业务模块或能力模块建立目录，不按源码目录机械复制。
3. 每个模块记录：模块职责、业务流程、数据契约、关键规则、已知风险。
4. 记忆文件不是变更日志，不记录"本次改了什么"。
5. 只记录项目稳定情况，不记录临时猜测。
6. 不复述代码实现细节，除非它影响业务理解、模块边界、工程风格或未来维护。
7. 每条重要记忆必须标注来源文件。
8. 不确定内容写入"待确认问题.md"，不能伪造成事实。
9. 没有值得沉淀的项目知识则 no-op，不要强行更新。
10. 每次只更新受影响模块，不重写整个记忆层。
11. 记忆内容应帮助 Agent 判断代码应该放哪里、该复用什么、哪些风格和边界不能破坏。

## 输出目标

让未来的 AI Agent 和开发者能快速理解当前项目的业务模块、模块边界、关键流程、工程风格、复用入口和风险点。
```

## 产物 2：Hook 预检脚本

写入 `.cursor/hooks/memory-precheck.mjs`，内容：

```javascript
#!/usr/bin/env node
/**
 * 项目记忆维护预检 Hook
 *
 * 由 Cursor hooks 在 stop / sessionEnd 时调用：
 *   1. 判断本轮 Agent 工作是否产生足够大的代码或架构相关变更
 *   2. 通过 .memory/.hook-state.json 指纹去重，避免 stop 与 sessionEnd 对同一批变更重复触发
 *   3. 命中阈值时输出 followup_message，提示主 Agent 调用 project-memory-maintainer 子代理
 *
 * 本脚本不直接调子代理；是否真正维护记忆，由主 Agent 与子代理自身判断。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'

/** 视为代码或架构相关变化的路径，至少命中一条才纳入考量 */
const INCLUDE_PATTERNS = [
    /^src\//, /^app\//, /^lib\//, /^components\//, /^pages\//,
    /^server\//, /^backend\//, /^frontend\//,
    /^core\//, /^infrastructure\//, /^adapters\//, /^views\//,
    /^packages\/[^/]+\/(src|core|infrastructure|adapters|views)\//,
    /^apps\/[^/]+\/(src|core|infrastructure|adapters|views)\//,
    /^package(-lock)?\.json$/,
    /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^yarn\.lock$/,
    /^tsconfig.*\.json$/,
    /^next\.config\./, /^vite\.config\./, /^nuxt\.config\./,
    /^webpack\.config\./, /^tailwind\.config\./,
    /^vitest\.config\./, /^jest\.config\./, /^eslint\.config\./,
]

/** 即使命中 include 也强制排除 */
const EXCLUDE_PATTERNS = [
    /^\.memory\//, /^\.cursor\//, /^\.omc\//, /^\.omx\//, /^\.claude\//,
    /^docs\//, /^README/i, /(^|\/)CHANGELOG/i,
    /^\.next\//, /^dist\//, /^build\//, /^out\//, /^coverage\//,
    /^node_modules\//, /^logs\//,
]

/** 命中即视为触及核心配置，自动提升优先级 */
const CORE_CONFIG_PATTERNS = [
    /^package(-lock)?\.json$/,
    /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/,
    /^tsconfig.*\.json$/,
    /^next\.config\./, /^vite\.config\./, /^nuxt\.config\./,
    /^eslint\.config\./,
]

/** 命中即视为架构敏感区域，自动提升优先级 */
const ARCHITECTURE_PATTERNS = [
    /^core\//, /^infrastructure\//, /^adapters\//,
    /^packages\/[^/]+\/(core|infrastructure|adapters)\//,
    /^src\/lib\/(api|request|supabase)\//,
    /^src\/(stores?|hooks|services|api|types)\//,
    /^src\/components\/common\//,
]

/** 触发阈值，按项目调整 */
const THRESHOLDS = { files: 3, lines: 80 }

const STATE_FILE = '.memory/.hook-state.json'
const LIST_LIMIT = 12

function runGit(args) {
    try {
        return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim()
    } catch (err) {
        process.stderr.write(`[memory-hook] git ${args.join(' ')} 失败：${err.message}\n`)
        return ''
    }
}

const inGitRepo = () => runGit(['rev-parse', '--is-inside-work-tree']) === 'true'
const normalizePath = (p) => p.replace(/\\/g, '/')

/** 解析 git status --porcelain 输出，兼容 rename（` -> `） */
function parseStatusPaths(status) {
    if (!status) return []
    return status.split('\n')
        .map((line) => {
            const body = line.slice(3).trim()
            const renameIdx = body.indexOf(' -> ')
            return renameIdx === -1 ? body : body.slice(renameIdx + 4)
        })
        .filter(Boolean)
        .map(normalizePath)
}

/** 同时统计已暂存与未暂存差异，覆盖 Agent 改了但还没提交的常见情况 */
function countChangedLines(paths) {
    if (paths.length === 0) return 0
    const numstat = runGit(['diff', '--numstat', 'HEAD', '--', ...paths])
    if (!numstat) return 0
    return numstat.split('\n').reduce((total, line) => {
        const [added, deleted] = line.split(/\s+/)
        const safe = (s) => {
            const n = Number.parseInt(s, 10)
            return Number.isFinite(n) ? n : 0
        }
        return total + safe(added) + safe(deleted)
    }, 0)
}

function readState(file) {
    if (!existsSync(file)) return {}
    try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return {} }
}

function writeState(file, state) {
    try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify(state, null, 2))
    } catch (err) {
        process.stderr.write(`[memory-hook] 写入状态失败：${err.message}\n`)
    }
}

/** 用 HEAD + 文件列表 + 短统计构造稳定指纹，避免 stop 与 sessionEnd 重复触发同一批变更 */
function diffSignature(paths) {
    const head = runGit(['rev-parse', 'HEAD']) || 'no-head'
    const shortstat = runGit(['diff', '--shortstat', 'HEAD', '--', ...paths])
    return createHash('sha1').update([head, ...paths, shortstat].join('\n')).digest('hex').slice(0, 16)
}

function main() {
    if (!inGitRepo()) return

    const isRelevant = (p) =>
        !EXCLUDE_PATTERNS.some((re) => re.test(p)) &&
        INCLUDE_PATTERNS.some((re) => re.test(p))

    const relevantPaths = Array.from(
        new Set(parseStatusPaths(runGit(['status', '--porcelain'])).filter(isRelevant)),
    )
    if (relevantPaths.length === 0) return

    const changedLines = countChangedLines(relevantPaths)
    const touchesCoreConfig = relevantPaths.some((p) => CORE_CONFIG_PATTERNS.some((re) => re.test(p)))
    const touchesArchitecture = relevantPaths.some((p) => ARCHITECTURE_PATTERNS.some((re) => re.test(p)))

    const reasons = []
    if (relevantPaths.length >= THRESHOLDS.files)
        reasons.push(`相关文件数 ${relevantPaths.length} ≥ ${THRESHOLDS.files}`)
    if (changedLines >= THRESHOLDS.lines)
        reasons.push(`变更行数 ${changedLines} ≥ ${THRESHOLDS.lines}`)
    if (touchesCoreConfig) reasons.push('触及核心配置')
    if (touchesArchitecture) reasons.push('触及架构敏感区域')
    if (reasons.length === 0) return

    const stateFile = resolve(STATE_FILE)
    const state = readState(stateFile)
    const signature = diffSignature(relevantPaths)
    if (signature && signature === state.lastSignature) return
    writeState(stateFile, { lastSignature: signature, lastTriggerAt: new Date().toISOString() })

    const shown = relevantPaths.slice(0, LIST_LIMIT)
    const remaining = relevantPaths.length - shown.length
    const fileList = shown.map((p) => `- ${p}`).join('\n') +
        (remaining > 0 ? `\n- ……还有 ${remaining} 个文件未列出` : '')

    const message = [
        '本轮检测到较大的代码或架构相关变更，请调用 `project-memory-maintainer` 子代理维护 `.memory/`。',
        '',
        '触发原因：',
        ...reasons.map((r) => `- ${r}`),
        '',
        '记忆维护要求：',
        '- 只记录项目稳定情况、模块边界、数据契约、工程风格、复用入口和已知风险。',
        '- 不要记录本次改了什么，不要把 `.memory` 写成 changelog。',
        '- 如果没有值得沉淀的稳定项目情况，请 no-op。',
        '',
        '相关变更文件：',
        fileList,
    ].join('\n')

    process.stdout.write(JSON.stringify({ followup_message: message }))
}

main()
```

## 产物 3：hooks.json

写入 `.cursor/hooks.json`，内容：

```json
{
  "version": 1,
  "hooks": {
    "stop": [
      { "command": "node .cursor/hooks/memory-precheck.mjs" }
    ],
    "sessionEnd": [
      { "command": "node .cursor/hooks/memory-precheck.mjs" }
    ]
  }
}
```

如果 `.cursor/hooks.json` 已存在，**不要直接覆盖**。读取已有内容、合并 stop / sessionEnd 数组、保留其他字段后写回。

## 产物 4：.memory/ 骨架

创建以下文件，每个文件留空骨架（包含一级标题和一句话占位说明，不填具体内容）：

```text
.memory/
  记忆索引.md         ← 一级标题"记忆索引" + 占位说明"由 project-memory-maintainer 子 Agent 自动维护"
  项目总览.md         ← 一级标题"项目总览" + 占位说明"由子 Agent 在足够大的变更后自动沉淀"
  术语表.md           ← 一级标题"术语表"
  待确认问题.md       ← 一级标题"待确认问题" + 占位说明"子 Agent 把不确定的内容写入此处，由人审定"
```

不要创建任何业务模块目录——那由子 Agent 在首次实际维护时按项目代码自动生成。

---

## 收尾

四件产物全部就位后，向用户输出一段简短摘要：

```text
项目记忆维护体系部署完成：
- .cursor/agents/project-memory-maintainer.md
- .cursor/hooks/memory-precheck.mjs
- .cursor/hooks.json (stop + sessionEnd 已注册)
- .memory/记忆索引.md / 项目总览.md / 术语表.md / 待确认问题.md

接下来：
- 你下一次较大代码变更结束时，hook 会自动检测并提示主 Agent 调用子代理。
- 阈值默认 3 个文件 / 80 行变更，可在 memory-precheck.mjs 顶部 THRESHOLDS 调整。
- 子 Agent 第一次跑会按项目代码自动生成业务模块目录，请审阅它的产物。
- 建议把 .memory/ 加入 git，但 .memory/.hook-state.json 加入 .gitignore（运行期状态）。
```

如果项目里没有 `.cursor/rules/**`，最后追加一行提示：

```text
- 检测到本项目尚未生成架构规则，建议运行 /init-architecture-rules。
```

不要输出代码 diff、不要输出 changelog 风格的"本次修改"——这次部署是一次性安装，不是日常变更。
