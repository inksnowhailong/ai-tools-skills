#!/usr/bin/env node
/**
 * tvs-task 共享库：薄账本解析/序列化 + git 原语 + 派生标注。
 * 被 scan.mjs / render.mjs / panel.mjs / session-start.mjs / session-end.mjs 共用。
 *
 * 账本哲学（v2 重设计）：
 *  - 只存 git 推不出的慢变量：标题、短名、子项、分支绑定、迭代记录。
 *  - 状态仅三值（与 Claude Code 内置 Task 同构）：pending / in_progress / completed。
 *  - "待验收 / 停滞 / 进度"是派生标注，渲染时现算，永不落盘。
 *  - 任务级 completed 只有用户显式确认才写入；绑分支子项的 completed 由 git 判定。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';

export const TASKLOG_DIR = join(homedir(), '.tasklog');
export const ACTIVE_FILE = join(TASKLOG_DIR, 'active.md');
export const ARCHIVE_FILE = join(TASKLOG_DIR, 'archive.md');
export const IGNORE_FILE = join(TASKLOG_DIR, 'ignore.txt');

/** 集成/测试分支别名：仅用于新分支候选排除，不参与完成判定 */
export const INTEGRATION_ALIASES = ['develop', 'dev', 'test', 'testing', 'staging', 'uat'];
/** 停滞判定阈值（天）：进行中任务全部分支最近提交距今超过此值 → 派生标注 🧊 */
export const STALL_DAYS = 7;
/** 归档留档天数 */
export const ARCHIVE_KEEP_DAYS = 30;

export function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- git 原语 ----------

export function git(repo, cmd) {
    return execSync(`git ${cmd}`, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();
}

export function isRepo(repo) {
    if (!repo || !existsSync(repo)) return false;
    try { git(repo, 'rev-parse --is-inside-work-tree'); return true; } catch { return false; }
}

export function refExists(repo, ref) {
    try { git(repo, `rev-parse --verify --quiet ${ref}`); return true; } catch { return false; }
}

/**
 * 动态识别主分支名。候选：origin/HEAD 指向的分支 + main + master（存在的）。
 * 多候选时若 A 是 B 的祖先则取 B——防 origin/HEAD 指着一条早已废弃的旧主干
 * （真实案例：repo 的 origin/HEAD → main，但 main 停更半年，master 才是包含它的现役主干）。
 * 真分叉（互不为祖先）时保持 origin/HEAD 优先。
 */
export function mainBranch(repo) {
    const cands = [];
    try {
        const n = git(repo, 'symbolic-ref --short refs/remotes/origin/HEAD').replace(/^origin\//, '');
        if (n) cands.push(n);
    } catch { /* 无远端默认分支 */ }
    for (const n of ['main', 'master']) {
        if (!cands.includes(n) && (refExists(repo, `refs/heads/${n}`) || refExists(repo, `refs/remotes/origin/${n}`))) cands.push(n);
    }
    const resolved = cands.map((n) => ({ n, ref: mainRef(repo, n) })).filter((c) => c.ref);
    if (!resolved.length) return null;
    let best = resolved[0];
    for (const c of resolved.slice(1)) {
        try { git(repo, `merge-base --is-ancestor ${best.ref} ${c.ref}`); best = c; } catch { /* best 保持 */ }
    }
    return best.n;
}

/** 主分支名解析为真实 ref：本地 head 优先，其次远端跟踪（company repo 本地主分支可能缺失/滞后） */
export function mainRef(repo, name) {
    if (!name) return null;
    if (refExists(repo, `refs/heads/${name}`)) return `refs/heads/${name}`;
    if (refExists(repo, `refs/remotes/origin/${name}`)) return `origin/${name}`;
    return null;
}

export function integrationBranches(repo) {
    return INTEGRATION_ALIASES.filter((n) => refExists(repo, `refs/heads/${n}`));
}

/** 分支是否已合入该 repo 主分支（祖先检测；squash merge 查不到 → 按未合处理，不误判） */
export function branchMerged(repo, branch) {
    if (!isRepo(repo)) return false;
    const name = mainBranch(repo);
    const base = mainRef(repo, name);
    if (!base || branch === name) return false; // 主分支直挂无"合并事件"，不判
    try { git(repo, `merge-base --is-ancestor "${branch}" ${base}`); return true; } catch { return false; }
}

/** 分支最后一次提交日期 YYYY-MM-DD；取不到返回 '' */
export function lastCommitDate(repo, branch) {
    try {
        const ts = parseInt(git(repo, `log -1 --format=%ct "${branch}"`), 10);
        if (ts) return new Date(ts * 1000).toISOString().slice(0, 10);
    } catch { /* 忽略 */ }
    return '';
}

// ---------- 账本解析 ----------
//
// active.md / archive.md 格式（archive 任务块多一行 `- 完成：日期`）：
//
//   # 任务清单
//
//   _下个ID：T-043_
//
//   ## T-021 · ShireHub 项目架构重构
//   - 短名：架构重构
//   - 状态：in_progress
//   - 创建：2026-06-12
//   - repo：D:\coding\shirehub
//
//   ### 子项
//   | id | 子项 | 分支 | 状态 |
//   |----|------|------|------|
//   | 1 | store A组迁移 | refactor/store-xxx | completed |
//
//   ### 迭代记录
//   - 2026-07-14 · followStore 迁移完成合入 test/dev
//
// 多 repo 任务写多行 `- repo：`，子项分支列用 `repo别名:分支`（别名=路径 basename）。

const STATUSES = new Set(['pending', 'in_progress', 'completed']);

/** 解析账本文本 → { nextId, tasks[] }；tasks 顺序保持文件顺序 */
export function parseLedger(raw) {
    const nextId = (raw.match(/_下个ID：(T-\d+)_/) || [])[1] ?? null;
    const tasks = [];
    for (const block of raw.split(/^## /m).slice(1)) {
        const head = block.match(/^(T-\d+) · (.+)/);
        if (!head) continue;
        const [, id, title] = head;
        const fieldSec = block.split(/^### /m)[0];
        const field = (label) => (fieldSec.match(new RegExp(`^- ${label}：(.+)$`, 'm')) || [])[1]?.trim() ?? '';
        const repos = [...fieldSec.matchAll(/^- repo：(.+)$/gm)].map((m) => {
            const path = m[1].trim();
            return { alias: basename(path), path };
        });
        const status = STATUSES.has(field('状态')) ? field('状态') : 'in_progress';

        // 按 ### 切段后归类，避免正则跨段贪婪/行尾 $ 的坑
        const sections = block.split(/^### /m).slice(1);
        const secBody = (name) => sections.find((s) => s.startsWith(name))?.slice(name.length) ?? '';

        // 子项表：| id | 子项 | 分支 | 状态 |
        const subs = [];
        for (const line of secBody('子项').split('\n')) {
            const cells = line.split('|').map((c) => c.trim());
            // 有效数据行：| id | title | branch | status | → split 后 [ '', id, title, branch, status, '' ]
            if (cells.length < 6 || !/^\d+$/.test(cells[1])) continue;
            let [repoAlias, branch] = ['', cells[3]];
            if (branch.includes(':')) [repoAlias, branch] = [branch.slice(0, branch.indexOf(':')), branch.slice(branch.indexOf(':') + 1)];
            subs.push({
                id: cells[1],
                title: cells[2],
                repoAlias,
                branch: branch === '—' || branch === '-' ? '' : branch,
                status: STATUSES.has(cells[4]) ? cells[4] : 'pending',
            });
        }

        // 迭代记录：- 日期 · 内容
        const iters = secBody('迭代记录').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- '));

        tasks.push({
            id, title: title.trim(),
            shortName: field('短名') || title.trim(),
            status,
            created: field('创建'),
            done: field('完成'),
            repos, subs, iters,
        });
    }
    return { nextId, tasks };
}

/** 序列化单个任务块（不含开头 '## '） */
export function serializeTask(t) {
    const lines = [`${t.id} · ${t.title}`, ''];
    if (t.shortName && t.shortName !== t.title) lines.push(`- 短名：${t.shortName}`);
    lines.push(`- 状态：${t.status}`);
    if (t.created) lines.push(`- 创建：${t.created}`);
    if (t.done) lines.push(`- 完成：${t.done}`);
    for (const r of t.repos) lines.push(`- repo：${r.path}`);
    if (t.subs.length) {
        lines.push('', '### 子项', '| id | 子项 | 分支 | 状态 |', '|----|------|------|------|');
        const multi = t.repos.length > 1;
        for (const s of t.subs) {
            const branch = s.branch ? (multi && s.repoAlias ? `${s.repoAlias}:${s.branch}` : s.branch) : '—';
            lines.push(`| ${s.id} | ${s.title} | ${branch} | ${s.status} |`);
        }
    }
    if (t.iters.length) lines.push('', '### 迭代记录', ...t.iters);
    return lines.join('\n');
}

export function serializeLedger(title, nextId, tasks) {
    const head = nextId ? `# ${title}\n\n_下个ID：${nextId}_\n` : `# ${title}\n`;
    if (!tasks.length) return head;
    return `${head}\n---\n\n${tasks.map((t) => `## ${serializeTask(t)}`).join('\n\n---\n\n')}\n`;
}

export function loadActive() {
    if (!existsSync(ACTIVE_FILE)) return { nextId: 'T-001', tasks: [] };
    return parseLedger(readFileSync(ACTIVE_FILE, 'utf8'));
}

export function loadArchive() {
    if (!existsSync(ARCHIVE_FILE)) return { nextId: null, tasks: [] };
    return parseLedger(readFileSync(ARCHIVE_FILE, 'utf8'));
}

export function saveActive(nextId, tasks) {
    mkdirSync(TASKLOG_DIR, { recursive: true });
    writeFileSync(ACTIVE_FILE, serializeLedger('任务清单', nextId, tasks), 'utf8');
}

export function saveArchive(tasks) {
    mkdirSync(TASKLOG_DIR, { recursive: true });
    writeFileSync(ARCHIVE_FILE, serializeLedger('已归档任务', null, tasks), 'utf8');
}

/** 子项 → 所属 repo 路径（单 repo 任务直取；多 repo 按别名匹配，缺别名取第一个） */
export function subRepo(task, sub) {
    if (!task.repos.length) return null;
    if (task.repos.length === 1 || !sub.repoAlias) return task.repos[0].path;
    return task.repos.find((r) => r.alias === sub.repoAlias)?.path ?? task.repos[0].path;
}

/**
 * 派生标注（渲染时现算，不落盘）：
 *  - progress：completed 子项 / 总子项
 *  - accept：任务未 completed 且子项全部 completed（含 ≥1 子项）→ ⏳待验收
 *  - stalled：任务 in_progress 且全部绑定分支最近提交距今 > STALL_DAYS → 🧊
 *  - lastActivity：各绑定分支最后提交日期的最新者
 * checkGit=false 时跳过 git 调用（只算 progress/accept），供快速路径使用。
 */
export function deriveTask(task, checkGit = true) {
    const total = task.subs.length;
    const done = task.subs.filter((s) => s.status === 'completed').length;
    const accept = task.status !== 'completed' && total > 0 && done === total;
    let lastActivity = '';
    let stalled = false;
    if (checkGit && task.status === 'in_progress') {
        for (const s of task.subs) {
            if (!s.branch) continue;
            const repo = subRepo(task, s);
            if (!isRepo(repo)) continue;
            const d = lastCommitDate(repo, s.branch);
            if (d && d > lastActivity) lastActivity = d;
        }
        if (lastActivity) {
            stalled = (Date.now() - new Date(lastActivity).getTime()) / 86400000 > STALL_DAYS;
        }
    }
    return { progress: { done, total }, accept, stalled, lastActivity };
}

/** 4 格进度条：▰▰▱▱ */
export function progressBar(done, total) {
    if (!total) return '';
    const filled = Math.round((done / total) * 4);
    return '▰'.repeat(filled) + '▱'.repeat(4 - filled);
}

/** 读忽略名单：每行 `仓库路径<TAB>分支名` → Set('repo\tbranch') */
export function loadIgnore() {
    const set = new Set();
    if (!existsSync(IGNORE_FILE)) return set;
    for (const line of readFileSync(IGNORE_FILE, 'utf8').split(/\r?\n/)) {
        const t = line.replace(/^\uFEFF/, '').trim();
        if (!t) continue;
        const [repo, branch] = t.split('\t');
        if (repo && branch) set.add(`${repo}\t${branch}`);
    }
    return set;
}

/** Windows 路径归一化（比较用）：反斜杠→斜杠 + 小写 */
export function normPath(p) {
    return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** 两路径互为祖先或相等（带目录边界，shirehub 不会误配 shirehub-central）。入参需已 normPath */
export function pathsOverlap(a, b) {
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
