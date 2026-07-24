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

// 机器资源利用率段：cpu/mem/disk 三个百分比，各自分档配色（阈值略有差异）。
// disk 是"磁盘活动时间%"（Task Manager 口径），不是空间占用。数据见 lib/sysmetrics.mjs。
function sysSeg(sys) {
  if (!sys) return null;
  const seg = [];
  if (sys.cpu != null)  seg.push(`cpu${tierColor(sys.cpu, 70, 90, 30)}${sys.cpu}%${C.R}`);
  if (sys.mem != null)  seg.push(`mem${tierColor(sys.mem, 75, 90, 40)}${sys.mem}%${C.R}`);
  if (sys.disk != null) seg.push(`disk${tierColor(sys.disk, 60, 85, 20)}${sys.disk}%${C.R}`);
  return seg.length ? seg.join(' ') : null;
}

// tvs 版本段：有新版亮绿 + ⇡远端版本，否则暗灰只显当前版本；非插件安装（active 为空）不显示
function versionSeg(update) {
  if (!update?.active) return null;
  return update.hasUpdate
    ? `${C.GREEN}tvs ${update.active}⇡${update.available}${C.R}`
    : `${C.DIM}tvs ${update.active}${C.R}`;
}

// effort 档位 → 颜色，越高越"热"：low/medium 冷静，high 起提醒，xhigh/max 最热烈
const EFFORT_COLOR = { low: C.GRAY, medium: C.BLUE, high: C.ORANGE, xhigh: C.RED, max: C.RED };

// 情绪脸配色：脸型 + 颜色双通道表达同一信号——hot 卡壳红、warm 干活橙、cold 平稳蓝、quiet 空闲暗灰
const MOOD_COLOR = { hot: C.RED, warm: C.ORANGE, cold: C.BLUE, quiet: C.GRAY };

function moodSeg(mood) {
  if (!mood?.face) return null;
  return `${MOOD_COLOR[mood.situation] ?? C.GRAY}${mood.face}${C.R}`;
}

/**
 * 行一：情绪脸领衔（第一眼位置、按 situation 上色）+ 模型/effort + ctx/5h/周三项各自独立展示
 *      （用 "·" 分隔），末尾紧跟 tvs 版本——之前顶在行二右尾，靠 COLUMNS 右对齐，宽度算不准时等于看不见。
 * @param {{modelName:string|null, effortLevel:string|null, contextPercent:number|null, fiveHourPercent:number|null, weeklyPercent:number|null}} usage
 * @param {{active:string|null, available:string|null, hasUpdate:boolean}|null} update tvs 版本检测，见 lib/version.mjs
 * @param {{ face: string, situation: string }|null} mood 情绪脸，见 lib/mood.mjs
 * @returns {string} 无任何字段时返回空串
 */
export function usageLine(usage, update = null, mood = null) {
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
  const ver = versionSeg(update);
  if (ver) head.push(ver);

  const rest = head.join(`  ${C.GRAY}·${C.R}  `);
  const face = moodSeg(mood);
  // 脸不参与 "·" 分组——它是整行的情绪前缀，不是又一个指标段
  if (!face) return rest;
  return rest ? `${face}  ${rest}` : face;
}

function gitStr({ dirty, ahead, behind }) {
  let s = '';
  if (dirty)  s += `${C.YELLOW}~${dirty}${C.R}`;
  if (ahead)  s += `${C.GREEN}↑${ahead}${C.R}`;
  if (behind) s += `${C.RED}↓${behind}${C.R}`;
  return s || `${C.GRAY}✓${C.R}`;
}

/**
 * 行二：机器资源利用率 + 分支 + git 状态 → 仓库名（次要上下文）→ worktree 徽标。
 * 情绪脸已移至行一开头（第一眼位置）；不在 git 仓库且无 sys 数据时整行省略。
 * @param {{ repoName: string, branch: string, git: object, worktrees: Array }|null} repo
 * @param {{cpu:number|null, mem:number|null, disk:number|null}|null} sys 机器资源利用率，见 lib/sysmetrics.mjs
 * @returns {string}
 */
export function contextLine(repo, sys = null) {
  const parts = [];
  if (repo) {
    let chunk = `${C.MAUVE}⎇ ${repo.branch}${C.R} ${gitStr(repo.git)}`;
    if (repo.repoName) chunk += `  ${C.GRAY}${repo.repoName}${C.R}`;
    const attention = repo.worktrees.filter((w) => w.dirty > 0 || w.behind > 0).length;
    if (attention) chunk += `  🌿${C.ORANGE}${attention}${C.R}`;
    parts.push(chunk);
  }
  let head = parts.join('   ');

  // 机器资源利用率（cpu/mem/disk）顶在行二最左，与后面的分支/情绪用 "·" 分隔
  const sysStr = sysSeg(sys);
  if (sysStr) head = `${sysStr}  ${C.GRAY}·${C.R}  ${head}`;

  return head;
}
