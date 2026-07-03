// tvs 插件版本更新检测——与 GitHub 远端比较，但绝不在渲染路径里联网。
// 原理：
//   · active（当前生效版本）= 插件缓存目录名里最高的 semver（~/.claude/plugins/cache/
//     tvs-inksnow/tvs-inksnow/<版本>/），纯本地读目录。
//   · available（远端最新版本）= GitHub 上 .claude-plugin/plugin.json 的 version，但它
//     经由「后台异步抓取 + 文件 TTL 缓存」得到：渲染时只同步读一次缓存文件（极快），
//     缓存过期就 detach 一个后台 node 进程去联网抓、写回缓存，不阻塞本次渲染——下次
//     渲染自然读到新值。这样既跟了远端、又守住「状态栏绝不做联网慢操作」的底线。
// 为什么必须落文件 + 起子进程：每次状态栏渲染是全新 node 进程，渲染完立刻退出；进程内
//   内存缓存跨不了渲染，未 await 的 fetch 会随进程退出被杀——只能靠文件缓存 + detached 子进程。

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, tmpdir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const HOME = homedir();
const CACHE_BASE = join(HOME, '.claude', 'plugins', 'cache', 'tvs-inksnow', 'tvs-inksnow');
const REMOTE_CACHE = join(tmpdir(), 'tvs-hud-cache', 'remote-version.json');
const REMOTE_URL = 'https://raw.githubusercontent.com/inksnowhailong/ai-tools-skills/main/.claude-plugin/plugin.json';
const REMOTE_TTL_MS = 3 * 60 * 60 * 1000; // 3 小时抓一次远端足够，状态栏不需要更实时

function parseSemver(v) {
  const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function semverGt(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

/** 当前生效的插件版本——插件缓存目录名里最高的那个 semver 子目录。非插件安装（软链/拷贝）返回 null。 */
function activeVersion() {
  if (!existsSync(CACHE_BASE)) return null;
  const SEMVER = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
  const versions = readdirSync(CACHE_BASE).filter((n) => SEMVER.test(n));
  return versions.sort((a, b) => (semverGt(a, b) ? -1 : semverGt(b, a) ? 1 : 0))[0] || null;
}

/** 读远端版本缓存 {version, checkedAt}；不存在/损坏返回 null。 */
function readRemoteCache() {
  try { return JSON.parse(readFileSync(REMOTE_CACHE, 'utf8')); } catch { return null; }
}

/** 缓存不存在或超过 TTL 视为过期。 */
function remoteCacheStale() {
  try { return Date.now() - statSync(REMOTE_CACHE).mtimeMs >= REMOTE_TTL_MS; }
  catch { return true; }
}

/** 把缓存 mtime 顶到现在（保留上次抓到的版本）——先占位再起后台进程，避免并发渲染重复 spawn。 */
function touchRemoteCache() {
  try {
    mkdirSync(dirname(REMOTE_CACHE), { recursive: true });
    const prev = readRemoteCache();
    writeFileSync(REMOTE_CACHE, JSON.stringify({ version: prev?.version ?? null, checkedAt: Date.now() }));
  } catch { /* 占位失败无所谓，最坏是这轮多起一个后台进程 */ }
}

/** detach 一个后台 node 进程去抓远端版本、写缓存——不阻塞当前渲染。 */
function refreshRemoteInBackground() {
  try {
    const self = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [self, '--refresh-remote'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
  } catch { /* 起不来就算了，下个 TTL 窗口再试 */ }
}

/**
 * @returns {{ active: string|null, available: string|null, hasUpdate: boolean }}
 *   available 为最近一次抓到的 GitHub 远端版本；hasUpdate=true 表示远端比当前生效版本新。
 */
export function checkUpdate() {
  const active = activeVersion();
  // 只有插件安装才有"生效版本"可比；过期就先占位、再后台刷新（不等结果）
  if (active && remoteCacheStale()) {
    touchRemoteCache();
    refreshRemoteInBackground();
  }
  const available = readRemoteCache()?.version || null;
  const hasUpdate = !!(active && available && semverGt(available, active));
  return { active, available, hasUpdate };
}

// ── 后台刷新入口：由上面 refreshRemoteInBackground 起的 detached 子进程调用 ──
// 正常被 render 链 import 时不带这个 flag，下面整段跳过；只有 `node version.mjs --refresh-remote` 才执行。
if (process.argv.includes('--refresh-remote')) {
  fetchRemoteVersion().then((version) => {
    if (version) {
      try {
        mkdirSync(dirname(REMOTE_CACHE), { recursive: true });
        writeFileSync(REMOTE_CACHE, JSON.stringify({ version, checkedAt: Date.now() }));
      } catch { /* 写失败下次再抓 */ }
    }
    process.exit(0);
  });
}

/** 抓 GitHub 上 plugin.json 的 version；断网/超时/非 200 一律返回 null（沿用旧缓存）。 */
async function fetchRemoteVersion() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(REMOTE_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const pkg = await res.json();
    return typeof pkg?.version === 'string' ? pkg.version : null;
  } catch { return null; }
}
