#!/usr/bin/env node
/**
 * tvs-task 渲染器（v2）：两层树视图（任务 → 子项），进度/待验收/停滞现场从 git 派生。
 *
 * 用法：
 *   node render.mjs                 全量（活跃任务）
 *   node render.mjs --title 关键词   按标题/短名模糊过滤
 *   node render.mjs --archive       附带最近归档
 *   node render.mjs --no-git        跳过 git 派生（快速路径，不算停滞/最近活动）
 *
 * 输出即最终 markdown/纯文本，原样贴进回复。ID 不展示（ID 是机器的，标题是用户的）。
 */
import { loadActive, loadArchive, deriveTask, progressBar } from './lib.mjs';

const args = process.argv.slice(2);
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
