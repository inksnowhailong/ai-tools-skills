// ── ANSI 颜色（Tokyo Night 256-color，与其余 tvs skill 面板同色系）───────────
const C = {
  R:      '\x1b[0m',
  DIM:    '\x1b[2m',
  BLUE:   '\x1b[38;5;110m',
  YELLOW: '\x1b[38;5;180m',
  GREEN:  '\x1b[38;5;150m',
  RED:    '\x1b[38;5;203m',
  ORANGE: '\x1b[38;5;215m',
  GRAY:   '\x1b[38;5;243m',
  MAUVE:  '\x1b[38;5;183m',
};

// 四档动态配色，覆盖整个 0~100% 区间（不是到了 warn 阈值才开始变色）：
// 低位安全区用绿色正向反馈，中段中性灰，warn 起橙，danger 起红。
function tierColor(n, warn, danger, safe) {
  return n >= danger ? C.RED : n >= warn ? C.ORANGE : n <= safe ? C.GREEN : C.GRAY;
}

// ctx 带标签 + 进度条——一眼看出"还剩多少余量"，比读数字直观（参照官方文档的多行示例）。
function ctxBar(n, width = 10) {
  if (n == null) return null;
  const filled = Math.max(0, Math.min(width, Math.round((n / 100) * width)));
  const bar = '▓'.repeat(filled) + '░'.repeat(width - filled);
  return `ctx${tierColor(n, 70, 85, 40)}[${bar}]${n}%${C.R}`;
}

// ctx / 5h / 周三个占比各自独立成段，不再拼进一个紧凑块——分开的标签+数值组合更好认，
// 不会出现"5h43"这种看着像一个词、实际是"5h 配额 43%"的歧义。
function pctSeg(label, n, warn, danger, safe) {
  if (n == null) return null;
  return `${label} ${tierColor(n, warn, danger, safe)}${n}%${C.R}`;
}

// effort 档位 → 颜色，越高越"热"：low/medium 冷静，high 起提醒，xhigh/max 最热烈
const EFFORT_COLOR = { low: C.GRAY, medium: C.BLUE, high: C.ORANGE, xhigh: C.RED, max: C.RED };

/** 去掉 ANSI 转义码后的可见字符长度，供右对齐算间距用。 */
function visibleLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * 把 tail 推到行尾——Claude Code 会在跑脚本前设好 COLUMNS 环境变量（>=2.1.153），
 * 拿不到就降级成固定间距，不强算，避免在旧版本/异常环境里把行硬撑爆或对不齐。
 */
function pushToEdge(head, tail) {
  const cols = Number(process.env.COLUMNS);
  if (Number.isFinite(cols) && cols > 20) {
    const pad = cols - visibleLen(head) - visibleLen(tail);
    if (pad >= 2) return head + ' '.repeat(pad) + tail;
  }
  return head + '  ' + tail;
}

/**
 * 行一：模型/effort + ctx/5h/周三项各自独立展示（左侧，高优先级、常看的信息，用 "·" 分隔）
 *      + tvs 版本（右侧行尾，低优先级、偶尔瞄一眼的信息）。
 * @param {{modelName:string|null, effortLevel:string|null, contextPercent:number|null, fiveHourPercent:number|null, weeklyPercent:number|null}} usage
 * @param {{active:string|null, available:string|null, hasUpdate:boolean}|null} update tvs 插件版本检测结果，见 lib/version.mjs
 * @returns {string} 无任何字段时返回空串
 */
export function usageLine(usage, update = null) {
  const head = [];
  if (usage.modelName) {
    // effort 用 "·" 紧挨模型名，视觉上是同一件事的两个属性，不当独立分组
    const effort = usage.effortLevel ? `${C.GRAY}·${C.R}${EFFORT_COLOR[usage.effortLevel] ?? C.GRAY}${usage.effortLevel}${C.R}` : '';
    head.push(`${C.BLUE}${usage.modelName}${C.R}${effort}`);
  }
  const bar = ctxBar(usage.contextPercent);
  if (bar) head.push(bar);
  const fiveHour = pctSeg('5h', usage.fiveHourPercent, 60, 85, 30);
  if (fiveHour) head.push(fiveHour);
  const weekly = pctSeg('周', usage.weeklyPercent, 60, 85, 30);
  if (weekly) head.push(weekly);

  const tail = update?.active
    ? (update.hasUpdate
        ? `${C.GREEN}tvs ${update.active}⇡${update.available}${C.R}`
        : `${C.DIM}tvs ${update.active}${C.R}`)
    : '';

  if (!head.length && !tail) return '';
  const headStr = head.join(`  ${C.GRAY}·${C.R}  `);
  return tail ? pushToEdge(headStr, tail) : headStr;
}

function gitStr({ dirty, ahead, behind }) {
  let s = '';
  if (dirty)  s += `${C.YELLOW}~${dirty}${C.R}`;
  if (ahead)  s += `${C.GREEN}↑${ahead}${C.R}`;
  if (behind) s += `${C.RED}↓${behind}${C.R}`;
  return s || `${C.GRAY}✓${C.R}`;
}

/**
 * 行二：分支 + git 状态（最常看，放最前）→ 仓库名（次要上下文）→ worktree 徽标 → 情绪脸。
 * 不在 git 仓库时只剩情绪部分。
 * @param {{ repoName: string, branch: string, git: object, worktrees: Array }|null} repo
 * @param {{ face: string }} mood 只有 face——脸本身就是标签，不额外配文字描述
 * @returns {string}
 */
export function contextLine(repo, mood) {
  const parts = [];
  if (repo) {
    let chunk = `${C.MAUVE}⎇ ${repo.branch}${C.R} ${gitStr(repo.git)}`;
    if (repo.repoName) chunk += `  ${C.GRAY}${repo.repoName}${C.R}`;
    const attention = repo.worktrees.filter((w) => w.dirty > 0 || w.behind > 0).length;
    if (attention) chunk += `  🌿${C.ORANGE}${attention}${C.R}`;
    parts.push(chunk);
  }
  parts.push(mood.face);
  return parts.join('   ');
}
