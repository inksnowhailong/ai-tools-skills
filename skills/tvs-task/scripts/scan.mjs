#!/usr/bin/env node
/**
 * tvs-task git 状态驱动扫描器
 * 读取 ~/.tasklog/active.md，解析每个任务的 (仓库路径, 分支)，扫真实 git 状态：
 *   1. 已合并检测：分支已合入该 repo 主分支的任务 → 应归档清单。
 *   2. reopen 检测：归档任务的分支重新领先主分支 → 应重新打开清单。
 *   3. 新分支候选：在册 repo 里有提交、但 active.md 无对应任务的本地分支 → 新任务候选。
 *
 * 主干（主分支 + 集成/测试分支）按 repo 动态识别，不再硬编码 main/master。
 * 完成语义：只有合入主分支才算完成，合入集成/测试分支不算。
 *
 * 用法：
 *   node scan.mjs            纯读取，只打印中文 markdown 报告（默认）
 *   node scan.mjs --apply    落地三件事：① 已合并任务移入 archive.md（加完成日期）+ 清理超 30 天归档；
 *                            ② reopen 任务从 archive.md 移回 active.md（追加迭代记录）；
 *                            ③ 把进行中任务的「更新」日期刷新为其分支最后提交日期（git 驱动停滞判定）。
 *
 * 零依赖：仅用 node 内置模块。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const apply = args.includes('--apply');

const dir = join(homedir(), '.tasklog');
const activeFile = join(dir, 'active.md');
const archiveFile = join(dir, 'archive.md');
const ignoreFile = join(dir, 'ignore.txt');

/** 集成/测试分支别名集合：仅用于排除，不参与完成判定 */
const INTEGRATION_ALIASES = ['develop', 'dev', 'test', 'testing', 'staging', 'uat'];

/** 今天日期 YYYY-MM-DD（本地时区） */
function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 在 repo 内执行 git 命令；失败统一抛错，由调用方 try/catch 静默跳过 */
function git(repo, cmd) {
    return execSync(`git ${cmd}`, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();
}

/** 判断 repo 是否为合法 git 仓库 */
function isRepo(repo) {
    if (!existsSync(repo)) return false;
    try {
        git(repo, 'rev-parse --is-inside-work-tree');
        return true;
    } catch {
        return false;
    }
}

/** 判断某个 ref 是否真实存在（本地 head 或远端跟踪皆可） */
function refExists(repo, ref) {
    try {
        git(repo, `rev-parse --verify --quiet ${ref}`);
        return true;
    } catch {
        return false;
    }
}

/**
 * 动态识别该 repo 的主分支名。解析顺序：
 *   1. origin/HEAD 指向的远端默认分支（最权威）
 *   2. 本地依次验证 main、master，取第一个存在的
 *   3. 都没有 → null（该 repo 的合并/候选/reopen 检测整体跳过）
 */
function mainBranch(repo) {
    try {
        const head = git(repo, 'symbolic-ref --short refs/remotes/origin/HEAD');
        const name = head.replace(/^origin\//, '');
        if (name) return name;
    } catch {
        // 取不到远端默认分支，降级到本地名
    }
    for (const name of ['main', 'master']) {
        if (refExists(repo, `refs/heads/${name}`)) return name;
    }
    return null;
}

/**
 * 把主分支名解析为一个真实存在的 ref：优先本地 head，其次远端跟踪。
 * company repo 本地主分支可能缺失或滞后，必须兜这种情况。返回 ref 字符串或 null。
 */
function mainRef(repo, name) {
    if (!name) return null;
    if (refExists(repo, `refs/heads/${name}`)) return `refs/heads/${name}`;
    if (refExists(repo, `refs/remotes/origin/${name}`)) return `origin/${name}`;
    return null;
}

/**
 * 动态识别该 repo 的集成/测试分支：在别名集合里返回真实存在的本地分支（refs/heads）。
 * 用途仅一个：与主分支一起组成「主干集合」，主干分支永不进新任务候选。
 */
function integrationBranches(repo) {
    return INTEGRATION_ALIASES.filter((name) => refExists(repo, `refs/heads/${name}`));
}

/**
 * 解析 active.md，得到任务列表（复用 render.mjs 的解析思路）。
 * 每个任务保留原始块文本 rawBlock（不含开头 '## '），用于归档时原样搬运。
 */
function parseActive(raw) {
    const tasks = [];
    for (const block of raw.split(/^## /m).slice(1)) {
        const head = block.match(/^(T-\d+) · (.+)/);
        if (!head) continue;
        const [, id, title] = head;
        const fieldSec = block.split('###')[0];
        const status = (fieldSec.match(/\*\*状态\*\*：(.+)/) || [])[1]?.trim() ?? '';
        const projects = [...fieldSec.matchAll(/^\s*- `([^`]+)`(?:\s*—\s*`([^`]+)`)?/gm)]
            .map((m) => ({ path: m[1], branch: m[2] ?? '' }));
        // 去掉块尾的分隔线与多余空行，保留纯净块体（不含 '## '）
        const body = block.replace(/\n+---\s*$/, '').replace(/\s+$/, '');
        tasks.push({ id, title: title.trim(), status, projects, rawBlock: body });
    }
    return tasks;
}

/**
 * 解析 archive.md，得到归档任务列表（结构同 parseActive，额外带 doneDate）。
 * 用于 reopen 检测与 30 天清理。
 */
function parseArchive(raw) {
    const tasks = [];
    for (const block of raw.split(/^## /m).slice(1)) {
        const head = block.match(/^(T-\d+) · (.+)/);
        if (!head) continue;
        const [, id, title] = head;
        const fieldSec = block.split('###')[0];
        const projects = [...fieldSec.matchAll(/^\s*- `([^`]+)`(?:\s*—\s*`([^`]+)`)?/gm)]
            .map((m) => ({ path: m[1], branch: m[2] ?? '' }));
        const doneDate = (block.match(/\*\*完成\*\*：(\d{4}-\d{2}-\d{2})/) || [])[1] ?? '';
        const body = block.replace(/\n+---\s*$/, '').replace(/\s+$/, '');
        tasks.push({ id, title: title.trim(), projects, doneDate, rawBlock: body });
    }
    return tasks;
}

/** 读忽略名单：每行 `仓库路径<TAB>分支名`，返回 Set('repo\tbranch') */
function loadIgnore() {
    const set = new Set();
    if (!existsSync(ignoreFile)) return set;
    for (const line of readFileSync(ignoreFile, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [repo, branch] = trimmed.split('\t');
        if (repo && branch) set.add(`${repo}\t${branch}`);
    }
    return set;
}

/** 取某分支最后一次提交日期 YYYY-MM-DD；取不到返回 '' */
function lastCommitDate(repo, branch) {
    try {
        const ts = parseInt(git(repo, `log -1 --format=%ct ${branch}`), 10);
        if (ts) return new Date(ts * 1000).toISOString().slice(0, 10);
    } catch {
        // 取不到提交信息
    }
    return '';
}

// ---------- 主流程 ----------

if (!existsSync(activeFile)) {
    console.log('（无任务文件 ~/.tasklog/active.md）');
    process.exit(0);
}

const activeRaw = readFileSync(activeFile, 'utf8');
const tasks = parseActive(activeRaw);
const ignore = loadIgnore();

/** 已合并应归档清单：仅收集"全部 (repo,branch) 对都已合入主分支"的任务 */
const merged = [];
/** 部分合并：只有部分分支合入主分支，不自动归档，单独提示 */
const partial = [];

/** 收集每个 repo 下"在册"的分支集合，供新分支候选检测排除 */
const trackedBranches = new Map(); // repo -> Set(branch)

for (const t of tasks) {
    const pairs = t.projects.filter((p) => p.path && p.branch);
    if (!pairs.length) continue;
    let mergedCount = 0;
    let mainOnly = false; // 直接挂在主分支上的任务无"合并事件"可检测，禁止自动归档
    for (const p of pairs) {
        const key = p.path;
        if (!trackedBranches.has(key)) trackedBranches.set(key, new Set());
        trackedBranches.get(key).add(p.branch);
        if (!isRepo(p.path)) continue;
        const name = mainBranch(p.path);
        const base = mainRef(p.path, name);
        if (!base) continue;
        // 分支本身就是主分支时祖先检测恒成立，会把进行中任务误判为已合并
        if (p.branch === name) {
            mainOnly = true;
            continue;
        }
        try {
            // 祖先检测：分支尖是主分支祖先 ⇒ 已合入（squash merge 查不到，按未合处理，不打扰）
            // 间接合并链（feature→dev→main）天然被祖先检测覆盖
            git(p.path, `merge-base --is-ancestor ${p.branch} ${base}`);
            mergedCount += 1;
        } catch {
            // 非祖先（未合或 squash），跳过
        }
    }
    // 含主分支直挂分支的任务永不自动归档；否则要求全部分支都已合入主分支
    if (!mainOnly && mergedCount === pairs.length) {
        merged.push(t);
    } else if (mergedCount > 0) {
        partial.push({ task: t, mergedCount, total: pairs.length });
    }
}

/** reopen 检测：归档任务的分支重新领先主分支（合并后又改了） */
const reopened = [];
let archiveRaw = '';
let archivedTasks = [];
if (existsSync(archiveFile)) {
    archiveRaw = readFileSync(archiveFile, 'utf8');
    archivedTasks = parseArchive(archiveRaw);
    for (const t of archivedTasks) {
        const pairs = t.projects.filter((p) => p.path && p.branch);
        if (!pairs.length) continue;
        const reopenPairs = [];
        for (const p of pairs) {
            if (!isRepo(p.path)) continue;
            const name = mainBranch(p.path);
            const base = mainRef(p.path, name);
            if (!base) continue;
            if (p.branch === name) continue; // 主分支本身不参与 reopen
            if (!refExists(p.path, `refs/heads/${p.branch}`)) continue; // 分支已删除，不 reopen
            try {
                // 仍是主分支祖先 ⇒ 没新东西，不 reopen
                git(p.path, `merge-base --is-ancestor ${p.branch} ${base}`);
            } catch {
                // 不再是祖先 ⇒ 合并后又领先主分支 ⇒ reopen
                reopenPairs.push(p);
            }
        }
        if (reopenPairs.length) reopened.push({ task: t, pairs: reopenPairs });
    }
}

/** 新分支候选检测 */
const candidates = [];

for (const [repo, branches] of trackedBranches) {
    if (!isRepo(repo)) continue;
    const name = mainBranch(repo);
    const base = mainRef(repo, name);
    // 动态主干集合：主分支 + 集成/测试分支 + HEAD 兜底，主干分支永不进候选
    const trunk = new Set(['HEAD']);
    if (name) trunk.add(name);
    for (const b of integrationBranches(repo)) trunk.add(b);
    let locals;
    try {
        locals = git(repo, "for-each-ref --format=%(refname:short) refs/heads")
            .split(/\r?\n/)
            .filter(Boolean);
    } catch {
        continue;
    }
    for (const br of locals) {
        if (trunk.has(br) || br.startsWith('release/')) continue;
        if (branches.has(br)) continue; // active.md 已有对应任务
        if (ignore.has(`${repo}\t${br}`)) continue; // 永久忽略
        if (!base) continue; // 无主分支，无法比较领先量，跳过
        let ahead = 0;
        try {
            ahead = parseInt(git(repo, `rev-list --count ${base}..${br}`), 10) || 0;
        } catch {
            continue;
        }
        let ageDays = Infinity;
        let lastDate = '';
        try {
            const ts = parseInt(git(repo, `log -1 --format=%ct ${br}`), 10);
            if (ts) {
                lastDate = new Date(ts * 1000).toISOString().slice(0, 10);
                ageDays = (Date.now() - ts * 1000) / 86400000;
            }
        } catch {
            continue;
        }
        // 噪音阀门：三条全部满足才算候选（领先 ≥2 且 最近提交 ≤14天 且 领先 ≤50）
        if (ahead >= 2 && ageDays <= 14 && ahead <= 50) {
            candidates.push({ repo, branch: br, ahead, lastDate });
        }
    }
}

// ---------- --apply：归档写入 + reopen 移回 + 更新日期刷新 + 30 天清理 ----------

if (apply) {
    const doneDate = today();
    const reopenIds = new Set(reopened.map((r) => r.task.id));

    // 1. 给每个待归档块在字段区（第一个 ### 之前）插入"完成"行
    const archivedBlocks = merged.map((t) => {
        const idx = t.rawBlock.indexOf('###');
        const line = `- **完成**：${doneDate}\n`;
        if (idx < 0) {
            return `${t.rawBlock.replace(/\s+$/, '')}\n${line.trimEnd()}`;
        }
        const fieldPart = t.rawBlock.slice(0, idx).replace(/\s+$/, '');
        const rest = t.rawBlock.slice(idx);
        return `${fieldPart}\n${line}\n${rest}`;
    });

    // 2. 清理现有归档：丢弃超 30 天的，以及本次被 reopen 的（reopen 块要移回 active.md）
    const cutoff = Date.now() - 30 * 86400000;
    const archivedExisting = archivedTasks
        .filter((t) => {
            if (reopenIds.has(t.id)) return false; // reopen 的从归档移除
            if (t.doneDate && new Date(t.doneDate).getTime() < cutoff) return false; // 超 30 天丢弃
            return true;
        })
        .map((t) => t.rawBlock);

    // 3. 新归档置顶，拼回 archive.md（保留标题）；有内容才写盘，避免凭空生成空文件
    const allArchived = [...archivedBlocks, ...archivedExisting];
    if (allArchived.length) {
        const archiveOut = `# 已归档任务\n\n${allArchived.map((b) => `## ${b}`).join('\n\n---\n\n')}\n`;
        writeFileSync(archiveFile, archiveOut, 'utf8');
    }

    // 4. 把 reopen 任务块从归档形态转回 active 形态（去完成行、状态置进行中、追加迭代、更新日期）
    const reopenedBlocks = reopened.map((r) => transformReopen(r.task.rawBlock, doneDate));

    // 5. 重建 active.md：移除已归档任务、刷新进行中任务的更新日期、追加 reopen 块
    //    任一动作发生（归档 / reopen / 日期刷新可能改内容）都需要重写，故合并为一次写盘
    const mergedIds = new Set(merged.map((t) => t.id));
    const segments = activeRaw.split(/^## /m);
    const header = segments[0]; // 文件头（含 _下个ID_）
    const keptBlocks = segments
        .slice(1)
        .filter((block) => {
            const m = block.match(/^(T-\d+) · /);
            return !(m && mergedIds.has(m[1]));
        })
        .map((block) => {
            const body = block.replace(/\n+---\s*$/, '').replace(/\s+$/, '');
            return refreshUpdatedDate(body);
        });

    const allActive = [...keptBlocks, ...reopenedBlocks];
    const bodyOut = allActive.map((b) => `## ${b}`).join('\n\n---\n\n');
    const activeOut = header.replace(/\s+$/, '') + '\n\n' + (bodyOut ? `${bodyOut}\n\n---\n` : '');
    writeFileSync(activeFile, activeOut, 'utf8');
}

/**
 * 把归档任务块转回 active 形态：去掉「完成」行、状态置 🔄 进行中、
 * 迭代记录末尾追加「合并后又改」一条、更新日期为今日。
 */
function transformReopen(rawBlock, dateStr) {
    let block = rawBlock;
    // 去掉完成行
    block = block.replace(/^- \*\*完成\*\*：.*\n?/m, '');
    // 状态置进行中
    block = block.replace(/(\*\*状态\*\*：).+/, `$1🔄 进行中`);
    // 更新日期
    block = block.replace(/(\*\*更新\*\*：).+/, `$1${dateStr}`);
    // 计算下一个迭代版本号
    const vers = [...block.matchAll(/^#### v(\d+) ·/gm)].map((m) => parseInt(m[1], 10));
    const nextV = (vers.length ? Math.max(...vers) : 0) + 1;
    const iter = `\n\n#### v${nextV} · ${dateStr} · 合并后又改\n状态：🔄 进行中`;
    block = block.replace(/\s+$/, '') + iter;
    return block;
}

/**
 * 刷新进行中任务的「更新」日期为其各分支最后提交日期的最新者（git 驱动停滞判定）。
 * 非进行中任务、无分支、取不到提交日期时原样返回。
 */
function refreshUpdatedDate(rawBlock) {
    const fieldSec = rawBlock.split('###')[0];
    const status = (fieldSec.match(/\*\*状态\*\*：(.+)/) || [])[1]?.trim() ?? '';
    if (!status.includes('进行中')) return rawBlock;
    const projects = [...fieldSec.matchAll(/^\s*- `([^`]+)`(?:\s*—\s*`([^`]+)`)?/gm)]
        .map((m) => ({ path: m[1], branch: m[2] ?? '' }))
        .filter((p) => p.path && p.branch);
    let latest = '';
    for (const p of projects) {
        if (!isRepo(p.path)) continue;
        const d = lastCommitDate(p.path, p.branch);
        if (d && d > latest) latest = d;
    }
    if (!latest) return rawBlock;
    return rawBlock.replace(/(\*\*更新\*\*：).+/, `$1${latest}`);
}

// ---------- 输出报告 ----------

const out = [];
out.push('## ✅ 检测到已合并、应归档的任务');
out.push('');
if (merged.length) {
    if (apply) out.push(`_已执行 --apply，以下任务已移入 archive.md（完成日期 ${today()}）_`);
    for (const t of merged) {
        const proj = t.projects
            .filter((p) => p.path && p.branch)
            .map((p) => `${p.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}/${p.branch}`)
            .join('、');
        out.push(`- ${t.id} ${t.title} （${proj}）`);
    }
} else {
    out.push('无');
}
if (partial.length) {
    out.push('');
    out.push('> 部分合并（仅部分分支进主分支，未自动归档，请人工确认）：');
    for (const p of partial) {
        out.push(`> - ${p.task.id} ${p.task.title}（${p.mergedCount}/${p.total} 分支已合）`);
    }
}

out.push('');
out.push('## 🔄 检测到应重新打开（reopen）的归档任务');
out.push('');
if (reopened.length) {
    if (apply) out.push('_已执行 --apply，以下任务已从 archive.md 移回 active.md_');
    for (const r of reopened) {
        const proj = r.pairs
            .map((p) => `${p.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}/${p.branch}`)
            .join('、');
        out.push(`- ${r.task.id} ${r.task.title} （${proj}）`);
    }
} else {
    out.push('无');
}

out.push('');
out.push('## 🌱 未跟踪的新分支候选');
out.push('');
if (candidates.length) {
    for (const c of candidates) {
        const name = c.repo.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
        // 带完整仓库路径，便于用户拒绝时直接拼出 ignore.txt 的 `路径<TAB>分支` 行（同名仓库可区分）
        out.push(`- ${name} · ${c.branch}（领先 ${c.ahead} 提交，最后提交 ${c.lastDate || '未知'}） — \`${c.repo}\``);
    }
} else {
    out.push('无');
}

console.log(out.join('\n'));
