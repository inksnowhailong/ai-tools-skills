#!/usr/bin/env node
// tvs-hud 状态栏入口：组装数据 → 按配置拼行 → 输出

import { loadConfig }                                       from './lib/config.mjs';
import { findTeamRoot, parseProjects }                      from './lib/boss.mjs';
import { parseActiveTasks }                                 from './lib/task.mjs';
import { projectLine, taskLine, taskSummaryLine }           from './lib/render.mjs';
import { collectAlerts, radarLine }                         from './lib/radar.mjs';

const cfg      = loadConfig();
const teamRoot = findTeamRoot(process.cwd());
const allTasks = parseActiveTasks();

const hasBoss = !!teamRoot;
const hasTask = allTasks.length > 0;

if (!hasBoss && !hasTask) process.exit(0);

const lines = [];
let projects = [];

if (hasBoss) {
  projects = parseProjects(teamRoot);
}

// 雷达优先：有告警时显示在最顶部
if (hasBoss && projects.length && cfg.show.has('radar')) {
  const alerts = collectAlerts(projects, allTasks);
  const rl = radarLine(alerts);
  if (rl) lines.push(rl);
}

// 项目行 or task-only 汇总
if (hasBoss && projects.length) {
  lines.push(projectLine(projects, allTasks, cfg));
} else {
  lines.push(taskSummaryLine(allTasks));
}

// 任务详情行
if (cfg.show.has('taskLine') && hasTask) {
  lines.push(taskLine(allTasks, cfg, process.cwd()));
}

if (lines.length) process.stdout.write(lines.join('\n'));
