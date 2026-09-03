#!/usr/bin/env node
/**
 * tvs-task 面板 v3：任务为正文，分支为挂件。
 *  - 顶部横向：项目页签（←/→ 或 h/l 切换）
 *  - 正文：该项目的任务树（任务 → 子项），子项行内嵌其绑定分支的 git 实况（wt/领先/日期）
 *  - 底部：未关联任何子项的分支简排 + 主干一行带过
 * 键位：←/→ 切项目  r 刷新  q 退出。快照式，按 r 现推。
 */
import { loadActive, deriveTask, progressBar, isRepo, git, mainBranch, mainRef, normPath, subRepo } from './lib.mjs';

const R = '\x1b[0m', DIM = '\x1b[2m', BOLD = '\x1b[1m';
const CYAN = '\x1b[38;5;110m', YELLOW = '\x1b[38;5;180m', GREEN = '\x1b[38;5;150m', GRAY = '\x1b[38;5;243m';
const MARK = { pending: '□', in_progress: `${YELLOW}■${R}`, completed: `${GREEN}✔${R}` };

let projects = [];
let cur = 0;

function collect() {
    const { tasks } = loadActive();
    const seen = new Map();
    for (const t of tasks) {
        for (const r of t.repos) {
            const key = normPath(r.path);
            if (!seen.has(key)) seen.set(key, { alias: r.alias, path: r.path, tasks: [] });
            seen.get(key).tasks.push(t);
        }
    }
    projects = [...seen.values()];
    if (cur >= projects.length) cur = 0;
}

/** 该 repo 全部本地分支的 git 实况：name -> {wt, vs, date, isTrunk, current} */
function branchInfo(path) {
    const info = new Map();
    if (!isRepo(path)) return info;
    const wt = new Map();
    try {
        let dir = '';
        for (const line of git(path, 'worktree list --porcelain').split('\n')) {
            if (line.startsWith('worktree ')) dir = line.slice(9);
            if (line.startsWith('branch refs/heads/')) wt.set(line.slice(18), dir);
        }
    } catch { /* 无 worktree */ }
    const mainName = mainBranch(path);
    const base = mainRef(path, mainName);
    const trunk = new Set([mainName, 'main', 'master', 'develop', 'dev', 'test', 'testing', 'staging', 'uat']);
    // 比较基准：主分支 + 实际存在的集成线（dev/test 等）。领先数取对"最近的线"的最小值——
    // 对 dev 流程的 repo，拿 main 算领先是几百的噪音，对 dev 算才是有效信号。
    const bases = [{ name: mainName, ref: base }];
    for (const n of ['develop', 'dev', 'test', 'staging', 'uat']) {
        try { git(path, `rev-parse --verify --quiet refs/heads/${n}`); bases.push({ name: n, ref: `refs/heads/${n}` }); continue; } catch { /* 本地无 */ }
        try { git(path, `rev-parse --verify --quiet refs/remotes/origin/${n}`); bases.push({ name: n, ref: `origin/${n}` }); } catch { /* 远端也无 */ }
    }
    let head = '';
    try { head = git(path, 'rev-parse --abbrev-ref HEAD'); } catch { /* detached */ }
    try {
        for (const l of git(path, 'for-each-ref --sort=-committerdate --format=%(refname:short)%09%(committerdate:short) refs/heads').split('\n').filter(Boolean)) {
            const [name, date = ''] = l.split('\t');
            let vs = '';
            if (!trunk.has(name) && base) {
                try {
                    // 已合主分支优先报（完成语义只认主分支）
                    git(path, `merge-base --is-ancestor "${name}" ${base}`);
                    vs = '已合';
                } catch {
                    let best = null;
                    for (const b of bases) {
                        if (!b.ref) continue;
                        try {
                            const n2 = parseInt(git(path, `rev-list --count ${b.ref}.."${name}"`), 10);
                            if (Number.isFinite(n2) && (best === null || n2 < best.n)) best = { n: n2, base: b.name };
                        } catch { /* 跳过 */ }
                    }
                    if (best) vs = best.n === 0 ? `已合·${best.base}` : `↑${best.n}${best.base === mainName ? '' : `·${best.base}`}`;
                }
            }
            info.set(name, { wt: wt.get(name) ?? '', vs, date: date.slice(5), isTrunk: trunk.has(name), current: name === head });
        }
    } catch { /* 非 git */ }
    return info;
}

/** 分支实况挂件：name ↑n·线 wt 09-01（分支名不截断——面板就是来看全信息的） */
function branchTag(name, b) {
    if (!b) return `${GRAY}${name}（本地无此分支）${R}`;
    const bits = [`${CYAN}${name}${R}`];
    if (b.vs) bits.push(b.vs.startsWith('已合') ? `${GREEN}${b.vs}✔${R}` : `${YELLOW}${b.vs}${R}`);
    if (b.wt) bits.push(`${DIM}wt:${wtShort(b.wt)}${R}`);
    if (b.date) bits.push(`${DIM}${b.date}${R}`);
    if (b.current) bits.unshift(`${GREEN}●当前${R}`);
    return bits.join(' ');
}

/** worktree 路径只留末段目录名 */
function wtShort(p) {
    return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p;
}

function draw() {
    collect();
    process.stdout.write('\x1b[2J\x1b[H');
    if (!projects.length) {
        console.log(`${CYAN}◤ tvs-task${R}\n\n${DIM}账本为空——对 AI 说「记任务 xxx」建第一条${R}\n\n${DIM}[q] 退出${R}`);
        return;
    }
    const tabs = projects.map((p, i) => i === cur ? `${BOLD}${CYAN} ${p.alias} ${R}` : `${DIM} ${p.alias} ${R}`).join(`${GRAY}│${R}`);
    console.log(`${CYAN}◤ tvs-task${R} ‹${tabs}›\n`);

    const p = projects[cur];
    const info = branchInfo(p.path);
    const linked = new Set();

    // ---------- 正文：任务树 ----------
    for (const t of p.tasks) {
        const d = deriveTask(t, true); // 面板是"看全信息"的场合，git 派生全开（停滞/最近活动）
        const badges = [];
        if (d.progress.total) badges.push(`${progressBar(d.progress.done, d.progress.total)} ${d.progress.done}/${d.progress.total}`);
        if (d.accept) badges.push(`${YELLOW}⏳待验收${R}`);
        else if (d.stalled) badges.push(`${YELLOW}🧊停滞${R}`);
        else if (d.lastActivity) badges.push(`${DIM}最近提交 ${d.lastActivity}${R}`);
        console.log(`${MARK[t.status] ?? '□'} ${BOLD}${t.shortName}${R}  ${badges.join(' · ')}`);
        // 完整标题与最近一条迭代记录（信息密度：面板要比会话列表多讲）
        if (t.title !== t.shortName) console.log(`  ${DIM}${t.title}${R}`);
        const lastIter = t.iters.at(-1);
        if (lastIter) console.log(`  ${GRAY}↳ ${lastIter.replace(/^- /, '').slice(0, 88)}${R}`);
        // 全部子项已完成 → 折叠不展开（该看的只剩"验收"这一个动作）
        const done = d.progress.total > 0 && d.progress.done === d.progress.total;
        if (done || t.status === 'completed') {
            for (const s of t.subs) if (s.branch) linked.add(s.branch);
            console.log(`  ${DIM}│ ✔ 子项 ${d.progress.total} 条全部完成${d.accept ? '，等验收归档' : ''}${R}`);
        } else {
            for (const s of t.subs) {
                // 多 repo 任务只显示属于当前项目页签的子项
                if (t.repos.length > 1 && normPath(subRepo(t, s) ?? '') !== normPath(p.path)) continue;
                let tag = '';
                if (s.branch) { linked.add(s.branch); tag = `  ${branchTag(s.branch, info.get(s.branch))}`; }
                console.log(`  │ ${MARK[s.status] ?? '□'} ${s.title}${tag}`);
            }
        }
        console.log('');
    }

    // ---------- 底部：未关联分支简排 + 主干一行 ----------
    const others = [...info.entries()].filter(([name, b]) => !linked.has(name) && !b.isTrunk);
    const trunks = [...info.entries()].filter(([, b]) => b.isTrunk).map(([name, b]) => b.current ? `${GREEN}●${R}${name}` : name);
    if (others.length || trunks.length) console.log(`${GRAY}${'─'.repeat(46)}${R}`);
    if (others.length) {
        console.log(`${DIM}未关联分支：${R}`);
        for (const [name, b] of others) console.log(`  ${branchTag(name, b)}`);
    }
    if (trunks.length) console.log(`${DIM}主干：${trunks.join(`${DIM} · ${R}`)}${R}`);

    console.log(`\n${DIM}□待开始 ■进行中 ✔完成（绑分支子项=合入主分支才算） · ↑n·线=领先该集成线${R}`);
    console.log(`${DIM}[←/→] 切项目   [r] 刷新   [q] 退出${R}`);
}

draw();

if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => {
        if (key === 'q' || key === '\x03') { process.stdout.write('\x1b[2J\x1b[H'); process.exit(0); }
        if (key === 'r') draw();
        if ((key === '\x1b[C' || key === 'l') && projects.length) { cur = (cur + 1) % projects.length; draw(); }
        if ((key === '\x1b[D' || key === 'h') && projects.length) { cur = (cur - 1 + projects.length) % projects.length; draw(); }
    });
}
