// 读 Claude Code 原生喂给 statusLine 命令的 stdin JSON——不依赖 omc 的 IPC 拦截。
// 协议字段（Claude Code 官方 statusline 接口，见 https://code.claude.com/docs/en/statusline）：
//   model.id / model.display_name
//   cwd, workspace.current_dir / repo.{host,owner,name}
//   context_window.used_percentage
//   rate_limits.five_hour / seven_day .used_percentage
// 该协议还有 cost.*（会话花费/时长/改动行数）、pr.*（当前分支挂的 PR 状态）、
// effort.level（推理强度）、session_id 等字段，本文件先只提取当前用到的这几项，
// 用不到的字段缺了就是缺了，不用为了"看着全"硬塞。
// 任何字段缺失都视为"这项没有"，不臆造。

/** 解析已读到手的 stdin 原文；空串/解析失败都返回 null。 */
export function parseStdin(raw) {
  try {
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

/** 独立跑本文件（CLI 手测）时才用：自己异步读 process.stdin 到底。bridge.mjs 场景不用这个——
 * 它已经同步读过 stdin 了，直接把原文传给 render()，避免重复读/双 node 进程开销。 */
export async function readStdinRaw() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) chunks.push(chunk);
    return chunks.join('');
  } catch { return ''; }
}

/**
 * 从 stdin JSON 提炼用量摘要。
 * @param {object|null} stdin
 * @returns {{ modelName: string|null, cwd: string|null, repoName: string|null, contextPercent: number|null, fiveHourPercent: number|null, weeklyPercent: number|null, effortLevel: string|null, linesChanged: number|null }}
 */
export function extractUsage(stdin) {
  if (!stdin) return { modelName: null, cwd: null, repoName: null, contextPercent: null, fiveHourPercent: null, weeklyPercent: null, effortLevel: null, linesChanged: null };
  const modelName = (stdin.model?.display_name || stdin.model?.id || '').trim() || null;
  const cwd = stdin.cwd || stdin.workspace?.current_dir || null;
  // repo 名优先用 workspace.repo.name（解析自 git origin，远程改名不受影响）；
  // 没有 origin/不在仓库内时才兜底用目录名（下面 tvs-status.mjs 里做）。
  const repoName = (stdin.workspace?.repo?.name || '').trim() || null;
  const ctx = stdin.context_window?.used_percentage;
  const contextPercent = typeof ctx === 'number' && !Number.isNaN(ctx) ? Math.round(ctx) : null;
  const fiveHour = stdin.rate_limits?.five_hour?.used_percentage;
  const sevenDay = stdin.rate_limits?.seven_day?.used_percentage;
  const fiveHourPercent = typeof fiveHour === 'number' ? Math.round(fiveHour) : null;
  const weeklyPercent = typeof sevenDay === 'number' ? Math.round(sevenDay) : null;
  // 当前模型不支持 effort 参数时该字段整个缺失，不是空字符串——留 null 而不是臆造 'default'
  const effortLevel = (stdin.effort?.level || '').trim() || null;
  // 本次会话累计改动行数（供情绪引擎当"干了多少活"的信号，不直接展示在状态栏）
  const added = stdin.cost?.total_lines_added;
  const removed = stdin.cost?.total_lines_removed;
  const linesChanged = typeof added === 'number' && typeof removed === 'number' ? added + removed : null;
  return { modelName, cwd, repoName, contextPercent, fiveHourPercent, weeklyPercent, effortLevel, linesChanged };
}
