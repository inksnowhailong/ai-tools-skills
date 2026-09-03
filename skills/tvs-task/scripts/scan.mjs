#!/usr/bin/env node
/**
 * tvs-task git 状态扫描器（v2）。
 *
 * 与旧版的根本区别：**扫描永远不归档任务**。任务级 completed/归档只有用户显式确认才发生。
 * 扫描只做四件事：
 *   1. 绑分支子项已合入主分支 → 标记子项 completed（--apply 落地）
 *   2. 子项全部 completed 的任务 → 报告 ⏳待验收（仅报告，等用户点头）
 *   3. reopen 检测：已归档任务 / 已 completed 子项的分支重新领先主分支 → 报告（--apply 时子项转回 in_progress；归档任务只报告不自动移回）
 *   4. 新分支候选：在册 repo 有新分支但无对应子项 → 报告（仅报告，登记与否用户定）
 * --apply 额外：清理超 30 天归档。
 *
 * 用法：node scan.mjs [--apply] [--repo <路径前缀>]
 *   --repo 限定只扫路径命中该前缀的任务（hook 快速路径用）。
 * 零依赖：仅 node 内置模块。
 */
import {
    loadActive, loadArchive, saveActive, saveArchive, loadIgnore,
    isRepo, git, mainBranch, mainRef, integrationBranches, branchMerged,
    deriveTask, subRepo, normPath, pathsOverlap, ARCHIVE_KEEP_DAYS,
} from './lib.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const repoFilter = args.includes('--repo') ? normPath(args[args.indexOf('--repo') + 1]) : null;

const { nextId, tasks } = loadActive();
const archive = loadArchive();
const ignore = loadIgnore();

/** 任务是否命中 --repo 过滤（无过滤则全收） */
function hitFilter(t) {
    if (!repoFilter) return true;
    return t.repos.some((r) => pathsOverlap(normPath(r.path), repoFilter));
}

const scanTasks = tasks.filter(hitFilter);

// ---------- 1. 绑分支子项合并检测 ----------
const subCompleted = [];   // {task, sub}
const subReopened = [];    // {task, sub}  completed 子项分支又领先
for (const t of scanTasks) {
    for (const s of t.subs) {
        if (!s.branch) continue;
        const repo = subRepo(t, s);
        if (!isRepo(repo)) continue;
        const merged = branchMerged(repo, s.branch);
        if (merged && s.status !== 'completed') {
            subCompleted.push({ task: t, sub: s });
            if (apply) s.status = 'completed';
        } else if (!merged && s.status === 'completed') {
            // 曾判完成（或人工标完成）但分支现在领先主分支 → 合并后又改了
            // 仅当分支还存在本地时才 reopen（分支删了 = 真结束）
            if (isRepo(repo) && branchExists(repo, s.branch) && branchAhead(repo, s.branch)) {
                subReopened.push({ task: t, sub: s });
                if (apply) s.status = 'in_progress';
            }
        }
    }
}

function branchExists(repo, branch) {
    try { git(repo, `rev-parse --verify --quiet "refs/heads/${branch}"`); return true; } catch { return false; }
}
/** 分支领先主分支 ≥1 提交（reopen 判据；主分支缺失则 false） */
function branchAhead(repo, branch) {
    const base = mainRef(repo, mainBranch(repo));
    if (!base) return false;
    try { return (parseInt(git(repo, `rev-list --count ${base}.."${branch}"`), 10) || 0) > 0; } catch { return false; }
}

// ---------- 2. 待验收（派生，仅报告） ----------
const acceptList = scanTasks.filter((t) => deriveTask(t, false).accept);

// ---------- 3. 归档任务 reopen 检测（仅报告） ----------
const archiveReopened = [];
for (const t of archive.tasks.filter(hitFilter)) {
    for (const s of t.subs) {
        if (!s.branch) continue;
        const repo = subRepo(t, s);
        if (!isRepo(repo) || !branchExists(repo, s.branch)) continue;
        if (branchAhead(repo, s.branch)) { archiveReopened.push({ task: t, sub: s }); break; }
    }
}

// ---------- 4. 新分支候选 ----------
const tracked = new Map(); // repoPath(norm) -> { path, branches:Set }
for (const t of [...tasks, ...archive.tasks]) {
    for (const r of t.repos) {
        const key = normPath(r.path);
        if (!tracked.has(key)) tracked.set(key, { path: r.path, branches: new Set() });
    }
    for (const s of t.subs) {
        if (!s.branch) continue;
        const repo = subRepo(t, s);
        if (repo) tracked.get(normPath(repo))?.branches.add(s.branch);
    }
}

const candidates = [];
for (const [key, { path, branches }] of tracked) {
    if (repoFilter && !(key.startsWith(repoFilter) || repoFilter.startsWith(key))) continue;
    if (!isRepo(path)) continue;
    const name = mainBranch(path);
    const base = mainRef(path, name);
    if (!base) continue;
    const trunk = new Set(['HEAD', name, ...integrationBranches(path)]);
    let locals;
    try {
        locals = git(path, 'for-each-ref --format=%(refname:short) refs/heads').split(/\r?\n/).filter(Boolean);
    } catch { continue; }
    for (const br of locals) {
        if (trunk.has(br) || br.startsWith('release/')) continue;
        if (branches.has(br)) continue;
        if (ignore.has(`${path}\t${br}`)) continue;
        let ahead = 0, ageDays = Infinity, lastDate = '';
        try { ahead = parseInt(git(path, `rev-list --count ${base}.."${br}"`), 10) || 0; } catch { continue; }
        try {
            const ts = parseInt(git(path, `log -1 --format=%ct "${br}"`), 10);
            if (ts) { lastDate = new Date(ts * 1000).toISOString().slice(0, 10); ageDays = (Date.now() - ts * 1000) / 86400000; }
        } catch { continue; }
        // 噪音阀门：领先 ≥2 且 最近提交 ≤14 天 且 领先 ≤50
        if (ahead >= 2 && ageDays <= 14 && ahead <= 50) candidates.push({ repo: path, branch: br, ahead, lastDate });
    }
}

// ---------- --apply 落地 ----------
if (apply) {
    saveActive(nextId, tasks);
    // 归档 30 天清理
    const cutoff = Date.now() - ARCHIVE_KEEP_DAYS * 86400000;
    const kept = archive.tasks.filter((t) => !t.done || new Date(t.done).getTime() >= cutoff);
    if (kept.length !== archive.tasks.length) saveArchive(kept);
}

// ---------- 报告 ----------
const out = [];
const repoShort = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();

out.push('## ✔ 已合入主分支的子项' + (apply && subCompleted.length ? '（已标 completed）' : ''));
out.push(subCompleted.length
    ? subCompleted.map(({ task, sub }) => `- ${task.shortName} ▸ ${sub.title}（${sub.branch}）`).join('\n')
    : '无');

out.push('', '## ⏳ 待验收任务（全部子项已完成，等用户确认归档）');
out.push(acceptList.length
    ? acceptList.map((t) => `- ${t.shortName}（${t.id}）——确认后由 AI 标 completed 并移入归档`).join('\n')
    : '无');

out.push('', '## 🔄 合并后又改（reopen）');
const reopenLines = [
    ...subReopened.map(({ task, sub }) => `- 子项：${task.shortName} ▸ ${sub.title}${apply ? '（已转回 in_progress）' : ''}`),
    ...archiveReopened.map(({ task, sub }) => `- 归档任务：${task.shortName}（${task.id}）分支 ${sub.branch} 又领先主分支——要移回活跃请用户确认`),
];
out.push(reopenLines.length ? reopenLines.join('\n') : '无');

out.push('', '## 🌱 新分支候选（未登记为任何子项）');
out.push(candidates.length
    ? candidates.map((c) => `- ${repoShort(c.repo)} · ${c.branch}（领先 ${c.ahead}，最后提交 ${c.lastDate || '未知'}）— \`${c.repo}\``).join('\n')
    : '无');

console.log(out.join('\n'));
