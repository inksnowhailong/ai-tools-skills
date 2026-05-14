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

````markdown
---
name: project-memory-maintainer
model: inherit
description: 维护当前项目的中文项目记忆层。较大的代码或架构变更后应主动使用；当变更影响模块边界、API 契约、公共组件、状态、权限、数据访问或项目约定时必须使用；当用户提到项目记忆、记忆维护、项目情况或知识沉淀时必须使用。写入 .memory/** 必须由本后台子 Agent 执行，主 Agent 不得直接编辑 .memory/**。
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

`.memory/**` 的写入必须发生在本后台子 Agent 内。主 Agent 只能触发或委派你，不能在主流程中直接新增、删除或修改 `.memory/**`。

如果当前环境无法启动本子 Agent，必须停止并说明原因，不能由主 Agent 代替维护记忆。

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

## 维护完成后

无论本轮是真维护了，还是判断 no-op，结束前都要执行一次：

```bash
node .cursor/hooks/memory-precheck.mjs --mark-done
```

这会把当前工作区作为新基线落盘，下次 hook 仅检查"自基线以来的新增量"，避免反复对同一批未提交的变更重复触发提示。

## 输出目标

让未来的 AI Agent 和开发者能快速理解当前项目的业务模块、模块边界、关键流程、工程风格、复用入口和风险点。
````

## 产物 2：Hook 预检脚本

写入 `.cursor/hooks/memory-precheck.mjs`，内容：

```javascript
#!/usr/bin/env node
/**
 * 项目记忆维护预检 Hook
 *
 * 由 Cursor hooks 在 stop / sessionEnd 时调用，判断是否要提示主 Agent
 * 调用 project-memory-maintainer 子代理维护 .memory/。
 *
 * 解决的核心问题：
 *   旧实现以"工作区相对 HEAD 的全量差异"为输入。
 *   长期不 commit 时差异只增不减，每次 stop 都过阈值反复触发同一批变更。
 *
 * 改进策略：
 *   1. 基线机制 —— 以"上次成功维护后的工作区快照"为基线，仅看相对基线的增量。
 *      指纹由 path:size:mtime 构成，不依赖 HEAD，适配长期不 commit 的工作流。
 *   2. 三层节流 —— 同指纹去重 + 冷却时间（默认 30 分钟）+ 增量阈值。
 *   3. 子代理协作 —— 维护成功后调用 `--mark-done` 刷新基线，下次仅看新增量。
 *   4. 手动控制 —— `--force` 强制提示一次，`--reset` 清空状态，`--status` 查看状态。
 *   5. 可选 commit-only 模式 —— `requireHeadAdvance=true` 时只在 HEAD 前进后才计入。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
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
    /^\.memory\//, /^\.cursor\//, /^\.omc\//, /^\.omx\//, /^\.claude\//, /^AIConfig\//,
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

/** 触发阈值与节流配置，按项目实际节奏调整 */
const CONFIG = {
    /** 自上次维护以来变更文件数 ≥ 此值才触发 */
    deltaFileThreshold: 5,
    /** 自上次维护以来变更行数 ≥ 此值才触发（按 deltaFiles 相对 HEAD 计） */
    deltaLineThreshold: 200,
    /** 距离上次提示的冷却时间（分钟）；冷却内即使有新增量也不重复提示 */
    cooldownMinutes: 30,
    /** 是否要求 HEAD 前进（commit 之后）才计入触发分数；默认关闭 */
    requireHeadAdvance: false,
}

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
const isRelevant = (p) =>
    !EXCLUDE_PATTERNS.some((re) => re.test(p)) &&
    INCLUDE_PATTERNS.some((re) => re.test(p))

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

/**
 * 计算工作区中相关文件的指纹。
 * 用 path:size:mtime 而非 git diff，原因：未提交时 diff 一直在变，
 * 但只要文件 size 与 mtime 不变就不应判定为"又有新变更"。
 */
function computeWorktreeFingerprint(paths) {
    const items = []
    for (const p of paths) {
        try {
            const st = statSync(p)
            items.push(`${p}|${st.size}|${Math.floor(st.mtimeMs)}`)
        } catch {
            items.push(`${p}|missing`)
        }
    }
    items.sort()
    return {
        files: items,
        hash: createHash('sha1').update(items.join('\n')).digest('hex').slice(0, 16),
    }
}

/** 找出当前工作区中相对基线"新增或元数据变化"的文件路径 */
function computeDelta(baselineFiles, currentFiles) {
    const baselineMap = new Map()
    for (const item of baselineFiles || []) {
        const idx = item.indexOf('|')
        if (idx === -1) continue
        baselineMap.set(item.slice(0, idx), item.slice(idx + 1))
    }
    const newOrChanged = []
    for (const item of currentFiles) {
        const idx = item.indexOf('|')
        if (idx === -1) continue
        const path = item.slice(0, idx)
        const meta = item.slice(idx + 1)
        const baselineMeta = baselineMap.get(path)
        if (baselineMeta === undefined || baselineMeta !== meta) {
            newOrChanged.push(path)
        }
    }
    return newOrChanged
}

/** 仅作为辅助信号：deltaFiles 相对 HEAD 的总变更行数 */
function countLinesAgainstHead(paths) {
    if (paths.length === 0) return 0
    const numstat = runGit(['diff', '--numstat', 'HEAD', '--', ...paths])
    if (!numstat) return 0
    return numstat.split('\n').reduce((total, line) => {
        const [a, d] = line.split(/\s+/)
        const safe = (s) => {
            const n = Number.parseInt(s, 10)
            return Number.isFinite(n) ? n : 0
        }
        return total + safe(a) + safe(d)
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

const minutesSince = (iso) => {
    if (!iso) return Infinity
    return (Date.now() - new Date(iso).getTime()) / 60000
}

function emitFollowup(message) {
    process.stdout.write(JSON.stringify({ followup_message: message }))
}

function buildMessage({ deltaFiles, reasons }) {
    const shown = deltaFiles.slice(0, LIST_LIMIT)
    const remaining = deltaFiles.length - shown.length
    const fileList = shown.map((p) => `- ${p}`).join('\n') +
        (remaining > 0 ? `\n- ……还有 ${remaining} 个文件未列出` : '')

    return [
        '本轮检测到自上次记忆维护以来的累积变更已达到阈值，必须调用后台子代理 `project-memory-maintainer` 维护 `.memory/`。',
        '',
        '触发原因：',
        ...reasons.map((r) => `- ${r}`),
        '',
        '记忆维护要求：',
        '- `.memory/**` 写入必须在 `project-memory-maintainer` 后台子 Agent 内完成，主 Agent 禁止直接编辑 `.memory/**`。',
        '- 如果当前环境无法启动该子 Agent，请直接说明无法执行，不要在主流程代办。',
        '- 只记录项目稳定情况、模块边界、数据契约、工程风格、复用入口和已知风险。',
        '- 不要记录本次改了什么，不要把 `.memory` 写成 changelog。',
        '- 维护完成（或确认 no-op）后请执行：`node .cursor/hooks/memory-precheck.mjs --mark-done` 刷新基线。',
        '- 不刷新基线下次还会再次提示同一批变更。',
        '',
        '相关变更文件：',
        fileList,
    ].join('\n')
}

/** 子命令：把当前工作区作为新基线落盘，下次 hook 仅检查相对基线的新增量 */
function commandMarkDone(stateFile) {
    if (!inGitRepo()) {
        process.stdout.write(JSON.stringify({ ok: false, message: '当前不在 git 仓库内' }))
        return
    }
    const allRelevant = Array.from(
        new Set(parseStatusPaths(runGit(['status', '--porcelain'])).filter(isRelevant)),
    )
    const fp = computeWorktreeFingerprint(allRelevant)
    const head = runGit(['rev-parse', 'HEAD']) || 'no-head'
    const prev = readState(stateFile)
    writeState(stateFile, {
        ...prev,
        baselineHead: head,
        baselineFingerprint: fp.files,
        baselineHash: fp.hash,
        lastMaintainedAt: new Date().toISOString(),
        lastTriggerHash: null,
    })
    process.stdout.write(JSON.stringify({
        ok: true,
        message: `已刷新记忆维护基线，已纳入 ${allRelevant.length} 个相关文件`,
    }))
}

/** 子命令：清空 hook 状态，下次将作为首次触发处理 */
function commandReset(stateFile) {
    writeState(stateFile, {})
    process.stdout.write(JSON.stringify({ ok: true, message: '已清空 hook 状态' }))
}

/** 子命令：打印当前状态，便于排查"为何没触发 / 为何反复触发" */
function commandStatus(stateFile) {
    const state = readState(stateFile)
    process.stdout.write(JSON.stringify({ stateFile, config: CONFIG, state }, null, 2))
}

function main() {
    const argv = process.argv.slice(2)
    const stateFile = resolve(STATE_FILE)

    if (argv.includes('--mark-done')) return commandMarkDone(stateFile)
    if (argv.includes('--reset')) return commandReset(stateFile)
    if (argv.includes('--status')) return commandStatus(stateFile)

    const force = argv.includes('--force')

    if (!inGitRepo()) return

    const allRelevant = Array.from(
        new Set(parseStatusPaths(runGit(['status', '--porcelain'])).filter(isRelevant)),
    )
    if (allRelevant.length === 0) return

    const state = readState(stateFile)
    const head = runGit(['rev-parse', 'HEAD']) || 'no-head'
    const currentFp = computeWorktreeFingerprint(allRelevant)

    if (CONFIG.requireHeadAdvance && state.baselineHead === head && !force) return
    if (!force && currentFp.hash === state.lastTriggerHash) return
    if (!force && minutesSince(state.lastTriggeredAt) < CONFIG.cooldownMinutes) return

    const deltaFiles = computeDelta(state.baselineFingerprint, currentFp.files)
    if (deltaFiles.length === 0 && !force) return

    const deltaLines = countLinesAgainstHead(deltaFiles)
    const touchesCoreConfig = deltaFiles.some((p) =>
        CORE_CONFIG_PATTERNS.some((re) => re.test(p)))
    const touchesArchitecture = deltaFiles.some((p) =>
        ARCHITECTURE_PATTERNS.some((re) => re.test(p)))

    const reasons = []
    if (deltaFiles.length >= CONFIG.deltaFileThreshold)
        reasons.push(`自上次维护以来变更文件数 ${deltaFiles.length} ≥ ${CONFIG.deltaFileThreshold}`)
    if (deltaLines >= CONFIG.deltaLineThreshold)
        reasons.push(`自上次维护以来变更行数 ${deltaLines} ≥ ${CONFIG.deltaLineThreshold}`)
    if (touchesCoreConfig) reasons.push('触及核心配置（依赖 / TS / 构建）')
    if (touchesArchitecture) reasons.push('触及架构敏感区（core / infrastructure / adapters）')

    if (reasons.length === 0 && !force) return
    if (force && reasons.length === 0) reasons.push('手动强制触发（--force）')

    /**
     * 这里只更新触发记录，不更新 baseline；
     * baseline 仅在子代理实际维护后由 `--mark-done` 写入，
     * 否则用户没真维护就连续触发会被错误地判定为"已处理"。
     */
    writeState(stateFile, {
        ...state,
        baselineHead: state.baselineHead || head,
        baselineFingerprint: state.baselineFingerprint || [],
        baselineHash: state.baselineHash || null,
        lastTriggerHash: currentFp.hash,
        lastTriggeredAt: new Date().toISOString(),
    })

    emitFollowup(buildMessage({ deltaFiles, reasons }))
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
      {
        "command": "node .cursor/hooks/memory-precheck.mjs",
        "timeout": 15,
        "loop_limit": 1,
        "failClosed": false
      }
    ],
    "sessionEnd": [
      {
        "command": "node .cursor/hooks/memory-precheck.mjs",
        "timeout": 15,
        "loop_limit": 1,
        "failClosed": false
      }
    ]
  }
}
```

如果 `.cursor/hooks.json` 已存在，**不要直接覆盖**。读取已有内容、合并 stop / sessionEnd 数组、保留其他字段后写回；如果已有同名 hook command 但缺少 `timeout`、`loop_limit` 或 `failClosed`，应补齐这些保护字段。

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

同时把 `.memory/.hook-state.json` 写入 `.gitignore`（运行期状态文件，不应入库）：

```text
# 项目记忆 hook 运行期状态
.memory/.hook-state.json
```

---

## 产物 5：初始化记忆维护基线

四件产物全部就位后，**立即执行一次**：

```bash
node .cursor/hooks/memory-precheck.mjs --mark-done
```

这一步至关重要。它会把当前工作区作为"基线"快照落盘到 `.memory/.hook-state.json`。从此 hook 只检查"自基线以来的新增量"，而不是工作区相对 HEAD 的全量差异。

**如果跳过这一步**，第一次 stop 触发时 hook 会把所有未提交的工作区变更全部当作"新增量"提示给你，反而立刻造成一次假性触发。

---

## 收尾

五件事全部就位后，向用户输出一段简短摘要：

```text
项目记忆维护体系部署完成：
- .cursor/agents/project-memory-maintainer.md
- .cursor/hooks/memory-precheck.mjs
- .cursor/hooks.json (stop + sessionEnd 已注册)
- .memory/记忆索引.md / 项目总览.md / 术语表.md / 待确认问题.md
- .memory/.hook-state.json （已用当前工作区初始化为基线）

触发节奏（默认值）：
- 自上次维护以来变更文件数 ≥ 5 个，或变更行数 ≥ 200 行，或触及核心配置 / 架构敏感区
- 同一段冷却期内（默认 30 分钟）只提示一次
- 工作区指纹未变就跳过（即使过了冷却时间）
- 想调阈值或冷却时间，改 memory-precheck.mjs 顶部 CONFIG 即可

日常运维命令：
- node .cursor/hooks/memory-precheck.mjs --mark-done   维护完成或判 no-op 后调用，刷新基线
- node .cursor/hooks/memory-precheck.mjs --force       绕过冷却与去重，手动强制提示一次
- node .cursor/hooks/memory-precheck.mjs --status      打印当前 CONFIG 与状态，排查触发问题
- node .cursor/hooks/memory-precheck.mjs --reset       清空 hook 状态，下次按首次触发处理

接下来：
- 你下一次较大代码变更结束时，hook 会自动检测并提示主 Agent 调用子代理。
- 子 Agent 第一次跑会按项目代码自动生成业务模块目录，请审阅它的产物。
- 建议把 .memory/ 加入 git；.memory/.hook-state.json 已加入 .gitignore。
```

如果项目里没有 `.cursor/rules/**`，最后追加一行提示：

```text
- 检测到本项目尚未生成架构规则，建议运行 /init-architecture-rules。
```

不要输出代码 diff、不要输出 changelog 风格的"本次修改"——这次部署是一次性安装，不是日常变更。
