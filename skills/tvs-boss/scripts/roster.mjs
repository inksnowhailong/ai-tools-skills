#!/usr/bin/env node
/**
 * tvs-boss 花名册 —— 多项目"舰队"的状态存储。
 *
 * 它是两样东西合一：① 瘦 leader 的外部状态库（leader 不把项目细节囤在上下文里，按需读这里）；
 * ② 崩溃/重启的恢复点（CC 团队是 session-only，重启后 leader 从这个文件重建团队）。
 *
 * 三张表：
 *   projects[] { id, path, git:{repo,main}, devAgents:[] }   —— dev 绑项目
 *   pool[]     { name, role:review|test|special, status }    —— 全队共享池（不绑项目）
 *   tasks[]    { id, project, demand, stage, owner, branch, contractVersion }
 *
 * 设计约束（本脚本只做存取，不做调度判断）：
 *   - 单 leader 调度；项目 = 各自独立目录 + 独立 git，天然隔离；worktree 仅项目内多 agent 改同 repo 时用。
 *   - 团队记忆极薄：此处只存"调度态"，项目领域知识留在各项目自己的记忆工程/codegraph，绝不重复进来。
 *
 * 零依赖（仅 node 内置），原子写，落盘到 ~/.tvs-boss/roster.json（Windows 为 %USERPROFILE%\.tvs-boss\）。
 *
 * CLI：
 *   node roster.mjs                                   打印花名册摘要（无文件则视为空表，不写盘）
 *   node roster.mjs init                              初始化一个空花名册文件
 *   node roster.mjs add-project <id> <path> [repo] [main]
 *   node roster.mjs add-dev <projectId> <devName>
 *   node roster.mjs add-pool <name> <review|test|special>
 *   node roster.mjs add-task <projectId> <demand...>  新建任务（stage=dispatched）
 *   node roster.mjs set-stage <taskId> <stage> [owner]
 *   node roster.mjs by-project <projectId>
 *   node roster.mjs by-owner <agentName>
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const DIR = join(homedir(), '.tvs-boss');
const FILE = join(DIR, 'roster.json');

/** 任务阶段流水：派发 → 编码 → 审查 → 测试 → 待提交 → 完成 */
export const STAGES = ['dispatched', 'coding', 'review', 'test', 'await_commit', 'done'];

function ensureDir(p) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

/** 原子写：先写临时文件再 rename，读者永远读不到半截 JSON */
function atomicWrite(path, content) {
    ensureDir(dirname(path));
    const tmp = `${path}.${process.pid}.${Date.now()}.${randomBytes(2).toString('hex')}.tmp`;
    writeFileSync(tmp, content);
    renameSync(tmp, path);
}

/** 读花名册；文件不存在或损坏则返回空三表（不写盘）。也是"恢复重建"的入口。 */
export function loadRoster() {
    if (!existsSync(FILE)) return { projects: [], pool: [], tasks: [] };
    try {
        const r = JSON.parse(readFileSync(FILE, 'utf8'));
        return { projects: r.projects ?? [], pool: r.pool ?? [], tasks: r.tasks ?? [] };
    } catch {
        return { projects: [], pool: [], tasks: [] };
    }
}

/** 原子写回花名册。崩溃恢复的依据就是这个文件，所以每次变更都落盘。 */
export function saveRoster(r) {
    atomicWrite(FILE, `${JSON.stringify(r, null, 4)}\n`);
}

export function addProject(r, id, path, repo = '', main = 'main') {
    if (r.projects.some((p) => p.id === id)) throw new Error(`项目 ${id} 已存在`);
    r.projects.push({ id, path, git: { repo, main }, devAgents: [] });
    return r;
}

export function addDevAgent(r, projectId, devName) {
    const p = r.projects.find((x) => x.id === projectId);
    if (!p) throw new Error(`无此项目：${projectId}`);
    if (!p.devAgents.includes(devName)) p.devAgents.push(devName);
    return r;
}

export function addPoolAgent(r, name, role) {
    if (!['review', 'test', 'special'].includes(role)) throw new Error('共享池角色只能是 review|test|special');
    if (!r.pool.some((a) => a.name === name)) r.pool.push({ name, role, status: 'idle' });
    return r;
}

export function addTask(r, project, demand) {
    const id = `T-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
    r.tasks.push({ id, project, demand, stage: 'dispatched', owner: '', branch: '', contractVersion: 0 });
    return id;
}

export function setStage(r, taskId, stage, owner) {
    if (!STAGES.includes(stage)) throw new Error(`非法 stage：${stage}（可选 ${STAGES.join(' / ')}）`);
    const t = r.tasks.find((x) => x.id === taskId);
    if (!t) throw new Error(`无此任务：${taskId}`);
    t.stage = stage;
    if (owner !== undefined) t.owner = owner;
    return t;
}

export function tasksByProject(r, projectId) {
    return r.tasks.filter((t) => t.project === projectId);
}

export function tasksByOwner(r, owner) {
    return r.tasks.filter((t) => t.owner === owner);
}

/** 一行摘要：项目数 / 池成员数 / 各 stage 任务计数 */
function summary(r) {
    const byStage = STAGES.map((s) => `${s}:${r.tasks.filter((t) => t.stage === s).length}`).join(' ');
    return `项目 ${r.projects.length} ｜ 池 ${r.pool.length} ｜ 任务 ${r.tasks.length}（${byStage}）`;
}

// ---------- CLI ----------

function main() {
    const [cmd, ...a] = process.argv.slice(2);
    const r = loadRoster();

    switch (cmd) {
        case undefined:
        case 'show':
            console.log(summary(r));
            break;
        case 'init':
            saveRoster(r);
            console.log(`已初始化花名册：${FILE}`);
            break;
        case 'add-project':
            addProject(r, a[0], a[1], a[2], a[3]);
            saveRoster(r);
            console.log(`已登记项目 ${a[0]}`);
            break;
        case 'add-dev':
            addDevAgent(r, a[0], a[1]);
            saveRoster(r);
            console.log(`已给项目 ${a[0]} 加 dev：${a[1]}`);
            break;
        case 'add-pool':
            addPoolAgent(r, a[0], a[1]);
            saveRoster(r);
            console.log(`已给共享池加 ${a[1]}：${a[0]}`);
            break;
        case 'add-task': {
            const id = addTask(r, a[0], a.slice(1).join(' '));
            saveRoster(r);
            console.log(`已建任务 ${id}（项目 ${a[0]}，dispatched）`);
            break;
        }
        case 'set-stage':
            setStage(r, a[0], a[1], a[2]);
            saveRoster(r);
            console.log(`任务 ${a[0]} → ${a[1]}${a[2] ? `（owner ${a[2]}）` : ''}`);
            break;
        case 'by-project':
            console.log(JSON.stringify(tasksByProject(r, a[0]), null, 2));
            break;
        case 'by-owner':
            console.log(JSON.stringify(tasksByOwner(r, a[0]), null, 2));
            break;
        default:
            console.error(`未知命令：${cmd}`);
            process.exit(1);
    }
}

// 仅作为 CLI 直接运行时执行 main（被 import 时不跑）
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('roster.mjs')) {
    main();
}
