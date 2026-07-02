// tvs 插件版本更新检测——纯本地文件读取，不发网络请求（statusLine 忌讳慢操作）。
// 原理：插件缓存目录名本身就是"你正在用的版本"（~/.claude/plugins/cache/tvs-inksnow/
// tvs-inksnow/<版本号>/）；本机 marketplace 克隆是独立的 git 检出，其 plugin.json 版本号
// 可能已经比缓存新（比如仓库刚发新版但你还没跑 /plugin update 激活）。两者一比较就知道
// "有没有新版本已经拉到本地、还没生效"——查不到真正意义上"远端还有没有更新"（那需要
// 联网 git fetch，不适合塞进每次渲染都跑的状态栏脚本）。

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const CACHE_BASE = join(HOME, '.claude', 'plugins', 'cache', 'tvs-inksnow', 'tvs-inksnow');
const MARKETPLACE_PLUGIN_JSON = join(HOME, '.claude', 'plugins', 'marketplaces', 'tvs-inksnow', '.claude-plugin', 'plugin.json');

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

/** marketplace 本地克隆里 plugin.json 声明的版本；克隆不存在/解析失败返回 null。 */
function marketplaceVersion() {
  try {
    const pkg = JSON.parse(readFileSync(MARKETPLACE_PLUGIN_JSON, 'utf8'));
    return pkg.version || null;
  } catch { return null; }
}

/**
 * @returns {{ active: string|null, available: string|null, hasUpdate: boolean }}
 *   hasUpdate=true 表示 marketplace 克隆里的版本比当前生效版本新（本地已拉到、未激活）。
 */
export function checkUpdate() {
  const active = activeVersion();
  const available = marketplaceVersion();
  const hasUpdate = !!(active && available && semverGt(available, active));
  return { active, available, hasUpdate };
}
