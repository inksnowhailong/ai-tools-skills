#!/usr/bin/env node
/**
 * Team mode stop hook driver —— Claude Code target。
 *
 * 本文件由 tvs-team-spawn 自动生成。
 * 由 Claude Code 的 Stop hook 在每次回合结束后触发。
 *
 * 与 Cursor 版的差异（接缝层，运行时内核共用 team.mjs）：
 *   - 工作区：读 payload.cwd / env.CLAUDE_PROJECT_DIR（Cursor 是 workspace_roots / CURSOR_PROJECT_DIR）
 *   - 会话：读 payload.session_id / payload.transcript_path（Cursor 是 conversation_id / CURSOR_TRANSCRIPT_PATH）
 *   - 注入消息：输出 { decision: "block", reason }（Cursor 是 { followup_message }）
 *   - 防死循环：Cursor 靠 hooks.json 的 loop_limit:1；Claude Code 没有该参数，
 *     这里改用「watcher PID 是否存活」+ stop_hook_active 双重兜底——
 *     无积压且 watcher 已在跑（或本轮已是 hook 续命）就放行 idle，
 *     watcher 退出时 Claude Code 会再唤醒本 chat。
 *
 * 职责：
 *   1. 读 stdin，拿 workspace + session_id
 *   2. 从 .claude/.team/config.json 的 bindings 查当前 chat 对应哪个 agent
 *   3. 不是 team chat → 直接 return
 *   4. 是 team chat：检查 inbox/<agent>/from-*\/ 是否有积压消息
 *        - 有 → decision:block，让 chat 处理
 *        - 没且无存活 watcher → decision:block，让 chat 启动后台 mailbox-watch
 *        - 没且已有 watcher / 已是续命轮 → return {} 进入 idle
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 异步读 stdin，带 3 秒超时兜底。
 */
function readStdinJson() {
    return new Promise((res) => {
        let data = '';
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            res(value);
        };
        try {
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (chunk) => { data += chunk; });
            process.stdin.on('end', () => {
                try { done(JSON.parse(data || '{}')); }
                catch { done({}); }
            });
            process.stdin.on('error', () => done({}));
            setTimeout(() => done({}), 3000);
        } catch {
            done({});
        }
    });
}

function readJson(path, fallback) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return fallback;
    }
}

function output(value) {
    process.stdout.write(JSON.stringify(value));
    process.exit(0);
}

/**
 * 解析上下文。Claude Code 的 Stop hook payload 里直接带 cwd / session_id / transcript_path，
 * 不需要 Cursor 那套 unix 盘符路径修正。
 */
function resolveContext(payload) {
    const env = process.env;

    let workspaceRoot = payload.cwd ?? null;
    if (!workspaceRoot && env.CLAUDE_PROJECT_DIR) workspaceRoot = env.CLAUDE_PROJECT_DIR;
    if (!workspaceRoot) workspaceRoot = process.cwd();
    workspaceRoot = resolve(workspaceRoot);

    let sessionId = payload.session_id ?? payload.sessionId ?? null;
    if (!sessionId && payload.transcript_path) {
        const match = String(payload.transcript_path).match(/([0-9a-f-]{36})\.jsonl$/i);
        if (match) sessionId = match[1];
    }

    return { workspaceRoot, sessionId, stopHookActive: !!payload.stop_hook_active };
}

function countPendingMessages(teamDir, agent) {
    const inboxDir = join(teamDir, 'inbox', agent);
    if (!existsSync(inboxDir)) return 0;
    let total = 0;
    let dirs;
    try {
        dirs = readdirSync(inboxDir, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const d of dirs) {
        if (!d.isDirectory() || !d.name.startsWith('from-')) continue;
        const fullPath = join(inboxDir, d.name);
        try {
            const files = readdirSync(fullPath);
            for (const f of files) {
                if (!f.endsWith('.json')) continue;
                if (f.endsWith('.tmp')) continue;
                total += 1;
            }
        } catch {
            continue;
        }
    }
    return total;
}

/**
 * watcher 是否还活着：读 .team/watchers/<agent>.pid 并探活。
 * 这是 Claude Code 版防 stop 死循环的关键——没有 loop_limit 可用。
 */
function isWatcherAlive(teamDir, agent) {
    const pidFile = join(teamDir, 'watchers', `${agent}.pid`);
    if (!existsSync(pidFile)) return false;
    const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function buildProcessFollowup(agent, count) {
    return [
        `[team-stop-driver] 你 (${agent}) 的邮箱里有 ${count} 条未处理消息。`,
        '',
        '请按你的 SKILL.md 的"主循环行为规范"逐条处理：',
        '1. 调用 mailbox-consume 一次性取出全部消息（取出即删除）',
        '2. 按消息 type / status 分别处理',
        '3. 处理过程中按需写回执（leader）或派下一棒任务（leader），或在回执里建议下一步（sub）',
        '4. 处理完后保持沉默；下一轮 stop 会再来叫你',
        '',
        '不要把"看到 N 条消息"这种程序化描述讲给用户。直接以你的人格语气工作。',
    ].join('\n');
}

function buildWaitFollowup(agent) {
    return [
        `[team-stop-driver] 你 (${agent}) 当前没有待处理消息，也没有未完成动作。`,
        '',
        '请进入"待命"状态：',
        '1. 用 Bash 工具启动一个后台监听进程（设 run_in_background: true，不要阻塞当前回合）：',
        '   在你的 SKILL.md 里找到 scripts/team.mjs 的绝对路径，执行：',
        '       node "<scriptDir>/team.mjs" mailbox-watch ' + agent + ' --target claude --max-ms 3600000',
        '   这个进程会在邮箱出现新消息或 60 分钟超时时自然退出，',
        '   Claude Code 会把后台进程结束当作通知再次叫醒你，下轮 stop 会自动回到这里。',
        '2. 启动后停下本轮，不要再产出对话内容。',
        '',
        '不要把"监听"或"watcher"这类词复述给用户。',
    ].join('\n');
}

async function main() {
    const payload = await readStdinJson();
    const ctx = resolveContext(payload);
    if (!ctx.workspaceRoot) return output({});
    if (!ctx.sessionId) return output({});

    const teamDir = join(ctx.workspaceRoot, '.claude', '.team');
    const configPath = join(teamDir, 'config.json');
    if (!existsSync(configPath)) return output({});

    const config = readJson(configPath, null);
    if (!config) return output({});

    const bindings = config.bindings ?? {};
    const agent = bindings[ctx.sessionId];
    if (!agent) return output({});

    const pending = countPendingMessages(teamDir, agent);
    if (pending > 0) {
        return output({ decision: 'block', reason: buildProcessFollowup(agent, pending) });
    }

    // 无积压：防死循环。watcher 已在跑、或本轮已是 hook 续命 → 放行 idle。
    if (isWatcherAlive(teamDir, agent) || ctx.stopHookActive) {
        return output({});
    }

    return output({ decision: 'block', reason: buildWaitFollowup(agent) });
}

await main();
