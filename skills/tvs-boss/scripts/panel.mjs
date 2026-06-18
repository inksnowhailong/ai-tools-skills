#!/usr/bin/env node
/**
 * tvs-boss 团队面板 —— 零依赖终端 ANSI 字符画 TUI（v4：原地重绘 + 键控切屏）。
 *
 * 只用 node 内置（fs / child_process / readline / process.stdout + ANSI 转义），不引任何三方库。
 *
 * 【展示原则】panel 只呈现「git 派生 + 真实文件原文」这类即时读就准的数据，
 *   不呈现需 leader 人工同步才正确的运行态（如曾经的 live-agents.json）——会过期、不可信。
 *   所以屏只剩：总览/项目（git 现推）+ 守则/契约/任务（直接读真实文件）。
 *
 * 形态「终端里跑的 TUI」：
 *   - 进备用屏（alt-screen），原地清屏重画当前屏，退出时原样还原终端，不留滚动残影。
 *   - 键盘 1~5 切屏（第 5 屏「任务」按数据有无自动出现）；↑↓/jk 滚动；q / Ctrl+C 退出。
 *   - 实时两路：fs.watch(.tvs-boss) 文件变即时重扫（150ms 抖动合并）+ 每 REFRESH_MS 兜底重扫 git。
 *
 * 数据引擎（findTeamRoot / readMem / readTasks / parseProjects / git / gitSnapshot / buildState）。
 *
 * 用法：node panel.mjs [--root <团队根路径>]
 *   --root 显式指定团队根（含 .tvs-boss/），不依赖启动时 cwd —— 启动器/双击场景用它最稳。
 *   不传则从当前目录向上自动探测。一键开窗见 open-panel.mjs / 团队根下生成的 panel.cmd。
 */
import { readFileSync, existsSync, watch } from 'node:fs';
import { join, parse as parsePath, resolve } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import readline from 'node:readline';

const execAsync = promisify(exec);

/* ────────────────────────── 数据引擎（照搬 v3，逻辑不变） ────────────────────────── */

function findTeamRoot(start = process.cwd()) {
    let dir = start;
    while (true) {
        if (existsSync(join(dir, '.tvs-boss'))) return dir;
        const up = parsePath(dir).dir;
        if (up === dir) return null;
        dir = up;
    }
}

function readMem(root, name) {
    const p = join(root, '.tvs-boss', name);
    if (!existsSync(p)) return `（${name} 还没建）`;
    return readFileSync(p, 'utf8');
}

function parseProjects(md) {
    const out = [];
    let cur = null;
    for (const line of md.split('\n')) {
        const h = line.match(/^##\s+(.+?)\s*$/);
        if (h) { cur = { id: h[1], path: '', main: 'main' }; out.push(cur); continue; }
        if (!cur) continue;
        const mp = line.match(/^\s*-\s*path:\s*(.+?)\s*$/i);
        if (mp) cur.path = mp[1];
        const mm = line.match(/^\s*-\s*主分支:\s*(.+?)\s*$/);
        if (mm) cur.main = mm[1];
    }
    return out;
}

// 异步跑 git（promisify(exec) 走 shell，保留 --format="…" 的引号语义，与原同步版行为一致；
// 关键：异步=不阻塞事件循环，周期重扫期间按键/滚动照样跟手）。出错返回 null，契约同原版。
async function git(path, args) {
    try { const { stdout } = await execAsync(`git -C "${path}" ${args}`, { encoding: 'utf8' }); return stdout.trim(); }
    catch { return null; }
}

async function gitSnapshot(p) {
    const branch = await git(p.path, 'rev-parse --abbrev-ref HEAD');
    if (branch === null) return { ...p, error: '读不到 git（路径不存在或非仓库）' };
    // branch 判过非空后，其余调用彼此独立 → 并发拿，省一仓库内的串行等待
    const [porcelain0, lr, refOut, stashOut0, last0] = await Promise.all([
        git(p.path, 'status --porcelain'),
        git(p.path, `rev-list --left-right --count ${p.main}...HEAD`),
        git(p.path, 'for-each-ref --sort=-committerdate refs/heads/ --format="%(refname:short)|%(committerdate:relative)"'),
        git(p.path, 'stash list'),
        git(p.path, 'log -1 --format="%s%x1f%cr%x1f%an%x1f%ct"'),
    ]);
    const porcelain = porcelain0 || '';
    const dirty = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;
    let ahead = 0, behind = 0;
    if (lr) { const [b, a] = lr.split(/\s+/).map(Number); behind = b || 0; ahead = a || 0; }
    const branches = (refOut || '').split('\n').map((s) => s.trim()).filter(Boolean)
        .map((l) => { const [name, age] = l.split('|'); return { name, age }; })
        .filter((b) => b.name && b.name !== p.main);
    const stash = stashOut0 ? stashOut0.split('\n').filter(Boolean).length : 0;
    const [msg, when, who, ct] = (last0 || '').split('\x1f');
    const ageDays = ct ? Math.floor((Date.now() / 1000 - Number(ct)) / 86400) : null;
    return { ...p, branch, dirty, ahead, behind, branches, stash, last: { msg, when, who, ageDays } };
}

/** 读 tvs-task 的任务表（~/.tasklog/active.md），任务屏用。无文件则返回 null（屏不出现）。 */
function readTasks() {
    const p = join(homedir(), '.tasklog', 'active.md');
    if (!existsSync(p)) return null;
    try { return readFileSync(p, 'utf8'); } catch { return null; }
}

/** 路径归一（Windows 大小写不敏感、分隔符统一、去尾斜杠）——任务↔分支按 (仓库,分支) join 的关键，不归一会 0 命中 */
function normPath(p) {
    return String(p || '').trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * 解析 active.md（「进行中」屏 + 「任务」屏 + 雷达停滞行 共用此解析器）。
 * 锚点：`## T-xxx · 标题` 起条；`- **状态**：` 行定状态（只认这行，不被「迭代记录」里的裸"状态："覆盖）；
 *   `- **更新**：YYYY-MM-DD` 取更新日；`### 进度节点` 下 `- [ ]/[x]` 数复选框算进度；
 *   `- **项目**：` 下 `` `路径` — `分支` `` 行收 (仓库,分支) 对，供按分支匹配任务。
 * 返回 [{ id, title, status:'in_progress'|'pending'|'done'|'other', updatedDays, done, total, links:[{path,branch,key}] }]。
 * status 里不含"停滞"——停滞是 in_progress + updatedDays≥阈值 派生的，渲染层自己判。
 * @param {string|null} md active.md 原文
 */
function parseActiveTasks(md) {
    if (!md) return [];
    const out = [];
    let cur = null;
    let inSteps = false, inProjects = false;
    const flush = () => { if (cur) out.push(cur); };
    const classify = (s) => {
        if (/进行中/.test(s)) return 'in_progress';
        if (/待开始/.test(s)) return 'pending';
        if (/已完成|完成|已归档/.test(s)) return 'done';
        return 'other';
    };
    for (const raw of md.split('\n')) {
        const line = raw.trim();
        const h = line.match(/^##\s+(T-\d+)\s*·\s*(.+?)\s*$/);
        if (h) { flush(); cur = { id: h[1], title: h[2], status: 'other', updatedDays: null, done: 0, total: 0, links: [] }; inSteps = false; inProjects = false; continue; }
        if (!cur) continue;
        // 段切换：### 进度节点 进入计数；遇到别的 ### 或 ## 退出
        if (/^###\s+进度节点/.test(line)) { inSteps = true; inProjects = false; continue; }
        if (/^#{2,3}\s/.test(line)) { inSteps = false; inProjects = false; }
        // 状态（只认 - **状态**：，避开迭代记录里的裸"状态："）
        if (/^-\s*\*\*状态\*\*[：:]/.test(line)) cur.status = classify(line);
        const u = line.match(/^-\s*\*\*更新\*\*[：:]\s*(\d{4})-(\d{2})-(\d{2})/);
        if (u) { const t = new Date(Number(u[1]), Number(u[2]) - 1, Number(u[3])).getTime(); cur.updatedDays = Math.floor((Date.now() - t) / 86400000); }
        // 项目段开始
        if (/^-\s*\*\*项目\*\*[：:]/.test(line)) { inProjects = true; continue; }
        if (inProjects) {
            const m = line.match(/^-\s*`([^`]+)`\s*[—–-]\s*`([^`]+)`/); // `路径` — `分支`
            if (m) cur.links.push({ path: m[1].trim(), branch: m[2].trim(), key: normPath(m[1]) + '@' + m[2].trim() });
            else if (line && !/^-\s/.test(line)) inProjects = false; // 项目列表结束
        }
        // 进度节点复选框计数
        if (inSteps) {
            const c2 = line.match(/^-\s*\[( |x|X)\]/);
            if (c2) { cur.total++; if (c2[1] !== ' ') cur.done++; }
        }
    }
    flush();
    return out;
}

async function buildState(root) {
    const projectsMd = readMem(root, 'projects.md');
    const tasksMd = readTasks();
    // 各项目并发扫（彼此独立目录，安全）——Windows 上 git 启动开销大，并发把整轮墙钟砍到 ~1/N
    const projects = await Promise.all(parseProjects(projectsMd).map(gitSnapshot));
    return {
        root,
        now: new Date().toLocaleTimeString('zh-CN'),
        projects,
        rulesMd: readMem(root, 'rules.md'),
        contractsMd: readMem(root, 'contracts.md'),
        tasksMd,
        tasks: parseActiveTasks(tasksMd), // 解析出的进行中任务（雷达停滞行用；后续任务×git 屏也用）
    };
}

/* ────────────────────────── 渲染基建：宽度 / 颜色 / 框线 ────────────────────────── */

const out = process.stdout;
const COLOR = out.isTTY && !process.env.NO_COLOR; // 不支持色彩或显式关色时降级为无色
const COLS = () => out.columns || 80;             // 终端列数，随窗口变

// ANSI 颜色：Tokyo Night 变体，256-color 低饱和护眼调色板；关色时全部返回原文，保证无色终端可读。
const fg = (n) => (s) => (COLOR ? `\x1b[38;5;${n}m${s}\x1b[0m` : s);
const c = {
    reset: COLOR ? '\x1b[0m' : '',
    dim: (s) => (COLOR ? `\x1b[38;5;242m${s}\x1b[0m` : s),
    bold: (s) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
    title: fg(111),   // 蓝紫 标题/◆
    cyan: fg(110),    // 柔蓝 分支⎇
    green: fg(114),   // 薄荷绿 ◌干净
    ahead: fg(150),   // 草绿 ↑领先
    yellow: fg(179),  // 琥珀 ◉改
    red: fg(167),     // 砖红 ↓落后/错误
    blue: fg(146),    // 薰衣草 在途分支
    mag: fg(183),     // 淡紫 角色
    gray: fg(238),    // 暗灰 框线（比 245 沉，不抢文字）
    live: fg(119),    // 嫩绿 ●实时专用
    time: fg(248),    // 浅灰 时间戳
    warn: fg(214),    // 金黄 告警
    stash: fg(215),   // 橙 ⊘藏
    invTab: (s) => (COLOR ? `\x1b[48;5;24m\x1b[38;5;195m${s}\x1b[0m` : `[${s}]`), // 选中 tab：靛蓝底+亮字
};

/**
 * 显示宽度：CJK / 全角字符记 2 宽，其余记 1。
 * 关键取舍（见 advisor 复核）：box-drawing(─│┌…) 与 几何/箭头符号(⬢●○↑↓⎇) 属
 * East-Asian-Ambiguous，这里一律按 1 宽算 —— 与主流等宽终端（Windows Terminal）一致。
 * 同时剥掉 ANSI 转义序列再量宽，避免颜色码被算进可见宽度。
 */
function dispWidth(str) {
    const s = str.replace(/\x1b\[[0-9;]*m/g, '');
    let w = 0;
    for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (isWide(cp)) w += 2; else w += 1;
    }
    return w;
}

/** 是否全角/宽字符（CJK 统一表意、假名、全角符号、CJK 标点等） */
function isWide(cp) {
    return (
        (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
        (cp >= 0x2e80 && cp <= 0x303e) || // CJK 部首 / 标点
        (cp >= 0x3041 && cp <= 0x33ff) || // 假名 / CJK 符号
        (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
        (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 统一表意
        (cp >= 0xa000 && cp <= 0xa4cf) || // 彝文
        (cp >= 0xac00 && cp <= 0xd7a3) || // 谚文音节
        (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意
        (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容形式
        (cp >= 0xff00 && cp <= 0xff60) || // 全角 ASCII
        (cp >= 0xffe0 && cp <= 0xffe6) || // 全角符号
        (cp >= 0x20000 && cp <= 0x3fffd)  // CJK 扩展 B+
    );
}

/**
 * 按显示宽度截断（超出加省略号 …，… 本身记 1 宽）。
 * ANSI 感知：保留并透传转义序列（不计宽），只数可见字符；截断时补 \x1b[0m 复位，
 * 防止已着色的合成行被切断后颜色"漏"到右框线（boxLine 会对整条多色行调本函数）。
 */
function clip(str, max) {
    if (dispWidth(str) <= max) return str;
    let w = 0, res = '';
    const re = /\x1b\[[0-9;]*m/g;          // 转义序列
    let i = 0;
    while (i < str.length) {
        re.lastIndex = i;
        const m = re.exec(str);
        if (m && m.index === i) { res += m[0]; i = re.lastIndex; continue; } // 透传转义，不计宽
        const ch = String.fromCodePoint(str.codePointAt(i));
        const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
        if (w + cw > max - 1) { res += '…'; break; }
        w += cw; res += ch; i += ch.length;
    }
    return COLOR ? res + '\x1b[0m' : res;   // 截断后复位，杜绝颜色越界
}

/** 按显示宽度右补空格到 width（已超则截断） */
function padTo(str, width) {
    const clipped = clip(str, width);
    const gap = width - dispWidth(clipped);
    return clipped + ' '.repeat(Math.max(0, gap));
}

// 兜底重扫间隔（ms）：每隔这么久后台静默重扫一次 git；数据没变不重绘。boss 偏好 4s。
const REFRESH_MS = 4000;

/* ────────────────────────── 行动雷达阈值（一处可调，boss 按需改）────────────────────────── */
// 这些是"需关注"的触发线；都是 git 派生量，改一个常量即调灵敏度。
const RADAR = {
    STALE_DAYS: 2,    // 有未提交改动 且 距上次提交 ≥ 这么多天 → 提醒"别丢了"
    AHEAD_PR: 1,      // 分支领先主线 ≥ 这么多提交没合 → 提醒"该开 PR"
    BEHIND_REBASE: 1, // 落后主线 ≥ 这么多 → 提醒"该 rebase"
    TASK_STALE_DAYS: 5,// tvs-task 进行中任务 距更新 ≥ 这么多天 → 提醒"推进?"
};
// 各类目严重度（数值越大越靠前）；排序与配色都用它，调顺序改这里即可。
const SEV = { behind: 40, ahead: 30, dirtyStale: 50, error: 60, taskStale: 35 };

/* ────────────────────────── 屏定义 + 帧组装 ────────────────────────── */

// 屏序：进行中(默认首屏,项目视角) / 任务(任务视角,仅有 active.md 时) / 项目(纯git) / 守则 / 契约。
// 原独立「雷达」屏取消——其告警压成「进行中」屏顶部一行。
function tabsFor(state) {
    const tabs = [['进行中', 'active'], ['任务', 'tasks'], ['项目', 'projects'], ['守则', 'rules'], ['契约', 'contracts']];
    return state?.tasksMd != null ? tabs : tabs.filter((t) => t[1] !== 'tasks');
}

let state = null;  // 唯一缓存态；只有 rebuild() 写它，render() 只读它（切屏不碰 git）
let cur = 0;       // 当前屏索引
let scroll = 0;    // 当前屏纵向滚动偏移（行）。key 里乐观增减，统一在 frame() 里夹紧——见下
let teamRoot = null;

/** 路径只留末两段（避免长路径挤掉时间）：E:\a\b\tvs\AIConfig → …/tvs/AIConfig */
function shortRoot(root) {
    const parts = String(root).split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 2) return root;
    return '…/' + parts.slice(-2).join('/');
}

/**
 * 顶部三行：标题行 / tab 行 / 圆角上框线。tab 不再嵌进框线（独立成行）。
 * 返回 [标题行, tab行, 上框线]——后两者下面接 body 的 │…│ 与 ╰──╯ 底框。
 */
function header(tabs, innerW, above) {
    const live = `${c.live('●')} ${c.dim('实时')}`;
    const title = ` ${c.title('◆')} ${c.bold('tvs-boss')} ${c.dim('·')} ${c.time(shortRoot(state.root))} ${c.dim('·')} ${c.time(state.now)}  ${live}`;
    // tab 段：[1]总览[2]项目… 选中靛蓝底
    const seg = tabs.map((t, i) => {
        const lbl = `[${i + 1}]${t[0]}`;
        return i === cur ? c.invTab(lbl) : c.dim(lbl);
    }).join(' ');
    return [
        title,
        ' ' + seg,
        edgeLine('╭', '╮', innerW, above), // 上框线；上方有内容被滚掉时带 ↑N 指示
    ];
}

/** 一行内容塞进左右框边：│ <内容补到 innerW> │ */
function boxLine(content, innerW) {
    return '│' + padTo(content, innerW) + '│';
}
/** 边线嵌一个右对齐小标签（滚动指示用）：├──────↑3 行──┤。label 为空则纯线。 */
function edgeLine(left, right, innerW, label) {
    if (!label) return left + c.gray('─'.repeat(innerW)) + right;
    const lw = dispWidth(label);
    const fill = Math.max(0, innerW - lw - 2);
    return left + c.gray('─'.repeat(fill)) + ' ' + c.dim(label) + ' ' + right;
}
/** 圆角底框线，可带 ↓N 滚动指示 */
function botLine(innerW, label) { return edgeLine('╰', '╯', innerW, label); }

/* —— 各屏正文：返回「内容行数组」（不含框边，由 frame() 包边） —— */

/**
 * 收集「需关注」告警项（git+任务派生）。原独立雷达屏取消，这些压成「进行中」屏顶部一行。
 * 返回精简标签数组，如 ['crestrail未提交2·3天', 'shirehub落后5', 'T-017停7天']；无则空数组。
 */
function collectAlerts(ps, tasks) {
    const a = [];
    for (const p of ps) {
        if (p.error) { a.push(`${p.id}读不到git`); continue; }
        if (p.dirty > 0 && p.last && p.last.ageDays != null && p.last.ageDays >= RADAR.STALE_DAYS) a.push(`${p.id}未提交${p.dirty}·${p.last.ageDays}天`);
        if (p.behind >= RADAR.BEHIND_REBASE) a.push(`${p.id}落后${p.behind}`);
        if (p.ahead >= RADAR.AHEAD_PR) a.push(`${p.id}领先${p.ahead}没合`);
    }
    for (const t of tasks) if (t.status === 'in_progress' && t.updatedDays != null && t.updatedDays >= RADAR.TASK_STALE_DAYS) a.push(`${t.id}停${t.updatedDays}天`);
    return a;
}

/** 进度展示：done/total → "5/6"，无进度节点 → "–" */
function progressStr(t) { return t.total > 0 ? `${t.done}/${t.total}` : '–'; }

/**
 * 屏1「进行中」（默认首屏，项目视角）：只列真正在动的项目（有在途分支 或 有进行中任务的），
 * 按 项目 → 在途分支 → 该分支对应的 tvs-task 任务 + git 状态 分组。
 * 任务↔分支匹配：active.md 任务的「项目」字段 (仓库,分支) 按归一路径匹配；匹配不到只显分支+git。
 * 顶部一行「需关注」告警（仅有异常时冒出），把原雷达压成一行。
 */
function viewActive(innerW) {
    const ps = state.projects || [];
    const tasks = state.tasks || [];
    const lines = [];

    // 首帧空壳
    if (state.loading) { lines.push(''); lines.push('  ' + c.dim('扫描中…（首次拉取各项目 git 状态）')); return lines; }

    // 顶部告警行（仅有异常时）
    const alerts = collectAlerts(ps, tasks);
    if (alerts.length) lines.push(' ' + c.warn('⚠ 需关注 ') + c.warn(clip(alerts.join(' · '), innerW - 10)));
    else lines.push(' ' + c.green('✓ 一切安好'));
    lines.push(c.gray(' ' + '─'.repeat(Math.max(0, innerW - 2))));

    if (!ps.length) { lines.push(''); lines.push(c.dim(' 还没登记项目，先 /tvs-boss 建团')); return lines; }

    // 按分支 key 建任务索引（一个分支可能挂多个任务）
    const tasksByBranch = new Map();
    for (const t of tasks) for (const lk of t.links) {
        if (!tasksByBranch.has(lk.key)) tasksByBranch.set(lk.key, []);
        tasksByBranch.get(lk.key).push(t);
    }

    // 只列"在动"的项目：有在途分支 的（任务匹配也落在在途分支上）
    const active = ps.filter((p) => !p.error && p.branches && p.branches.length);
    if (!active.length) { lines.push(''); lines.push(c.dim(' 暂无在动项目（没有在途功能分支）')); return lines; }

    active.forEach((p, i) => {
        if (i > 0) lines.push('');
        lines.push(' ' + c.title(c.bold(p.id)));
        for (const b of p.branches) {
            // 分支行：⎇ 名  git状态(↑↓/dirty/最近)
            const ab = `${p.ahead ? c.ahead('↑' + p.ahead) : c.dim('↑0')}${p.behind ? c.red('↓' + p.behind) : c.dim('↓0')}`;
            const dirtyTag = p.dirty > 0 ? '  ' + c.yellow(`●${p.dirty}改`) : '';
            const age = b.age ? '  ' + c.time(b.age) : '';
            lines.push('   ' + c.cyan('⎇ ' + b.name) + '  ' + ab + dirtyTag + age);
            // 该分支对应任务（归一 key 匹配）
            const matched = tasksByBranch.get(normPath(p.path) + '@' + b.name) || [];
            for (const t of matched) {
                lines.push('     ' + c.dim('└ ') + c.bold(t.id) + ' ' + clip(t.title, innerW - 24) + '  ' + c.mag(taskStatusIcon(t) + progressStr(t)));
            }
        }
    });
    return lines;
}

/** 任务状态图标（宽度1，替 emoji）：进行中 ◑ / 停滞 ◔ / 待开始 ○ / 完成 ● / 其他 · */
function taskStatusIcon(t) {
    if (t.status === 'in_progress') return t.updatedDays != null && t.updatedDays >= RADAR.TASK_STALE_DAYS ? c.stash('◔') : c.green('◑');
    if (t.status === 'pending') return c.dim('○');
    if (t.status === 'done') return c.green('●');
    return c.dim('·');
}

/**
 * 屏2「任务」（任务视角，清爽版）：复用 parseActiveTasks，不堆原文，结构化行按状态分组。
 * 每条：ID·标题·进度·项目（首个关联仓库名）。停滞 = 进行中且距更新≥阈值，单独分组。
 */
function viewTasks(innerW) {
    const tasks = state.tasks || [];
    if (!tasks.length) return [c.dim(' active.md 里没有任务')];
    const isStale = (t) => t.status === 'in_progress' && t.updatedDays != null && t.updatedDays >= RADAR.TASK_STALE_DAYS;
    // 分组：进行中(非停滞) / 停滞 / 待开始 / 其他
    const groups = [
        ['◑ 进行中', c.green, tasks.filter((t) => t.status === 'in_progress' && !isStale(t))],
        ['◔ 停滞', c.stash, tasks.filter(isStale)],
        ['○ 待开始', c.dim, tasks.filter((t) => t.status === 'pending')],
    ];
    const other = tasks.filter((t) => t.status === 'other' || t.status === 'done');
    if (other.length) groups.push(['· 其他', c.dim, other]);

    // 项目名 = 首个关联仓库的末段目录（无关联→—）
    const projOf = (t) => t.links.length ? (t.links[0].path.split(/[\\/]+/).filter(Boolean).pop() || '—') : '—';
    const lines = [];
    for (const [title, col, items] of groups) {
        if (!items.length) continue;
        lines.push('');
        lines.push(' ' + col(title) + c.dim(`（${items.length}）`));
        for (const t of items) {
            const prog = isStale(t) ? `停${t.updatedDays}天` : progressStr(t);
            const row = ` ${c.bold(padTo(t.id, 7))} ${padTo(clip(t.title, 28), 28)} ${c.dim(padTo(prog, 7))} ${c.cyan(projOf(t))}`;
            lines.push(row);
        }
    }
    return lines.length ? lines : [c.dim(' （空）')];
}

/** 项目屏：每项目完整信息（分支·主分支·dirty·ahead/behind·stash·在途分支+各自活跃时间·最近提交） */
function viewProjects(innerW) {
    const ps = state.projects || [];
    if (!ps.length) return [c.dim(' 还没登记项目')];
    const lines = [];
    ps.forEach((p, i) => {
        // 项目间编号分隔线：─── 1/4  ShireHub ───────（暗灰线、id 蓝紫 bold）
        const tag = `─── ${i + 1}/${ps.length}  ${p.id} `;
        const tail = '─'.repeat(Math.max(0, innerW - dispWidth(tag) - 1));
        lines.push(c.gray(' ─── ' + `${i + 1}/${ps.length}  `) + c.title(c.bold(p.id)) + ' ' + c.gray(tail));
        if (p.error) { lines.push(` ${c.red('✕ ' + p.error)}`); return; }
        const dirtyTag = p.dirty > 0 ? c.yellow(`◉${p.dirty}改`) : c.green('◌干净');
        const ab = `${p.ahead ? c.ahead('↑' + p.ahead) : c.dim('↑0')} ${p.behind ? c.red('↓' + p.behind) : c.dim('↓0')}`;
        const stashTag = p.stash > 0 ? '  ' + c.stash('⊘' + p.stash + '藏') : '';
        lines.push(`   ${c.cyan('⎇' + p.branch)} ${c.dim('（主 ' + p.main + '）')}  ${dirtyTag}  ${ab}${stashTag}`);
        lines.push(c.dim('   ' + p.path));
        // 在途分支：各自带最近活跃时间，列对齐
        if (p.branches && p.branches.length) {
            lines.push(c.dim('   在途分支'));
            const nameW = Math.min(36, Math.max(...p.branches.map((b) => dispWidth(b.name))));
            for (const b of p.branches) {
                lines.push('     ' + c.blue('▸' + padTo(b.name, nameW)) + '  ' + c.time(b.age || ''));
            }
        } else {
            lines.push(c.dim('   在途分支 ') + c.dim('— 无'));
        }
        if (p.last && p.last.msg) {
            lines.push(c.dim('   最近 ') + c.bold(clip(p.last.msg, innerW - 8)));
            lines.push(c.dim('         ' + (p.last.when || '') + ' · ' + (p.last.who || '')));
        }
    });
    return lines;
}

/** 轻量 markdown → ANSI 行：## 标题 / - 列表 / 普通段。守则/契约用（纯文件原文，轻量渲染）。 */
function viewMarkdown(md, innerW) {
    const lines = [];
    for (const raw of (md || '').split('\n')) {
        const l = raw.trimEnd();
        if (/^##\s+/.test(l)) { lines.push(''); lines.push(' ' + c.cyan(c.bold(l.replace(/^##\s+/, '')))); }
        else if (/^#\s+/.test(l)) lines.push(' ' + c.bold(l.replace(/^#\s+/, '')));
        else if (/^[-*]\s+/.test(l)) lines.push(c.dim('  • ') + l.replace(/^[-*]\s+/, ''));
        else if (l === '') lines.push('');
        else lines.push(c.dim(' ') + l);
    }
    return lines.length ? lines : [c.dim(' （空）')];
}

/** 组装当前屏整帧字符串（含框边、按终端高度裁剪、底部提示） */
function frame() {
    const tabs = tabsFor(state);
    if (cur >= tabs.length) cur = tabs.length - 1;
    const totalW = Math.min(COLS(), 100);
    const innerW = totalW - 2; // 去掉左右框边

    let body;
    const key = tabs[cur][1];
    if (key === 'active') body = viewActive(innerW);          // 进行中（项目视角）
    else if (key === 'tasks') body = viewTasks(innerW);       // 任务（任务视角，清爽）
    else if (key === 'projects') body = viewProjects(innerW); // 项目（纯 git）
    else if (key === 'rules') body = viewMarkdown(state.rulesMd, innerW);
    else body = viewMarkdown(state.contractsMd, innerW);      // 契约

    const foot = ' ' + c.dim('←→/1-' + tabs.length + '切屏 · ↑↓/jk滚动 · PgUp/PgDn翻页 · g/G首尾 · q退出');

    // 高度预算：终端行数 - 标题(1) - tab(1) - 上框(1) - 下框(1) - 底提示(1) = -5
    const rows = out.rows || 24;
    const maxBody = Math.max(3, rows - 5);

    // —— 滚动夹紧只此一处 —— body.length 只有这里才知道（依赖数据/换行/终端宽）。
    // key 里乐观增减 scroll，到这里统一夹到 [0, maxScroll]，一处兜住：按键过冲 / resize 变矮 / 数据缩短。
    const maxScroll = Math.max(0, body.length - maxBody);
    if (scroll > maxScroll) scroll = maxScroll;
    if (scroll < 0) scroll = 0;
    const shown = body.slice(scroll, scroll + maxBody);

    // 滚动指示放进边线（不占正文行，避免滚动时框跳动）：↑N 进上框、↓N 进下框
    const above = scroll > 0 ? `↑${scroll} 行` : '';
    const below = scroll < maxScroll ? `↓还有${maxScroll - scroll} 行` : '';

    const lines = [
        ...header(tabs, innerW, above),
        ...shown.map((ln) => boxLine(ln, innerW)),
        botLine(innerW, below),
        foot,
    ];
    return lines.join('\n');
}

/* ────────────────────────── 重绘 / 重扫 ────────────────────────── */

let drawScheduled = false;
let lastRowCount = 0; // 上一帧实际行数（用于新帧更短时擦掉多余尾行）
/**
 * 无闪原地重绘：不再整屏 2J（那会先黑屏再画、滚动时一闪一闪）。
 * 改为逐行「光标定位 \x1b[r;1H + 写该行 + \x1b[K 清到行尾」，最后 \x1b[J 擦掉旧帧多出来的尾行。
 * raw 模式下不靠 \n（可能只下移不回车），用显式行号定位最稳。render/onKey 全同步、只读缓存 state。
 */
function render() {
    if (drawScheduled) return;
    drawScheduled = true;
    setImmediate(() => {
        drawScheduled = false;
        if (!state) return;
        const rows = frame().split('\n');
        let buf = '';
        for (let i = 0; i < rows.length; i++) buf += `\x1b[${i + 1};1H` + rows[i] + '\x1b[K';
        if (rows.length < lastRowCount) buf += `\x1b[${rows.length + 1};1H\x1b[J`; // 新帧更短 → 清掉残留尾行
        lastRowCount = rows.length;
        out.write(buf);
    });
}

// 数据变更签名：只看 git/文件派生量，【刻意排除 now 时钟】——否则每秒都"变"、永远跳不过重绘。
function dataSig(s) {
    if (!s) return '';
    const proj = (s.projects || []).map((p) => p.error
        ? `${p.id}!err`
        : `${p.id}|${p.branch}|${p.dirty}|${p.ahead}|${p.behind}|${p.stash}|${(p.branches || []).map((b) => b.name + b.age).join(',')}|${p.last && p.last.msg}|${p.last && p.last.when}`
    ).join('；');
    // 任务签名含 状态/进度/停滞天数——[ ]→[x] 这类等长改动靠 done/total 捕获（光看 tasksMd.length 抓不到）
    const tasks = (s.tasks || []).map((t) => `${t.id}:${t.status}:${t.done}/${t.total}:${t.updatedDays}`).join(',');
    return proj + '∥' + tasks + '∥' + (s.rulesMd || '').length + '∥' + (s.contractsMd || '').length;
}

let scanning = false;      // 重扫互斥：异步扫 >2s 时定时器再来不叠加
let lastSig = null;        // 上次数据签名；没变就不重绘（空闲零写、零闪）
/**
 * 异步重扫（不阻塞事件循环 → 扫描期间按键/滚动照样跟手）。
 * 拿到新数据比对签名：变了才刷缓存+重绘，没变直接丢弃（除非首帧/强制）。
 * @param {boolean} force 强制重绘（首帧、手动 r）：即便签名没变也画一帧
 */
async function rebuild(force = false) {
    if (scanning) return;
    scanning = true;
    try {
        const next = await buildState(teamRoot);
        const sig = dataSig(next);
        if (force || sig !== lastSig) { state = next; lastSig = sig; render(); }
        else { state = next; } // 数据没变，仅静默更新缓存（含新 now），不重绘
    } catch { /* 单次重扫失败忽略，留旧帧 */ }
    finally { scanning = false; }
}

/* ────────────────────────── 终端进入 / 退出 ────────────────────────── */

let watcher = null, gitTimer = null, fsTimer = null, exited = false;

/** 还原终端：退出备用屏、显示光标、关 raw、清定时器/监听。幂等。 */
function cleanup() {
    if (exited) return;
    exited = true;
    clearInterval(gitTimer);
    clearTimeout(fsTimer);
    try { watcher?.close(); } catch { /* ignore */ }
    if (out.isTTY) {
        try { process.stdin.setRawMode(false); } catch { /* ignore */ }
        out.write('\x1b[?25h');    // 显示光标
        out.write('\x1b[?1049l');  // 退出 alt-screen，还原进入前的屏内容
    }
    process.stdin.pause();
}

function enterTui() {
    if (out.isTTY) {
        out.write('\x1b[?1049h'); // 进 alt-screen（独立缓冲，退出原样还原）
        out.write('\x1b[?25l');  // 隐藏光标
    }
    // 键盘：raw 模式下 Ctrl+C 不再走 SIGINT，必须在 keypress 里自己处理
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', onKey);

    // 退出兜底：进程任何方式退出都还原终端
    process.on('exit', cleanup);
    // raw 模式下 Ctrl+C 走 keypress；但若 raw 没生效 / 被外部 kill -INT，信号仍要还原终端
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

function onKey(str, key) {
    if (!key) return;
    // 退出：q / Q / Ctrl+C / Esc
    if (key.name === 'q' || (key.ctrl && key.name === 'c') || key.name === 'escape') {
        cleanup();
        process.exit(0);
        return;
    }
    // 数字切屏（仅在范围内）：切屏归零滚动
    const tabs = tabsFor(state);
    const n = parseInt(str, 10);
    if (n >= 1 && n <= tabs.length) {
        cur = n - 1; scroll = 0;
        render(); // 纯缓存重绘，不碰 git → 切屏零延迟
        return;
    }
    // 键位分工（符合直觉、不打架）：横向键管 tab、纵向键管滚动。
    // ←/→ 上一屏/下一屏（循环，切屏归零滚动）；↑↓ 或 j/k 滚一行；PgUp/PgDn 翻页；g/G 顶底；r 手刷。
    // 滚动全部乐观增减，越界由 frame() 夹紧（END 用大数顶到底，clamp 会收）。
    const page = Math.max(1, (out.rows || 24) - 7);
    if (key.name === 'left') { cur = (cur - 1 + tabs.length) % tabs.length; scroll = 0; render(); }
    else if (key.name === 'right') { cur = (cur + 1) % tabs.length; scroll = 0; render(); }
    else if (key.name === 'up' || str === 'k') { scroll -= 1; render(); }
    else if (key.name === 'down' || str === 'j') { scroll += 1; render(); }
    else if (key.name === 'pageup') { scroll -= page; render(); }
    else if (key.name === 'pagedown') { scroll += page; render(); }
    else if (key.name === 'home' || str === 'g') { scroll = 0; render(); }
    else if (key.name === 'end' || str === 'G') { scroll = Number.MAX_SAFE_INTEGER; render(); }
    else if (str === 'r') { rebuild(true); } // r 手动强制刷新
}

/* ────────────────────────── 主流程 ────────────────────────── */

function main() {
    // --root <path>：显式指定团队根（不依赖启动时 cwd，启动器/双击最稳）。
    // 三种入参都接：① 团队根本身（含 .tvs-boss/）② 直接给 .tvs-boss 目录 ③ 其下任意子目录（向上探测）。
    // 优先级：--root 解析值 > 向上自动探测。结果一律 resolve 成绝对路径，避免出现 E:\.tvs-boss\.. 这类相对残留。
    const rootArg = process.argv.indexOf('--root');
    const explicit = rootArg > -1 ? process.argv[rootArg + 1] : null;
    if (explicit) {
        const abs = resolve(explicit);
        if (parsePath(abs).base === '.tvs-boss') teamRoot = parsePath(abs).dir;   // ② 给的是 .tvs-boss 目录
        else if (existsSync(join(abs, '.tvs-boss'))) teamRoot = abs;              // ① 给的是团队根
        else teamRoot = findTeamRoot(abs);                                       // ③ 子目录，向上找
    } else {
        teamRoot = findTeamRoot();
    }
    if (!teamRoot) {
        console.error('没找到团队根（向上没发现 .tvs-boss/）。先在项目目录跑 /tvs-boss 建团，或用 --root <团队根路径> 指定。');
        process.exit(1);
    }

    enterTui();
    // 首帧：先用空壳 state 立刻画一帧（git 异步扫 ~1s，避免启动黑屏），再触发首次强制重扫
    state = { root: teamRoot, now: new Date().toLocaleTimeString('zh-CN'), projects: [], rulesMd: '', contractsMd: '', tasksMd: null, tasks: [], loading: true };
    render();
    rebuild(true); // 首次强扫（async，不阻塞）

    // 实时一：fs.watch 文件变即时重扫（150ms 抖动合并）
    try {
        watcher = watch(join(teamRoot, '.tvs-boss'), () => {
            clearTimeout(fsTimer);
            fsTimer = setTimeout(() => rebuild(), 150);
        });
    } catch { /* 平台不支持 watch 时降级，靠下面的定时重扫 */ }

    // 实时二：每 REFRESH_MS 兜底重扫 git（异步，不阻塞输入；scanning 互斥防叠加；数据没变不重绘）
    gitTimer = setInterval(() => rebuild(), REFRESH_MS);

    // 窗口尺寸变化 → 先整屏清一次（变窄时旧宽行会留残），再重绘
    out.on('resize', () => { out.write('\x1b[2J'); lastRowCount = 0; render(); });
}

if (process.argv[1]?.endsWith('panel.mjs')) main();
