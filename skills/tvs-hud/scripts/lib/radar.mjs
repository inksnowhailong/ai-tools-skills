import { gitOf, lastCommitAgeOf, stashCountOf, worktreesOf } from './boss.mjs';

// ── 雷达阈值 ──────────────────────────────────────────────────────────────────
const T = {
  STALE_COMMIT_DAYS: 2,   // dirty 且 N天未提交 → 提醒
  AHEAD_PR:          1,   // 领先主线 N 提交未合
  BEHIND_REBASE:     1,   // 落后主线 N
  TASK_STALE_DAYS:   5,   // 任务进行中 N 天未更新
  STASH_WARN:        2,   // stash 条数 ≥ N → 提醒
  WT_BEHIND:         5,   // worktree 落后 ≥ N → 提醒
};

// ── ANSI ──────────────────────────────────────────────────────────────────────
const R    = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM  = '\x1b[2m';
const GRAY = '\x1b[38;5;243m';
const RED  = '\x1b[38;5;203m';
const ORG  = '\x1b[38;5;215m';
const YEL  = '\x1b[38;5;180m';

function sev(val, [warn, danger]) {
  return val >= danger ? RED : val >= warn ? ORG : YEL;
}

function clip(s, n = 14) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── 收集告警 ──────────────────────────────────────────────────────────────────
/**
 * @param {{ id: string, path: string }[]} projects
 * @param {{ title: string, icon: string, updatedStr?: string }[]} allTasks
 * @returns {{ text: string, color: string }[]}
 */
export function collectAlerts(projects, allTasks) {
  const alerts = [];

  for (const { id, path } of projects) {
    const { dirty, ahead, behind } = gitOf(path);
    const ageDays = dirty > 0 ? lastCommitAgeOf(path) : null;
    const stash   = stashCountOf(path);

    // 脏文件 + 长时间未提交
    if (dirty > 0 && ageDays != null && ageDays >= T.STALE_COMMIT_DAYS)
      alerts.push({ text: `${id} ~${dirty} 未提交${ageDays}天`, color: sev(ageDays, [T.STALE_COMMIT_DAYS, 7]) });

    if (behind >= T.BEHIND_REBASE)
      alerts.push({ text: `${id} ↓${behind} 需rebase`, color: sev(behind, [1, 10]) });

    if (ahead >= T.AHEAD_PR)
      alerts.push({ text: `${id} ↑${ahead} 未合并`, color: sev(ahead, [1, 20]) });

    if (stash >= T.STASH_WARN)
      alerts.push({ text: `${id} 📦${stash}`, color: sev(stash, [T.STASH_WARN, 5]) });

    for (const wt of worktreesOf(path)) {
      if (wt.behind >= T.WT_BEHIND)
        alerts.push({ text: `${id}/🌿${clip(wt.branch, 12)} ↓${wt.behind}`, color: sev(wt.behind, [T.WT_BEHIND, 20]) });
    }
  }

  // 停滞任务（◔）：tasks行只显图标，雷达补天数
  for (const t of allTasks) {
    if (t.icon !== '◔') continue;
    const days = staleDays(t);
    if (days != null && days >= T.TASK_STALE_DAYS)
      alerts.push({ text: `💤 ${clip(t.title, 14)} 停${days}天`, color: sev(days, [T.TASK_STALE_DAYS, 14]) });
  }

  // 红色优先排序
  const order = { [RED]: 0, [ORG]: 1, [YEL]: 2 };
  alerts.sort((a, b) => (order[a.color] ?? 3) - (order[b.color] ?? 3));
  return alerts;
}

/**
 * 格式化雷达行，无告警返回空字符串。
 * @param {{ text: string, color: string }[]} alerts
 * @returns {string}
 */
export function radarLine(alerts) {
  if (!alerts.length) return '';
  const SEP   = `  ${GRAY}·${R}  `;
  const label = `${DIM}tvs-雷达${R} 🚨${BOLD}${RED}${alerts.length}${R}`;
  const items = alerts.map(({ text, color }) => `${BOLD}${color}${text}${R}`).join(SEP);
  return label + `  ${GRAY}│${R}  ` + items;
}

// ── 内部工具 ──────────────────────────────────────────────────────────────────
function staleDays(task) {
  if (!task.updatedStr) return null;
  return Math.floor((Date.now() - new Date(task.updatedStr)) / 86400_000);
}
