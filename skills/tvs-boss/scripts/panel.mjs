#!/usr/bin/env node
/**
 * tvs-boss 团队面板 —— 零依赖终端 ANSI 字符画 TUI（v4：原地重绘 + 键控切屏）。
 *
 * 只用 node 内置（fs / child_process / readline / process.stdout + ANSI 转义），不引任何三方库。
 * 形态从 v3 的「本地网页 + SSE」改成「终端里跑的 TUI」：
 *   - 进备用屏（alt-screen），原地清屏重画当前屏，退出时原样还原终端，不留滚动残影。
 *   - 键盘 1~5 切屏（第 6 屏「任务」按数据有无自动出现），q / Ctrl+C 退出。
 *   - 实时两路（沿用 v3 思路）：fs.watch(.tvs-boss) 文件变即时重扫（150ms 抖动合并）+ 每 2s 兜底重扫 git。
 *
 * 数据引擎（findTeamRoot / readMem / readLiveAgents / parseProjects / git / gitSnapshot / buildState）
 *   逻辑与 v3 完全一致，只换渲染层和交互层。
 *
 * 用法：node panel.mjs [--root <团队根路径>]
 *   --root 显式指定团队根（含 .tvs-boss/），不依赖启动时 cwd —— 启动器/双击场景用它最稳。
 *   不传则从当前目录向上自动探测。配套一键启动器见同级目录 panel.cmd（双击即开）。
 */
import { readFileSync, existsSync, watch } from 'node:fs';
import { join, parse as parsePath, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import readline from 'node:readline';

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

/** 读在岗名单（运行态文件，可能不存在） */
function readLiveAgents(root) {
    const p = join(root, '.tvs-boss', 'live-agents.json');
    if (!existsSync(p)) return { updatedAt: '', agents: [] };
    try { const j = JSON.parse(readFileSync(p, 'utf8')); return { updatedAt: j.updatedAt || '', agents: j.agents || [] }; }
    catch { return { updatedAt: '', agents: [] }; }
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

function git(path, args) {
    try { return execSync(`git -C "${path}" ${args}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
}

function gitSnapshot(p) {
    const branch = git(p.path, 'rev-parse --abbrev-ref HEAD');
    if (branch === null) return { ...p, error: '读不到 git（路径不存在或非仓库）' };
    const porcelain = git(p.path, 'status --porcelain') || '';
    const dirty = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;
    let ahead = 0, behind = 0;
    const lr = git(p.path, `rev-list --left-right --count ${p.main}...HEAD`);
    if (lr) { const [b, a] = lr.split(/\s+/).map(Number); behind = b || 0; ahead = a || 0; }
    const branches = (git(p.path, 'branch --format=%(refname:short)') || '')
        .split('\n').map((s) => s.trim()).filter((s) => s && s !== p.main);
    const last = git(p.path, 'log -1 --format="%s|%cr|%an"') || '';
    const [msg, when, who] = last.split('|');
    return { ...p, branch, dirty, ahead, behind, branches, last: { msg, when, who } };
}

/** 读 tvs-task 的任务表（~/.tasklog/active.md），第 6 屏用。无文件则返回 null（屏不出现）。 */
function readTasks() {
    const p = join(homedir(), '.tasklog', 'active.md');
    if (!existsSync(p)) return null;
    try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function buildState(root) {
    const projectsMd = readMem(root, 'projects.md');
    const live = readLiveAgents(root);
    return {
        root,
        now: new Date().toLocaleTimeString('zh-CN'),
        projects: parseProjects(projectsMd).map(gitSnapshot),
        agents: live.agents,
        agentsUpdatedAt: live.updatedAt,
        rulesMd: readMem(root, 'rules.md'),
        contractsMd: readMem(root, 'contracts.md'),
        tasksMd: readTasks(),
    };
}

/* ────────────────────────── 渲染基建：宽度 / 颜色 / 框线 ────────────────────────── */

const out = process.stdout;
const COLOR = out.isTTY && !process.env.NO_COLOR; // 不支持色彩或显式关色时降级为无色
const COLS = () => out.columns || 80;             // 终端列数，随窗口变

// ANSI 颜色：关色时全部返回原文，保证无色终端可读
const c = {
    reset: COLOR ? '\x1b[0m' : '',
    dim: (s) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
    bold: (s) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
    cyan: (s) => (COLOR ? `\x1b[36m${s}\x1b[0m` : s),
    green: (s) => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
    yellow: (s) => (COLOR ? `\x1b[33m${s}\x1b[0m` : s),
    red: (s) => (COLOR ? `\x1b[31m${s}\x1b[0m` : s),
    blue: (s) => (COLOR ? `\x1b[34m${s}\x1b[0m` : s),
    mag: (s) => (COLOR ? `\x1b[35m${s}\x1b[0m` : s),
    gray: (s) => (COLOR ? `\x1b[90m${s}\x1b[0m` : s),
    invCyan: (s) => (COLOR ? `\x1b[46m\x1b[30m${s}\x1b[0m` : `[${s}]`), // 选中 tab 反白
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

/** 按显示宽度截断（超出加省略号 …，… 本身记 1 宽） */
function clip(str, max) {
    if (dispWidth(str) <= max) return str;
    let w = 0, res = '';
    for (const ch of str.replace(/\x1b\[[0-9;]*m/g, '')) {
        const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
        if (w + cw > max - 1) { res += '…'; break; }
        w += cw; res += ch;
    }
    return res;
}

/** 按显示宽度右补空格到 width（已超则截断） */
function padTo(str, width) {
    const clipped = clip(str, width);
    const gap = width - dispWidth(clipped);
    return clipped + ' '.repeat(Math.max(0, gap));
}

/* ────────────────────────── 屏定义 + 帧组装 ────────────────────────── */

// 第 6 屏「任务」仅在有 ~/.tasklog/active.md 时出现
const BASE_TABS = [['总览', 'overview'], ['项目', 'projects'], ['团队', 'team'], ['守则', 'rules'], ['契约', 'contracts']];
function tabsFor(state) {
    return state?.tasksMd != null ? [...BASE_TABS, ['任务', 'tasks']] : BASE_TABS;
}

let state = null;  // 唯一缓存态；只有 rebuild() 写它，render() 只读它（切屏不碰 git）
let cur = 0;       // 当前屏索引
let teamRoot = null;

/** 顶部状态栏 + tab 行（tab 行嵌进上框边） */
function header(tabs, innerW) {
    const live = COLOR ? c.green('●实时') : '●实时';
    const title = `${c.cyan('⬢')} ${c.bold('tvs-boss')} ${c.gray('·')} ${state.root} ${c.gray('·')} ${state.now}  ${live}`;
    // tab 段：[1]总览[2]项目… 选中反白
    const seg = tabs.map((t, i) => {
        const lbl = `[${i + 1}]${t[0]}`;
        return i === cur ? c.invCyan(lbl) : c.dim(lbl);
    }).join('');
    const segW = dispWidth(seg);
    const fill = '─'.repeat(Math.max(0, innerW - segW));
    return [
        ' ' + title,
        '┌' + seg + c.gray(fill) + '┐',
    ];
}

/** 一行内容塞进左右框边：│ <内容补到 innerW> │ */
function boxLine(content, innerW) {
    return '│' + padTo(content, innerW) + '│';
}
function sepLine(innerW) { return '├' + c.gray('─'.repeat(innerW)) + '┤'; }
function botLine(innerW) { return '└' + c.gray('─'.repeat(innerW)) + '┘'; }

/* —— 各屏正文：返回「内容行数组」（不含框边，由 frame() 包边） —— */

function viewOverview(innerW) {
    const ps = state.projects || [];
    const dirty = ps.filter((p) => p.dirty > 0).length;
    const feat = ps.reduce((n, p) => n + ((p.branches || []).length), 0);
    const lines = [];
    // 四个数：项目 / 在岗 / 在途分支 / 未提交
    const stat = `${c.bold('项目' + ps.length)}    ${c.bold('在岗' + (state.agents || []).length)}    ${c.bold('在途分支' + feat)}    ${c.bold('未提交' + dirty)}`;
    lines.push(' ' + stat);
    lines.push(c.gray(' ' + '─'.repeat(Math.max(0, innerW - 2))));
    if (!ps.length) { lines.push(c.dim(' 还没登记项目，先 /tvs-boss 建团')); return lines; }
    for (const p of ps) lines.push(...projectRowsCompact(p, innerW));
    return lines;
}

/** 总览用的精简项目行（每项目 2~3 行） */
function projectRowsCompact(p, innerW) {
    if (p.error) return [` ${c.bold(padTo(p.id, 12))} ${c.red('✗ ' + p.error)}`];
    const dirtyTag = p.dirty > 0 ? c.yellow(`●${p.dirty}改`) : c.green('○干净');
    const ab = `${p.ahead ? c.green('↑' + p.ahead) : c.dim('↑0')}${p.behind ? c.red('↓' + p.behind) : c.dim('↓0')}`;
    const head = ` ${c.bold(padTo(p.id, 12))} ${c.cyan('⎇' + padTo(p.branch, 12))} ${dirtyTag}  ${ab}`;
    const rows = [head];
    if (p.branches && p.branches.length) {
        const shown = p.branches.slice(0, 2).join('·');
        const more = p.branches.length > 2 ? `…(+${p.branches.length - 2})` : '';
        rows.push(c.dim('  在途 ') + c.blue(clip(shown + more, innerW - 7)));
    }
    if (p.last && p.last.msg) {
        rows.push(c.dim('  最近 ') + clip(`${p.last.msg}·${p.last.when || ''}·${p.last.who || ''}`, innerW - 7));
    }
    return rows;
}

/** 项目屏：每项目完整信息（分支·主分支·dirty·ahead/behind·在途分支·最近提交） */
function viewProjects(innerW) {
    const ps = state.projects || [];
    if (!ps.length) return [c.dim(' 还没登记项目')];
    const lines = [];
    ps.forEach((p, i) => {
        if (i > 0) lines.push('');
        if (p.error) { lines.push(` ${c.bold(p.id)}  ${c.red('✗ ' + p.error)}`); return; }
        const dirtyTag = p.dirty > 0 ? c.yellow(`●${p.dirty}改`) : c.green('○干净');
        const ab = `${p.ahead ? c.green('↑' + p.ahead) : c.dim('↑0')} ${p.behind ? c.red('↓' + p.behind) : c.dim('↓0')}`;
        lines.push(` ${c.bold(p.id)}  ${c.cyan('⎇' + p.branch)} ${c.gray('（主 ' + p.main + '）')}  ${dirtyTag}  ${ab}`);
        lines.push(c.dim('   ' + p.path));
        const br = p.branches && p.branches.length ? p.branches.map((b) => c.blue(b)).join(c.dim('·')) : c.dim('— 无');
        lines.push(c.dim('   在途分支 ') + br);
        if (p.last && p.last.msg) {
            lines.push(c.dim('   最近 ') + c.bold(clip(p.last.msg, innerW - 8)));
            lines.push(c.dim('         ' + (p.last.when || '') + ' · ' + (p.last.who || '')));
        }
    });
    return lines;
}

/** 团队屏：在岗名单 name/role/project/state/since */
function viewTeam(innerW) {
    const ag = state.agents || [];
    if (!ag.length) {
        return [
            c.dim(' 当前无在岗成员（懒启动：来活才 spawn）'),
            c.dim(' leader 没在写 live-agents.json 时这里恒空'),
        ];
    }
    const lines = [];
    if (state.agentsUpdatedAt) lines.push(c.dim(' 名单更新于 ' + state.agentsUpdatedAt));
    for (const a of ag) {
        const role = c.mag(a.role || '?');
        const proj = a.project ? c.cyan(a.project) : c.dim('—');
        const st = c.green(a.state || '在岗');
        lines.push(` ${c.bold(padTo(a.name || '?', 14))} ${padTo(role, 18)} ${padTo(proj, 16)} ${st}`);
        if (a.since) lines.push(c.dim('   起于 ' + a.since));
    }
    return lines;
}

/**
 * 行内 markdown 标记 → ANSI：双星/双下划线粗体 → 去标记并加 ANSI 粗体；
 * 单下划线/单星斜体 → 去标记；反引号 code → 去反引号。emoji 原样保留。
 * 仅第 6 屏「任务」用（rich=true），守则/契约保持纯轻量不动。
 */
function mdInline(s) {
    return s
        .replace(/\*\*(.+?)\*\*/g, (_, t) => c.bold(t))
        .replace(/__(.+?)__/g, (_, t) => c.bold(t))
        .replace(/(?<![A-Za-z0-9])[_*](?=\S)(.+?)(?<=\S)[_*](?![A-Za-z0-9])/g, '$1') // _斜体_ / *斜体*
        .replace(/`([^`]+)`/g, '$1');
}

/**
 * 轻量 markdown → ANSI 行：## 标题 / - 列表 / 普通段。
 * @param {boolean} rich 富渲染开关：true 时额外处理行内粗体/斜体/code 与 --- 分隔线（仅任务屏）。
 */
function viewMarkdown(md, innerW, rich = false) {
    const lines = [];
    const inline = rich ? mdInline : (s) => s;
    for (const raw of (md || '').split('\n')) {
        const l = raw.trimEnd();
        if (rich && /^\s*---+\s*$/.test(l)) lines.push(c.gray(' ' + '─'.repeat(Math.max(0, innerW - 2)))); // --- → 分隔线
        else if (/^##\s+/.test(l)) { lines.push(''); lines.push(' ' + c.cyan(c.bold(inline(l.replace(/^##\s+/, ''))))); }
        else if (/^#\s+/.test(l)) { lines.push(' ' + c.bold(inline(l.replace(/^#\s+/, '')))); }
        else if (/^[-*]\s+/.test(l)) lines.push(c.dim('  • ') + inline(l.replace(/^[-*]\s+/, '')));
        else if (l === '') lines.push('');
        else lines.push(c.dim(' ') + inline(l));
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
    if (key === 'overview') body = viewOverview(innerW);
    else if (key === 'projects') body = viewProjects(innerW);
    else if (key === 'team') body = viewTeam(innerW);
    else if (key === 'rules') body = viewMarkdown(state.rulesMd, innerW);
    else if (key === 'contracts') body = viewMarkdown(state.contractsMd, innerW);
    else body = viewMarkdown(state.tasksMd, innerW, true); // 任务屏富渲染（**/_/--- 处理）

    const head = header(tabs, innerW);
    const foot = ' ' + c.dim('1-' + tabs.length + '切屏 · q退出 · 每2s现场git推 · fs变即时刷');

    // 高度预算：终端行数 - 顶栏(1) - 上框(1) - 分隔(1) - 下框(1) - 底提示(1) - 安全(1)
    const rows = out.rows || 24;
    const maxBody = Math.max(3, rows - 6);
    let shown = body;
    if (body.length > maxBody) { shown = body.slice(0, maxBody - 1); shown.push(c.dim(' …（终端太矮，省略 ' + (body.length - maxBody + 1) + ' 行）')); }

    const lines = [
        ...head,
        sepLine(innerW),
        ...shown.map((ln) => boxLine(ln, innerW)),
        botLine(innerW),
        foot,
    ];
    return lines.join('\n');
}

/* ────────────────────────── 重绘 / 重扫 ────────────────────────── */

let drawScheduled = false;
/** 原地重绘：清屏 + 回到左上 + 写整帧。用微合并避免一拍多画。 */
function render() {
    if (drawScheduled) return;
    drawScheduled = true;
    setImmediate(() => {
        drawScheduled = false;
        if (!state) return;
        // \x1b[H 回原点；\x1b[J 清到屏尾（配合 alt-screen，不滚动、无残影）
        out.write('\x1b[H\x1b[J' + frame());
    });
}

/** 重扫数据（跑 git，可能阻塞）→ 刷新缓存 → 重绘。只有定时器/文件监听调它。 */
function rebuild() {
    try { state = buildState(teamRoot); } catch { /* 单次重扫失败忽略，留旧帧 */ }
    render();
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
    // 数字切屏（仅在范围内）
    const tabs = tabsFor(state);
    const n = parseInt(str, 10);
    if (n >= 1 && n <= tabs.length) {
        cur = n - 1;
        render(); // 纯缓存重绘，不碰 git → 切屏零延迟
        return;
    }
    // ← / → 也支持切屏
    if (key.name === 'left') { cur = (cur - 1 + tabs.length) % tabs.length; render(); }
    else if (key.name === 'right') { cur = (cur + 1) % tabs.length; render(); }
    else if (key.name === 'r') { rebuild(); } // r 手动刷新
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
    rebuild(); // 首帧

    // 实时一：fs.watch 文件变即时重扫（150ms 抖动合并）
    try {
        watcher = watch(join(teamRoot, '.tvs-boss'), () => {
            clearTimeout(fsTimer);
            fsTimer = setTimeout(rebuild, 150);
        });
    } catch { /* 平台不支持 watch 时降级，靠下面的定时重扫 */ }

    // 实时二：每 2s 兜底重扫 git
    gitTimer = setInterval(rebuild, 2000);

    // 窗口尺寸变化 → 仅重绘（不必重扫数据）
    out.on('resize', render);
}

if (process.argv[1]?.endsWith('panel.mjs')) main();
