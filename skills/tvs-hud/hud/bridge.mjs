#!/usr/bin/env node
// tvs-hud 状态栏桥接——部署到 ~/.claude/hud/bridge.mjs（由 tvs-setup 拷贝）。
// 职责：① 定位真正的 tvs-status.mjs 安装位置 ② 同步读一次 stdin ③ 直接 import
// 它导出的 render() 在本进程内跑完、写 stdout——不再 spawn 子进程（旧版用
// spawnSync 起第二个 node，两次解释器启动叠加是 statusLine 偶发"跑一半被
// Claude Code 自己的调度取消、状态栏消失"的一半原因；另一半是 git 扫描没缓存，
// 已在 lib/cache.mjs 加 TTL 缓存解决）。
// 不要直接改部署副本——改仓库里的这份，再 tvs-setup doctor --fix 同步。
//
// 为什么要一层桥接而不是直接把 statusLine.command 指向仓库/插件缓存里的 tvs-status.mjs：
// 插件缓存路径带版本号、软链安装路径因机器而异，都不适合硬编码进 settings.json；
// 桥接文件在 ~/.claude/hud/ 这个固定位置，运行时再自己找真身，装哪个版本都不用手改配置。

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';

const HOME = homedir();

function resolveVersioned(base, ...sub) {
  if (!existsSync(base)) return null;
  const SEMVER = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
  const versions = readdirSync(base)
    .filter((n) => SEMVER.test(n))
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

/** 插件缓存优先（CC 装 tvs-inksnow 插件），回退老 skills 目录（Cursor 软链/拷贝安装）。 */
function resolveTvsStatus() {
  const fromPlugin = resolveVersioned(
    join(HOME, '.claude', 'plugins', 'cache', 'tvs-inksnow', 'tvs-inksnow'),
    'skills', 'tvs-hud', 'hud', 'tvs-status.mjs');
  if (fromPlugin) return fromPlugin;
  const legacy = join(HOME, '.claude', 'skills', 'tvs-hud', 'hud', 'tvs-status.mjs');
  return existsSync(legacy) ? legacy : null;
}

const target = resolveTvsStatus();
if (!target) process.exit(0); // 没装 tvs-hud，静默退出，不报错干扰状态栏

// 同步读 stdin（Claude Code 走管道喂 JSON，非 TTY 时 fd 0 可同步读到 EOF）
let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { /* 无 stdin（TTY 手动跑）时留空 */ }

try {
  const { render } = await import(pathToFileURL(target).href);
  const out = render(raw);
  if (out) process.stdout.write(out);
} catch {
  // 真身跑挂了：静默退出而不是抛异常刷屏——状态栏这轮空着，比报错更不打扰。
  process.exit(0);
}
