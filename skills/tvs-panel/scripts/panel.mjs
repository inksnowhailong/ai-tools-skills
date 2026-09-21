#!/usr/bin/env node
/**
 * 指挥台面板的地址簿：**唯一**算范围键、**唯一**读写地址簿的地方。
 *
 * 三个数据脚本（tvs-task / tvs-boss / tvs-council）不再各自算范围键、也不读地址簿——
 * 它们收 `--scope <键>` 参数。一致性因此是结构保证的，不是靠四处纪律。
 * （踩过：tvs-council 少做了仓库根规整，在子目录里跑会算出另一个键、给子目录另建孤儿板。）
 *
 * 一个范围一块面板：在项目目录跑就是该项目的板，在多 repo 父目录跑就是总板。
 * 分板是物理隔离——各板各自一个 db，不同实例之间删不着对方、watch 也不串。
 *
 * 用法：
 *   node panel.mjs                       按当前目录算范围键，输出 {scope,label,url,stale}
 *   node panel.mjs --cwd <路径>           指定范围
 *   node panel.mjs --cwd <路径> --set <URL>   记录地址（同时记下当时的页面指纹）
 *   node panel.mjs --list                列出全部面板，并标出哪些板在跑旧版页面
 *
 * 存储 ~/.tvs-panel.json：
 *   { "panels": { "<范围键>": { url, label, publishedAt, pageHash } } }
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PANEL_FILE = join(homedir(), '.tvs-panel.json');
const PAGE_FILE = join(dirname(dirname(fileURLToPath(import.meta.url))), 'page.html');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => (flag(n) ? args[args.indexOf(n) + 1] ?? '' : '');

function load() {
    if (!existsSync(PANEL_FILE)) return { panels: {} };
    try {
        const b = JSON.parse(readFileSync(PANEL_FILE, 'utf8'));
        return b && typeof b.panels === 'object' && b.panels ? b : { panels: {} };
    } catch {
        return { panels: {} };   // 结构坏了当空处理，不让一个脏文件挡住整条链路
    }
}

/**
 * 页面指纹：发布时记一次，`--list` 拿它和当前 page.html 比。
 * 对不上 = 那块板还在跑旧版页面。把"记得逐块重发"从纪律变成看得见的状态。
 */
function pageHash() {
    try {
        return createHash('sha1').update(readFileSync(PAGE_FILE)).digest('hex').slice(0, 12);
    } catch {
        return '';
    }
}

/** 范围键：反斜杠转斜杠、去尾斜杠、小写 */
function norm(p) {
    return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * 在仓库里规整到仓库根，否则用目录本身。
 * 规整是为了在子目录里跑不会算出新范围、开出第二块板——这是本文件存在的首要理由。
 */
function scopeOf(cwd) {
    const p = norm(cwd);
    try {
        const top = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        return top ? norm(top) : p;
    } catch {
        return p;   // 不是仓库（多 repo 父目录、团队根），就用目录本身
    }
}

if (flag('--list')) {
    const { panels } = load();
    const keys = Object.keys(panels);
    if (!keys.length) {
        console.log('还没有任何面板。在目标范围下跑一次同步即可创建。');
        process.exit(0);
    }
    const cur = pageHash();
    const out = keys.map((k) => {
        const p = panels[k];
        return {
            scope: k,
            label: p.label || basename(k),
            url: p.url || '',
            // 没记过指纹的老板子按"待确认"处理，不冒充最新
            pageStale: cur ? (p.pageHash ? p.pageHash !== cur : null) : null,
        };
    });
    const stale = out.filter((p) => p.pageStale === true);
    const unknown = out.filter((p) => p.pageStale === null);
    console.log(JSON.stringify({ currentPageHash: cur, panels: out }, null, 2));
    if (stale.length) {
        console.error(`\n⚠ ${stale.length} 块板在跑旧版页面，需要带 url 重发：`);
        stale.forEach((p) => console.error(`   ${p.label}  ${p.url}`));
    }
    if (unknown.length) {
        console.error(`\n· ${unknown.length} 块板没有页面指纹记录（建板时的旧版本），重发一次即可对齐。`);
    }
    process.exit(0);
}

const cwd = value('--cwd') || process.cwd();
const scope = scopeOf(cwd);
const label = basename(scope) || scope;

if (flag('--set')) {
    const url = value('--set').trim();
    if (!/^https:\/\/claude\.ai\/(artifact|code\/artifact)\//.test(url)) {
        console.error('不是合法的 claude.ai artifact 地址：' + url);
        process.exit(1);
    }
    const book = load();
    book.panels[scope] = { url, label, publishedAt: new Date().toISOString(), pageHash: pageHash() };
    writeFileSync(PANEL_FILE, JSON.stringify(book, null, 2), 'utf8');
    console.log(`面板地址已记录：${label}（${scope}）→ ${url}`);
    process.exit(0);
}

const rec = load().panels[scope];
const cur = pageHash();
console.log(JSON.stringify({
    scope,
    label,
    url: rec?.url || '',
    // true = 这块板在跑旧版页面，同步前先带 url 重发一次
    pageStale: rec && cur ? (rec.pageHash ? rec.pageHash !== cur : null) : false,
}, null, 2));
