#!/usr/bin/env node
/**
 * 在独立的新终端窗口里打开任务面板（panel.mjs 是交互 TUI，必须有自己的 TTY）。
 * 供两种入口调用：AI 直接跑（零配置路径）；shell 别名 `tasks`（install-launcher 安装）。
 * 拉起即退，不阻塞调用方——Claude 里 `! tasks` 弹窗后会话立刻继续。
 */
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const panel = join(dirname(fileURLToPath(import.meta.url)), 'panel.mjs');

if (platform() === 'win32') {
    // start 新开 cmd 窗口；第一个带引号参数是窗口标题（不带引号会被当成待运行文件）。
    // node 默认参数转义会吞引号，用 windowsVerbatimArguments 原样透传。
    spawn('cmd', ['/c', 'start', '"tvs-task"', 'cmd', '/k', `node "${panel}"`], {
        detached: true, stdio: 'ignore', windowsVerbatimArguments: true,
    }).unref();
} else if (platform() === 'darwin') {
    const cmd = `node ${JSON.stringify(panel)}`;
    spawn('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(cmd)}`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
} else {
    // linux 尽力而为：常见终端挨个试
    const terms = [['x-terminal-emulator', ['-e']], ['gnome-terminal', ['--']], ['konsole', ['-e']], ['xterm', ['-e']]];
    let ok = false;
    for (const [bin, pre] of terms) {
        try { spawn(bin, [...pre, 'node', panel], { detached: true, stdio: 'ignore' }).unref(); ok = true; break; } catch { /* 下一个 */ }
    }
    if (!ok) console.log(`未找到可用终端，请手动运行：node "${panel}"`);
}
console.log('任务面板已在新窗口打开');
