#!/usr/bin/env node
/**
 * tvs-boss 预算闸 —— 一根"绝不超过"的保险丝。
 *
 * 对怕失控烧钱的场景：与其精算"大概花多少"，不如焊死"绝不超过多少"。
 * leader 每步把消耗累加进来；到阈值就返回"停手"信号 —— leader 据此停止自动派活、喊用户。
 *
 * 纯算术、零依赖。落盘到 ~/.tvs-boss/budget.json：
 *   { day: 'YYYY-MM-DD', spent: <number>, limit: <number|null> }
 * 跨自然日自动清零（按本地日期）。spent 的单位由调用方自定（token 数或钱，统一即可）。
 *
 * CLI：
 *   node budget.mjs                      打印今日用量 / 阈值 / 是否超限
 *   node budget.mjs add <n>              累加 n 到今日用量
 *   node budget.mjs set-limit <n|off>    设置/取消今日阈值
 *   node budget.mjs check                退出码 0=未超限，1=已超限（给脚本串联用）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const FILE = join(homedir(), '.tvs-boss', 'budget.json');

function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function atomicWrite(path, content) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.${randomBytes(2).toString('hex')}.tmp`;
    writeFileSync(tmp, content);
    renameSync(tmp, path);
}

/** 读预算；不存在、损坏、或跨天则回到"今日清零"的初值 */
export function loadBudget() {
    let b = { day: today(), spent: 0, limit: null };
    if (existsSync(FILE)) {
        try {
            const j = JSON.parse(readFileSync(FILE, 'utf8'));
            // 跨自然日自动清零，但保留 limit
            if (j.day === b.day) b = { day: j.day, spent: Number(j.spent) || 0, limit: j.limit ?? null };
            else b.limit = j.limit ?? null;
        } catch {
            // 损坏 → 用初值
        }
    }
    return b;
}

export function saveBudget(b) {
    atomicWrite(FILE, `${JSON.stringify(b, null, 4)}\n`);
}

/** 累加用量，返回累加后的状态 */
export function addSpent(n) {
    const b = loadBudget();
    b.spent += Number(n) || 0;
    saveBudget(b);
    return b;
}

export function setLimit(limit) {
    const b = loadBudget();
    b.limit = limit;
    saveBudget(b);
    return b;
}

/** 是否超限：无阈值视为永不超限 */
export function isOver(b = loadBudget()) {
    return b.limit != null && b.spent >= b.limit;
}

function describe(b) {
    const lim = b.limit == null ? '未设' : b.limit;
    const flag = isOver(b) ? '  ⛔ 已超限：应停手、喊用户' : '';
    return `预算[${b.day}] 用量 ${b.spent} / 阈值 ${lim}${flag}`;
}

// ---------- CLI ----------

function main() {
    const [cmd, arg] = process.argv.slice(2);
    switch (cmd) {
        case undefined:
        case 'status':
            console.log(describe(loadBudget()));
            break;
        case 'add':
            console.log(describe(addSpent(arg)));
            break;
        case 'set-limit':
            console.log(describe(setLimit(arg === 'off' ? null : Number(arg))));
            break;
        case 'check': {
            const over = isOver();
            console.log(over ? 'OVER' : 'OK');
            process.exit(over ? 1 : 0);
            break;
        }
        default:
            console.error(`未知命令：${cmd}`);
            process.exit(1);
    }
}

if (process.argv[1]?.endsWith('budget.mjs')) {
    main();
}
