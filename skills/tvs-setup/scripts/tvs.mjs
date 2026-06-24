#!/usr/bin/env node
/**
 * tvs.mjs —— AIConfig 统一安装/体检 runtime（零依赖）
 *
 * 设计原则：确定性动作（检测/复制/链接/校验）全在脚本里，AI（tvs-setup skill）
 * 只负责解读 JSON 输出、给建议、向用户要确认。
 *
 * 位置：skills/tvs-setup/scripts/tvs.mjs（随 skill 分发；软链安装时 Node 自动解析真实路径，
 * 因此 import.meta.url 始终指向仓库内，可向上定位仓库根。拷贝安装时无法定位，报错引导）。
 *
 * 命令：
 *   node "<skill-path>/scripts/tvs.mjs" detect           检测宿主 / skill 安装状态 / 第三方生态
 *   node "<skill-path>/scripts/tvs.mjs" install [--target claude,cursor] [--mode link|copy] [--only a,b] [--force] [--prune]
 *   node "<skill-path>/scripts/tvs.mjs" doctor [--fix]   体检：漂移 / 死引用 / frontmatter / 孤儿 / 断链
 *   node "<skill-path>/scripts/tvs.mjs" update [--pull]  检查远程是否有新版本；--pull 拉取（仅 ff，脏仓库拒绝）
 *
 * 输出：统一 JSON（stdout），含 summary 数组（人读摘要行）。
 */

import { execSync } from 'node:child_process'
import {
    existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
    readlinkSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, cpSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
// skills/tvs-setup/scripts → 向上三级 = 仓库根
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..')
const SKILLS_DIR = join(REPO_ROOT, 'skills')
/** 复制/哈希时排除的目录与文件（运行期状态，不属于 skill 本体） */
const EXCLUDES = new Set(['.omc', '.git', 'node_modules', '.DS_Store'])

// ---------- 基础工具 ----------

const norm = (p) => p.replace(/\\/g, '/')

function listRepoSkills() {
    return readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(SKILLS_DIR, d.name, 'SKILL.md')))
        .map((d) => d.name)
}

/** 宿主定义：skill 安装目录按宿主区分；Codex 无同构 skills 目录，不在安装范围 */
function hosts() {
    const home = homedir()
    const def = {
        claude: { root: join(home, '.claude'), skillsDir: join(home, '.claude', 'skills') },
        cursor: { root: join(home, '.cursor'), skillsDir: join(home, '.cursor', 'skills') },
    }
    for (const h of Object.values(def)) h.exists = existsSync(h.root)
    return def
}

/** 递归收集目录内文件相对路径 → sha1，跳过 EXCLUDES */
function hashDir(dir) {
    const map = {}
    const walk = (cur, rel) => {
        for (const entry of readdirSync(cur, { withFileTypes: true })) {
            if (EXCLUDES.has(entry.name)) continue
            const full = join(cur, entry.name)
            const r = rel ? `${rel}/${entry.name}` : entry.name
            if (entry.isDirectory()) walk(full, r)
            else if (entry.isFile()) {
                map[r] = createHash('sha1').update(readFileSync(full)).digest('hex')
            }
        }
    }
    walk(dir, '')
    return map
}

/** 判断已安装目录相对仓库的状态 */
function installState(repoSkillDir, installedPath) {
    if (!existsSync(installedPath)) {
        // lstat 区分"目标丢失的断链"与"完全不存在"
        try {
            if (lstatSync(installedPath).isSymbolicLink()) return { state: 'broken-link' }
        } catch { /* 不存在 */ }
        return { state: 'missing' }
    }
    const st = lstatSync(installedPath)
    if (st.isSymbolicLink()) {
        let target = ''
        try { target = resolve(readlinkSync(installedPath)) } catch { /* ignore */ }
        if (!existsSync(target)) return { state: 'broken-link', target: norm(target) }
        return norm(target) === norm(resolve(repoSkillDir))
            ? { state: 'linked' }
            : { state: 'linked-elsewhere', target: norm(target) }
    }
    // 实体拷贝：哈希比对判断是否漂移
    const a = hashDir(repoSkillDir)
    const b = hashDir(installedPath)
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    const diff = [...keys].filter((k) => a[k] !== b[k])
    return diff.length === 0 ? { state: 'copy-synced' } : { state: 'copy-drift', diffFiles: diff.slice(0, 20) }
}

/** 删除已安装项：链接只摘链不进目标，目录整删 */
function removeInstalled(p) {
    const st = lstatSync(p)
    if (st.isSymbolicLink()) {
        try { unlinkSync(p) } catch { rmdirSync(p) } // Windows 目录 junction 需 rmdir
    } else {
        rmSync(p, { recursive: true, force: true })
    }
}

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim()
    } catch { return null }
}

// ---------- 第三方生态探测 ----------

/** 扫 ~/.claude/plugins/cache/<marketplace>/<plugin>/ 两层找插件名 */
function pluginInstalled(name) {
    const cache = join(homedir(), '.claude', 'plugins', 'cache')
    if (!existsSync(cache)) return false
    try {
        for (const m of readdirSync(cache, { withFileTypes: true })) {
            if (!m.isDirectory()) continue
            if (m.name.includes(name)) return true
            for (const p of readdirSync(join(cache, m.name), { withFileTypes: true })) {
                if (p.isDirectory() && p.name.includes(name)) return true
            }
        }
    } catch { /* ignore */ }
    return false
}

function detectThirdParty() {
    return {
        node: run('node --version'),
        codegraph: {
            installed: !!run('codegraph --version'),
            hint: 'npx @colbymchenry/codegraph（官方安装器，自动配置当前工具的 MCP 与指令文件），再 codegraph init -i 建项目索引',
            why: '结构知识图谱：符号定义/调用链/影响面秒级查询，tvs-analyze 等会自动用它增强，缺失时降级原生搜索',
        },
        omc: {
            installed: pluginInstalled('oh-my-claudecode') || !!run('omc --version'),
            hint: 'npm i -g oh-my-claudecode && omc setup',
            why: '并行编排/自治循环/专业 agent 池（autopilot、ultrawork、team 等），tvs 不做这类重编排能力',
        },
        superpowers: {
            installed: pluginInstalled('superpowers'),
            hint: 'Claude Code 内 /plugin → 添加 marketplace obra/superpowers-marketplace → 安装 superpowers',
            why: 'TDD/系统化调试/计划执行等工程纪律工作流，与 tvs 的中文项目工作流互补',
        },
    }
}

// ---------- HUD 接管（仅 claude 宿主）----------
//
// tvs-hud 要出现在 Claude Code 状态栏，依赖一条三点链路：
//   1. ~/.claude/hud/combined-status.mjs 桥接文件存在（由仓库部署）
//   2. settings.json → statusLine.command 指向该桥接文件
//   3. 命令末尾带 --omc-hud（让 OMC 自检 includes("omc-hud") 通过，否则 OMC HUD 退化成诊断文字）
// 任一断裂，tvs 三行不显示或 OMC HUD 异常。/oh-my-claudecode:hud setup 会把 statusLine 改回纯 omc，复发本问题。

const HUD_BRIDGE = 'combined-status.mjs'
const repoHudBridge = () => join(SKILLS_DIR, 'tvs-hud', 'hud', HUD_BRIDGE)
const installedHudBridge = () => join(homedir(), '.claude', 'hud', HUD_BRIDGE)
const settingsPath = () => join(homedir(), '.claude', 'settings.json')

/** 检测 HUD 接管链路三点状态；claude 宿主缺失时返回 skipped */
function checkHud() {
    if (!existsSync(join(homedir(), '.claude'))) return { skipped: true }
    const repoBridge = repoHudBridge()
    const instBridge = installedHudBridge()
    const r = {
        repoBridgePresent: existsSync(repoBridge),
        bridgeInstalled: existsSync(instBridge),
        bridgeSynced: false,
        statusLineWired: false,
        omcHudFlag: false,
        command: null,
        issues: [],
    }
    if (r.repoBridgePresent && r.bridgeInstalled) {
        r.bridgeSynced = readFileSync(repoBridge, 'utf8') === readFileSync(instBridge, 'utf8')
    }
    const sp = settingsPath()
    if (existsSync(sp)) {
        try {
            const cmd = JSON.parse(readFileSync(sp, 'utf8'))?.statusLine?.command ?? null
            r.command = cmd
            if (cmd) {
                r.statusLineWired = cmd.includes(HUD_BRIDGE)
                r.omcHudFlag = cmd.includes('--omc-hud')
            }
        } catch { /* settings.json 解析失败，下面 issue 兜底 */ }
    }
    // 仓库没有桥接源 → 质量问题，脚本不自动修
    if (!r.repoBridgePresent) { r.issues.push('hud-bridge-missing-in-repo'); return r }
    if (!r.bridgeInstalled) r.issues.push('hud-bridge-not-installed')
    else if (!r.bridgeSynced) r.issues.push('hud-bridge-drift')
    if (!r.statusLineWired) r.issues.push('statusline-not-wired')
    else if (!r.omcHudFlag) r.issues.push('statusline-missing-omc-hud-flag')
    return r
}

/** 一句话状态标签 */
function hudLabel(hud) {
    if (hud.skipped) return '未检测到 claude 宿主（跳过）'
    if (hud.issues.length === 0) return '✅ 已接管（combined-status + --omc-hud）'
    return '⚠️ ' + hud.issues.join(', ')
}

/** 部署桥接文件 仓库 → ~/.claude/hud/（始终拷贝，独立于 skill 软链，卸载 tvs-hud 不影响状态栏） */
function deployHudBridge() {
    const repoBridge = repoHudBridge()
    if (!existsSync(repoBridge)) return { ok: false, reason: '仓库缺少 hud/combined-status.mjs 源文件' }
    const dest = installedHudBridge()
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(repoBridge, dest)
    return { ok: true, dest: norm(dest) }
}

/** 改写 settings.json：仅触碰 statusLine.command 一个键，其余原样保序回写，不备份 */
function wireStatusLine() {
    const sp = settingsPath()
    let cfg = {}
    if (existsSync(sp)) {
        try { cfg = JSON.parse(readFileSync(sp, 'utf8')) }
        catch (e) { return { ok: false, reason: `settings.json 解析失败（${e.message}），拒绝改写以免破坏配置` } }
    }
    const bridge = norm(installedHudBridge())
    // 沿用现有命令里的 node 可执行（首 token）——仅当它确实像 node 时；否则回退当前 node，
    // 避免把非 node 的首 token（脏数据/其他命令）误当解释器传下去。
    const firstTok = cfg.statusLine?.command?.match(/^("[^"]+"|\S+)/)?.[1] || ''
    const looksLikeNode = /node(\.exe)?"?$/i.test(firstTok)
    const nodeExe = looksLikeNode ? firstTok : `"${process.execPath}"`
    const newCmd = `${nodeExe} "${bridge}" --omc-hud`
    if (!cfg.statusLine) cfg.statusLine = { type: 'command' }
    if (cfg.statusLine.command === newCmd) return { ok: true, changed: false, command: newCmd }
    cfg.statusLine.type = cfg.statusLine.type || 'command'
    cfg.statusLine.command = newCmd
    writeFileSync(sp, JSON.stringify(cfg, null, 2) + '\n')
    return { ok: true, changed: true, command: newCmd }
}

/** 修复 HUD 链路：部署桥接 + 接管 statusLine。返回动作摘要数组 */
function fixHud() {
    const fixes = []
    const d = deployHudBridge()
    if (!d.ok) return { fixes: [`❌ HUD 桥接部署失败：${d.reason}`], ok: false }
    fixes.push(`已部署桥接文件 → ${d.dest}`)
    const w = wireStatusLine()
    if (!w.ok) { fixes.push(`❌ statusLine 接管失败：${w.reason}`); return { fixes, ok: false } }
    fixes.push(w.changed ? `已接管 statusLine.command → ${HUD_BRIDGE} --omc-hud` : 'statusLine 已是期望值，无需改动')
    fixes.push('提示：状态栏下次刷新生效；若日后跑了 /oh-my-claudecode:hud setup 被改回，再 doctor --fix 即可')
    return { fixes, ok: true }
}

// ---------- 仓库版本检查 ----------

/** 仓库相对远程上游的版本状态；doFetch 时先 fetch，网络不可用则降级为本地缓存比较 */
function repoStatus(doFetch = true) {
    const git = (args) => run(`git -C "${REPO_ROOT}" ${args}`)
    if (git('rev-parse --is-inside-work-tree') !== 'true') return { isGitRepo: false }
    const branch = git('rev-parse --abbrev-ref HEAD')
    const dirty = (git('status --porcelain') || '') !== ''
    // fetch 成功返回空串（非 null）；失败（无网/无权限）返回 null
    const fetchOk = doFetch ? git('fetch --quiet') !== null : null
    const upstream = git('rev-parse --abbrev-ref --symbolic-full-name @{u}')
    if (!upstream) {
        return { isGitRepo: true, branch, dirty, upstream: null, note: '未配置上游分支（detached HEAD 或本地分支无 tracking），无法比较版本' }
    }
    const count = (range) => Number.parseInt(git(`rev-list --count ${range}`) ?? '0', 10) || 0
    const behind = count(`HEAD..${upstream}`)
    const ahead = count(`${upstream}..HEAD`)
    // 落后时给出最近 10 条新提交，供"是否更新"的决策参考
    const newCommits = behind > 0
        ? (git(`log --oneline -10 HEAD..${upstream}`) || '').split('\n').filter(Boolean)
        : []
    return { isGitRepo: true, branch, upstream, dirty, fetchOk, behind, ahead, newCommits }
}

/** update：检查新版本；--pull 时执行更新（仅 fast-forward，脏仓库拒绝） */
function update(args) {
    const repo = repoStatus(true)
    const summary = []
    if (!repo.isGitRepo) return { repo, summary: ['AIConfig 不是 git 仓库，无法检查更新'] }
    if (repo.note) summary.push(`⚠️ ${repo.note}`)
    else if (repo.fetchOk === false) summary.push('⚠️ 无法连接远程（网络/权限），以下为本地缓存的比较结果')

    if (repo.behind === 0) {
        summary.push('✅ 已是最新版本' + (repo.ahead > 0 ? `（本地领先远程 ${repo.ahead} 个提交，记得 push）` : ''))
    } else {
        summary.push(`⬆️ 发现新版本：落后远程 ${repo.behind} 个提交`)
        summary.push(...repo.newCommits.map((c) => `  ${c}`))
    }

    let pulled = false
    if (args.pull && repo.behind > 0) {
        if (repo.dirty) {
            summary.push('❌ 仓库有未提交的本地修改，拒绝自动 pull——请先提交/暂存后重试')
        } else {
            const res = run(`git -C "${REPO_ROOT}" pull --ff-only`)
            if (res === null) summary.push('❌ pull 失败（可能与远程分叉），请手动处理')
            else {
                pulled = true
                summary.push('✅ 已更新到最新。软链安装的 skill 即时生效；若有拷贝安装的宿主，再跑 doctor --fix 同步')
            }
        }
    }
    return { repo, pulled, summary }
}

// ---------- detect ----------

function detect() {
    const H = hosts()
    const skills = {}
    const orphans = {}
    const repoSkills = listRepoSkills()

    for (const [hostName, h] of Object.entries(H)) {
        orphans[hostName] = []
        if (!h.exists) continue
        // 孤儿：安装目录里有 tvs- 前缀、但仓库已删除的 skill（只认 tvs- 前缀，避免误报用户自己的 skill）
        if (existsSync(h.skillsDir)) {
            for (const d of readdirSync(h.skillsDir, { withFileTypes: true })) {
                if (d.name.startsWith('tvs-') && !repoSkills.includes(d.name)) orphans[hostName].push(d.name)
            }
        }
    }
    for (const s of repoSkills) {
        skills[s] = {}
        for (const [hostName, h] of Object.entries(H)) {
            if (!h.exists) { skills[s][hostName] = { state: 'host-absent' }; continue }
            skills[s][hostName] = installState(join(SKILLS_DIR, s), join(h.skillsDir, s))
        }
    }

    const thirdParty = detectThirdParty()
    const hud = checkHud()
    const repo = repoStatus(true)
    const summary = []
    for (const [hostName, h] of Object.entries(H)) {
        if (!h.exists) { summary.push(`宿主 ${hostName}: 未检测到（跳过）`); continue }
        const counts = {}
        for (const s of repoSkills) {
            const st = skills[s][hostName].state
            counts[st] = (counts[st] || 0) + 1
        }
        summary.push(`宿主 ${hostName}: ` + Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(' '))
        if (orphans[hostName].length) summary.push(`宿主 ${hostName} 孤儿目录（仓库已删但本机还在）: ${orphans[hostName].join(', ')}`)
    }
    for (const [k, v] of Object.entries(thirdParty)) {
        if (k === 'node') continue
        summary.push(`${k}: ${v.installed ? '✅ 已就绪' : '⬜ 未安装（可增强）'}`)
    }
    summary.push(`HUD 接管(claude): ${hudLabel(hud)}`)
    if (repo.isGitRepo) {
        if (repo.note) summary.push(`仓库版本: ⚠️ ${repo.note}`)
        else if (repo.behind > 0) summary.push(`仓库版本: ⬆️ 落后远程 ${repo.behind} 个提交（用户确认后可 update --pull 更新）`)
        else summary.push('仓库版本: ✅ 已是最新' + (repo.fetchOk === false ? '（远程不可达，本地缓存比较）' : ''))
    }

    return { repoRoot: norm(REPO_ROOT), hosts: H, skills, orphans, thirdParty, hud, repo, summary }
}

// ---------- install ----------

function install(args) {
    const H = hosts()
    const targets = (args.target ? args.target.split(',') : Object.keys(H).filter((k) => H[k].exists))
        .filter((t) => H[t])
    const mode = args.mode || 'link'
    const only = args.only ? args.only.split(',') : null
    const repoSkills = listRepoSkills().filter((s) => !only || only.includes(s))
    const actions = []
    const skipped = []

    for (const t of targets) {
        const h = H[t]
        mkdirSync(h.skillsDir, { recursive: true })
        for (const s of repoSkills) {
            const src = join(SKILLS_DIR, s)
            const dst = join(h.skillsDir, s)
            const cur = installState(src, dst)
            // 已是期望状态则跳过
            if (mode === 'link' && cur.state === 'linked') { skipped.push(`${t}/${s} 已是软链`); continue }
            if (mode === 'copy' && cur.state === 'copy-synced') { skipped.push(`${t}/${s} 拷贝已同步`); continue }
            // 本机拷贝有漂移：可能含用户本地修改，没 --force 不动它
            if (cur.state === 'copy-drift' && !args.force) {
                skipped.push(`${t}/${s} 拷贝有漂移（可能含本地修改），需 --force 才覆盖`)
                continue
            }
            if (cur.state !== 'missing') removeInstalled(dst)
            if (mode === 'link') {
                // Windows 用 junction（目录级、无需管理员），POSIX 自动退化为目录 symlink
                symlinkSync(resolve(src), dst, 'junction')
                actions.push(`${t}/${s} → 软链`)
            } else {
                cpSync(src, dst, { recursive: true, filter: (p) => !EXCLUDES.has(basename(p)) })
                actions.push(`${t}/${s} → 拷贝`)
            }
        }
        // --prune：清掉孤儿（仅 tvs- 前缀）
        if (args.prune && existsSync(h.skillsDir)) {
            for (const d of readdirSync(h.skillsDir, { withFileTypes: true })) {
                if (d.name.startsWith('tvs-') && !listRepoSkills().includes(d.name)) {
                    removeInstalled(join(h.skillsDir, d.name))
                    actions.push(`${t}/${d.name} 孤儿目录已清除`)
                }
            }
        }
    }
    // 装了 tvs-hud 且目标含 claude → 自动接管状态栏（部署桥接 + 改 statusLine），否则 tvs-hud 装了也不显示
    const hudActions = []
    if (targets.includes('claude') && repoSkills.includes('tvs-hud')) {
        const r = fixHud()
        hudActions.push(...r.fixes)
    }
    return {
        mode, targets, actions, skipped, hudActions,
        summary: [`安装完成：${actions.length} 项动作，${skipped.length} 项跳过`, ...actions, ...skipped, ...hudActions],
    }
}

// ---------- doctor ----------

/** 扫描 SKILL.md 中引用的 .mjs 脚本路径是否存在（死引用检测） */
function checkScriptRefs(skillName) {
    const dir = join(SKILLS_DIR, skillName)
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
    const issues = []
    const re = /node\s+["']?([^\s"')]+\.mjs)/g
    for (const m of text.matchAll(re)) {
        let p = m[1]
            .replace(/<skill-path>/g, dir)
            .replace(/\{SKILL_DIR\}/g, dir)
        // 项目运行期路径（部署产物）不在仓库内，跳过
        if (/^\.?(\.\/)?(\.cursor|\.claude|\.codex|<宿主)/.test(p) || p.includes('宿主')) continue
        if (!existsSync(p) && !existsSync(join(dir, p))) {
            issues.push({ kind: 'dead-script-ref', skill: skillName, ref: m[1] })
        }
    }
    return issues
}

/** frontmatter lint：name 与目录一致、description 存在 */
function checkFrontmatter(skillName) {
    const text = readFileSync(join(SKILLS_DIR, skillName, 'SKILL.md'), 'utf8')
    const issues = []
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!fm) return [{ kind: 'frontmatter-missing', skill: skillName }]
    const name = fm[1].match(/^name:\s*(\S+)/m)?.[1]
    if (name !== skillName) issues.push({ kind: 'frontmatter-name-mismatch', skill: skillName, found: name || null })
    if (!/^description:\s*\S/m.test(fm[1])) issues.push({ kind: 'frontmatter-no-description', skill: skillName })
    return issues
}

/** README 同步：仓库 skill 是否都出现在 README 里 */
function checkReadme(repoSkills) {
    const readmePath = join(REPO_ROOT, 'README.md')
    if (!existsSync(readmePath)) return []
    const text = readFileSync(readmePath, 'utf8')
    return repoSkills.filter((s) => !text.includes(s)).map((s) => ({ kind: 'readme-missing-skill', skill: s }))
}

function doctor(args) {
    const det = detect()
    const repoSkills = listRepoSkills()
    const issues = []
    const fixes = []

    for (const s of repoSkills) {
        issues.push(...checkScriptRefs(s))
        issues.push(...checkFrontmatter(s))
        for (const [hostName, info] of Object.entries(det.skills[s])) {
            if (info.state === 'copy-drift') {
                issues.push({ kind: 'copy-drift', skill: s, host: hostName, diffFiles: info.diffFiles })
                if (args.fix) {
                    const h = hosts()[hostName]
                    rmSync(join(h.skillsDir, s), { recursive: true, force: true })
                    cpSync(join(SKILLS_DIR, s), join(h.skillsDir, s), { recursive: true, filter: (p) => !EXCLUDES.has(basename(p)) })
                    fixes.push(`已同步 ${hostName}/${s}（仓库 → 本机拷贝）`)
                }
            }
            if (info.state === 'broken-link') {
                issues.push({ kind: 'broken-link', skill: s, host: hostName })
                if (args.fix) {
                    const h = hosts()[hostName]
                    removeInstalled(join(h.skillsDir, s))
                    symlinkSync(resolve(join(SKILLS_DIR, s)), join(h.skillsDir, s), 'junction')
                    fixes.push(`已重建 ${hostName}/${s} 软链`)
                }
            }
            if (info.state === 'linked-elsewhere') issues.push({ kind: 'linked-elsewhere', skill: s, host: hostName, target: info.target })
        }
    }
    issues.push(...checkReadme(repoSkills))
    for (const [hostName, list] of Object.entries(det.orphans)) {
        for (const o of list) issues.push({ kind: 'orphan', skill: o, host: hostName, hint: 'install --prune 可清除' })
    }
    // HUD 接管链路（仅 claude）
    if (!det.hud?.skipped && det.hud?.issues?.length) {
        for (const k of det.hud.issues) {
            issues.push({ kind: k, skill: 'HUD 状态栏接管', host: 'claude',
                hint: k === 'hud-bridge-missing-in-repo' ? '仓库缺 skills/tvs-hud/hud/combined-status.mjs，需补回源文件（脚本不自动修）' : 'doctor --fix 自动修复' })
        }
        // 仓库有源 才能 --fix（missing-in-repo 是质量问题，跳过自动修）
        if (args.fix && det.hud.repoBridgePresent) {
            fixes.push(...fixHud().fixes)
        }
    }
    if (det.repo?.behind > 0) {
        issues.push({ kind: 'repo-outdated', skill: `落后远程 ${det.repo.behind} 个提交`, hint: '展示新提交给用户，确认后 update --pull' })
    }

    const summary = [
        issues.length === 0 ? '✅ 体检通过，未发现问题' : `发现 ${issues.length} 个问题`,
        ...issues.map((i) => `[${i.kind}] ${i.host ? i.host + '/' : ''}${i.skill}${i.ref ? ' → ' + i.ref : ''}${i.target ? ' → ' + i.target : ''}`),
        ...fixes,
    ]
    return { issues, fixes, thirdParty: det.thirdParty, repo: det.repo, summary }
}

// ---------- CLI ----------

function parseArgs(argv) {
    const args = { _: [] }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a.startsWith('--')) {
            const [k, v] = a.slice(2).split('=')
            if (v !== undefined) {
                // 等号式：--key=value
                args[k] = v
            } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
                // 空格式：--key value（下一个 token 非 flag 时作为值消费）
                args[k] = argv[++i]
            } else {
                // 纯布尔 flag：--fix / --pull / --force / --prune
                args[k] = true
            }
        } else args._.push(a)
    }
    return args
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    const cmd = args._[0]
    // 拷贝安装的 skill 里跑本脚本时无法定位仓库（软链安装无此问题：Node 自动解析真实路径）
    if (!existsSync(SKILLS_DIR)) {
        process.stdout.write(JSON.stringify({
            error: `无法定位 AIConfig 仓库（期望 ${norm(SKILLS_DIR)} 存在）。本脚本可能在"拷贝安装"的目录里运行——请到仓库目录内执行，或用软链方式重新安装 tvs-setup。`,
        }, null, 2) + '\n')
        process.exit(1)
    }
    let out
    if (cmd === 'detect') out = detect()
    else if (cmd === 'install') out = install(args)
    else if (cmd === 'doctor') out = doctor(args)
    else if (cmd === 'update') out = update(args)
    else {
        out = { error: `未知命令: ${cmd || '(空)'}`, usage: 'node scripts/tvs.mjs <detect|install|doctor|update> [--target claude,cursor] [--mode link|copy] [--only a,b] [--force] [--prune] [--fix] [--pull]' }
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
    if (out.error) process.exit(1)
}

main()
