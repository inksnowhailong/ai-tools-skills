#!/usr/bin/env node
/**
 * tvs-boss 面板数据出口：把在途需求的**可从文件推出来的事实**打成 JSON，供 leader 写进面板需求区。
 *
 * 分工（对应 tvs-boss「状态靠 git 现推、不落盘」的铁律）：
 *   脚本管 —— work/<slug>/ 的存在、进度台账.md「0. 当前卡点」段的卡点条目、产出文件清单。这些都有客观来源。
 *   leader 管 —— stage（派活/编码/审查/测试/待提交/完成）与 note（一句人话现状）。
 *                 这两个只有 leader 知道，脚本不猜；输出里留空位，leader 写库时自己填。
 *
 * 分支实况脚本推不出来：work/<slug>/ 不记录需求归哪个项目，只有 leader 知道。
 * 所以 branch 也留空位，leader 写库时填——它本来就要过分支闸门，手上必有这个值。
 *
 * 用法：
 *   node panel-data.mjs --root <团队根>    输出 JSON：docs + links + stale
 *   node panel-data.mjs --known a,b,c      告知库里现存的需求 slug，输出应删除的差集
 *
 * **不读地址簿、不碰网络**——那些归 tvs-panel。团队根就是范围键；tvs-task 在团队根跑时
 * 算出同一个键，于是总指挥台上「在途需求」与「全部项目的任务」并排。各项目自己那块板是
 * 另一个 artifact，与你无关——分板是物理隔离，你既删不着也看不见。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (flag(name) ? args[args.indexOf(name) + 1] ?? '' : '');

const root = value('--root') || process.cwd();
const workDir = join(root, '.tvs-boss', 'work');

function normPath(p) {
    return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
// 团队根就是范围键；它由启动协议明确定位，不存在子目录歧义。
// 面板地址不在这里查——地址簿归 tvs-panel，调用方拿到 url 再写库。
const scope = normPath(root);

/**
 * 解析待拍板清单：`work/<slug>/进度台账.md` 的「0. 当前卡点（boss 侧）」段。
 *
 * 该段是编号列表，一条一段，编号**跳号即代表已拍板删除**（不重编号）：
 *   9. **生产发帖流 [96] forum 守卫 bug**：web 私人帖被错挂到…
 *   8. （已解）boss 09-07 令三条同时开工：…
 *
 * 约定只有两条，都取自文本自带的信号，不做推断：
 *   `**加粗标题**：` → 要紧的，面板摊开；没加粗的折叠。
 *   `（已解）` 开头  → 已处理，再折一层。
 * 急/缓这里没有结构化字段，所以**不猜**——原五要素里的「不决卡住」在这个格式下不存在。
 */
function parseBlockers(file) {
    if (!existsSync(file)) return [];
    // 必须按 /\r?\n/ 切：JS 正则里 \r 是行终止符，`.` 不匹配它，
    // 留着 \r 会让 `(.*)$` 在 CRLF 文件上整条失配——不报错，只是静默少给条目。
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    const start = lines.findIndex((l) => /^## 0\./.test(l));
    if (start < 0) return [];
    let end = start + 1;
    while (end < lines.length && !/^## /.test(lines[end])) end++;

    // 按 `N. ` 起头切条，后续非空行并入上一条（条目可能跨行）
    const raws = [];
    let cur = null;
    for (const line of lines.slice(start + 1, end)) {
        const m = /^(\d+)\.\s+(.*)$/.exec(line);
        if (m) {
            if (cur) raws.push(cur);
            cur = { no: Number(m[1]), text: m[2] };
        } else if (cur && line.trim()) {
            cur.text += '\n' + line.trim();
        }
    }
    if (cur) raws.push(cur);

    return raws.map((it) => {
        const done = /^（已解）/.test(it.text);
        const text = done ? it.text.replace(/^（已解）\s*/, '') : it.text;

        const bold = /^\*\*(.+?)\*\*(.*)$/s.exec(text);
        let title, body;
        if (bold) {
            title = bold[1].trim();
            body = bold[2].replace(/^[：:]\s*/, '').trim();
        } else {
            // 没加粗就从正文切一句当标题，切在第一个句读处；切不出来就整段截断
            const cut = /^(.{4,46}?)[：:。；;]\s*/s.exec(text);
            title = cut ? cut[1].trim() : text.slice(0, 46).trim();
            body = cut ? text.slice(cut[0].length).trim() : text.slice(46).trim();
        }
        return { no: it.no, title, body, done, focus: Boolean(bold) && !done };
    });
}

/**
 * 项目注册表 → 面板上的项目入口。
 * 每个纳管项目在面板上是一个可点的入口，通到该项目自己那块 task 板——
 * boss 看完团队全局，想知道某个项目还剩什么任务没完，点一下就到，不用切目录重跑。
 * 项目还没建板时 url 为空，页面渲染成"未建板"而不是死链。
 */
function parseProjects(file) {
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const out = [];
    let cur = null;
    for (const line of lines) {
        const h = /^## (.+)$/.exec(line);
        if (h) {
            if (cur) out.push(cur);
            cur = { project: h[1].trim(), path: '' };
            continue;
        }
        if (!cur) continue;
        const p = /^- path:\s*(.+)$/.exec(line);
        if (p) cur.path = p[1].trim();
    }
    if (cur) out.push(cur);
    return out.filter((p) => p.path);
}

/** 需求产出目录里的文件清单（大产出的落点，面板上给个索引）。台账与备份不算产出。 */
function artifacts(dir) {
    try {
        return readdirSync(dir)
            .filter((f) => !/^进度台账|\.bak-\d+$/.test(f) && statSync(join(dir, f)).isFile())
            .slice(0, 12);
    } catch {
        return [];
    }
}

let slugs = [];
try {
    slugs = readdirSync(workDir).filter((f) => statSync(join(workDir, f)).isDirectory());
} catch {
    slugs = [];   // 没有 work/ 目录 = 当前没有在途需求，不是错误
}

const syncedAt = new Date().toISOString();

const docs = slugs.map((slug, i) => {
    const dir = join(workDir, slug);
    const pending = parseBlockers(join(dir, '进度台账.md'));
    return {
        slug,
        title: slug,          // leader 写库时换成人话需求摘要
        project: '',          // ↓ 以下四个只有 leader 知道，脚本不猜
        branch: '',
        stage: '',
        note: '',
        pending,
        openCount: pending.filter((p) => !p.done).length,
        focusCount: pending.filter((p) => p.focus).length,
        artifacts: artifacts(dir),
        // 归属：同一块面板可能有多个团队根在写，这个字段决定谁有权删谁
        root,
        // 每条自带同步时间：多实例各写各的，全局一个时间戳会被互相覆盖成假新鲜度
        syncedAt,
        order: i,
    };
});

const known = value('--known').split(',').map((s) => s.trim()).filter(Boolean);
const live = new Set(docs.map((d) => d.slug));

// 项目入口：写进 links 集合，面板上渲染成一排可点的项目卡
const links = parseProjects(join(root, '.tvs-boss', 'projects.md')).map((p, i) => ({
    project: p.project,
    path: p.path,
    // url 与 openTasks 由调用方合并：url 从 panel.mjs --list 按 path 对上，
    // openTasks 跑一次 tvs-task 的出口按该项目范围拿 taskCount
    url: '',
    openTasks: null,
    syncedAt,
    order: i,
}));

console.log(JSON.stringify({
    scope,
    root,
    syncedAt,
    demandCount: docs.length,
    pendingCount: docs.reduce((n, d) => n + d.openCount, 0),   // 未处理的才算积压
    docs,
    links,
    // work/ 里已清掉（需求交付）但库里还留着的——必须删，否则面板挂着已交付的需求
    stale: known.filter((s) => !live.has(s)),
}, null, 2));
