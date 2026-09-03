#!/usr/bin/env node
/**
 * 安装 `tasks` 快捷命令：任何 shell（PowerShell / cmd / Git Bash / zsh，含 Claude 里 `! tasks`
 * 的非交互 bash）敲 tasks → 新窗口打开任务面板。
 *
 * 方案：PATH 垫片（真实可执行文件），不改 shell profile——alias 在非交互 shell 里不生效，垫片没这问题。
 *  - Windows → %LOCALAPPDATA%\Microsoft\WindowsApps（系统默认在 PATH 且用户可写）：
 *      tasks.cmd（cmd/PowerShell 用） + tasks 无扩展 sh 脚本（Git Bash 用）
 *  - macOS/Linux → ~/.local/bin/tasks（不在 PATH 时提示加一行）
 *
 * 冲突检测：PATH 上已有同名命令 → 自动落备选名 tvst 并告知。幂等：重复执行覆盖更新。
 * 顺带清理旧版遗留的 profile alias 块。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const opener = join(dirname(fileURLToPath(import.meta.url)), 'open-panel.mjs');
const MARK = '# tvs-task panel launcher';

// ---------- 冲突检测（跳过我们自己装过的垫片） ----------
function conflicted(name) {
    try {
        const out = platform() === 'win32'
            ? execSync(`where ${name}`, { stdio: 'pipe', encoding: 'utf8' })
            : execSync(`command -v ${name}`, { stdio: 'pipe', encoding: 'utf8', shell: '/bin/sh' });
        return !out.toLowerCase().includes('tvs-task') && !/WindowsApps|\.local[\\/]bin/i.test(out);
    } catch { return false; }
}

let cmdName = 'tasks';
if (conflicted(cmdName)) {
    console.log('⚠ PATH 上已存在其他 `tasks` 命令，为避免遮蔽改装备选名 `tvst`');
    cmdName = 'tvst';
    if (conflicted(cmdName)) { console.log('⚠ `tvst` 也被占用，放弃安装'); process.exit(1); }
}

// ---------- 清理旧版 profile alias 块（历史遗留） ----------
for (const f of [
    join(homedir(), 'Documents', 'PowerShell', 'profile.ps1'),
    join(homedir(), 'Documents', 'WindowsPowerShell', 'profile.ps1'),
    join(homedir(), '.bashrc'), join(homedir(), '.zshrc'),
]) {
    if (!existsSync(f)) continue;
    const content = readFileSync(f, 'utf8');
    const cleaned = content.replace(new RegExp(`\\n?${MARK}[\\s\\S]*?${MARK} end\\n?`), '\n');
    if (cleaned !== content) { writeFileSync(f, cleaned, 'utf8'); console.log(`✓ 清理旧 alias：${f}`); }
}

// ---------- 写垫片 ----------
if (platform() === 'win32') {
    const binDir = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Microsoft', 'WindowsApps');
    mkdirSync(binDir, { recursive: true });
    // cmd/PowerShell 入口
    writeFileSync(join(binDir, `${cmdName}.cmd`), `@echo off\r\nrem tvs-task panel launcher\r\nnode "${opener}" %*\r\n`, 'utf8');
    // Git Bash 入口（无扩展 + shebang）
    writeFileSync(join(binDir, cmdName), `#!/bin/sh\n# tvs-task panel launcher\nexec node "${opener.replace(/\\/g, '/')}" "$@"\n`, 'utf8');
    console.log(`✓ ${join(binDir, `${cmdName}.cmd`)}（cmd/PowerShell）`);
    console.log(`✓ ${join(binDir, cmdName)}（Git Bash）`);
} else {
    const binDir = join(homedir(), '.local', 'bin');
    mkdirSync(binDir, { recursive: true });
    const shim = join(binDir, cmdName);
    writeFileSync(shim, `#!/bin/sh\n# tvs-task panel launcher\nexec node "${opener}" "$@"\n`, 'utf8');
    chmodSync(shim, 0o755);
    console.log(`✓ ${shim}`);
    if (!(process.env.PATH ?? '').split(':').includes(binDir)) {
        console.log(`⚠ ~/.local/bin 不在 PATH，请在 shell 配置里加：export PATH="$HOME/.local/bin:$PATH"`);
    }
}
console.log(`装好了：任何终端或 Claude 里 \`! ${cmdName}\` 即弹出任务面板窗口`);
