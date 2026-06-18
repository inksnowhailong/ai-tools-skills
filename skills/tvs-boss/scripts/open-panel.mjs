#!/usr/bin/env node
/**
 * tvs-boss 面板「开窗器」—— 跨平台弹一个新终端窗口跑 TUI 面板。
 *
 * 谁调它：leader。boss 说"看面板/打开面板" → leader 跑 `node "$SKILL/scripts/open-panel.mjs"`，
 *   由 leader 把面板弹出来给 boss，不用 boss 自己敲命令。
 *
 * 平台开窗（弹出的窗口都支持 ANSI、可键盘交互）：
 *   - Windows：有 Windows Terminal 优先 `wt`（最佳 ANSI），否则 `powershell -NoExit`。
 *   - macOS：`osascript` 让 Terminal.app `do script`。
 *   - Linux：$TERMINAL / x-terminal-emulator / gnome-terminal / konsole 兜底，都没有就当前终端直跑。
 *
 * 零硬编码：panel.mjs 路径由本脚本自身位置推出（import.meta.url）；
 *   团队根优先 --root，否则 findTeamRoot 向上探测。绝不写死盘符/绝对团队路径。
 *
 * 用法：node open-panel.mjs [--root <团队根>] [--print]
 *   --print 只打印将执行的命令（dry-run，给生成器/调试/自测用），不真的开窗。
 */
import { existsSync } from 'node:fs';
import { join, parse as parsePath, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

// panel.mjs 绝对路径：与本脚本同目录，由自身位置推出
const PANEL = join(dirname(fileURLToPath(import.meta.url)), 'panel.mjs');

/** 向上找含 .tvs-boss/ 的团队根（与 panel.mjs 同逻辑） */
function findTeamRoot(start = process.cwd()) {
    let dir = start;
    while (true) {
        if (existsSync(join(dir, '.tvs-boss'))) return dir;
        const up = parsePath(dir).dir;
        if (up === dir) return null;
        dir = up;
    }
}

/** 解析 --root：接 团队根 / .tvs-boss 目录 / 子目录，归一成绝对团队根 */
function resolveRoot(explicit) {
    if (explicit) {
        const abs = resolve(explicit);
        if (parsePath(abs).base === '.tvs-boss') return parsePath(abs).dir;
        if (existsSync(join(abs, '.tvs-boss'))) return abs;
        return findTeamRoot(abs);
    }
    return findTeamRoot();
}

/** Windows 是否装了 Windows Terminal（运行时检测，不在生成时定死） */
function hasWt() {
    try { execSync('where wt', { stdio: 'ignore' }); return true; } catch { return false; }
}

/**
 * 按平台算出 { cmd, args }（spawn 用）。--print 模式会把它拼成可读串打出来。
 * @param {string} root 绝对团队根
 */
function buildLaunch(root) {
    const plat = process.platform;
    const node = process.execPath; // 当前 node 绝对路径，最稳
    if (plat === 'win32') {
        const inner = `& '${node}' '${PANEL}' --root '${root}'`;
        if (hasWt()) {
            return { cmd: 'wt', args: ['new-tab', 'powershell', '-NoExit', '-Command', inner] };
        }
        return { cmd: 'powershell', args: ['-NoExit', '-Command', inner] };
    }
    if (plat === 'darwin') {
        // osascript 里要把双引号转义进 AppleScript 字符串
        const script = `tell application "Terminal" to do script "'${node}' '${PANEL}' --root '${root}'"`;
        return { cmd: 'osascript', args: ['-e', script] };
    }
    // linux：挑一个可用终端模拟器
    const term = process.env.TERMINAL
        || ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'].find((t) => {
            try { execSync(`command -v ${t}`, { stdio: 'ignore' }); return true; } catch { return false; }
        });
    if (term) return { cmd: term, args: ['-e', `${node} "${PANEL}" --root "${root}"`] };
    return null; // 没有终端模拟器 → 调用方降级当前终端直跑
}

function main() {
    const argv = process.argv;
    const rootArg = argv.indexOf('--root');
    const root = resolveRoot(rootArg > -1 ? argv[rootArg + 1] : null);
    if (!root) {
        console.error('没找到团队根（向上没发现 .tvs-boss/）。用 --root <团队根> 指定。');
        process.exit(1);
    }
    const launch = buildLaunch(root);

    if (argv.includes('--print')) { // dry-run：只打印，不开窗
        if (!launch) { console.log(`（本平台无窗口终端，将在当前终端直跑）node "${PANEL}" --root "${root}"`); return; }
        console.log(`${launch.cmd} ${launch.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
        return;
    }

    if (!launch) { // 兜底：当前终端直跑（阻塞，但保证能看）
        spawn(process.execPath, [PANEL, '--root', root], { stdio: 'inherit' });
        return;
    }
    // detached + unref + ignore：开窗器自己退出，新窗口照常活着，不阻塞 leader 的调用
    const child = spawn(launch.cmd, launch.args, { detached: true, stdio: 'ignore', shell: false });
    child.unref();
    console.log(`已弹出面板窗口（团队根 ${root}）。`);
}

main();
