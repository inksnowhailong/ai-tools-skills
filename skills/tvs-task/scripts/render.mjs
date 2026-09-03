#!/usr/bin/env node
/**
 * tvs-task 渲染器（v2）：两层树视图（任务 → 子项），进度/待验收/停滞现场从 git 派生。
 *
 * 用法：
 *   node render.mjs                 全量（活跃任务）
 *   node render.mjs --title 关键词   按标题/短名模糊过滤
 *   node render.mjs --archive       附带最近归档
 *   node render.mjs --no-git        跳过 git 派生（快速路径，不算停滞/最近活动）
 *   node render.mjs --seed [--cwd 路径]
 *                                   输出播种计划：按 cwd 命中（任务 repo 与 cwd 互为前缀；无 repo 的任务
 *                                   只在 cwd 不是 git 仓库时命中）列出应 TaskCreate 的父/子行——subject、
 *                                   锚、初始状态。锚由脚本给出，AI 照单执行，不自造 ID。
 *
 * 输出即最终 markdown/纯文本，原样贴进回复。ID 不展示（ID 是机器的，标题是用户的）；
 * --seed 是例外：它输出的是给 AI 执行的计划，锚必须出现（写进 metadata，不进 subject）。
 */
import { loadActive, loadArchive, deriveTask, progressBar, normPath, pathsOverlap, isRepo } from './lib.mjs';

const args = process.argv.slice(2);
if (args.includes('--seed')) { printSeedPlan(); process.exit(0); }
const withGit = !args.includes('--no-git');
const withArchive = args.includes('--archive');
const titleFilter = args.includes('--title') ? (args[args.indexOf('--title') + 1] ?? '') : '';

const { tasks } = loadActive();
const shown = titleFilter
    ? tasks.filter((t) => t.title.includes(titleFilter) || t.shortName.includes(titleFilter))
    : tasks;

const MARK = { pending: '□', in_progress: '■', completed: '✔' };

const out = [];
const derived = shown.map((t) => ({ t, d: deriveTask(t, withGit) }));

// 总览行
const nAccept = derived.filter(({ d }) => d.accept).length;
const nIp = shown.filter((t) => t.status === 'in_progress').length;
const nPend = shown.filter((t) => t.status === 'pending').length;
out.push(`任务 ${shown.length} ｜ ■进行中 ${nIp} · □待开始 ${nPend}${nAccept ? ` · ⏳待验收 ${nAccept}` : ''}`);
out.push('');

// 排序：待验收置顶（等用户动作）→ 进行中 → 待开始
derived.sort((a, b) => score(b) - score(a));
function score({ t, d }) {
    if (d.accept) return 3;
    if (t.status === 'in_progress') return 2;
    if (t.status === 'pending') return 1;
    return 0;
}

for (const { t, d } of derived) {
    const badges = [];
    if (d.progress.total) badges.push(`${progressBar(d.progress.done, d.progress.total)} ${d.progress.done}/${d.progress.total}`);
    if (d.accept) badges.push('⏳待验收');
    else if (d.stalled) badges.push(`🧊停滞(${d.lastActivity})`);
    else if (d.lastActivity) badges.push(`最近 ${d.lastActivity}`);
    const repos = t.repos.map((r) => r.alias).join('、');
    out.push(`${MARK[t.status] ?? '□'} ${t.shortName}${t.shortName !== t.title ? `（${t.title}）` : ''}  ${badges.join(' · ')}${repos ? `  · ${repos}` : ''}`);
    for (const s of t.subs) {
        const branch = s.branch ? `  (${s.branch})` : '';
        out.push(`  │ ${MARK[s.status] ?? '□'} ${s.title}${branch}`);
    }
    out.push('');
}

if (withArchive) {
    const archived = loadArchive().tasks;
    if (archived.length) {
        out.push('---', '', `最近归档 ${archived.length}：`);
        for (const t of archived) out.push(`  ✔ ${t.shortName}（${t.done}）`);
    }
}

console.log(out.join('\n').replace(/\n+$/, ''));

/** 播种计划：cwd 命中的全部任务，父行一条 + 每个未完成子项一条 */
function printSeedPlan() {
    const cwd = normPath(args.includes('--cwd') ? (args[args.indexOf('--cwd') + 1] ?? process.cwd()) : process.cwd());
    const cwdIsRepo = isRepo(cwd);
    const hit = loadActive().tasks.filter((t) =>
        t.repos.length ? t.repos.some((r) => pathsOverlap(normPath(r.path), cwd)) : !cwdIsRepo);
    if (!hit.length) { console.log('播种计划：当前目录未命中任何在册任务，不播。'); return; }

    const lines = [`播种计划（cwd 命中 ${hit.length} 个任务；逐行 TaskCreate，锚原样写进 metadata.anchor，绝不进 subject）：`];
    for (const t of hit) {
        const d = deriveTask(t, false);
        const tail = d.progress.total ? `${t.status === 'in_progress' ? '进行中' : '待开始'} ${d.progress.done}/${d.progress.total}` : (t.status === 'in_progress' ? '进行中' : '待开始');
        lines.push(`- 父 subject="${t.shortName} ｜ ${tail}" anchor=${t.id} status=${t.status}`);
        for (const s of t.subs) {
            if (s.status === 'completed') continue;
            lines.push(`  - 子 subject="│ ${s.title}" anchor=${t.id}.${s.id} status=${s.status}`);
        }
    }
    lines.push('父行 in_progress 的全程保持；已播过的锚（本会话 Task 列表里已有同锚行）跳过，不重复建。');
    console.log(lines.join('\n'));
}
