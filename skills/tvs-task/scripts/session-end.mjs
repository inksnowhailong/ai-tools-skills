#!/usr/bin/env node
/**
 * tvs-task SessionEnd hook：按锚回收会话内置 Task → 账本。
 *
 * 数据源：~/.claude/tasks/session-<会话id前8位>/<n>.json（Claude Code 原生 Task 落盘）。
 * 只认 metadata.anchor（"T-021" 任务级 / "T-021.3" 子项级），无锚的一律忽略。
 * 回收动作（全部幂等，可安全重跑）：
 *   1. 锚定子项且会话内标了 completed：无分支子项 → 账本标 completed（绑分支子项不动，合并判定归 git）
 *   2. 有任何锚定活动的 pending 任务 → 转 in_progress
 *   3. 会话内完成的锚定条目 → 压缩成一条迭代记录追加到对应任务
 * 静默运行：任何异常直接退出，不阻塞会话关闭。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadActive, saveActive, today } from './lib.mjs';

try {
    const payload = JSON.parse(await readStdin());
    const sessionId = payload.session_id || '';
    if (!sessionId) process.exit(0);

    const dir = join(homedir(), '.claude', 'tasks', `session-${sessionId.slice(0, 8)}`);
    if (!existsSync(dir)) process.exit(0);

    /** 收集本会话所有带锚条目：anchor -> {status, subject} */
    const anchored = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        try {
            const t = JSON.parse(readFileSync(join(dir, f), 'utf8'));
            const anchor = t.metadata?.anchor;
            if (typeof anchor === 'string' && /^T-\d+(\.\d+)?$/.test(anchor)) {
                anchored.push({ anchor, status: t.status, subject: (t.subject || '').replace(/^│\s*/, '') });
            }
        } catch { /* 单文件坏了跳过 */ }
    }
    if (!anchored.length) process.exit(0);

    const { nextId, tasks } = loadActive();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    let dirty = false;

    /** 按任务分组：taskId -> { touched, doneSubjects[] } */
    const groups = new Map();
    for (const a of anchored) {
        const [taskId, subId] = a.anchor.split('.');
        const task = byId.get(taskId);
        if (!task) continue;
        if (!groups.has(taskId)) groups.set(taskId, { doneSubjects: [] });
        const g = groups.get(taskId);
        if (a.status === 'completed') g.doneSubjects.push(a.subject);
        // 子项级锚 + 会话内完成 + 无分支绑定 → 账本子项标 completed
        if (subId && a.status === 'completed') {
            const sub = task.subs.find((s) => s.id === subId);
            if (sub && !sub.branch && sub.status !== 'completed') { sub.status = 'completed'; dirty = true; }
        }
    }

    const date = today();
    for (const [taskId, g] of groups) {
        const task = byId.get(taskId);
        // 有锚定活动的 pending 任务 → 转 in_progress
        if (task.status === 'pending') { task.status = 'in_progress'; dirty = true; }
        // 完成条目压缩成一条迭代记录（截断防膨胀；同日同内容不重复追加 → 幂等）
        if (g.doneSubjects.length) {
            const line = `- ${date} · ${g.doneSubjects.join('；')}`.slice(0, 180);
            if (!task.iters.includes(line)) { task.iters.push(line); dirty = true; }
        }
    }

    if (dirty) saveActive(nextId, tasks);
} catch { /* 收尾 hook 绝不阻塞会话退出 */ }
process.exit(0);

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.on('data', (c) => { data += c; });
        process.stdin.on('end', () => resolve(data));
        setTimeout(() => resolve(data), 1500);
    });
}
