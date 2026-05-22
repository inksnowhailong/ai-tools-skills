#!/usr/bin/env node
/**
 * team.mjs — tvs-team-spawn 团队多 Agent 协作运行时。
 *
 * 用法：
 *   node team.mjs <command> [args...] [--flag value]
 *
 * 命令列表：
 *   ensure-team         初始化 .cursor/.team/ 目录骨架与 config.json
 *   list-roles          输出可选角色池
 *   add-member          在 config.json 追加成员并建立邮箱/记忆目录
 *   generate-leader     生成 .cursor/skills/team-leader-<team>/SKILL.md
 *   generate-sub        生成 .cursor/skills/<subName>/SKILL.md
 *   generate-stop-hook  写出 .cursor/hooks/team-stop-driver.mjs 并合并 hooks.json
 *   bind                把当前最近的 Cursor conversation_id 绑定到 agent
 *   unbind              解绑某个 conversation_id 或 agent
 *   mailbox-send        原子写入一条消息到 inbox/<to>/from-<from>/
 *   mailbox-consume     一次性读出并删除 inbox/<agent>/from-* /*.json
 *   mailbox-watch       监听 inbox/<agent>/，文件事件或超时退出
 *   blackboard-read     读黑板（section 可选）
 *   blackboard-write    写黑板（仅 caller 在 writers 列表中允许）
 *   worktree-create     在 .cursor/.team/worktrees/<sub>/ 建 git worktree
 *   worktree-assign     把已有 worktree 路径分配给 sub
 *   worktree-list       打印所有 worktree 状态
 *   watcher-claim       占位 watcher PID，kill 旧 watcher
 *   check-deps          检查 chokidar 是否全局可用
 *   install-deps        全局安装 chokidar（npm install -g chokidar）
 *   status              打印团队整体状态
 *
 * 所有命令输出 JSON。出错时退出码非零，错误信息从 stderr 输出。
 *
 * 跨平台：纯 Node.js，依赖 npm + git，在 macOS / Windows / Linux 上一致运行。
 * mailbox-watch 优先用 chokidar（如果通过 install-deps 装好了），否则回退到
 * Node 内置 fs.watch + 5 秒轮询，行为等价但 chokidar 在重命名/编辑器原子写入
 * 等边缘场景下事件更稳定。
 */

import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    readdirSync,
    statSync,
    unlinkSync,
    watch,
    renameSync,
    appendFileSync,
} from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync, execSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const SCRIPT_DIR = dirname(__filename)
const TEMPLATES_DIR = join(SCRIPT_DIR, 'templates')
const ROLES_FILE = join(SCRIPT_DIR, 'team-roles.json')

/* =========================================================================
 * Path helpers
 * Cursor 在 Windows 下可能给出 unix 风格的盘符路径，例如 /e:/foo，
 * 必须先剥掉前导斜杠再 resolve；并把盘符大写以便比对一致。
 * ========================================================================= */

function fixCursorPath(value) {
    if (typeof value !== 'string') return value
    if (process.platform === 'win32' && /^\/[a-z]:/i.test(value)) {
        return value.substring(1)
    }
    return value
}

function normalizeWorkspace(value) {
    let result = resolve(fixCursorPath(value)).replaceAll('\\', '/')
    if (process.platform === 'win32' && /^[a-z]:/.test(result)) {
        result = result[0].toUpperCase() + result.slice(1)
    }
    return result
}

function teamDirFor(ws) {
    return join(ws, '.cursor', '.team')
}

function configFileFor(ws) {
    return join(teamDirFor(ws), 'config.json')
}

function toRel(ws, p) {
    return relative(ws, p).replaceAll('\\', '/')
}

/* =========================================================================
 * IO helpers
 * ========================================================================= */

function stripBom(s) {
    return typeof s === 'string' && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function readTextFile(path) {
    return stripBom(readFileSync(path, 'utf8'))
}

function readJson(path, fallback) {
    try {
        return JSON.parse(readTextFile(path))
    } catch {
        return fallback
    }
}

function ensureDir(p) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

function atomicWriteFile(path, content) {
    ensureDir(dirname(path))
    const tmp = `${path}.${process.pid}.${Date.now()}.${randomBytes(2).toString('hex')}.tmp`
    writeFileSync(tmp, content)
    renameSync(tmp, path)
}

function writeJsonAtomic(path, value) {
    atomicWriteFile(path, `${JSON.stringify(value, null, 4)}\n`)
}

/* =========================================================================
 * Template substitution
 * ========================================================================= */

function readTemplate(name) {
    return readFileSync(join(TEMPLATES_DIR, name), 'utf8')
}

function substitute(template, vars) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{{${k}}}`))
}

/* =========================================================================
 * Dependency discovery (chokidar)
 *
 * 全局安装 chokidar 让 mailbox-watch 在 macOS / Windows / Linux 上行为更一致；
 * 没装也能跑（自动回退到 Node 内置 fs.watch + 5 秒轮询兜底）。
 * ========================================================================= */

function npmGlobalRoot() {
    try {
        return execSync('npm root -g', { encoding: 'utf8' }).trim()
    } catch {
        return null
    }
}

function chokidarEntryCandidates(globalRoot) {
    if (!globalRoot) return []
    // chokidar v4 (ESM) 在 esm/index.js；chokidar v3 (CJS) 在 index.js。
    return [
        join(globalRoot, 'chokidar', 'esm', 'index.js'),
        join(globalRoot, 'chokidar', 'index.js'),
    ].filter((p) => existsSync(p))
}

async function loadChokidar() {
    const globalRoot = npmGlobalRoot()
    if (!globalRoot) return null
    for (const entry of chokidarEntryCandidates(globalRoot)) {
        try {
            const url = pathToFileURL(entry).href
            const mod = await import(url)
            // CJS interop: import 一个 CJS 模块时，命名导出可能挂在 default 上
            const candidate = mod.default && typeof mod.default.watch === 'function' ? mod.default : mod
            if (typeof candidate.watch === 'function') return candidate
        } catch {
            // 候选项加载失败时静默尝试下一个
        }
    }
    return null
}

function chokidarVersion(globalRoot) {
    if (!globalRoot) return null
    const pkg = join(globalRoot, 'chokidar', 'package.json')
    if (!existsSync(pkg)) return null
    const data = readJson(pkg, null)
    return data?.version ?? null
}

function npmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/* =========================================================================
 * Roles
 * ========================================================================= */

function loadRoles() {
    return readJson(ROLES_FILE, { roles: [] })
}

function findRole(roleId) {
    return loadRoles().roles.find((r) => r.id === roleId) ?? null
}

/* =========================================================================
 * Cursor session detection
 *
 * 当 chat 调用 bind 时，team.mjs 通过扫描
 *   ~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl
 * 找到最近被修改的 transcript，把它的 uuid 当作当前 conversation_id。
 * 这要求用户在调用 bind 前至少已经在该 chat 说过一句话。
 * ========================================================================= */

function cursorProjectSlug(workspace) {
    const normalized = normalizeWorkspace(workspace)
    if (/^[A-Z]:\//.test(normalized)) {
        const drive = normalized[0].toLowerCase()
        const rest = normalized.slice(3).split('/').filter(Boolean).join('-')
        return `${drive}-${rest}`
    }
    return normalized.replace(/^\/+/, '').replace(/[:/\\]+/g, '-')
}

function latestConversationId(workspace) {
    const slug = cursorProjectSlug(workspace)
    const root = join(homedir(), '.cursor', 'projects', slug, 'agent-transcripts')
    if (!existsSync(root)) return null
    let dirs
    try {
        dirs = readdirSync(root, { withFileTypes: true })
    } catch {
        return null
    }
    const candidates = []
    for (const d of dirs) {
        if (!d.isDirectory()) continue
        if (!/^[0-9a-f-]{36}$/i.test(d.name)) continue
        const transcriptFile = join(root, d.name, `${d.name}.jsonl`)
        if (!existsSync(transcriptFile)) continue
        try {
            const st = statSync(transcriptFile)
            candidates.push({ id: d.name, mtimeMs: st.mtimeMs })
        } catch {
            continue
        }
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return candidates[0]?.id ?? null
}

/* =========================================================================
 * Config helpers
 * ========================================================================= */

function readConfig(ws) {
    return readJson(configFileFor(ws), null)
}

function writeConfig(ws, config) {
    writeJsonAtomic(configFileFor(ws), {
        ...config,
        updatedAt: new Date().toISOString(),
    })
}

function assertConfig(ws, cmd) {
    const cfg = readConfig(ws)
    if (!cfg) throw new Error(`${cmd}: team not initialized; run ensure-team first`)
    return cfg
}

function listAllAgents(cfg) {
    return [cfg.leaderName, ...cfg.subs.map((s) => s.name)]
}

/* =========================================================================
 * Commands
 * ========================================================================= */

function cmdEnsureTeam(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const teamName = args['team-name'] ?? args.teamName ?? args._[1] ?? `team-${Date.now()}`
    const leaderName = args['leader-name'] ?? args.leaderName ?? 'leader'

    const teamDir = teamDirFor(ws)
    const created = []

    const baseDirs = [
        teamDir,
        join(teamDir, 'inbox'),
        join(teamDir, 'inbox', leaderName),
        join(teamDir, 'blackboard'),
        join(teamDir, 'memory'),
        join(teamDir, 'memory', leaderName),
        join(teamDir, 'worktrees'),
        join(teamDir, 'watchers'),
    ]
    for (const d of baseDirs) {
        if (!existsSync(d)) {
            ensureDir(d)
            created.push(toRel(ws, d))
        }
    }

    const blackboardFiles = {
        'shared-context.md': '# 团队共享上下文\n\n（由 leader 维护；阶段、目标、核心方向；sub 只读。）\n',
        'decisions.jsonl': '',
        'conventions.md': '# 团队约定\n\n（命名、风格、不可破坏的边界；由 leader 维护。）\n',
    }
    for (const [name, body] of Object.entries(blackboardFiles)) {
        const p = join(teamDir, 'blackboard', name)
        if (!existsSync(p)) {
            atomicWriteFile(p, body)
            created.push(toRel(ws, p))
        }
    }

    let config = readConfig(ws)
    if (!config) {
        config = {
            schemaVersion: 1,
            teamName,
            leaderName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            leader: { name: leaderName, model: 'claude-opus-4-7-thinking-max' },
            subs: [],
            blackboard: { writers: [leaderName] },
            bindings: {},
        }
        writeConfig(ws, config)
        created.push(toRel(ws, configFileFor(ws)))
    } else {
        if (config.leaderName !== leaderName) {
            throw new Error(
                `ensure-team: team already initialized with leader "${config.leaderName}", refusing to overwrite with "${leaderName}"`,
            )
        }
        if (teamName !== config.teamName) {
            config.teamName = teamName
            writeConfig(ws, config)
        }
    }

    return {
        ok: true,
        teamDir: toRel(ws, teamDir),
        teamName: config.teamName,
        leaderName: config.leaderName,
        created,
    }
}

function cmdListRoles() {
    return loadRoles()
}

function cmdAddMember(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const name = args._[1]
    const roleId = args._[2]
    if (!name) throw new Error('add-member: missing <name>')
    if (!roleId) throw new Error('add-member: missing <role>')

    const config = assertConfig(ws, 'add-member')
    const role = findRole(roleId)
    if (!role) throw new Error(`add-member: unknown role ${roleId}`)

    if (name === config.leaderName) throw new Error(`add-member: name ${name} conflicts with leader`)
    if (config.subs.some((s) => s.name === name)) throw new Error(`add-member: name ${name} already taken`)

    const model = args.model ?? role.defaultModel
    const member = {
        name,
        role: roleId,
        roleDisplayName: role.displayName,
        model,
        worktree: null,
        addedAt: new Date().toISOString(),
    }
    config.subs.push(member)
    writeConfig(ws, config)

    const teamDir = teamDirFor(ws)
    ensureDir(join(teamDir, 'inbox', name, `from-${config.leaderName}`))
    ensureDir(join(teamDir, 'inbox', config.leaderName, `from-${name}`))
    ensureDir(join(teamDir, 'memory', name))

    return { ok: true, member }
}

function cmdGenerateLeader(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const config = assertConfig(ws, 'generate-leader')

    const skillName = args['skill-name'] ?? args.skillName ?? `team-leader-${config.teamName}`

    const memberList = config.subs.length === 0
        ? '- 当前还没有 sub。回到 /tvs-team-spawn 或调用 team.mjs add-member 来添加。'
        : config.subs.map((s) => `- ${s.name} (${s.roleDisplayName}, model: ${s.model})`).join('\n')

    const template = readTemplate('leader-skill.md.tpl')
    const content = substitute(template, {
        skillName,
        teamName: config.teamName,
        leaderName: config.leaderName,
        teamDir: '.cursor/.team',
        scriptDir: SCRIPT_DIR.replaceAll('\\', '/'),
        memberList,
    })

    const skillPath = join(ws, '.cursor', 'skills', skillName, 'SKILL.md')
    atomicWriteFile(skillPath, content)
    return { ok: true, skillPath: toRel(ws, skillPath), skillName }
}

function cmdGenerateSub(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const subName = args._[1]
    if (!subName) throw new Error('generate-sub: missing <name>')

    const config = assertConfig(ws, 'generate-sub')
    const member = config.subs.find((s) => s.name === subName)
    if (!member) throw new Error(`generate-sub: ${subName} not in team`)

    const role = findRole(member.role)
    if (!role) throw new Error(`generate-sub: unknown role ${member.role}`)

    const memoryHintsBullet = role.memoryHints.map((h) => `- ${h}`).join('\n')

    const template = readTemplate('sub-skill.md.tpl')
    const content = substitute(template, {
        skillName: subName,
        subName,
        teamName: config.teamName,
        leaderName: config.leaderName,
        role: role.id,
        roleDisplayName: role.displayName,
        roleSummary: role.summary,
        roleSystemPrompt: role.systemPrompt,
        teamDir: '.cursor/.team',
        scriptDir: SCRIPT_DIR.replaceAll('\\', '/'),
        memoryHintsBullet,
    })

    const skillPath = join(ws, '.cursor', 'skills', subName, 'SKILL.md')
    atomicWriteFile(skillPath, content)
    return { ok: true, skillPath: toRel(ws, skillPath), subName, role: role.id }
}

function cmdGenerateStopHook(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())

    const hookPath = join(ws, '.cursor', 'hooks', 'team-stop-driver.mjs')
    const template = readTemplate('team-stop-driver.mjs.tpl')
    atomicWriteFile(hookPath, template)

    const hooksJsonPath = join(ws, '.cursor', 'hooks.json')
    let hooksConfig = readJson(hooksJsonPath, null)
    if (!hooksConfig) {
        hooksConfig = { version: 1, hooks: {} }
    }
    if (!hooksConfig.hooks) hooksConfig.hooks = {}
    if (!Array.isArray(hooksConfig.hooks.stop)) hooksConfig.hooks.stop = []

    const hookEntry = {
        command: 'node .cursor/hooks/team-stop-driver.mjs',
        timeout: 10,
        loop_limit: 1,
        failClosed: false,
    }

    const idx = hooksConfig.hooks.stop.findIndex((h) => h?.command === hookEntry.command)
    if (idx === -1) {
        hooksConfig.hooks.stop.push(hookEntry)
    } else {
        hooksConfig.hooks.stop[idx] = { ...hooksConfig.hooks.stop[idx], ...hookEntry }
    }

    writeJsonAtomic(hooksJsonPath, hooksConfig)

    return {
        ok: true,
        hookPath: toRel(ws, hookPath),
        hooksJson: toRel(ws, hooksJsonPath),
    }
}

function cmdBind(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('bind: missing <agent>')

    const config = assertConfig(ws, 'bind')

    const isLeader = config.leaderName === agent
    const isSub = config.subs.some((s) => s.name === agent)
    if (!isLeader && !isSub) {
        throw new Error(`bind: agent ${agent} not in team`)
    }

    const convId = args['conversation-id'] ?? args.conversationId ?? latestConversationId(ws)
    if (!convId) {
        throw new Error(
            'bind: cannot detect current conversation_id. ' +
                'Send at least one message in this chat first, then retry. ' +
                'Or pass --conversation-id <uuid> explicitly.',
        )
    }

    config.bindings = config.bindings ?? {}
    for (const [cid, a] of Object.entries(config.bindings)) {
        if (a === agent && cid !== convId) {
            delete config.bindings[cid]
        }
    }
    config.bindings[convId] = agent
    writeConfig(ws, config)

    return { ok: true, agent, conversationId: convId }
}

function cmdUnbind(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const target = args._[1]
    const config = assertConfig(ws, 'unbind')

    config.bindings = config.bindings ?? {}
    const removed = []
    if (!target) {
        for (const [cid, a] of Object.entries(config.bindings)) removed.push({ conversationId: cid, agent: a })
        config.bindings = {}
    } else {
        for (const [cid, a] of Object.entries(config.bindings)) {
            if (cid === target || a === target) {
                removed.push({ conversationId: cid, agent: a })
                delete config.bindings[cid]
            }
        }
    }
    writeConfig(ws, config)
    return { ok: true, removed }
}

function cmdMailboxSend(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const from = args._[1]
    const to = args._[2]
    if (!from || !to) {
        throw new Error('mailbox-send: usage <workspace> <from> <to> (<jsonPayload> | --payload-file <path>)')
    }

    // 优先 --payload-file（跨平台稳定，避免 PowerShell/CMD 的引号坑）；
    // 没传 file 时退化为位置参数 _[3] 直接传 JSON 字符串。
    const payloadFile = args['payload-file'] ?? args.payloadFile
    let payloadStr
    if (payloadFile) {
        try {
            payloadStr = readTextFile(payloadFile)
        } catch (e) {
            throw new Error(`mailbox-send: cannot read --payload-file ${payloadFile}: ${e.message}`)
        }
    } else {
        payloadStr = args._[3]
    }
    if (!payloadStr) {
        throw new Error('mailbox-send: missing payload (provide <jsonPayload> argument or --payload-file <path>)')
    }

    const config = assertConfig(ws, 'mailbox-send')
    const allAgents = new Set(listAllAgents(config))
    if (!allAgents.has(from)) throw new Error(`mailbox-send: from ${from} not in team`)
    if (!allAgents.has(to)) throw new Error(`mailbox-send: to ${to} not in team`)

    let payload
    try {
        payload = JSON.parse(payloadStr)
    } catch (e) {
        throw new Error(`mailbox-send: payload is not valid JSON: ${e.message}`)
    }

    payload.id = payload.id ?? `msg-${Date.now()}-${randomBytes(3).toString('hex')}`
    payload.from = from
    payload.to = to
    payload.createdAt = payload.createdAt ?? new Date().toISOString()

    const teamDir = teamDirFor(ws)
    const inboxDir = join(teamDir, 'inbox', to, `from-${from}`)
    ensureDir(inboxDir)

    const filename = `${Date.now()}-${randomBytes(4).toString('hex')}.json`
    const filePath = join(inboxDir, filename)
    atomicWriteFile(filePath, JSON.stringify(payload, null, 2))

    return {
        ok: true,
        id: payload.id,
        from,
        to,
        path: toRel(ws, filePath),
    }
}

function cmdMailboxConsume(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('mailbox-consume: missing <agent>')

    const teamDir = teamDirFor(ws)
    const inboxDir = join(teamDir, 'inbox', agent)

    const messages = []
    if (!existsSync(inboxDir)) return { ok: true, agent, count: 0, messages }

    let dirs
    try {
        dirs = readdirSync(inboxDir, { withFileTypes: true })
    } catch {
        return { ok: true, agent, count: 0, messages }
    }

    for (const d of dirs) {
        if (!d.isDirectory() || !d.name.startsWith('from-')) continue
        const fullPath = join(inboxDir, d.name)
        let files
        try {
            files = readdirSync(fullPath)
        } catch {
            continue
        }
        for (const f of files.sort()) {
            if (!f.endsWith('.json')) continue
            if (f.endsWith('.tmp')) continue
            const filePath = join(fullPath, f)
            let msg
            try {
                msg = JSON.parse(readTextFile(filePath))
            } catch {
                continue
            }
            messages.push(msg)
            try { unlinkSync(filePath) } catch { /* ignore */ }
        }
    }

    return { ok: true, agent, count: messages.length, messages }
}

function countPendingIn(inboxDir) {
    let total = 0
    let dirs
    try { dirs = readdirSync(inboxDir, { withFileTypes: true }) } catch { return 0 }
    for (const d of dirs) {
        if (!d.isDirectory() || !d.name.startsWith('from-')) continue
        let files
        try { files = readdirSync(join(inboxDir, d.name)) } catch { continue }
        for (const f of files) {
            if (f.endsWith('.json') && !f.endsWith('.tmp')) total++
        }
    }
    return total
}

function watchWithChokidar(chokidar, { inboxDir, pidFile, maxMs, ws }) {
    return new Promise((res) => {
        let settled = false
        let timeoutHandle = null

        const watcher = chokidar.watch(inboxDir, {
            depth: 1,
            ignoreInitial: true,
            persistent: true,
            ignored: (p) => p.endsWith('.tmp'),
            awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
        })

        const finish = (reason, hint) => {
            if (settled) return
            settled = true
            if (timeoutHandle) clearTimeout(timeoutHandle)
            Promise.resolve(watcher.close?.()).catch(() => {})
            try {
                if (existsSync(pidFile)) {
                    const currentPid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
                    if (currentPid === process.pid) unlinkSync(pidFile)
                }
            } catch { /* ignore */ }
            res({ ok: true, exitReason: reason, hint, watchedDir: toRel(ws, inboxDir), mode: 'chokidar' })
        }

        watcher.on('add', (filepath) => {
            if (filepath.endsWith('.json') && !filepath.endsWith('.tmp')) {
                finish('chokidar:add', filepath)
            }
        })
        watcher.on('addDir', (dirpath) => {
            // 新建 from-<sender>/ 目录后立刻检查是否带文件进入
            if (countPendingIn(inboxDir) > 0) finish('chokidar:addDir', dirpath)
        })
        watcher.on('error', (err) => {
            // chokidar 报错不中断 watcher：继续靠 timeout 兜底
            process.stderr.write(`[mailbox-watch] chokidar error: ${err?.message ?? err}\n`)
        })
        watcher.on('ready', () => {
            if (countPendingIn(inboxDir) > 0) finish('immediate', 'mailbox already non-empty')
        })

        timeoutHandle = setTimeout(() => finish('timeout', `reached max-ms=${maxMs}`), maxMs)
    })
}

function watchWithFsWatch({ inboxDir, pidFile, maxMs, ws }) {
    return new Promise((res) => {
        let settled = false
        const watchers = []
        let pollInterval = null
        let timeoutHandle = null

        const finish = (reason, hint) => {
            if (settled) return
            settled = true
            for (const w of watchers) { try { w.close() } catch { /* ignore */ } }
            if (pollInterval) clearInterval(pollInterval)
            if (timeoutHandle) clearTimeout(timeoutHandle)
            try {
                if (existsSync(pidFile)) {
                    const currentPid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
                    if (currentPid === process.pid) unlinkSync(pidFile)
                }
            } catch { /* ignore */ }
            res({ ok: true, exitReason: reason, hint, watchedDir: toRel(ws, inboxDir), mode: 'fs.watch' })
        }

        function attachFromDirWatchers() {
            let entries
            try { entries = readdirSync(inboxDir, { withFileTypes: true }) } catch { return }
            for (const d of entries) {
                if (!d.isDirectory() || !d.name.startsWith('from-')) continue
                const full = join(inboxDir, d.name)
                try {
                    const w = watch(full, (event, fname) => {
                        if (!fname) {
                            if (countPendingIn(inboxDir) > 0) finish('event:nameless', 'fs.watch event without filename')
                            return
                        }
                        if (fname.endsWith('.tmp')) return
                        if (!fname.endsWith('.json')) return
                        finish('event:file', `${event}:${fname}`)
                    })
                    watchers.push(w)
                } catch { /* ignore */ }
            }
        }

        try {
            const root = watch(inboxDir, (event, name) => {
                if (!name) return
                if (name.startsWith('from-')) {
                    attachFromDirWatchers()
                    if (countPendingIn(inboxDir) > 0) finish('event:new-from-dir', name)
                }
            })
            watchers.push(root)
        } catch { /* ignore */ }

        attachFromDirWatchers()

        if (countPendingIn(inboxDir) > 0) {
            finish('immediate', 'mailbox already non-empty')
            return
        }

        pollInterval = setInterval(() => {
            if (countPendingIn(inboxDir) > 0) finish('poll', 'found pending messages')
        }, 5000)

        timeoutHandle = setTimeout(() => finish('timeout', `reached max-ms=${maxMs}`), maxMs)
    })
}

async function cmdMailboxWatch(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('mailbox-watch: missing <agent>')

    const maxMs = Number.parseInt(args['max-ms'] ?? args.maxMs ?? '1800000', 10)
    const forceMode = args.engine ?? null // 'chokidar' | 'fs.watch' | null

    const teamDir = teamDirFor(ws)
    const inboxDir = join(teamDir, 'inbox', agent)
    ensureDir(inboxDir)

    const pidFile = join(teamDir, 'watchers', `${agent}.pid`)
    ensureDir(dirname(pidFile))

    if (existsSync(pidFile)) {
        const oldPid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
        if (Number.isFinite(oldPid) && oldPid !== process.pid) {
            try { process.kill(oldPid) } catch { /* old process already gone */ }
        }
    }
    writeFileSync(pidFile, String(process.pid))

    const wantsChokidar = forceMode === 'chokidar' || forceMode == null
    if (wantsChokidar) {
        const chokidar = await loadChokidar()
        if (chokidar) {
            return watchWithChokidar(chokidar, { inboxDir, pidFile, maxMs, ws })
        }
        if (forceMode === 'chokidar') {
            throw new Error('mailbox-watch: chokidar requested but not installed. Run `team.mjs install-deps`.')
        }
    }

    return watchWithFsWatch({ inboxDir, pidFile, maxMs, ws })
}

async function cmdCheckDeps() {
    const globalRoot = npmGlobalRoot()
    const chokidar = await loadChokidar()
    return {
        ok: true,
        nodeVersion: process.version,
        platform: process.platform,
        npmGlobalRoot: globalRoot,
        chokidar: chokidar
            ? { available: true, version: chokidarVersion(globalRoot) }
            : { available: false, hint: 'run `team.mjs install-deps` to enable chokidar (fs.watch fallback works too)' },
    }
}

function cmdInstallDeps(args) {
    const force = !!args.force
    const globalRoot = npmGlobalRoot()
    if (globalRoot && !force) {
        const pkg = join(globalRoot, 'chokidar', 'package.json')
        if (existsSync(pkg)) {
            const data = readJson(pkg, null)
            return { ok: true, already: true, version: data?.version ?? null, npmGlobalRoot: globalRoot }
        }
    }

    // 通过 shell 调用 npm，跨平台稳定。Node 22+ 的 execFile 不允许直接 spawn .cmd / .bat，
    // 因此这里走 execSync(..., { shell: true })。chokidar 版本不锁，由 npm 决定最新稳定版。
    let stdout
    try {
        stdout = execSync('npm install -g chokidar', { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
    } catch (e) {
        const stderr = e.stderr ? e.stderr.toString() : ''
        throw new Error(`install-deps: npm install -g chokidar failed: ${e.message}\n${stderr}`)
    }

    const root = npmGlobalRoot()
    const version = chokidarVersion(root)
    return {
        ok: true,
        installed: true,
        version,
        npmGlobalRoot: root,
        npmOutputTail: stdout.split('\n').slice(-6).join('\n').trim(),
    }
}

function cmdBlackboardRead(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const section = args._[1]

    const bbDir = join(teamDirFor(ws), 'blackboard')

    if (section) {
        const fileName = section.endsWith('.md') || section.endsWith('.jsonl')
            ? section
            : section === 'decisions' ? 'decisions.jsonl' : `${section}.md`
        const path = join(bbDir, fileName)
        if (!existsSync(path)) return { ok: true, section, content: '' }
        return { ok: true, section, file: toRel(ws, path), content: readTextFile(path) }
    }

    const out = {}
    if (existsSync(bbDir)) {
        for (const f of readdirSync(bbDir)) {
            try { out[f] = readTextFile(join(bbDir, f)) } catch { /* ignore */ }
        }
    }
    return { ok: true, content: out }
}

function cmdBlackboardWrite(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const section = args._[1]
    const caller = args.caller

    if (!section) throw new Error('blackboard-write: missing <section>')
    if (!caller) throw new Error('blackboard-write: --caller <agent> is required')

    let content
    const contentFile = args['content-file'] ?? args.contentFile
    if (contentFile) {
        try {
            content = readTextFile(contentFile)
        } catch (e) {
            throw new Error(`blackboard-write: cannot read --content-file ${contentFile}: ${e.message}`)
        }
    } else {
        content = args._[2]
    }
    if (content === undefined) {
        throw new Error('blackboard-write: missing content (provide <content> argument or --content-file <path>)')
    }

    const config = assertConfig(ws, 'blackboard-write')
    const writers = config.blackboard?.writers ?? [config.leaderName]
    if (!writers.includes(caller)) {
        throw new Error(`blackboard-write: ${caller} is not in writers [${writers.join(',')}]`)
    }

    const bbDir = join(teamDirFor(ws), 'blackboard')
    ensureDir(bbDir)

    if (section === 'decisions') {
        let entry
        try { entry = JSON.parse(content) }
        catch { throw new Error('blackboard-write decisions: content must be valid JSON') }
        entry.recordedAt = entry.recordedAt ?? new Date().toISOString()
        entry.author = entry.author ?? caller
        const line = `${JSON.stringify(entry)}\n`
        const path = join(bbDir, 'decisions.jsonl')
        if (!existsSync(path)) writeFileSync(path, '')
        appendFileSync(path, line)
        return { ok: true, mode: 'append-jsonl', path: toRel(ws, path) }
    }

    const fileName = section.endsWith('.md') || section.endsWith('.jsonl') ? section : `${section}.md`
    const path = join(bbDir, fileName)
    atomicWriteFile(path, content)
    return { ok: true, mode: 'overwrite', path: toRel(ws, path) }
}

function cmdWorktreeCreate(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const subName = args._[1]
    const branch = args._[2]
    if (!subName || !branch) throw new Error('worktree-create: missing <subName> <branch>')

    const config = assertConfig(ws, 'worktree-create')
    const member = config.subs.find((s) => s.name === subName)
    if (!member) throw new Error(`worktree-create: ${subName} not in team`)

    const teamDir = teamDirFor(ws)
    const worktreePath = join(teamDir, 'worktrees', subName)
    ensureDir(dirname(worktreePath))
    if (existsSync(worktreePath)) {
        throw new Error(`worktree-create: ${toRel(ws, worktreePath)} already exists`)
    }

    try {
        execFileSync('git', ['-C', ws, 'worktree', 'add', worktreePath, '-b', branch], { stdio: 'pipe' })
    } catch (e) {
        throw new Error(`worktree-create: git worktree add failed: ${e.message}`)
    }

    member.worktree = toRel(ws, worktreePath)
    member.worktreeBranch = branch
    writeConfig(ws, config)

    return { ok: true, subName, worktree: member.worktree, branch }
}

function cmdWorktreeAssign(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const subName = args._[1]
    const path = args._[2]
    if (!subName || !path) throw new Error('worktree-assign: missing <subName> <path>')
    if (!existsSync(path)) throw new Error(`worktree-assign: path ${path} does not exist`)

    const config = assertConfig(ws, 'worktree-assign')
    const member = config.subs.find((s) => s.name === subName)
    if (!member) throw new Error(`worktree-assign: ${subName} not in team`)

    member.worktree = resolve(path).replaceAll('\\', '/')
    writeConfig(ws, config)

    return { ok: true, subName, worktree: member.worktree }
}

function cmdWorktreeList(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const config = assertConfig(ws, 'worktree-list')

    let gitOut = ''
    try {
        gitOut = execFileSync('git', ['-C', ws, 'worktree', 'list'], { stdio: 'pipe', encoding: 'utf8' })
    } catch (e) {
        gitOut = `(git worktree list failed: ${e.message})`
    }

    const subs = config.subs.map((s) => ({
        name: s.name,
        role: s.role,
        worktree: s.worktree,
        worktreeBranch: s.worktreeBranch ?? null,
    }))
    return { ok: true, subs, gitWorktrees: gitOut.split('\n').filter(Boolean) }
}

function cmdWatcherClaim(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('watcher-claim: missing <agent>')

    const teamDir = teamDirFor(ws)
    const pidFile = join(teamDir, 'watchers', `${agent}.pid`)
    ensureDir(dirname(pidFile))

    let killedOldPid = null
    if (existsSync(pidFile)) {
        const oldPid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
        if (Number.isFinite(oldPid) && oldPid !== process.pid) {
            try { process.kill(oldPid); killedOldPid = oldPid } catch { /* ignore */ }
        }
    }
    writeFileSync(pidFile, String(process.pid))
    return { ok: true, agent, pid: process.pid, killedOldPid }
}

function cmdStatus(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const config = readConfig(ws)
    if (!config) return { ok: false, message: 'team not initialized' }

    const teamDir = teamDirFor(ws)

    function countInbox(agent) {
        const inboxDir = join(teamDir, 'inbox', agent)
        const result = {}
        if (!existsSync(inboxDir)) return result
        let dirs
        try { dirs = readdirSync(inboxDir, { withFileTypes: true }) } catch { return result }
        for (const d of dirs) {
            if (!d.isDirectory() || !d.name.startsWith('from-')) continue
            try {
                const files = readdirSync(join(inboxDir, d.name)).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
                if (files.length > 0) result[d.name] = files.length
            } catch { /* ignore */ }
        }
        return result
    }

    function checkWatcher(agent) {
        const pidFile = join(teamDir, 'watchers', `${agent}.pid`)
        if (!existsSync(pidFile)) return null
        const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
        if (!Number.isFinite(pid)) return null
        try {
            process.kill(pid, 0)
            return { pid, alive: true }
        } catch {
            return { pid, alive: false }
        }
    }

    return {
        ok: true,
        status: {
            teamName: config.teamName,
            teamDir: toRel(ws, teamDir),
            leader: {
                name: config.leaderName,
                inbox: countInbox(config.leaderName),
                watcher: checkWatcher(config.leaderName),
            },
            subs: config.subs.map((s) => ({
                name: s.name,
                role: s.role,
                model: s.model,
                worktree: s.worktree,
                inbox: countInbox(s.name),
                watcher: checkWatcher(s.name),
            })),
            bindings: config.bindings ?? {},
        },
    }
}

/* =========================================================================
 * CLI
 * ========================================================================= */

function parseArgs(argv) {
    const positional = []
    const flags = {}
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i]
        if (v.startsWith('--')) {
            const eqIdx = v.indexOf('=')
            if (eqIdx >= 0) {
                flags[v.slice(2, eqIdx)] = v.slice(eqIdx + 1)
            } else {
                const k = v.slice(2)
                const next = argv[i + 1]
                if (next != null && !next.startsWith('--')) {
                    flags[k] = next
                    i++
                } else {
                    flags[k] = true
                }
            }
        } else {
            positional.push(v)
        }
    }
    return { _: positional, ...flags }
}

const COMMANDS = {
    'ensure-team': cmdEnsureTeam,
    'list-roles': cmdListRoles,
    'add-member': cmdAddMember,
    'generate-leader': cmdGenerateLeader,
    'generate-sub': cmdGenerateSub,
    'generate-stop-hook': cmdGenerateStopHook,
    bind: cmdBind,
    unbind: cmdUnbind,
    'mailbox-send': cmdMailboxSend,
    'mailbox-consume': cmdMailboxConsume,
    'mailbox-watch': cmdMailboxWatch,
    'blackboard-read': cmdBlackboardRead,
    'blackboard-write': cmdBlackboardWrite,
    'worktree-create': cmdWorktreeCreate,
    'worktree-assign': cmdWorktreeAssign,
    'worktree-list': cmdWorktreeList,
    'watcher-claim': cmdWatcherClaim,
    'check-deps': cmdCheckDeps,
    'install-deps': cmdInstallDeps,
    status: cmdStatus,
}

async function main() {
    const argv = process.argv.slice(2)
    const cmd = argv[0]
    if (!cmd || cmd === '-h' || cmd === '--help') {
        const usage = [
            'team.mjs <command> [args...] [--flag value]',
            '',
            'commands:',
            ...Object.keys(COMMANDS).map((c) => `  ${c}`),
        ].join('\n')
        process.stdout.write(`${usage}\n`)
        process.exit(0)
    }
    const handler = COMMANDS[cmd]
    if (!handler) {
        process.stderr.write(`unknown command: ${cmd}\n`)
        process.exit(2)
    }
    const args = parseArgs(argv.slice(1))
    try {
        const result = await handler(args)
        if (result !== undefined) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
        }
    } catch (e) {
        process.stderr.write(`Error: ${e.message}\n`)
        process.exit(1)
    }
}

main()
