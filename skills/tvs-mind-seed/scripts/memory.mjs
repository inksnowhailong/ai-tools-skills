#!/usr/bin/env node
/**
 * memory.mjs — tvs-mind-seed 单 agent 记忆初始化运行时。
 *
 * 用法：
 *   node memory.mjs <command> [args...] [--flag value]
 *
 * 命令：
 *   list-agents <workspace>              列出该项目下已存在记忆的 agents
 *   check <workspace> <agent>            检查该 agent 的记忆是否已初始化
 *   ensure-root <workspace> <agent>      仅创建 memory-raw.md 骨架（index/sources/consolidated 懒创建）
 *   write-identity <workspace> <agent>   --identity <jsonStr> | --identity-file <path>
 *                                        写 identity.json（v2，合并 profile+personality）
 *   write-profile / write-personality    （旧七件套兼容命令，仍可用）
 *   write-active <workspace> <agent> --active <jsonStr>
 *                                        写 memory-active.json（覆盖）
 *   append-raw <workspace> <agent> <markdownBlock>
 *                                        追加块到 memory-raw.md（不覆盖历史）
 *   read <workspace> <agent> [section]   读取记忆（不指定 section 时输出全部摘要）
 *   role-hints <workspace> <agent>       从 team config 读出 agent 的 role 与 memoryHints
 *
 * 精简三件套（v2，HMO-lite 再精简，去掉 mind-state）：
 *   identity.json            静态身份画像（合并了旧 profile + personality），启动只读一次
 *   memory-active.json       当前活跃约束 + ongoingTasks + lastSeenBlackboardHashes，每轮读
 *   memory-raw.md            候选记忆池，待整理
 * 懒创建（当前无自动整理流程，不预建）：memory-index.jsonl / memory-sources.jsonl / memory-consolidated.md
 * 兼容旧七件套：profile.json / personality.json 仍可被探测与读取
 *
 * 所有命令输出 JSON。
 */

import {
    existsSync,
    readFileSync,
    writeFileSync,
    readdirSync,
    appendFileSync,
    mkdirSync,
    renameSync,
} from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { randomBytes } from 'node:crypto'

/* =========================================================================
 * Path helpers
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

/**
 * 目标 IDE：'cursor' | 'claude'。在 main() 里解析一次后，teamDirFor 据它给出
 * .cursor/.team 或 .claude/.team。必须和 tvs-team-spawn 的落盘目录一致，
 * 否则 mind-seed 写的记忆会和团队 skill 读的位置对不上。
 */
let TARGET = 'cursor'

function ideTeamDir(target) {
    return target === 'claude' ? ['.claude', '.team'] : ['.cursor', '.team']
}

/** 探测已部署的 target：团队 config 或已有 memory 目录在哪个 IDE 下。 */
function detectTarget(ws) {
    if (existsSync(join(ws, '.claude', '.team', 'config.json'))) return 'claude'
    if (existsSync(join(ws, '.cursor', '.team', 'config.json'))) return 'cursor'
    // standalone：没团队配置时看已有的 memory 目录
    if (existsSync(join(ws, '.claude', '.team', 'memory'))) return 'claude'
    if (existsSync(join(ws, '.cursor', '.team', 'memory'))) return 'cursor'
    return null
}

/** 解析 target：显式 --target 优先，其次探测，最后回退 cursor（兼容老部署）。 */
function resolveTarget(args, ws) {
    if (args.target === 'claude' || args.target === 'cursor') return args.target
    return detectTarget(ws) ?? 'cursor'
}

function teamDirFor(ws) {
    return join(ws, ...ideTeamDir(TARGET))
}

function memoryRoot(ws) {
    return join(teamDirFor(ws), 'memory')
}

function memoryDir(ws, agent) {
    return join(memoryRoot(ws), agent)
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
 * Memory file layout
 * ========================================================================= */

const FILE_LAYOUT = {
    // 精简三件套（v2 默认）：identity 合并了旧的 profile + personality
    identity: 'identity.json',
    active: 'memory-active.json',
    raw: 'memory-raw.md',
    // 兼容旧七件套（仍可被读取/探测；不再自动创建）
    profile: 'profile.json',
    personality: 'personality.json',
    index: 'memory-index.jsonl',
    sources: 'memory-sources.jsonl',
    consolidated: 'memory-consolidated.md',
}

function fileFor(ws, agent, key) {
    return join(memoryDir(ws, agent), FILE_LAYOUT[key])
}

/* =========================================================================
 * Default markdown skeletons
 *
 * 这两个 md 在 ensure-root 时就写入默认骨架；JSON 文件（profile/personality/
 * active）由 tvs-mind-seed SKILL 在对话引导后通过 write-* 命令传入完整内容，
 * 不在 ensure-root 阶段创建。
 * ========================================================================= */

function defaultRawMd(agent) {
    return [
        `# ${agent} · 候选记忆池（memory-raw.md）`,
        '',
        '> 由 agent 自己或 leader 在工作中追加。后续由整理流程或用户手动晋升到 memory-active / memory-index / memory-consolidated。',
        '',
        '## 写入格式',
        '',
        '```markdown',
        '## YYYY-MM-DD HH:mm',
        '- [pattern] ...',
        '- [anti-pattern] ...',
        '- [convention] ...',
        '- [feedback] ...',
        '- [boundary] ...',
        '- [decision] ...',
        '- [risk] ...',
        '```',
        '',
        '## 记忆区',
        '',
    ].join('\n')
}

function defaultConsolidatedMd(agent) {
    return [
        `# ${agent} · 长期摘要（memory-consolidated.md）`,
        '',
        '> 由整理流程从 memory-raw / memory-index / memory-sources 提炼得来，给人类阅读和后续 agent 启动时快速 onboarding 用。',
        '',
        '## 当前还没有摘要',
        '',
        '可以等 memory-raw 积累一段时间后再做整理。',
        '',
    ].join('\n')
}

/* =========================================================================
 * Team config (optional)
 * ========================================================================= */

function readTeamConfig(ws) {
    return readJson(join(teamDirFor(ws), 'config.json'), null)
}

function lookupAgentRoleId(config, agent) {
    if (!config) return null
    if (config.leaderName === agent) return null
    const member = config.subs?.find((s) => s.name === agent)
    return member?.role ?? null
}

/* =========================================================================
 * Commands
 * ========================================================================= */

function cmdListAgents(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const root = memoryRoot(ws)
    if (!existsSync(root)) return { ok: true, agents: [] }
    let entries
    try {
        entries = readdirSync(root, { withFileTypes: true })
    } catch {
        return { ok: true, agents: [] }
    }
    const agents = []
    for (const e of entries) {
        if (!e.isDirectory()) continue
        const dir = join(root, e.name)
        agents.push({
            name: e.name,
            path: toRel(ws, dir),
            hasIdentity: existsSync(join(dir, FILE_LAYOUT.identity)),
            hasActive: existsSync(join(dir, FILE_LAYOUT.active)),
            hasRaw: existsSync(join(dir, FILE_LAYOUT.raw)),
            // 兼容旧七件套部署
            hasProfile: existsSync(join(dir, FILE_LAYOUT.profile)),
            hasPersonality: existsSync(join(dir, FILE_LAYOUT.personality)),
        })
    }
    return { ok: true, agents }
}

function cmdCheck(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('check: missing <agent>')
    const dir = memoryDir(ws, agent)
    const result = {
        ok: true,
        agent,
        path: toRel(ws, dir),
        exists: existsSync(dir),
        files: {},
    }
    for (const [k, name] of Object.entries(FILE_LAYOUT)) {
        result.files[k] = existsSync(join(dir, name))
    }
    return result
}

function cmdEnsureRoot(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('ensure-root: missing <agent>')

    const dir = memoryDir(ws, agent)
    ensureDir(dir)

    const created = []

    const ensureEmpty = (key, fallback) => {
        const path = fileFor(ws, agent, key)
        if (existsSync(path)) return
        atomicWriteFile(path, fallback)
        created.push(toRel(ws, path))
    }

    // 精简三件套：ensure-root 只建 raw 候选池骨架。
    // identity / active 由 mind-seed 引导后用 write-identity / write-active 写入。
    // index / sources / consolidated 改为"懒创建"——当前没有自动整理流程，不再预先铺空骨架（省得每次都摄入空文件）。
    ensureEmpty('raw', defaultRawMd(agent))

    return { ok: true, agent, dir: toRel(ws, dir), created }
}

function cmdRoleHints(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('role-hints: missing <agent>')

    const config = readTeamConfig(ws)
    if (!config) {
        return {
            ok: true,
            agent,
            inTeam: false,
            note: 'no team config; this agent is standalone or team not initialized',
        }
    }

    const isLeader = config.leaderName === agent
    const member = config.subs?.find((s) => s.name === agent) ?? null
    if (!isLeader && !member) {
        return {
            ok: true,
            agent,
            inTeam: false,
            note: `agent ${agent} not found in team config; you can still initialize standalone memory`,
        }
    }

    if (isLeader) {
        return {
            ok: true,
            agent,
            inTeam: true,
            kind: 'leader',
            teamName: config.teamName,
            subs: config.subs?.map((s) => ({ name: s.name, role: s.role })) ?? [],
        }
    }

    return {
        ok: true,
        agent,
        inTeam: true,
        kind: 'sub',
        teamName: config.teamName,
        role: member.role,
        roleDisplayName: member.roleDisplayName,
        model: member.model,
    }
}

function readJsonInputArg(args, primaryFlag, fileFlag, label) {
    const fileVal = args[fileFlag] ?? args[`${fileFlag.replace('-file', 'File')}`]
    if (fileVal) {
        try {
            return readTextFile(fileVal)
        } catch (e) {
            throw new Error(`${label}: cannot read --${fileFlag} ${fileVal}: ${e.message}`)
        }
    }
    return args[primaryFlag] ?? null
}

function cmdWriteProfile(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('write-profile: missing <agent>')
    const profileStr = readJsonInputArg(args, 'profile', 'profile-file', 'write-profile')
    if (!profileStr) throw new Error('write-profile: --profile <jsonStr> or --profile-file <path> is required')

    let profile
    try {
        profile = JSON.parse(profileStr)
    } catch (e) {
        throw new Error(`write-profile: profile is not valid JSON: ${e.message}`)
    }

    const dir = memoryDir(ws, agent)
    ensureDir(dir)

    profile.schemaVersion = profile.schemaVersion ?? 1
    profile.agent = agent
    profile.updatedAt = new Date().toISOString()
    if (!profile.createdAt) profile.createdAt = profile.updatedAt

    const path = fileFor(ws, agent, 'profile')
    writeJsonAtomic(path, profile)

    return { ok: true, agent, path: toRel(ws, path) }
}

function cmdWritePersonality(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('write-personality: missing <agent>')
    const personalityStr = readJsonInputArg(args, 'personality', 'personality-file', 'write-personality')
    if (!personalityStr) throw new Error('write-personality: --personality <jsonStr> or --personality-file <path> is required')

    let personality
    try {
        personality = JSON.parse(personalityStr)
    } catch (e) {
        throw new Error(`write-personality: personality is not valid JSON: ${e.message}`)
    }

    const dir = memoryDir(ws, agent)
    ensureDir(dir)

    personality.schemaVersion = personality.schemaVersion ?? 1
    personality.agent = agent
    personality.updatedAt = new Date().toISOString()
    if (!personality.createdAt) personality.createdAt = personality.updatedAt

    const path = fileFor(ws, agent, 'personality')
    writeJsonAtomic(path, personality)

    return { ok: true, agent, path: toRel(ws, path) }
}

/**
 * 写 identity.json（v2 精简三件套）——合并了旧 profile + personality。
 * 字段建议：codename / role / roleDisplayName / positioning / focus[] / outOfScope[]
 *           / communicationStyle / tone / boundaries[] / traits[] / catchphrase / quirks / roleSeed / notes
 * 启动时只读它 + memory-active 两个文件即可恢复身份与硬约束。
 */
function cmdWriteIdentity(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('write-identity: missing <agent>')
    const identityStr = readJsonInputArg(args, 'identity', 'identity-file', 'write-identity')
    if (!identityStr) throw new Error('write-identity: --identity <jsonStr> or --identity-file <path> is required')

    let identity
    try {
        identity = JSON.parse(identityStr)
    } catch (e) {
        throw new Error(`write-identity: identity is not valid JSON: ${e.message}`)
    }

    const dir = memoryDir(ws, agent)
    ensureDir(dir)

    identity.schemaVersion = identity.schemaVersion ?? 2
    identity.agent = agent
    identity.updatedAt = new Date().toISOString()
    if (!identity.createdAt) identity.createdAt = identity.updatedAt

    const path = fileFor(ws, agent, 'identity')
    writeJsonAtomic(path, identity)

    return { ok: true, agent, path: toRel(ws, path) }
}

function cmdWriteActive(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('write-active: missing <agent>')
    const activeStr = readJsonInputArg(args, 'active', 'active-file', 'write-active')
    if (!activeStr) throw new Error('write-active: --active <jsonStr> or --active-file <path> is required')

    let active
    try {
        active = JSON.parse(activeStr)
    } catch (e) {
        throw new Error(`write-active: active is not valid JSON: ${e.message}`)
    }

    const dir = memoryDir(ws, agent)
    ensureDir(dir)

    active.schemaVersion = active.schemaVersion ?? 1
    active.agent = agent
    active.updatedAt = new Date().toISOString()

    const path = fileFor(ws, agent, 'active')
    writeJsonAtomic(path, active)

    return { ok: true, agent, path: toRel(ws, path) }
}

function cmdAppendRaw(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    const block = args._[2]
    if (!agent) throw new Error('append-raw: missing <agent>')
    if (block === undefined) throw new Error('append-raw: missing <markdownBlock>')

    const path = fileFor(ws, agent, 'raw')
    ensureDir(dirname(path))
    if (!existsSync(path)) writeFileSync(path, defaultRawMd(agent))

    const content = block.endsWith('\n') ? block : `${block}\n`
    appendFileSync(path, content)

    return { ok: true, agent, path: toRel(ws, path) }
}

function cmdRead(args) {
    const ws = normalizeWorkspace(args._[0] ?? process.cwd())
    const agent = args._[1]
    if (!agent) throw new Error('read: missing <agent>')
    const section = args._[2]

    const dir = memoryDir(ws, agent)
    if (!existsSync(dir)) return { ok: true, agent, exists: false, content: null }

    if (section) {
        const key = section.replace(/^memory-/, '').replace(/\.(json|jsonl|md)$/, '')
        const layoutKey = Object.keys(FILE_LAYOUT).find((k) => k === key || k === section) ?? key
        const fileName = FILE_LAYOUT[layoutKey] ?? section
        const path = join(dir, fileName)
        if (!existsSync(path)) return { ok: true, agent, section, exists: false }
        return {
            ok: true,
            agent,
            section,
            file: toRel(ws, path),
            content: readTextFile(path),
        }
    }

    const out = {}
    for (const [key, name] of Object.entries(FILE_LAYOUT)) {
        const path = join(dir, name)
        if (existsSync(path)) {
            try { out[key] = readTextFile(path) } catch { /* ignore */ }
        }
    }
    return { ok: true, agent, exists: true, content: out }
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
    'list-agents': cmdListAgents,
    check: cmdCheck,
    'ensure-root': cmdEnsureRoot,
    'role-hints': cmdRoleHints,
    'write-identity': cmdWriteIdentity,
    'write-profile': cmdWriteProfile,
    'write-personality': cmdWritePersonality,
    'write-active': cmdWriteActive,
    'append-raw': cmdAppendRaw,
    read: cmdRead,
}

function main() {
    const argv = process.argv.slice(2)
    const cmd = argv[0]
    if (!cmd || cmd === '-h' || cmd === '--help') {
        const usage = [
            'memory.mjs <command> [args...] [--flag value]',
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
    // target 在分发前解析一次：显式 --target 优先，否则探测已部署目录，回退 cursor
    TARGET = resolveTarget(args, normalizeWorkspace(args._[0] ?? process.cwd()))
    try {
        const result = handler(args)
        if (result !== undefined) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
        }
    } catch (e) {
        process.stderr.write(`Error: ${e.message}\n`)
        process.exit(1)
    }
}

main()
