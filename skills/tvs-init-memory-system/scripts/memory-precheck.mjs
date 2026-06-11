#!/usr/bin/env node
/**
 * 项目记忆维护预检 Hook
 *
 * 由会话结束类 hook（Cursor stop/sessionEnd、Claude Code Stop/SessionEnd 等）调用，
 * 判断是否要提示主 Agent 调用 project-memory-maintainer 子代理维护 .memory/。
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
 *
 *   ── v4 团队化增量（全程代码判断、零 AI）──
 *   6. 分支感知触发 —— 纳入「当前分支 / 分支领先集成线提交数 / 距上次维护时间」三维度。
 *   7. 时间衰减门槛 —— 距上次维护越久，文件/提交阈值越低（连续缩放，非硬阈值）：
 *      <2天 ×1.5（更难触，别烦）；2-7天 ×1.0；>7天 ×0.5；>14天 有相关变更即触发。
 *   8. 跨成员去重 —— 上次维护到的 commit 记在入库的 `跨分支在研功能地图.md` 机读锚点
 *      `<!-- mem-meta: {...} -->` 里；当前分支 HEAD 已被该锚点 head 覆盖则跳过（团队成员 pull 即共享）。
 *   9. 防膨胀信号 —— 统计 `.memory/**.md` 体积，单文件/总量超阈值即在提示里追加精简建议（零 AI）。
 *  10. lint 增 changelog 检测 —— `--lint-memory` 额外扫描"本次改了什么"式 changelog 噪音。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'

// preset: <选定的 preset 名>
// 安装时必须把 SELECTED_PRESET 替换成前置检查阶段选定的 preset。
const SELECTED_PRESET = '<selected-preset>'

const PRESET_REGISTRY = {
    'nodejs-frontend': {
        include: [
            /^src\//, /^app\//, /^pages\//, /^components\//, /^lib\//,
            /^package(-lock)?\.json$/, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^yarn\.lock$/,
            /^tsconfig.*\.json$/, /^jsconfig.*\.json$/,
            /^next\.config\./, /^vite\.config\./, /^nuxt\.config\./, /^webpack\.config\./,
            /^tailwind\.config\./, /^postcss\.config\./, /^vitest\.config\./, /^jest\.config\./, /^eslint\.config\./,
            /^middleware\./, /^i18n\//, /^public\/images\//, /^public\/icons\//,
        ],
        coreConfig: [
            /^package(-lock)?\.json$/, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^yarn\.lock$/,
            /^tsconfig.*\.json$/,
            /^next\.config\./, /^vite\.config\./, /^nuxt\.config\./, /^middleware\./,
        ],
        architecture: [
            /^src\/lib\/(api|stores|hooks)\//,
            /^src\/components\/(layouts|ui)\//,
            /^src\/app\/api\//,
            /^src\/(auth|middleware)\//,
        ],
    },
    'nodejs-backend': {
        include: [
            /^src\//, /^lib\//, /^routes\//, /^controllers\//, /^services\//, /^models\//, /^middleware\//,
            /^package(-lock)?\.json$/, /^pnpm-lock\.yaml$/, /^yarn\.lock$/,
            /^tsconfig.*\.json$/, /^jsconfig.*\.json$/,
            /^nest-cli\./, /^vitest\.config\./, /^jest\.config\./, /^eslint\.config\./,
        ],
        coreConfig: [
            /^package(-lock)?\.json$/, /^pnpm-lock\.yaml$/, /^yarn\.lock$/,
            /^tsconfig.*\.json$/, /^nest-cli\./,
        ],
        architecture: [
            /^src\/(routes|controllers|services|models|middleware)\//,
            /^src\/(db|database|prisma|drizzle)\//,
        ],
    },
    python: {
        include: [
            /^src\//, /^app\//, /^lib\//, /^[a-z_]+\/__init__\.py$/,
            /^pyproject\.toml$/, /^setup\.(py|cfg)$/, /^requirements.*\.txt$/, /^Pipfile(\.lock)?$/, /^poetry\.lock$/,
            /^pytest\.ini$/, /^mypy\.ini$/, /^\.flake8$/, /^\.pylintrc$/, /^tox\.ini$/,
            /^manage\.py$/, /^wsgi\.py$/, /^asgi\.py$/,
        ],
        coreConfig: [
            /^pyproject\.toml$/, /^setup\.(py|cfg)$/, /^requirements.*\.txt$/, /^Pipfile(\.lock)?$/, /^poetry\.lock$/,
        ],
        architecture: [
            /^src\/(models|services|api|core)\//,
            /^app\/(models|views|api)\//,
        ],
    },
    go: {
        include: [
            /^cmd\//, /^internal\//, /^pkg\//, /^api\//, /^services\//,
            /^go\.mod$/, /^go\.sum$/,
            /^\.golangci\.ya?ml$/,
        ],
        coreConfig: [
            /^go\.mod$/, /^go\.sum$/,
        ],
        architecture: [
            /^internal\/(domain|usecase|adapter|infrastructure)\//,
            /^pkg\/(http|grpc|db)\//,
        ],
    },
}

// v5：preset 未注入只影响"触发检测"主路径；--lint-memory / --mark-done / --status / --reset 与 preset 无关，不应被挡。
// 校验下沉到 main() 的触发分支（见下），模块加载不再抛错。
const SELECTED_PRESET_CONFIG = PRESET_REGISTRY[SELECTED_PRESET] || null

/** 视为代码或架构相关变化的路径，至少命中一条才纳入考量 */
const INCLUDE_PATTERNS = SELECTED_PRESET_CONFIG?.include ?? []

/** 即使命中 include 也强制排除；所有 preset 共享 */
const EXCLUDE_PATTERNS = [
    /^\.memory\//, /^\.cursor\//, /^\.claude\//, /^\.codex\//, /^\.omc\//, /^\.omx\//, /^AIConfig\//,
    /^docs\//, /^README/i, /(^|\/)CHANGELOG/i,
    /^\.next\//, /^dist\//, /^build\//, /^out\//, /^target\//, /^coverage\//,
    /^node_modules\//, /^__pycache__\//, /^vendor\//, /^logs\//,
    /\.(pyc|pyo|class)$/,
]

/** 命中即视为触及核心配置，自动提升优先级 */
const CORE_CONFIG_PATTERNS = SELECTED_PRESET_CONFIG?.coreConfig ?? []

/** 命中即视为架构敏感区域，自动提升优先级 */
const ARCHITECTURE_PATTERNS = SELECTED_PRESET_CONFIG?.architecture ?? []

/** 触发阈值与节流配置，按项目实际节奏调整 */
const CONFIG = {
    /** 自上次维护以来变更文件数 ≥ 此值才触发（会被时间衰减因子缩放） */
    deltaFileThreshold: 5,
    /** 自上次维护以来变更行数 ≥ 此值才触发（按 deltaFiles 相对 HEAD 计；会被时间衰减因子缩放） */
    deltaLineThreshold: 200,
    /** 距离上次提示的冷却时间（分钟）；冷却内即使有新增量也不重复提示 */
    cooldownMinutes: 30,
    /** 是否要求 HEAD 前进（commit 之后）才计入触发分数；默认关闭 */
    requireHeadAdvance: false,
    // ── v4 团队化配置 ──
    /** v5/P3：团队模式。false = 单人项目，--mark-done 只写本机 state，不往入库的跨分支地图写机读锚点（避免无意义 git diff） */
    teamMode: true,
    /** 集成线候选；探测时取第一个本地存在的分支作为"集成线"，用于算分支领先提交数 */
    integrationBranchCandidates: ['dev', 'develop', 'main', 'master'],
    /** 当前分支领先集成线的提交数 ≥ 此值即独立触发（攒了不少活该维护了；会被时间衰减缩放） */
    branchAheadThreshold: 10,
    /** 距上次维护 > 此天数且有任何相关变更即触发（长期不维护的兜底；与时间衰减 >14天 规则一致） */
    staleMaintenanceDays: 14,
    /** 单个 .memory md 文件软上限（字节）；超过即在提示里追加"该文件膨胀了考虑精简" */
    memoryFileSoftLimitBytes: 8192,
    /** .memory md 总量软上限（字节）；v5 账本模型收紧到 32KB（只存不可推导知识，超了说明混进了可推导内容） */
    memoryTotalSoftLimitBytes: 32768,
    /** v5：lint 超龄复审——文件超过此天数未更新即标记"提请复审"（实时性兜底） */
    lintStaleFileDays: 180,
    /** 旧路径占位；真实旧路径每个项目特定，请按项目情况补进 */
    lintMemoryStalePathPatterns: [
        'src/legacy/',
        'src/old/',
        'src/deprecated/',
    ],
    /** changelog 式噪音关键词；--lint-memory 命中（且无"历史"语境）即判 lint 失败，逼记忆别写成变更日志 */
    lintChangelogPatterns: [
        '本次修改', '本次改动', '本次新增', '本次变更', '## 变更记录', '## 更新日志', '本轮改了',
    ],
}

const STATE_FILE = '.memory/.hook-state.json'
/** 团队共享维护元数据载体：人读表格 + 机读锚点共处一个入库文件 */
const CROSS_BRANCH_MAP_FILE = '.memory/跨分支在研功能地图.md'
/** 机读锚点正则：从跨分支地图里提取 <!-- mem-meta: {...} --> 的 JSON（比解析 md 表格稳健） */
const MEM_META_RE = /<!--\s*mem-meta:\s*(\{[\s\S]*?\})\s*-->/
const LIST_LIMIT = 12

function runGit(args, { silent = false } = {}) {
    try {
        return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim()
    } catch (err) {
        // silent：探测候选分支是否存在这类"预期可能失败"的调用，不打 stderr 噪音
        if (!silent) process.stderr.write(`[memory-hook] git ${args.join(' ')} 失败：${err.message}\n`)
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
 * 计算 worktree 相关文件的 mtime 指纹哈希（用于 trigger dedup）。
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
    return createHash('sha1').update(items.join('\n')).digest('hex').slice(0, 16)
}

/** 解析 git diff --name-only 输出为路径数组 */
function parseDiffPaths(output) {
    if (!output) return []
    return output.split('\n').map((l) => normalizePath(l.trim())).filter(Boolean)
}

function parseNumstat(numstat) {
    if (!numstat) return 0
    return numstat.split('\n').reduce((total, line) => {
        const [a, d] = line.split(/\s+/)
        const safe = (s) => { const n = Number.parseInt(s, 10); return Number.isFinite(n) ? n : 0 }
        return total + safe(a) + safe(d)
    }, 0)
}

/** worktree 相对 HEAD 的变更行数 */
function countLinesAgainstHead(paths) {
    if (paths.length === 0) return 0
    return parseNumstat(runGit(['diff', '--numstat', 'HEAD', '--', ...paths]))
}

/** fromRef..toRef 之间相关文件的变更行数（用于已提交变更统计） */
function countLinesBetween(paths, fromRef, toRef) {
    if (paths.length === 0 || !fromRef || fromRef === toRef) return 0
    return parseNumstat(runGit(['diff', '--numstat', fromRef, toRef, '--', ...paths]))
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

const daysSince = (iso) => minutesSince(iso) / 1440

/**
 * 时间衰减因子：距上次维护越久，阈值缩放越小（越容易触发）。
 * <2天 ×1.5（刚维护完，别拿小变动烦人）；2-7天 ×1.0；>7天 ×0.5；>14天 →0（有相关变更即触发）。
 * 返回 0 表示阈值归零：任意相关变更都过门槛。
 */
function decayFactor(days) {
    if (days < 2) return 1.5
    if (days <= 7) return 1.0
    if (days <= 14) return 0.5
    return 0
}

/** 探测集成线：取第一个本地存在的候选分支（dev/develop/main/master）。算分支领先提交数用。 */
function resolveIntegrationBranch() {
    for (const b of CONFIG.integrationBranchCandidates) {
        if (runGit(['rev-parse', '--verify', '--quiet', b], { silent: true })) return b
    }
    return null
}

/** 当前检出分支名（detached 时回退 'HEAD'） */
const currentBranch = () => runGit(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD'

/** 当前分支领先集成线的提交数 = git rev-list --count <集成线>..HEAD */
function branchAheadCount(integration) {
    if (!integration) return 0
    const n = Number.parseInt(runGit(['rev-list', '--count', `${integration}..HEAD`]), 10)
    return Number.isFinite(n) ? n : 0
}

/** 读入库跨分支地图里的机读锚点（团队共享的维护元数据）。无则返回 null。 */
function readMemMeta() {
    const f = resolve(CROSS_BRANCH_MAP_FILE)
    if (!existsSync(f)) return null
    try {
        const m = readFileSync(f, 'utf8').match(MEM_META_RE)
        return m ? JSON.parse(m[1]) : null
    } catch {
        return null
    }
}

/**
 * 把机读锚点写/更新进跨分支地图（hook 的职责；人读表格由子 Agent 维护，两者共处一文件互不覆盖）。
 * 已有锚点就原地替换，没有就插到第一个一级标题之后；文件不存在则建最小骨架。
 */
function writeMemMetaIntoMap(meta) {
    const f = resolve(CROSS_BRANCH_MAP_FILE)
    const anchor = `<!-- mem-meta: ${JSON.stringify(meta)} -->`
    let text = existsSync(f)
        ? readFileSync(f, 'utf8')
        : '# 跨分支在研功能地图\n\n> 记录各分支在迭代的功能：功能 → 分支 → 负责人 → 状态。由 project-memory-maintainer 维护人读表格；机读锚点由 hook 维护。\n'
    if (MEM_META_RE.test(text)) {
        text = text.replace(MEM_META_RE, anchor)
    } else {
        const lines = text.split('\n')
        const idx = lines.findIndex((l) => l.startsWith('# '))
        if (idx >= 0) lines.splice(idx + 1, 0, anchor)
        else lines.unshift(anchor)
        text = lines.join('\n')
    }
    try {
        mkdirSync(dirname(f), { recursive: true })
        writeFileSync(f, text)
    } catch (err) {
        process.stderr.write(`[memory-hook] 写入跨分支地图锚点失败：${err.message}\n`)
    }
}

/** 统计 .memory 下 md 体积，找出超软上限的文件（防膨胀信号，零 AI） */
function computeMemorySizes() {
    const files = listMarkdownFiles(resolve('.memory'))
    let total = 0
    const oversized = []
    for (const f of files) {
        try {
            const sz = statSync(f).size
            total += sz
            if (sz > CONFIG.memoryFileSoftLimitBytes) oversized.push({ file: normalizePath(f), bytes: sz })
        } catch { /* ignore */ }
    }
    return { total, oversized, fileCount: files.length }
}

function emitFollowup(message) {
    process.stdout.write(JSON.stringify({ followup_message: message }))
}

function buildMessage({ deltaFiles, reasons, sizeInfo }) {
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
        '- v5 账本模型：只维护四类不可推导知识——业务导航（术语↔入口）、决策日志（append-only，为什么）、红线与约定、跨分支地图。',
        '- 写入黑名单：模块职责描述、业务流程叙述、数据契约、函数签名/参数、调用关系、纯路径罗列（无业务词锚定）、代码注释转述、临时进度/TODO、changelog 式"本次改了什么"——可推导内容查 codegraph 或源码，不进记忆。',
        '- 本轮若没有新决策、新红线、导航变化（新能力/新叫法/入口迁移），直接 no-op——这是预期常态，不要硬写。',
        '- 维护后同步更新本文件（跨分支在研功能地图.md）的人读表格：功能 / 分支 / 负责人（git user.name）/ 状态 / 上次维护。',
        '',
        'mark-done 质量闸门：',
        '- 维护完成后，先输出自检摘要：本次更新文件清单、反查过的源码路径、发现并处理的过期路径、未能确认的问题。',
        '- 未能确认的问题应写入 `待确认问题.md`，不能混入模块档案伪造成当前事实。',
        '- 如果代码入口路径在集成线不存在却被当作当前事实保留，或决策日志的历史条目正文被改写（只允许追加和状态行修订），禁止执行 `--mark-done`。',
        '- 禁止刷新基线时，应把未解决问题写入 `待确认问题.md`，或通过回执返回 blocked。',
        '- 通过自检后再执行：`node .cursor/hooks/memory-precheck.mjs --mark-done` 刷新基线。',
        '',
        '--lint-memory 子命令：',
        '- `node .cursor/hooks/memory-precheck.mjs --lint-memory` 扫描 `.memory/**` 中是否出现旧路径模式。',
        '- 默认旧路径模式使用 CONFIG.lintMemoryStalePathPatterns 占位：`src/legacy/`、`src/old/`、`src/deprecated/`。',
        '- 命中且未带"历史" / "已迁出"等上下文时返回非零，视为 lint 失败。',
        '- 该子命令可用于 CI / 定期任务检查 memory 是否漂移；真实旧路径每个项目特定，请按项目情况补进 CONFIG。',
        '- 不刷新基线下次还会再次提示同一批变更。',
        '',
        ...(sizeInfo && (sizeInfo.oversized.length > 0 || sizeInfo.total > CONFIG.memoryTotalSoftLimitBytes) ? [
            '记忆体积提醒（防膨胀，零 AI 统计）：',
            ...(sizeInfo.total > CONFIG.memoryTotalSoftLimitBytes
                ? [`- .memory 总量 ${(sizeInfo.total / 1024).toFixed(0)}KB 超软上限 ${(CONFIG.memoryTotalSoftLimitBytes / 1024).toFixed(0)}KB，维护时优先精简冗余。`]
                : []),
            ...sizeInfo.oversized.map((o) => `- ${o.file} 已 ${(o.bytes / 1024).toFixed(1)}KB 超单文件软上限，考虑拆分或删 codegraph 已覆盖的结构冗余。`),
            '',
        ] : []),
        '相关变更文件：',
        fileList,
    ].join('\n')
}

/** 子命令：把当前 HEAD 记为新基线，下次 hook 仅检查相对此 HEAD 的已提交变更 + 工作区 WIP */
function commandMarkDone(stateFile) {
    if (!inGitRepo()) {
        process.stdout.write(JSON.stringify({ ok: false, message: '当前不在 git 仓库内' }))
        return
    }
    const head = runGit(['rev-parse', 'HEAD']) || 'no-head'
    const branch = currentBranch()
    const by = runGit(['config', 'user.name']) || 'unknown'
    const nowIso = new Date().toISOString()
    const prev = readState(stateFile)
    writeState(stateFile, {
        baselineHead: head,
        lastMaintainedAt: nowIso,
        lastTriggerHash: null,
        // 保留历史字段供 --status 可读
        ...(prev.lastTriggeredAt ? { lastTriggeredAt: prev.lastTriggeredAt } : {}),
    })
    // v4：把"谁/何时/在哪个分支维护到哪个 commit"写进入库的机读锚点，供团队跨成员去重 + 时间衰减判断。
    // v5/P3：单人模式（teamMode: false）跳过——锚点入库只在多人共享时有意义，单人写它只产生 git diff 噪音。
    if (CONFIG.teamMode) {
        const prevMeta = readMemMeta() || {}
        const lastMaintained = { ...(prevMeta.lastMaintained || {}), [branch]: head }
        writeMemMetaIntoMap({ lastMaintained, updatedAt: nowIso, by, branch })
    }
    process.stdout.write(JSON.stringify({
        ok: true,
        message: `已刷新记忆维护基线（分支 ${branch} @ ${head.slice(0, 8)}，维护者 ${by}）`,
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
    const meta = readMemMeta()
    const inRepo = inGitRepo()
    const branch = inRepo ? currentBranch() : null
    const integration = inRepo ? resolveIntegrationBranch() : null
    const aheadCount = integration ? branchAheadCount(integration) : null
    const lastMaintainedIso = meta?.updatedAt || state.lastMaintainedAt || null
    const days = lastMaintainedIso ? daysSince(lastMaintainedIso) : null
    const sizes = computeMemorySizes()
    process.stdout.write(JSON.stringify({
        stateFile,
        config: CONFIG,
        state,
        v4: {
            branch,
            integrationBranch: integration,
            branchAheadCount: aheadCount,
            lastMaintainedAt: lastMaintainedIso,
            daysSinceMaintained: days != null ? Number(days.toFixed(2)) : null,
            decayFactor: days != null ? decayFactor(days) : null,
            memMeta: meta,
            memorySize: {
                totalKB: Number((sizes.total / 1024).toFixed(1)),
                fileCount: sizes.fileCount,
                oversized: sizes.oversized,
            },
        },
    }, null, 2))
}

function listMarkdownFiles(dir) {
    if (!existsSync(dir)) return []

    const files = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = resolve(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...listMarkdownFiles(fullPath))
            continue
        }

        if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath)
        }
    }

    return files
}

function hasHistoryContext(lines, index) {
    const contextWords = ['历史', '已迁出', '历史路径', '过去路径', '迁移自']
    const from = Math.max(0, index - 2)
    const to = Math.min(lines.length - 1, index + 2)
    const context = lines.slice(from, to + 1).join('\n')
    return contextWords.some((word) => context.includes(word))
}

/** changelog 关键词豁免：否定/指令语境（"不要写本次改了什么"）或关键词被引号包裹（作为反例引用）时不算噪音 */
function isChangelogException(line, keyword) {
    if (/不要|不应|不得|禁止|别[写记把]|勿|避免/.test(line)) return true
    const quoted = [`"${keyword}"`, `“${keyword}”`, `「${keyword}」`, `'${keyword}'`]
    return quoted.some((q) => line.includes(q))
}

/**
 * 子命令：递归扫描 `.memory/` 下的 Markdown 文件中未标注历史语境的旧路径。
 *
 * 目的：阻止过期目录被继续写成"当前事实"，污染长期项目记忆。
 */
function commandLintMemory() {
    const memoryRoot = resolve('.memory')
    const files = listMarkdownFiles(memoryRoot)
    const hits = []

    for (const file of files) {
        const text = readFileSync(file, 'utf8')
        const lines = text.split(/\r?\n/)
        lines.forEach((lineContent, index) => {
            for (const pattern of CONFIG.lintMemoryStalePathPatterns) {
                if (!lineContent.includes(pattern)) continue
                if (hasHistoryContext(lines, index)) continue

                hits.push({
                    kind: 'stale-path',
                    file: normalizePath(file),
                    line: index + 1,
                    lineContent,
                    pattern,
                })
            }
            // v4：changelog 式噪音（"本次改了什么"）本就不该进长期记忆，命中即判失败，无历史语境豁免
            for (const pattern of CONFIG.lintChangelogPatterns) {
                if (!lineContent.includes(pattern)) continue
                if (isChangelogException(lineContent, pattern)) continue
                hits.push({
                    kind: 'changelog',
                    file: normalizePath(file),
                    line: index + 1,
                    lineContent,
                    pattern,
                })
            }
        })
    }

    // ── v5 健康检查（借鉴 omc wiki lint）：孤儿文件 / 互链断裂 / 超龄复审 ──
    const indexText = (() => {
        const f = resolve(memoryRoot, '记忆索引.md')
        return existsSync(f) ? readFileSync(f, 'utf8') : ''
    })()
    const pageNames = new Set(files.map((f) => basename(f, '.md')))
    const now = Date.now()
    for (const file of files) {
        const name = basename(file, '.md')
        // 孤儿：记忆索引完全没提到的页面（索引自己和个人偏好豁免）
        if (indexText && name !== '记忆索引' && name !== '个人偏好' && !indexText.includes(name)) {
            hits.push({ kind: 'orphan-file', file: normalizePath(file), line: 0, lineContent: '', pattern: '记忆索引未引用' })
        }
        // 断链：[[页面]] 互链指向不存在的页面
        const text = readFileSync(file, 'utf8')
        for (const m of text.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
            if (!pageNames.has(m[1])) {
                hits.push({ kind: 'broken-link', file: normalizePath(file), line: 0, lineContent: m[0], pattern: m[1] })
            }
        }
        // 超龄复审：长期未更新的页面提请人工复审（实时性兜底，不自动判错）
        try {
            const ageDays = (now - statSync(file).mtimeMs) / 86400000
            if (ageDays > CONFIG.lintStaleFileDays) {
                hits.push({ kind: 'stale-review', file: normalizePath(file), line: 0, lineContent: `${ageDays.toFixed(0)} 天未更新`, pattern: '提请复审' })
            }
        } catch { /* ignore */ }
    }

    const ok = hits.length === 0
    const counts = {}
    for (const h of hits) counts[h.kind] = (counts[h.kind] || 0) + 1
    process.stdout.write(JSON.stringify({
        ok,
        total_files: files.length,
        hits,
        message: ok
            ? '未发现旧路径、changelog 噪音、孤儿页、断链或超龄页'
            : '发现问题：' + Object.entries(counts).map(([k, v]) => `${k}×${v}`).join('，'),
        // v5/P1 衡量回路：写而不读的记忆是负债——每次 lint 顺便自问，三问皆否就该精简而不是扩充
        review: [
            'P1 衡量三问：',
            '1. 最近一个月 AI 放错过代码位置吗？',
            '2. 最近一个月 AI 重复造过轮子吗？',
            '3. 你自己上次查 .memory 是什么时候？',
        ],
    }, null, 2))
    process.exit(ok ? 0 : 1)
}

function main() {
    const argv = process.argv.slice(2)
    const stateFile = resolve(STATE_FILE)

    if (argv.includes('--mark-done')) return commandMarkDone(stateFile)
    if (argv.includes('--reset')) return commandReset(stateFile)
    if (argv.includes('--status')) return commandStatus(stateFile)
    if (argv.includes('--lint-memory')) return commandLintMemory()

    // 触发检测主路径才需要 preset；未注入时跳过并提示（安装脚本忘了替换占位）
    if (!SELECTED_PRESET_CONFIG) {
        process.stderr.write(`[memory-hook] 未注入 preset（SELECTED_PRESET=${SELECTED_PRESET}），触发检测跳过。请按安装步骤替换脚本顶部占位。\n`)
        return
    }

    const force = argv.includes('--force')

    if (!inGitRepo()) return

    const head = runGit(['rev-parse', 'HEAD']) || 'no-head'
    const state = readState(stateFile)

    // ── Option C：committed diff + worktree 双轨 ──
    // 1. 已提交但未入基线的相关文件（baselineHead → HEAD）
    const committedPaths = state.baselineHead && state.baselineHead !== head
        ? parseDiffPaths(runGit(['diff', '--name-only', state.baselineHead, head, '--'])).filter(isRelevant)
        : []

    // 2. 未提交的 WIP 相关文件
    const worktreePaths = parseStatusPaths(runGit(['status', '--porcelain'])).filter(isRelevant)

    // 3. 合并去重；工作区干净且 HEAD 未前进时直接跳过
    const allRelevant = Array.from(new Set([...committedPaths, ...worktreePaths]))
    if (allRelevant.length === 0) return

    // 4. Trigger dedup：HEAD + worktree 指纹组合哈希，相同状态不重复触发
    const worktreeFpHash = computeWorktreeFingerprint(worktreePaths)
    const triggerSignature = createHash('sha1')
        .update(`${head}|${worktreeFpHash}`)
        .digest('hex').slice(0, 16)

    if (!force && triggerSignature === state.lastTriggerHash) return
    if (!force && minutesSince(state.lastTriggeredAt) < CONFIG.cooldownMinutes) return

    // ── v4 分支感知 + 时间衰减 + 跨成员去重（全程代码判断，零 AI）──
    const meta = readMemMeta()
    const branch = currentBranch()
    // 上次维护时间优先取入库锚点（团队共享），回退单机 state
    const lastMaintainedIso = meta?.updatedAt || state.lastMaintainedAt
    const days = daysSince(lastMaintainedIso)
    const factor = decayFactor(days)

    // 跨成员去重：当前分支 HEAD 已被锚点标记为已维护、且两轨均无新增量 → 别人已维护过，跳过
    const maintainedHead = meta?.lastMaintained?.[branch]
    if (!force && maintainedHead && maintainedHead === head && committedPaths.length === 0 && worktreePaths.length === 0) return

    // 时间衰减后的有效阈值（factor=0 时阈值归零：有相关变更即过门槛，对应 >14 天兜底）
    const fileThreshold = Math.ceil(CONFIG.deltaFileThreshold * factor)
    const lineThreshold = Math.ceil(CONFIG.deltaLineThreshold * factor)
    const aheadThreshold = Math.ceil(CONFIG.branchAheadThreshold * factor)

    const deltaFiles = allRelevant
    // committed 行数从 baselineHead diff HEAD 取；worktree 行数从 diff HEAD 取
    const committedLines = countLinesBetween(committedPaths, state.baselineHead, head)
    const worktreeLines = countLinesAgainstHead(worktreePaths)
    const deltaLines = committedLines + worktreeLines
    const integration = resolveIntegrationBranch()
    const aheadCount = branchAheadCount(integration)
    const touchesCoreConfig = deltaFiles.some((p) =>
        CORE_CONFIG_PATTERNS.some((re) => re.test(p)))
    const touchesArchitecture = deltaFiles.some((p) =>
        ARCHITECTURE_PATTERNS.some((re) => re.test(p)))

    const reasons = []
    if (deltaFiles.length >= fileThreshold)
        reasons.push(`自上次维护以来变更文件数 ${deltaFiles.length} ≥ ${fileThreshold}（距上次 ${days.toFixed(1)} 天，衰减×${factor}）`)
    if (deltaLines >= lineThreshold)
        reasons.push(`自上次维护以来变更行数 ${deltaLines} ≥ ${lineThreshold}（衰减×${factor}）`)
    if (integration && aheadThreshold > 0 && aheadCount >= aheadThreshold)
        reasons.push(`当前分支 ${branch} 领先集成线 ${integration} ${aheadCount} commit ≥ ${aheadThreshold}`)
    if (days > CONFIG.staleMaintenanceDays)
        reasons.push(`距上次维护 ${days.toFixed(0)} 天 > ${CONFIG.staleMaintenanceDays} 天（长期未维护兜底）`)
    if (touchesCoreConfig) reasons.push('触及核心配置（依赖 / TS / 构建）')
    if (touchesArchitecture) reasons.push(`触及架构敏感区（preset: ${SELECTED_PRESET}）`)

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
        lastTriggerHash: triggerSignature,
        lastTriggeredAt: new Date().toISOString(),
    })

    emitFollowup(buildMessage({ deltaFiles, reasons, sizeInfo: computeMemorySizes() }))
}

main()
