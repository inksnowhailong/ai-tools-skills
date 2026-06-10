#!/usr/bin/env node
/**
 * tvs-task 状态表渲染器
 * 读取 ~/.tasklog/active.md，解析任务块，输出「单张宽表 + 项目列视觉合并」markdown 表格。
 *
 * 用法：
 *   node render.mjs                  全量视图（完成任务每组折叠成一行）
 *   node render.mjs --all            全量视图（完成任务逐行展开）
 *   node render.mjs --ids T-008,T-2  增量视图：只渲染含这些任务的项目组，命中行标 ← 本次
 *
 * 零依赖：仅用 node 内置模块。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const expandDone = args.includes('--all');
const idsIdx = args.indexOf('--ids');
const focusIds = idsIdx >= 0 && args[idsIdx + 1]
    ? args[idsIdx + 1].split(',').map((s) => s.trim().toUpperCase())
    : null;

const file = join(homedir(), '.tasklog', 'active.md');
let raw;
try {
    raw = readFileSync(file, 'utf8');
} catch {
    console.log('（无任务文件 ~/.tasklog/active.md）');
    process.exit(0);
}

/** 解析所有任务块 */
const tasks = [];
for (const block of raw.split(/^## /m).slice(1)) {
    const head = block.match(/^(T-\d+) · (.+)/);
    if (!head) continue;
    const [, id, title] = head;
    // 字段区 = 第一个 ### 之前，避免迭代记录/进度节点里的内容造成误匹配
    const fieldSec = block.split('###')[0];
    const get = (label) => (fieldSec.match(new RegExp(`\\*\\*${label}\\*\\*：(.+)`)) || [])[1]?.trim() ?? '';
    // 项目行形如：  - `E:\repo` — `branch`
    const projects = [...fieldSec.matchAll(/^\s*- `([^`]+)`(?:\s*—\s*`([^`]+)`)?/gm)]
        .map((m) => ({ path: m[1], branch: m[2] ?? '' }));
    const nodeSec = block.split('### 进度节点')[1]?.split('###')[0] ?? '';
    const done = (nodeSec.match(/- \[x\]/g) || []).length;
    const total = (nodeSec.match(/- \[[x ]\]/g) || []).length;
    tasks.push({
        id,
        title: title.trim(),
        status: get('状态'),
        priority: get('优先级'),
        updated: get('更新'),
        projects,
        done,
        total,
    });
}

/** 停滞判定：进行中且距更新日期超过 5 天 */
function effStatus(t) {
    if (t.status.includes('进行中') && t.updated) {
        const days = (Date.now() - new Date(t.updated).getTime()) / 86400000;
        if (days > 5) return '🕐 停滞';
    }
    return t.status;
}

function rank(s) {
    if (s.includes('进行中')) return 0;
    if (s.includes('停滞')) return 1;
    if (s.includes('待开始')) return 2;
    if (s.includes('完成')) return 3;
    return 2;
}

/** 按项目目录名分组；跨项目任务出现在每个相关组 */
const groups = new Map();
for (const t of tasks) {
    const plist = t.projects.length ? t.projects : [{ path: '', branch: '' }];
    for (const p of plist) {
        const name = p.path
            ? p.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
            : '未关联';
        if (!groups.has(name)) groups.set(name, { name, rows: [] });
        groups.get(name).rows.push({ t, branch: p.branch });
    }
}

/** 增量视图：只保留含焦点任务的组 */
let glist = [...groups.values()];
if (focusIds) {
    glist = glist.filter((g) => g.rows.some((r) => focusIds.includes(r.t.id)));
}

/** 组排序：含进行中/停滞的组优先，其余按组内最近更新降序；未关联永远最后 */
function groupKey(g) {
    const hasActive = g.rows.some((r) => rank(effStatus(r.t)) <= 1) ? 0 : 1;
    const latest = Math.max(...g.rows.map((r) => new Date(r.t.updated || 0).getTime()));
    return { hasActive, latest };
}
glist.sort((a, b) => {
    if (a.name === '未关联') return 1;
    if (b.name === '未关联') return -1;
    const ka = groupKey(a);
    const kb = groupKey(b);
    return ka.hasActive - kb.hasActive || kb.latest - ka.latest;
});

/** 全局总览（任务只数一次，不按组重复计） */
const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
for (const t of tasks) counts[rank(effStatus(t))]++;
const summaryParts = [];
if (counts[0]) summaryParts.push(`🔄${counts[0]}`);
if (counts[1]) summaryParts.push(`🕐${counts[1]}`);
if (counts[2]) summaryParts.push(`📋${counts[2]}`);
if (counts[3]) summaryParts.push(`✅${counts[3]}`);
const lines = [`任务 ${tasks.length} ｜ ${summaryParts.join(' ')}`, ''];

lines.push('| 项目 | ID | 任务 | 状态 | 优先级 | 进度 | 分支 |');
lines.push('|------|----|------|------|--------|------|------|');

const short = (s, n = 12) => ([...s].length > n ? [...s].slice(0, n).join('') + '…' : s);

for (const g of glist) {
    const sorted = [...g.rows].sort((a, b) => rank(effStatus(a.t)) - rank(effStatus(b.t)));
    const open = sorted.filter((r) => rank(effStatus(r.t)) < 3);
    const closed = sorted.filter((r) => rank(effStatus(r.t)) === 3);
    let first = true;
    const cell = () => {
        const v = first ? `**${g.name}**` : '';
        first = false;
        return v;
    };
    const renderRow = (r) => {
        const t = r.t;
        const cross = t.projects.length > 1 ? ' ⇄' : '';
        const mark = focusIds && focusIds.includes(t.id) ? ' ← 本次' : '';
        const progress = t.total ? `${t.done}/${t.total}` : '—';
        lines.push(`| ${cell()} | ${t.id}${cross} | ${t.title} | ${effStatus(t)} | ${t.priority} | ${progress} | ${r.branch}${mark} |`);
    };
    open.forEach(renderRow);
    if (closed.length) {
        if (expandDone) {
            closed.forEach(renderRow);
        } else {
            const summary = closed.map((r) => `${r.t.id} ${short(r.t.title)}`).join(' / ');
            lines.push(`| ${cell()} | ✅ ×${closed.length} | ${summary} | | | | |`);
        }
    }
}

console.log(lines.join('\n'));
