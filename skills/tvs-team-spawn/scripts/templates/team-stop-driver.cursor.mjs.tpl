#!/usr/bin/env node
/**
 * Team mode stop hook driver.
 *
 * 本文件由 tvs-team-spawn 自动生成。
 * 由 Cursor stop hook 在每次 AI 回合结束后触发。
 *
 * 职责：
 *   1. 读 stdin / env，找到 workspace_root 和 conversation_id
 *   2. 从 .cursor/.team/config.json 的 bindings 字段查 chat 对应的 agent
 *   3. 不是 team chat → 直接 return
 *   4. 是 team chat：检查 inbox/<agent>/from-*\/ 是否有积压消息
 *        - 有 → 返回 followup_message 让 chat 处理
 *        - 没 → 返回 followup_message 让 chat 启动后台 mailbox-watch 进入等待
 *
 * 设计原则：
 *   - hook 不主动消费邮件，只检查和决策；消费由 chat 自己调用 mailbox-consume 完成
 *   - hook 不调用 team.mjs，自给自足
 *   - 所有路径处理沿用 Cursor 在 Windows 下 unix 风格路径的修正逻辑
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 异步读取 stdin。Cursor 在 Windows 下传 stdin 的方式让 readFileSync(0) 拿不到，
 * 必须用事件流接收 chunks，且要有超时兜底。
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

/**
 * Cursor 在 Windows 下会用 unix 风格的盘符路径，例如 `/e:/inksnow/Thoughts`。
 * path.resolve 不能直接吃这种格式，会得到 `E:\e:\...`，需要先剥掉前导斜杠。
 */
function fixCursorPath(value) {
    if (typeof value !== 'string') return value;
    if (process.platform === 'win32' && /^\/[a-z]:/i.test(value)) {
        return value.substring(1);
    }
    return value;
}

function normalize(value) {
    let result = resolve(fixCursorPath(value)).replaceAll('\\', '/');
    if (process.platform === 'win32' && /^[a-z]:/.test(result)) {
        result = result[0].toUpperCase() + result.slice(1);
    }
    return result;
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

function resolveContext(payload) {
    const env = process.env;
    const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];

    let workspaceRoot = null;
    for (const r of roots) {
        if (!r) continue;
        workspaceRoot = normalize(r);
        break;
    }
    if (!workspaceRoot && env.CURSOR_PROJECT_DIR) {
        workspaceRoot = normalize(env.CURSOR_PROJECT_DIR);
    }
    if (!workspaceRoot) {
        workspaceRoot = normalize(process.cwd());
    }

    let conversationId = payload.conversation_id ?? payload.conversationId ?? null;
    if (!conversationId && env.CURSOR_TRANSCRIPT_PATH) {
        const match = env.CURSOR_TRANSCRIPT_PATH.match(/[\\/]([0-9a-f-]{36})[\\/.]/i);
        if (match) conversationId = match[1];
    }

    return { workspaceRoot, conversationId };
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
                if (f.startsWith('.tmp-')) continue;
                total += 1;
            }
        } catch {
            continue;
        }
    }
    return total;
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
        '1. 启动一个后台 Shell：在你的 SKILL.md 里找到 scripts/team.mjs 的绝对路径，执行：',
        '       node "<scriptDir>/team.mjs" mailbox-watch ' + agent + ' --max-ms 1800000',
        '   设置 block_until_ms: 0（不要阻塞当前回合）。',
        '   这个监听进程会在邮箱目录出现新消息或者 30 分钟超时时自然退出，',
        '   Cursor 会把进程结束当作通知再次叫醒你，下轮 stop 会自动到这里。',
        '2. 启动完后停下本轮，不要再产出对话内容。',
        '',
        '不要把"监听"或"watcher"这类词复述给用户。',
    ].join('\n');
}

async function main() {
    const payload = await readStdinJson();
    const ctx = resolveContext(payload);
    if (!ctx.workspaceRoot) return output({});
    if (!ctx.conversationId) return output({});

    const teamDir = join(fixCursorPath(ctx.workspaceRoot), '.cursor', '.team');
    const configPath = join(teamDir, 'config.json');
    if (!existsSync(configPath)) return output({});

    const config = readJson(configPath, null);
    if (!config) return output({});

    const bindings = config.bindings ?? {};
    const agent = bindings[ctx.conversationId];
    if (!agent) return output({});

    const pending = countPendingMessages(teamDir, agent);
    if (pending > 0) {
        return output({ followup_message: buildProcessFollowup(agent, pending) });
    }

    return output({ followup_message: buildWaitFollowup(agent) });
}

await main();
