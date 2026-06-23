import { gitOf, branchOf, worktreesOf } from './boss.mjs';
import { normPath } from './task.mjs';

// ── ANSI 颜色常量（Tokyo Night 256-color）────────────────────────────────────
export const C = {
  R:      '\x1b[0m',
  DIM:    '\x1b[2m',
  BLUE:   '\x1b[38;5;110m',  // 项目名
  YELLOW: '\x1b[38;5;180m',  // dirty / 停滞
  GREEN:  '\x1b[38;5;150m',  // ahead
  RED:    '\x1b[38;5;203m',  // behind
  GRAY:   '\x1b[38;5;243m',  // 分隔 / clean / 待开始
  CYAN:   '\x1b[38;5;117m',  // 进行中
  MAUVE:  '\x1b[38;5;183m',  // worktree 分支名
};

const SEP    = `  ${C.GRAY}│${C.R}  `;  // 项目间分隔，与 · 任务等待区分
const WT_SEP = `  `;                    // worktree 前空格，无额外符号

// ── 内部工具 ──────────────────────────────────────────────────────────────────

function gitStr({ dirty, ahead, behind }) {
  let s = '';
  if (dirty)  s += `${C.YELLOW}~${dirty}${C.R}`;
  if (ahead)  s += `${C.GREEN}↑${ahead}${C.R}`;
  if (behind) s += `${C.RED}↓${behind}${C.R}`;
  return s || `${C.GRAY}✓${C.R}`;
}

function taskCountStr(tasks) {
  const n = icon => tasks.filter(t => t.icon === icon).length;
  return [
    n('◑') && `🔥${C.CYAN}${n('◑')}${C.R}`,
    n('◔') && `💤${C.YELLOW}${n('◔')}${C.R}`,
    n('○') && `⏳${C.GRAY}${n('○')}${C.R}`,
  ].filter(Boolean).join(' ');
}

/** worktree 紧凑片段：🌿feat/auth ↓19 */
function worktreeChunks(repoPath) {
  return worktreesOf(repoPath).map(wt => {
    const name = wt.branch.length > 18 ? wt.branch.slice(0, 17) + '…' : wt.branch;
    const gs   = gitStr(wt);
    return `🌿${C.MAUVE}${name}${C.R} ${gs}`;
  });
}

// ── 公开渲染函数 ───────────────────────────────────────────────────────────────

/**
 * 行1：按项目分组（boss 存在时）。
 * 每个项目：名称 [分支名] git状态 任务计数 [worktree...]
 * @param {{ id: string, path: string }[]} projects
 * @param {{ icon: string, paths: string[] }[]} allTasks
 * @param {{ show: Set<string> }} cfg
 * @returns {string}
 */
export function projectLine(projects, allTasks, cfg) {
  const parts = projects.map(({ id, path }) => {
    const norm      = normPath(path);
    const projTasks = allTasks.filter(t => t.paths.some(p => p === norm));
    const wts       = cfg.show.has('worktrees') ? worktreeChunks(path) : [];

    let chunk = `${C.BLUE}${id}${C.R}`;
    if (cfg.show.has('branchName')) {
      const b = branchOf(path);
      if (b) chunk += ` ${C.GRAY}(${b})${C.R}`;
    }
    if (cfg.show.has('git'))                        chunk += ` ${gitStr(gitOf(path))}`;
    if (cfg.show.has('taskCounts') && projTasks.length) chunk += ` ${taskCountStr(projTasks)}`;
    if (wts.length)                                 chunk += WT_SEP + wts.join(WT_SEP);
    return chunk;
  });
  return `${C.DIM}tvs-boss${C.R} ${C.GRAY}│${C.R}  ` + parts.join(SEP);
}

/**
 * 行2：任务详情行（标题预览，最多 8 条）。
 * 当前所在项目（cwd 落在其路径内）的任务整体排到最前，组内再按 进行中→停滞→待开始。
 * @param {{ title: string, icon: string, paths: string[] }[]} allTasks
 * @param {{ taskTitleLen: number, taskLineMax?: number }} cfg
 * @param {string} [cwd] 当前工作目录，用于"本项目优先"排序
 * @returns {string}
 */
export function taskLine(allTasks, cfg, cwd) {
  const max = cfg.taskLineMax ?? 8;

  // 本项目优先：cwd 命中某任务的项目路径（同路径或在其子目录内）则提前
  const cwdNorm   = normPath(cwd ?? '');
  const inCurrent = t => cwdNorm && t.paths.some(p => cwdNorm === p || cwdNorm.startsWith(p + '/'));
  const iconRank  = { '◑': 0, '◔': 1, '○': 2 };  // 进行中→停滞→待开始

  const shown = [...allTasks]
    .sort((a, b) => {
      const ca = inCurrent(a) ? 0 : 1, cb = inCurrent(b) ? 0 : 1;
      if (ca !== cb) return ca - cb;                            // 本项目整体提前
      return (iconRank[a.icon] ?? 9) - (iconRank[b.icon] ?? 9); // 组内按状态
    })
    .slice(0, max);

  const ICON = { '◑': '🔥', '◔': '💤', '○': '⏳' };
  const parts = shown.map(({ title, icon }) => {
    const sym     = ICON[icon] ?? icon;
    const clipped = title.length > cfg.taskTitleLen
      ? title.slice(0, cfg.taskTitleLen) + '…'
      : title;
    return `${sym} ${clipped}`;
  });

  const rest = allTasks.length > max ? ` ${C.GRAY}+${allTasks.length - max}${C.R}` : '';
  return `${C.DIM}tvs-tasks${C.R} ${C.GRAY}│${C.R}  ` + parts.join(SEP) + rest;
}

/**
 * task-only 汇总行（无 boss 时）。
 * @param {{ icon: string }[]} allTasks
 * @returns {string}
 */
export function taskSummaryLine(allTasks) {
  return `${C.DIM}tvs-tasks${C.R} ${C.GRAY}│${C.R}  ` + taskCountStr(allTasks);
}
