#!/usr/bin/env node
// tvs-status：状态栏渲染实现，不依赖 omc 的 HUD/IPC。
// 导出 render(rawStdinText)，由同目录 bridge.mjs 直接 import 调用（同一个 node 进程，
// 不再 spawn 子进程——两次解释器启动开销砍成一次，是修 statusLine 常"跑一半被取消而
// 消失"这个问题的一部分；另一部分是 lib/cache.mjs 给 git 扫描加的 TTL 缓存）。
// 文件底部保留 CLI 直跑入口，方便手测：`node tvs-status.mjs < mock.json`。
//
// 数据来源三块，互相独立、缺一不崩：
//   1. Claude 用量：Claude Code 原生喂给 statusLine 命令的 stdin JSON（见 lib/usage.mjs）
//   2. 当前目录 git：cwd 所在仓库的分支/状态/worktree（见 lib/git.mjs，不依赖任何登记表；
//      扫描结果经 lib/cache.mjs 缓存几秒，避免每次渲染都串行起十几个 git 子进程）
//   3. 情绪脸：由 transcript 尾部活跃度 + git 状态 + 配额/上下文压力 + 会话累计改动量现算 PAD 三轴

import { pathToFileURL } from 'url';
import { parseStdin, extractUsage, readStdinRaw } from '../scripts/lib/usage.mjs';
import { isGitRepo, branchOf, gitOf, worktreesOf, repoRootName } from '../scripts/lib/git.mjs';
import { recentActivity } from '../scripts/lib/transcript.mjs';
import { computeMood, renderMood } from '../scripts/lib/mood.mjs';
import { usageLine, contextLine } from '../scripts/lib/render.mjs';
import { cached } from '../scripts/lib/cache.mjs';
import { checkUpdate } from '../scripts/lib/version.mjs';
import { getSysMetrics } from '../scripts/lib/sysmetrics.mjs';

/**
 * @param {string} rawStdinText Claude Code 喂给 statusLine 命令的 stdin 原文（未解析的 JSON 字符串）
 * @returns {string} 渲染好的状态栏文本（可能多行），无内容时返回空串
 */
export function render(rawStdinText) {
  const stdin = parseStdin(rawStdinText);
  const usage = extractUsage(stdin);
  const cwd = usage.cwd || process.cwd();

  // 只缓存真正费子进程的部分（是否在仓库内/分支/git状态/worktree/仓库根目录名兜底）；
  // usage.repoName 来自当次 stdin、不进子进程、永远现取——否则会出现"缓存里存着上一次
  // stdin 算出的 repoName，这一次 stdin 变了但还在读旧缓存"这种串味的 bug。
  const gitInfo = cached(`repo:${cwd}`, () => {
    if (!isGitRepo(cwd)) return null;
    return { branch: branchOf(cwd), git: gitOf(cwd), worktrees: worktreesOf(cwd), rootName: repoRootName(cwd) };
  });
  const repo = gitInfo
    ? { repoName: usage.repoName || gitInfo.rootName, branch: gitInfo.branch, git: gitInfo.git, worktrees: gitInfo.worktrees }
    : null;

  const activity = recentActivity(stdin?.transcript_path || null);
  const mood = computeMood(activity, repo?.git ?? null, {
    fiveHourPercent: usage.fiveHourPercent,
    weeklyPercent: usage.weeklyPercent,
    contextPercent: usage.contextPercent,
    linesChanged: usage.linesChanged,
  });
  const face = renderMood(mood);
  const update = checkUpdate(); // 纯本地文件读取，不发网络请求
  const sys = getSysMetrics();  // 读缓存文件，过期则后台采样，不阻塞渲染

  return [usageLine(usage, update), contextLine(repo, face, sys)].filter(Boolean).join('\n');
}

// CLI 直跑（手测用）：`node tvs-status.mjs < mock.json`。bridge.mjs 走的是上面的 import，不经过这里。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = await readStdinRaw();
  const out = render(raw);
  if (out) process.stdout.write(out);
}
