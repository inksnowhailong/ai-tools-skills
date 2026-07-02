// 从 transcript_path（Claude Code 原生会话记录，JSONL）的尾部窗口里，
// 提炼"最近在干什么"的活跃度信号——不落盘、不需要 hook 捕获管线，
// 每次渲染都现算，天然带一点"读历史"带来的黏性（transcript 本身就是历史）。

import { readFileSync, statSync, openSync, readSync, closeSync } from 'fs';

const TAIL_BYTES   = 200_000;   // 只读文件尾部这么多字节，避免大 transcript 拖慢渲染
const WINDOW_MS    = 15 * 60_000; // 只看最近 15 分钟的事件

/** 读文件尾部 TAIL_BYTES 字节并按行切分，丢弃可能不完整的第一行。 */
function tailLines(path) {
  let size;
  try { size = statSync(path).size; } catch { return []; }
  if (size === 0) return [];
  const start = Math.max(0, size - TAIL_BYTES);
  const len = size - start;
  const buf = Buffer.alloc(len);
  let fd;
  try {
    fd = openSync(path, 'r');
    readSync(fd, buf, 0, len, start);
  } catch { return []; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
  const text = buf.toString('utf8');
  const lines = text.split('\n');
  if (start > 0) lines.shift(); // 第一行大概率被截断，丢弃
  return lines.filter(Boolean);
}

/**
 * @param {string|null} transcriptPath
 * @returns {{ toolCallCount: number, errorRatio: number, msSinceLastTool: number|null }}
 *   toolCallCount: 最近窗口内的工具调用次数（活跃度）
 *   errorRatio: 最近窗口内工具结果里 is_error 的占比（0~1，无结果时为 0）
 *   msSinceLastTool: 距最近一次工具调用过去了多久（无记录为 null）
 */
export function recentActivity(transcriptPath) {
  if (!transcriptPath) return { toolCallCount: 0, errorRatio: 0, msSinceLastTool: null };

  const lines = tailLines(transcriptPath);
  const now = Date.now();
  let toolCallCount = 0;
  let resultCount = 0;
  let errorCount = 0;
  let lastToolAt = null;

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const t = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
    if (Number.isNaN(t) || now - t > WINDOW_MS) continue;

    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const item of content) {
      if (item.type === 'tool_use') {
        toolCallCount++;
        if (lastToolAt === null || t > lastToolAt) lastToolAt = t;
      } else if (item.type === 'tool_result') {
        resultCount++;
        if (item.is_error) errorCount++;
      }
    }
  }

  return {
    toolCallCount,
    errorRatio: resultCount > 0 ? errorCount / resultCount : 0,
    msSinceLastTool: lastToolAt !== null ? now - lastToolAt : null,
  };
}
