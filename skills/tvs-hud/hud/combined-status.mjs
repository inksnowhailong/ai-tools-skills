#!/usr/bin/env node
// 合并状态栏：omc-hud（主进程 import）+ tvs-hud（子进程）
// --omc-hud 参数使 omc 的 sl.command.includes("omc-hud") 检测通过
//
// omc 必须在主进程里 import，因为它通过 Claude Code IPC 读取状态；
// 作为子进程运行会丢失 IPC 上下文，退化成诊断文字。
//
// 本文件是「源头」，由 tvs-setup 部署到 ~/.claude/hud/combined-status.mjs。
// 不要直接改部署副本——改这里，再 tvs-setup doctor --fix 同步。

import { existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

const node   = process.execPath;
const HOME   = homedir();

// ── 在 <base>/<版本>/<...sub> 里按 SEMVER 选最新版命中的文件，无则 null ──────────
// omc 与 tvs 两个插件缓存目录都是「版本号子目录」结构，共用这一套选版逻辑。
function resolveVersioned(base, ...sub) {
  if (!existsSync(base)) return null;
  const SEMVER = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
  const versions = readdirSync(base)
    .filter(n => SEMVER.test(n))
    .sort((a, b) => {
      const pa = a.split('-')[0].split('.').map(Number);
      const pb = b.split('-')[0].split('.').map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
      return 0;
    });
  for (const v of versions) {
    const p = join(base, v, ...sub);
    if (existsSync(p)) return p;
  }
  return null;
}

// ── 解析 omc 的 dist/hud/index.js 路径（插件缓存）────────────────────────────────
function resolveOmcHud() {
  return resolveVersioned(
    join(HOME, '.claude', 'plugins', 'cache', 'omc', 'oh-my-claudecode'),
    'dist', 'hud', 'index.js');
}

// ── 解析 tvs-hud 的 status.mjs 路径 ──────────────────────────────────────────────
// 插件缓存优先（CC 装 tvs-inksnow 插件时 skill 在此），回退老 skills 目录（Cursor/软链/拷贝安装）。
// 修复点：原先写死 ~/.claude/skills/tvs-hud/scripts/status.mjs，插件安装下该路径不存在 →
// runSubprocess 静默返回空 → tvs 三行消失且无报错。
function resolveTvsHud() {
  const fromPlugin = resolveVersioned(
    join(HOME, '.claude', 'plugins', 'cache', 'tvs-inksnow', 'tvs-inksnow'),
    'skills', 'tvs-hud', 'scripts', 'status.mjs');
  if (fromPlugin) return fromPlugin;
  const legacy = join(HOME, '.claude', 'skills', 'tvs-hud', 'scripts', 'status.mjs');
  return existsSync(legacy) ? legacy : null;
}

// ── 主进程内 import + 拦截 stdout ──────────────────────────────────────────────
async function captureInProcess(modulePath) {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  // 拦截
  process.stdout.write = (chunk, enc, cb) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    if (typeof enc === 'function') enc();
    else if (typeof cb === 'function') cb();
    return true;
  };
  try {
    await import(pathToFileURL(modulePath).href);
  } catch {}
  // 等待 omc 内部的异步 IPC 完成（有输出就好，最多等 800ms）
  await new Promise(resolve => {
    const deadline = setTimeout(resolve, 800);
    let ticks = 0;
    const poll = () => {
      if (chunks.length > 0) { clearTimeout(deadline); resolve(); return; }
      if (++ticks < 80) setImmediate(poll); else { clearTimeout(deadline); resolve(); }
    };
    setImmediate(poll);
  });
  process.stdout.write = orig;
  return chunks.join('').trimEnd();
}

// ── 子进程运行 tvs-hud（不需要 IPC，子进程 OK）────────────────────────────────
function runSubprocess(script) {
  if (!existsSync(script)) return '';
  const r = spawnSync(node, [script], {
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
    cwd: process.cwd(),
  });
  return r.stdout?.toString().trimEnd() ?? '';
}

// ── main ──────────────────────────────────────────────────────────────────────
const tvsScript = resolveTvsHud();

// tvs-hud 先启（子进程异步），omc 主进程 import 同时跑
const tvsOut = tvsScript ? runSubprocess(tvsScript) : '';   // spawnSync = 等结果

const omcPath = resolveOmcHud();
const omcOut  = omcPath ? await captureInProcess(omcPath) : '';

const lines = [omcOut, tvsOut].filter(Boolean);
if (lines.length) process.stdout.write(lines.join('\n'));
