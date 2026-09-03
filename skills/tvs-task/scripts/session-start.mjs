#!/usr/bin/env node
/**
 * tvs-task SessionStart hook：仓库级任务摘要注入。
 *
 * 匹配规则：会话 cwd 与任务 repo 互为前缀（在 repo 里开会话，或在多 repo 父目录开会话）即命中。
 * 无账本 / 无命中 → 静默退出零输出（绝不打扰无关会话）。
 * 注入内容：命中任务摘要（短名+进度+未完成子项+派生标注）+ 新分支候选 + 播种协议摘要。
 * 摘要只给标题不给 ID 展示（ID 仅作锚点写进 metadata）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
    ACTIVE_FILE, loadActive, deriveTask, progressBar, normPath, pathsOverlap,
    isRepo, git, mainBranch, mainRef, integrationBranches, loadIgnore, subRepo,
} from './lib.mjs';

let payload = {};
try {
    payload = JSON.parse(await readStdin());
} catch { /* 无载荷也继续，用 process.cwd() 兜底 */ }
const cwd = normPath(payload.cwd || process.cwd());

if (!existsSync(ACTIVE_FILE)) process.exit(0);

const { tasks } = loadActive();
const matched = tasks.filter((t) => t.repos.some((r) => pathsOverlap(normPath(r.path), cwd)));
if (!matched.length) process.exit(0);

// ---------- 任务摘要（git 派生，命中任务通常 ≤5 个，成本可控） ----------
const lines = ['# tvs-task 在册任务（账本 ~/.tasklog/active.md，详细协议见 tvs-task skill）', ''];
for (const t of matched) {
    const d = deriveTask(t, true);
    const badges = [];
    if (d.progress.total) badges.push(`${progressBar(d.progress.done, d.progress.total)} ${d.progress.done}/${d.progress.total}`);
    if (d.accept) badges.push('⏳待验收——提醒用户确认后归档');
    else if (d.stalled) badges.push(`🧊停滞(最近提交 ${d.lastActivity})`);
    const todo = t.subs.filter((s) => s.status !== 'completed').map((s) => s.title).join(' / ');
    lines.push(`- ${t.shortName}〔锚 ${t.id}〕 ${badges.join(' · ')}${todo ? `｜未完成子项: ${todo}` : ''}`);
}

// ---------- 新分支候选（只扫命中任务的 repo，最多 6 个） ----------
const candidates = findCandidates(matched);
if (candidates.length) {
    lines.push('', '未登记的新分支（毕业制候选，问用户要不要挂为子项/新任务；拒绝则记入 ~/.tasklog/ignore.txt）：');
    for (const c of candidates) lines.push(`- ${c.repoName} · ${c.branch}（领先 ${c.ahead}，最后提交 ${c.lastDate}）`);
}

// ---------- 环境检查：内置 Task 工具门控 ----------
if (!todoToolsEnabled()) {
    lines.push('', '⚠ 全局 settings.json 的 env 未配置 CLAUDE_CODE_ENABLE_TODO_TOOLS="1"——内置 Task 工具（TaskCreate 等）可能被门控关闭。播种前先确认工具是否存在；不存在则提醒用户加上该配置并重启会话，本次降级为文本清单。');
}

// ---------- 播种协议摘要 ----------
lines.push('', [
    '播种协议（本 hook 不播种；只在用户显式执行 /tvs-task 时播，范围=脚本按 cwd 命中的全部任务）：',
    '① 有 TaskCreate 工具时：跑 render.mjs --seed 拿播种计划，逐行照单 TaskCreate（subject / metadata.anchor / status 全用脚本给的，禁止自编 ID）；父行 subject="<短名> ｜ <一句当前阶段>"，in_progress 任务的父行全程保持 in_progress，阶段变了改写尾巴；',
    '② 子行 subject="│ <子项标题> — <一句进展/结论>"，动工时置 in_progress，做完置 completed；',
    '③ subject 上限 90 字符、写自足可读的整句（对象+动作+进展），细节进 description；会话新长出的属于该任务的步骤同样 "│ "+锚；临时杂务不带锚；subject 里绝不出现锚/ID；',
    '④ 更新纪律：每做完一个动作当轮就 TaskUpdate 对应子行（转状态或刷尾巴），不许攒到最后——自检时机：子项刚做完 / 准备回复用户前 / 切下一个子项前。忘标的 SessionEnd 救不回来，账本进度会延后；',
    '⑤ 会话结束 hook 自动按锚回收（无分支子项完成状态 + 迭代记录），无需手动写账本；',
    '⑥ 无 TaskCreate 工具的环境退化为普通文本清单，其余照旧。',
    '禁止：因对话里出现任务字眼就自动建账本任务——账本写入只走用户显式指令或上面候选的确认。',
].join('\n'));

console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
}));

// ---------- helpers ----------

function findCandidates(matchedTasks) {
    const ignore = loadIgnore();
    const repoMap = new Map(); // norm -> {path, branches:Set}
    for (const t of matchedTasks) {
        for (const r of t.repos) {
            const key = normPath(r.path);
            if (!repoMap.has(key)) repoMap.set(key, { path: r.path, branches: new Set() });
        }
        for (const s of t.subs) {
            if (!s.branch) continue;
            const repo = subRepo(t, s);
            if (repo) repoMap.get(normPath(repo))?.branches.add(s.branch);
        }
    }
    const out = [];
    let scanned = 0;
    for (const { path, branches } of repoMap.values()) {
        if (scanned >= 6) break; // 注入是热路径，扫描上限保底
        if (!isRepo(path)) continue;
        scanned += 1;
        const base = mainRef(path, mainBranch(path));
        if (!base) continue;
        const trunk = new Set(['HEAD', mainBranch(path), ...integrationBranches(path)]);
        let locals;
        try { locals = git(path, 'for-each-ref --format=%(refname:short) refs/heads').split(/\r?\n/).filter(Boolean); } catch { continue; }
        for (const br of locals) {
            if (trunk.has(br) || br.startsWith('release/') || branches.has(br)) continue;
            if (ignore.has(`${path}\t${br}`)) continue;
            let ahead = 0, ageDays = Infinity, lastDate = '';
            try { ahead = parseInt(git(path, `rev-list --count ${base}.."${br}"`), 10) || 0; } catch { continue; }
            try {
                const ts = parseInt(git(path, `log -1 --format=%ct "${br}"`), 10);
                if (ts) { lastDate = new Date(ts * 1000).toISOString().slice(0, 10); ageDays = (Date.now() - ts * 1000) / 86400000; }
            } catch { continue; }
            if (ahead >= 2 && ageDays <= 14 && ahead <= 50) {
                out.push({ repoName: path.replace(/[\\/]+$/, '').split(/[\\/]/).pop(), branch: br, ahead, lastDate });
            }
        }
    }
    return out;
}

/** 全局 settings.json 是否已开 TODO 工具门控（读不到/没配 → false） */
function todoToolsEnabled() {
    try {
        const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'));
        return settings.env?.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1' || process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1';
    } catch { return process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS === '1'; }
}

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.on('data', (c) => { data += c; });
        process.stdin.on('end', () => resolve(data));
        setTimeout(() => resolve(data), 1500); // stdin 不来也不挂死
    });
}
