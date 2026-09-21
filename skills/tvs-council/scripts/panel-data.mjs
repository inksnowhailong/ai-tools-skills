#!/usr/bin/env node
/**
 * tvs-council 面板数据出口：把落盘的议会目录打成 JSON，供主持人写进面板议会区。
 *
 * 脚本能自己算出的（不用主持人填）：
 *   轮次、草案版本、issue 原文（编号/席位/严重度/针对/陈述）、每条的处置状态、
 *   **收敛走势**（逐轮未决数）、待发起人裁决的条目标题。
 * 因为这些全在文件里：issue 原文在回信里，状态在处置表里，白话清单在待裁决清单.md 里。
 * 主持人只补一个 `phase`（当前停在哪一步），那是唯一只有它知道的。
 *
 * 兼容三代落盘格式（议会协议演进过，老会议不能因此读不出来）：
 *   新（2026-09-18 起）  质询轮-{n}/回信-{席位}.md 放 issue 原文，issues-{n}.md 放处置表
 *   中（2026-09-17）     issues-{n}.md 里 issue 原文与处置表同文件
 *   旧（改版前）         round-{n}.md / 分歧登记表.md，结构完全不同 → 只登记会议本身，标 legacy
 *
 * **不算范围键、不读地址簿**——那些归 tvs-panel，范围键用 --scope 传进来。
 * （踩过：本脚本原来只做字符串归一化、不规整到仓库根，在项目子目录里跑会算出与
 * tvs-task 不同的键，找不到板、下一步就给子目录另建一块孤儿板。）
 *
 * 用法：
 *   node panel-data.mjs --scope <范围键>   范围键从 tvs-panel 的 panel.mjs 取
 *   node panel-data.mjs --dir <会议目录名>  只出这一场
 *   node panel-data.mjs --limit 10        最多几场（默认 12，按日期倒序）
 *   node panel-data.mjs --known a,b       告知库里现存的文档 id，输出应删除的差集
 *
 * 写库时 doc_id 用输出里的 `docId`（ASCII），不要用 `dir`——议题短名是中文，库不收。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const COUNCIL_DIR = join(homedir(), '.tvs-council');

const SEATS = { SX: '思绪', JG: '架构师', QC: '穷查理', YH: '用户' };

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (flag(name) ? args[args.indexOf(name) + 1] ?? '' : '');

// 范围键由 panel.mjs 唯一计算后传进来，这里只原样带上，不自己算
const scope = (value('--scope') || process.cwd()).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** 读文本并统一换行——CRLF 里的 \r 在 JS 正则中是行终止符，留着会让 `$` 锚点整行失配 */
function read(file) {
    try {
        return readFileSync(file, 'utf8').split(/\r?\n/).join('\n');
    } catch {
        return '';
    }
}
function ls(dir) {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

/**
 * 解析 issue 原文。格式由 seats.md 通用段焊死，字段一个不少：
 *   ### ISSUE-{席位缩写}-{序号}
 *   - 针对：…  - 严重度：…  - 陈述：…  - 依据：…  - 定案方式：…
 * 缺字段留空——宁可显示不全，也不替席位编。
 */
function parseIssues(text, round) {
    const out = [];
    for (const block of text.split(/^### /m).slice(1)) {
        const m = /^(ISSUE-([A-Z]{2})-(\d+))/.exec((block.split('\n')[0] || '').trim());
        if (!m) continue;
        const field = (label) => (block.match(new RegExp(`^- ${label}：(.+)$`, 'm')) || [])[1]?.trim() ?? '';
        const target = field('针对');
        out.push({
            id: m[1],
            seat: SEATS[m[2]] || m[2],
            round,
            severity: field('严重度'),
            target,
            // 针对整份草案的是替代路 issue——它不攻某一节，而是主张整条路走错了
            alt: /整份草案|替代路/.test(target),
            claim: field('陈述'),
            basis: field('依据'),
            close: field('定案方式'),
            status: '',
            reason: '',
        });
    }
    return out;
}

/**
 * 解析处置表（markdown 表格）拿每条 issue 的最终状态。
 * 一个文件里可能有多张表（「书记」按席位分表），全扫。
 * 列名按表头定位，不按列序——表头列序在不同场次里变过。
 */
function parseDispositions(text) {
    const map = {};
    const lines = text.split('\n');

    let cols = null;
    for (const line of lines) {
        if (!line.trim().startsWith('|')) { cols = null; continue; }
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        if (!cells.length) continue;

        // 分隔行 |---|---| 跳过
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;

        if (!cols) {
            // 第一行非分隔的表格行当表头
            cols = {
                id: cells.findIndex((c) => /ISSUE|编号/i.test(c)),
                severity: cells.findIndex((c) => /严重度/.test(c)),
                status: cells.findIndex((c) => /处置|最终处置/.test(c)),
                reason: cells.findIndex((c) => /理由/.test(c)),
            };
            if (cols.id < 0 || cols.status < 0) cols = null;   // 不是处置表
            continue;
        }

        const raw = cells[cols.id] || '';
        const m = /(?:ISSUE-)?([A-Z]{2})-(\d+)/.exec(raw);
        if (!m) continue;
        const id = `ISSUE-${m[1]}-${m[2]}`;
        map[id] = {
            status: cols.status >= 0 ? (cells[cols.status] || '') : '',
            reason: cols.reason >= 0 ? (cells[cols.reason] || '') : '',
            severity: cols.severity >= 0 ? (cells[cols.severity] || '') : '',
        };
    }
    return map;
}

/**
 * 处置词 → 归一状态。未决 = 还压在议会或发起人手上的。
 * 处置可能写成链式（`采纳→后作废`），只看最后一段——那才是这条的下场。
 */
function normStatus(raw) {
    if (!raw) return { key: 'open', open: true };
    const last = String(raw).split(/→|->/).pop().trim();
    if (/作废|推翻/.test(last)) return { key: '已作废', open: false };
    if (/待裁决/.test(last)) return { key: '待裁决', open: true };
    if (/待验证/.test(last)) return { key: '待验证', open: true };
    if (/暂定/.test(last)) return { key: '暂定', open: false };
    if (/驳回/.test(last)) return { key: '已驳回', open: false };
    if (/采纳/.test(last)) return { key: '已采纳', open: false };
    if (/登记|替代路/.test(last)) return { key: '已登记', open: false };
    if (/关闭|撤回/.test(last)) return { key: '已关闭', open: false };
    return { key: last.slice(0, 8), open: true };   // 没见过的词按未决算，宁可多报
}

/**
 * 纪要「决策记录」里的定宽块：`SX-1  需改 采纳→后作废  说明`。
 * 这是整场结束后的最终定论，比逐轮处置表更权威，所以优先用它。
 */
function parseMinutes(text) {
    const map = {};
    for (const line of text.split('\n')) {
        const m = /^\s*([A-Z]{2}-\d+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
        if (!m) continue;
        // 严重度必须是协议的三值之一，否则这行只是碰巧长得像——正文里
        // 「SX-1 的处理 方式…」这种句子也能匹配上面的正则，认了就是往面板里塞垃圾
        if (!/^(致命|需改|提问)$/.test(m[2])) continue;
        map[`ISSUE-${m[1]}`] = { severity: m[2], status: m[3], reason: m[4].trim() };
    }
    return map;
}

/** 待裁决清单.md → 条目标题（全文太长，面板只给标题和问题句，正文回文件看） */
function parseOwnerList(text) {
    const out = [];
    for (const block of text.split(/^## /m).slice(1)) {
        const title = (block.split('\n')[0] || '').trim();
        if (!title) continue;
        const q = (block.match(/^- \*\*问题\*\*：(.+)$/m) || [])[1]?.trim() ?? '';
        out.push({ title, question: q });
    }
    return out;
}

/** 目录名 → 日期 + 议题短名（协议：{YYYY-MM-DD}-{议题短名}） */
function splitName(name) {
    const m = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(name);
    return m ? { date: m[1], topic: m[2] } : { date: '', topic: name };
}

/**
 * 面板文档 id 必须是 ASCII（库只收 [A-Za-z0-9_-.~:@+]），而议题短名是中文，
 * 直接拿目录名当 id 会被库拒收。用「日期 + 目录名哈希」生成稳定的 ASCII id：
 * 同一场会每次算出同一个 id，改名才会变（改名本就该当成另一场）。
 */
function docIdOf(name, date) {
    const h = createHash('sha1').update(name).digest('hex').slice(0, 8);
    return date ? `${date}-${h}` : h;
}

function maxIndex(files, re) {
    let max = 0;
    for (const f of files) {
        const m = re.exec(f);
        if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
}

const allDirs = ls(COUNCIL_DIR).filter((f) => statSync(join(COUNCIL_DIR, f)).isDirectory());

let dirs = allDirs.slice();
const only = value('--dir');
if (only) dirs = dirs.filter((d) => d === only);
dirs.sort().reverse();                       // 目录名以日期开头，倒序 = 最近的在前
dirs = dirs.slice(0, Number(value('--limit')) || 20);

const syncedAt = new Date().toISOString();

const docs = dirs.map((name, i) => {
    const dir = join(COUNCIL_DIR, name);
    const files = ls(dir);
    const { date, topic } = splitName(name);

    const roundDirs = files.filter((f) => /^质询轮-\d+$/.test(f));
    const round = Math.max(maxIndex(files, /^issues-(\d+)\.md$/), maxIndex(roundDirs, /^质询轮-(\d+)$/));
    const draftVersion = maxIndex(files, /^草案-v(\d+)/);

    // 旧格式（round-N.md / 分歧登记表.md）结构完全不同，只登记会议本身
    const legacy = round === 0 && files.some((f) => /^round-\d+\.md$/.test(f));

    const issues = [];
    const trend = [];
    // 纪要里的最终定论优先于逐轮处置表——整场结束后它才是这条 issue 的下场
    const final = files.includes('纪要.md') ? parseMinutes(read(join(dir, '纪要.md'))) : {};
    let dispFound = Object.keys(final).length;

    for (let n = 1; n <= round; n++) {
        // issue 原文：新格式在 质询轮-n/回信-*.md，中格式在 issues-n.md
        let raw = '';
        const rd = join(dir, `质询轮-${n}`);
        const replies = ls(rd).filter((f) => /^回信-.+\.md$/.test(f));
        if (replies.length) raw = replies.map((f) => read(join(rd, f))).join('\n\n');
        else raw = read(join(dir, `issues-${n}.md`));

        const got = parseIssues(raw, n);

        // 处置状态：纪要的最终定论优先，否则回落到本轮处置表
        const disp = parseDispositions(read(join(dir, `issues-${n}.md`)));
        dispFound += Object.keys(disp).length;
        for (const it of got) {
            const d = final[it.id] || disp[it.id];
            if (d) {
                it.status = d.status;
                it.reason = d.reason;
                if (!it.severity) it.severity = d.severity;
            }
        }
        issues.push(...got);

        // 本轮收敛快照：到这一轮为止提出的全部 issue 里，还有多少压着没结
        const openNow = issues.filter((x) => normStatus(x.status).open).length;
        trend.push({ round: n, total: issues.length, open: openNow, added: got.length });
    }

    // 一条处置都没解析到（那场的处置表是散文或代码块，格式与两代模板都不同）：
    // 此时每条 issue 都会落成 open，报出来就是"全部未决"的假信号——比不报更糟。
    // 所以明说状态未知，让面板显示"状态未解析"而不是一个错数字。
    const statusKnown = dispFound > 0;

    const ownerFile = files.find((f) => /待裁决清单\.md$/.test(f));
    const forOwner = ownerFile ? parseOwnerList(read(join(dir, ownerFile))) : [];

    const openIssues = issues.filter((x) => normStatus(x.status).open);

    return {
        docId: docIdOf(name, date),
        dir: name,
        date,
        topic,
        legacy,
        round,
        draftVersion,
        // 纪要存在 = 这场已经收了（拍板或散会），面板上折起来
        closed: files.includes('纪要.md'),
        // 详情只给还压着的：面板对已结的 issue 只用到计数，传全文是白费带宽和文档配额。
        // 一条 issue 的陈述/依据/定案方式常有几百字，×100 条就是几十 KB。
        issues: issues.map((x) => {
            const key = statusKnown ? normStatus(x.status).key : '';
            const slim = { id: x.id, seat: x.seat, round: x.round, severity: x.severity, statusKey: key };
            if (!statusKnown || normStatus(x.status).open) {
                return { ...slim, target: x.target, alt: x.alt, claim: x.claim, basis: x.basis, close: x.close, status: x.status, reason: x.reason };
            }
            return slim;
        }),
        issueCount: issues.length,
        statusKnown,
        // 状态解析不出来时给 null（未知），不是 0 也不是全部——面板据此显示"状态未解析"
        openCount: statusKnown ? openIssues.length : null,
        trend: statusKnown ? trend : [],
        forOwner,
        phase: '',      // ← 只有主持人知道：当前停在协议的哪一步
        scope,
        syncedAt,
        order: i,
    };
});

const known = value('--known').split(',').map((s) => s.trim()).filter(Boolean);

// live 按**磁盘上全部目录**算，不受 --limit / --dir 影响。
// 否则超出窗口的会议会被判成"该删"，面板上无声消失，而目录明明还在——
// 清理必须是显式动作（删目录），不能是查询参数的副作用。
const live = new Set(allDirs.map((d) => docIdOf(d, splitName(d).date)));

console.log(JSON.stringify({
    scope,
    syncedAt,
    councilCount: docs.length,
    docs,
    stale: known.filter((d) => !live.has(d)),
}, null, 2));
