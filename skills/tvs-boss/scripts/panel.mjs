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
 *   - 实时两路：fs.watch(.tvs-boss) 文件变即时重扫（150ms 抖动合并）+ 每 2s 兜底重扫 git。
 *
 * 数据引擎（findTeamRoot / readMem / readTasks / parseProjects / git / gitSnapshot / buildState）。
 *
 * 用法：node panel.mjs [--root <团队根路径>]
 *   --root 显式指定团队根（含 .tvs-boss/），不依赖启动时 cwd —— 启动器/双击场景用它最稳。
 *   不传则从当前目录向上自动探测。一键开窗见 open-panel.mjs / 团队根下生成的 panel.cmd。
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
    // 一次 for-each-ref 同时拿到 在途分支 + 各自最近活跃时间（按时间倒序），避免每分支再 git log（省 N 次 execSync）
    const refLines = (git(p.path, 'for-each-ref --sort=-committerdate refs/heads/ --format="%(refname:short)|%(committerdate:relative)"') || '')
        .split('\n').map((s) => s.trim()).filter(Boolean);
    const branches = refLines
        .map((l) => { const [name, age] = l.split('|'); return { name, age }; })
        .filter((b) => b.name && b.name !== p.main);
    // stash 数：一次 stash list 计数
    const stashOut = git(p.path, 'stash list') || '';
    const stash = stashOut ? stashOut.split('\n').filter(Boolean).length : 0;
    const last = git(p.path, 'log -1 --format="%s|%cr|%an"') || '';
    const [msg, when, who] = last.split('|');
    return { ...p, branch, dirty, ahead, behind, branches, stash, last: { msg, when, who } };
}

/** 读 tvs-task 的任务表（~/.tasklog/active.md），任务屏用。无文件则返回 null（屏不出现）。 */
function readTasks() {
    const p = join(homedir(), '.tasklog', 'active.md');
    if (!existsSync(p)) return null;
    try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function buildState(root) {
    const projectsMd = readMem(root, 'projects.md');
    return {
        root,
        now: new Date().toLocaleTimeString('zh-CN'),
        projects: parseProjects(projectsMd).map(gitSnapshot),
        rulesMd: readMem(root, 'rules.md'),
        contractsMd: readMem(root, 'contracts.md'),
        tasksMd: readTasks(),
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

/* ────────────────────────── 屏定义 + 帧组装 ────────────────────────── */

// 「任务」屏（末屏）仅在有 ~/.tasklog/active.md 时出现
const BASE_TABS = [['总览', 'overview'], ['项目', 'projects'], ['守则', 'rules'], ['契约', 'contracts']];
function tabsFor(state) {
    return state?.tasksMd != null ? [...BASE_TABS, ['任务', 'tasks']] : BASE_TABS;
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

function viewOverview(innerW) {
    const ps = state.projects || [];
    const dirty = ps.filter((p) => p.dirty > 0).length;
    const feat = ps.reduce((n, p) => n + ((p.branches || []).length), 0);
    const lines = [];
    // 三个数（都是 git 能算准的）：项目 / 在途分支 / 未提交
    const stat = `${c.bold('项目' + ps.length)}    ${c.bold('在途分支' + feat)}    ${c.bold('未提交' + dirty)}`;
    lines.push(' ' + stat);
    // 告警行：仅当有 dirty / behind 时显示一行金黄；无异常不显示
    const flags = ps
        .filter((p) => !p.error && (p.dirty > 0 || p.behind > 0))
        .map((p) => {
            const bits = [];
            if (p.behind > 0) bits.push('↓' + p.behind);
            if (p.dirty > 0) bits.push('◉' + p.dirty + '改');
            return `${p.id}(${bits.join(' ')})`;
        });
    if (flags.length) lines.push(' ' + c.warn('⚠ 需关注 ' + clip(flags.join(' · '), innerW - 8)));
    lines.push(c.gray(' ' + '─'.repeat(Math.max(0, innerW - 2))));
    if (!ps.length) { lines.push(c.dim(' 还没登记项目，先 /tvs-boss 建团')); return lines; }
    for (const p of ps) lines.push(...projectRowsCompact(p, innerW));
    return lines;
}

/** 总览用的精简项目行（每项目 2~3 行） */
function projectRowsCompact(p, innerW) {
    if (p.error) return [` ${c.bold(padTo(p.id, 12))} ${c.red('✕ ' + p.error)}`];
    const dirtyTag = p.dirty > 0 ? c.yellow(`◉${p.dirty}改`) : c.green('◌干净');
    const ab = `${p.ahead ? c.ahead('↑' + p.ahead) : c.dim('↑0')}${p.behind ? c.red('↓' + p.behind) : c.dim('↓0')}`;
    const stashTag = p.stash > 0 ? '  ' + c.stash('⊘' + p.stash + '藏') : '';
    const head = ` ${c.bold(padTo(p.id, 12))} ${c.cyan('⎇' + padTo(p.branch, 12))} ${dirtyTag}  ${ab}${stashTag}`;
    const rows = [head];
    if (p.branches && p.branches.length) {
        const shown = p.branches.slice(0, 2).map((b) => b.name).join('·');
        const more = p.branches.length > 2 ? `…(+${p.branches.length - 2})` : '';
        rows.push(c.dim('  ▸ ') + c.blue(clip(shown + more, innerW - 7)));
    }
    if (p.last && p.last.msg) {
        rows.push(c.dim('  最近 ') + clip(`${p.last.msg}·${p.last.when || ''}·${p.last.who || ''}`, innerW - 7));
    }
    return rows;
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

/**
 * 行内 markdown 标记 → ANSI：双星/双下划线粗体 → 去标记并加 ANSI 粗体；
 * 单下划线/单星斜体 → 去标记；反引号 code → 去反引号。emoji 原样保留。
 * 仅「任务」屏用（rich=true），守则/契约保持纯轻量不动。
 */
function mdInline(s) {
    return s
        .replace(/^\[ \]\s*/, c.dim('◌ '))                       // - [ ] 未完成 → ◌
        .replace(/^\[[xX]\]\s*/, c.green('✓ '))                  // - [x] 完成 → ✓
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
    else if (key === 'rules') body = viewMarkdown(state.rulesMd, innerW);
    else if (key === 'contracts') body = viewMarkdown(state.contractsMd, innerW);
    else body = viewMarkdown(state.tasksMd, innerW, true); // 任务屏富渲染（**/_/--- 处理）

    const foot = ' ' + c.dim('1-' + tabs.length + '切屏 · ↑↓/jk滚动 · PgUp/PgDn翻页 · g/G首尾 · q退出');

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
    // 数字切屏（仅在范围内）：切屏归零滚动
    const tabs = tabsFor(state);
    const n = parseInt(str, 10);
    if (n >= 1 && n <= tabs.length) {
        cur = n - 1; scroll = 0;
        render(); // 纯缓存重绘，不碰 git → 切屏零延迟
        return;
    }
    // 纵向滚动：↑/k 上一行、↓/j 下一行、PgUp/PgDn 翻页、g/Home 顶、G/End 底。
    // 全部乐观增减，越界由 frame() 夹紧（END 用大数顶到底，clamp 会收）。
    const page = Math.max(1, (out.rows || 24) - 7);
    if (key.name === 'up' || str === 'k') { scroll -= 1; render(); }
    else if (key.name === 'down' || str === 'j') { scroll += 1; render(); }
    else if (key.name === 'pageup') { scroll -= page; render(); }
    else if (key.name === 'pagedown') { scroll += page; render(); }
    else if (key.name === 'home' || str === 'g') { scroll = 0; render(); }
    else if (key.name === 'end' || str === 'G') { scroll = Number.MAX_SAFE_INTEGER; render(); }
    else if (str === 'r') { rebuild(); } // r 手动刷新
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
