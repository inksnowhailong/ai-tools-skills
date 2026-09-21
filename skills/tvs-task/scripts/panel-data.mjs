#!/usr/bin/env node
/**
 * tvs-task 面板数据出口：把账本 + git 派生标注打成 JSON，供 AI 写进面板的 `tasks` 集合。
 *
 * **不算范围键、不读地址簿、不碰网络**——那些归 tvs-panel。范围键由
 * `tvs-panel/scripts/panel.mjs` 唯一计算后用 `--scope` 传进来。
 * （踩过：四个脚本各写一份范围键实现，其中两份少做了仓库根规整，在子目录里跑会算出
 * 另一个键、给子目录另建一块孤儿板。一致性只能靠"只有一处实现"，靠纪律等于没有。）
 *
 * 一个范围一块板：
 *   范围是某个项目       → 该项目的板，只有命中该项目的任务
 *   范围是多 repo 父目录 → 总板，全部任务
 * 命中规则与 `render.mjs --seed` 逐字一致——播种看到什么，面板就有什么。
 *
 * 用法：
 *   node panel-data.mjs --scope <范围键>   范围键从 panel.mjs 取
 *   node panel-data.mjs --no-git          跳过 git 派生（快速路径，不算停滞/最近活动）
 *   node panel-data.mjs --known T-1,T-2   告知该板现存的任务 id，输出应删除的差集
 */
import { basename } from 'node:path';
import { loadActive, deriveTask, subRepo, isRepo, normPath, pathsOverlap } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (flag(name) ? args[args.indexOf(name) + 1] ?? '' : '');

const scope = normPath(value('--scope') || process.cwd());
const label = basename(scope) || scope;
const withGit = !flag('--no-git');

const { tasks } = loadActive();

// 命中规则与 render.mjs --seed 逐字一致：有 repo 的任务看范围与 repo 是否互为前缀，
// 无 repo 的任务只在范围不是仓库时命中（也就是只进总板，不进各项目板）。
const scopeIsRepo = isRepo(scope);
const hit = tasks.filter((t) =>
    t.repos.length ? t.repos.some((r) => pathsOverlap(normPath(r.path), scope)) : !scopeIsRepo);

/**
 * 子项 → 面板行。
 * 仓库归属只对绑了分支的子项成立——无分支子项不属于任何仓库，
 * 不能拿 repos[0] 兜底，否则面板会显示一个它并没绑的仓库。
 */
function subRow(task, sub) {
    const bound = Boolean(sub.branch);
    return {
        title: sub.title,
        status: sub.status,
        branch: sub.branch,
        // 多 repo 任务才需要标仓库，单 repo 标了是噪音
        repoAlias: bound && task.repos.length > 1 ? (sub.repoAlias || task.repos[0]?.alias || '') : '',
        repoPath: bound ? (subRepo(task, sub) || '') : '',
    };
}

const syncedAt = new Date().toISOString();

const docs = hit.map((task, i) => {
    const d = deriveTask(task, withGit);
    return {
        // id 是锚，只进 metadata 不上屏——面板渲染只用 shortName/title
        id: task.id,
        title: task.title,
        shortName: task.shortName,
        status: task.status,
        created: task.created,
        repos: task.repos.map((r) => r.alias),
        subs: task.subs.map((s) => subRow(task, s)),
        progress: d.progress,
        accept: d.accept,
        stalled: d.stalled,
        lastActivity: d.lastActivity,
        // 迭代记录只送最近 5 条：面板看的是现在，不是编年史
        iters: task.iters.slice(-5).map((l) => l.replace(/^- /, '')),
        syncedAt,
        order: i,
    };
});

const known = value('--known').split(',').map((s) => s.trim()).filter(Boolean);
const live = new Set(docs.map((d) => d.id));

console.log(JSON.stringify({
    scope,
    label,
    syncedAt,
    taskCount: docs.length,
    totalTasks: tasks.length,   // 账本总数：与 taskCount 的差就是被范围过滤掉的
    gitDerived: withGit,
    docs,
    // 本范围内已不命中（归档/删除/移出该项目）但库里还留着的——必须删，否则面板展示过期真相
    stale: known.filter((id) => !live.has(id)),
}, null, 2));
