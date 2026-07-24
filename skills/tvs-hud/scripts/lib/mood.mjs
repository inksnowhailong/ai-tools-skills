// v1 情绪引擎：不落盘、不接 hook 事件捕获，每次渲染直接从「transcript 尾部活跃度」+
// 「当前 git 状态」+「配额/上下文压力」+「本次会话改动量」现算 PAD 三轴。
// transcript 本身就是历史，读它天然带一点黏性；换来的是零状态文件、零额外管线——
// 先出一个能用的版本，参见 E:\inksnow\Thoughts\docs\tvs情绪记忆HUD-skill设计文档.md §十 开放问题 1。
import { pickKaomoji } from './kaomoji.mjs';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const IDLE_MS = 20 * 60_000; // 20 分钟无操作视为「闲」

/**
 * @param {{ toolCallCount: number, errorRatio: number, msSinceLastTool: number|null }} activity
 * @param {{ dirty: number, ahead: number, behind: number, stash: number }|null} git 不在仓库时传 null
 * @param {{ fiveHourPercent?: number|null, weeklyPercent?: number|null, contextPercent?: number|null, linesChanged?: number|null }} signals
 *   fiveHourPercent/weeklyPercent：配额用量（0~100）；contextPercent：上下文窗口占用（0~100）；
 *   linesChanged：本次会话累计改动行数（cost.total_lines_added + total_lines_removed），衡量"干了多少活"。
 *   任何一项缺失都视为没有这个信号，不参与计算，不臆造。
 * @returns {{ pad: {valence:number, energy:number, control:number}, situation: string }}
 */
export function computeMood(activity, git, signals = {}) {
  const { toolCallCount, errorRatio, msSinceLastTool } = activity;
  const { fiveHourPercent = null, weeklyPercent = null, contextPercent = null, linesChanged = null } = signals;
  const idle = msSinceLastTool === null || msSinceLastTool > IDLE_MS;

  // energy：工具调用密度是主驱动，空闲自然蔫回低位；本次会话累计改动量大也算"投入度"高，往上顶一点
  const density = clamp01(toolCallCount / 12); // 15 分钟窗口内 ~12 次调用视为满格
  const throughput = linesChanged == null ? 0 : clamp01(linesChanged / 400); // 累计改 400 行视为"干了不少活"
  const energy = idle ? 0.25 : clamp01(0.3 + density * 0.6 + throughput * 0.15);

  // valence：错误率拉低，干净地推进拉高
  const valence = clamp01(0.55 - errorRatio * 0.7 + (idle ? 0 : 0.05));

  // 三种"憋屈感"压力源，各自有自己的起效阈值（超过阈值才明显起作用，避免小额用量就皱眉）：
  //   5h 配额（最紧迫，阈值最低）> 上下文窗口（次之）> 周配额（最不紧迫，阈值最高）
  const quotaPressure = fiveHourPercent == null ? 0 : clamp01((fiveHourPercent - 70) / 30);
  const ctxPressure = contextPercent == null ? 0 : clamp01((contextPercent - 75) / 25);
  const weeklyPressure = weeklyPercent == null ? 0 : clamp01((weeklyPercent - 80) / 20);
  const pressure = Math.max(quotaPressure, ctxPressure * 0.9, weeklyPressure * 0.6);

  // control：git 状态越乱越低（脏文件多/落后主线/有 stash 堆积/领先太多没合并），配额+上下文吃紧也拉低掌控感
  let control = 0.55;
  if (git) {
    control -= Math.min(0.25, git.dirty * 0.03);
    control -= Math.min(0.15, git.behind * 0.03);
    control -= Math.min(0.1, git.stash * 0.02);
    control -= Math.min(0.1, Math.max(0, git.ahead - 3) * 0.02); // 领先太多没合并=活攒着没交付，也算一种失控
    if (git.dirty === 0 && git.behind === 0) control += 0.1;
  }
  control -= errorRatio * 0.2;
  control -= pressure * 0.25;
  control = clamp01(control);

  // situation：错误率高或任一压力源告急都算「卡壳」（hot 池，脸更炸/紧绷）
  const situation = idle ? 'quiet' : (errorRatio > 0.3 || pressure > 0.5) ? 'hot' : toolCallCount >= 6 ? 'warm' : 'cold';

  return { pad: { valence, energy, control }, situation };
}

/**
 * 只出颜文字本身——脸就是标签，不额外配文字描述；situation 一并带出，供渲染层按情绪上色。
 * @param {{ pad: object, situation: string }} mood
 * @returns {{ face: string, situation: string }}
 */
export function renderMood(mood) {
  return { face: pickKaomoji(mood.situation, mood.pad), situation: mood.situation };
}
