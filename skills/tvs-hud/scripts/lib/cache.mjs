// 给"扫 git 状态"这类偏慢的操作加短 TTL 缓存，按官方 statusLine 文档推荐的模式
// （见 https://code.claude.com/docs/en/statusline #cache-expensive-operations）：
// statusLine 命令在每条新消息后都会重跑，跑慢了会被下一轮更新直接取消（整行消失）。
// 仓库 worktree 一多，每次现查要串行起十几个 git 子进程，Windows 上进程 spawn 开销
// 又比 Linux 高，很容易跑不完——缓存几秒钱就能把绝大多数渲染变成纯读文件，秒回。

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const CACHE_DIR = join(tmpdir(), 'tvs-hud-cache');
const TTL_MS = 4000;

function keyToFile(key) {
  // 路径当 key 用，把分隔符/冒号换掉即可，不需要真哈希——碰撞概率对这个用途无所谓
  const safe = String(key).replace(/[\\/:]+/g, '_');
  return join(CACHE_DIR, `${safe}.json`);
}

/**
 * 缓存包装：key 命中且未过期直接返回缓存值；否则跑 compute() 拿新值、写缓存、返回。
 * compute 抛错时不缓存，直接把错误抛给调用方（不吞异常，方便定位问题）。
 * @param {string} key
 * @param {() => any} compute
 * @returns {any}
 */
export function cached(key, compute) {
  const file = keyToFile(key);
  try {
    const st = statSync(file);
    if (Date.now() - st.mtimeMs < TTL_MS) {
      return JSON.parse(readFileSync(file, 'utf8'));
    }
  } catch { /* 无缓存或读取失败，走下面重新计算 */ }

  const value = compute();
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  } catch { /* 写缓存失败不影响本次渲染，下次再试 */ }
  return value;
}
