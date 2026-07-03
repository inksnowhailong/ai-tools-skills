// 机器资源利用率采样——CPU% / 内存% / 磁盘活动率%（不是磁盘空间！）。
// 和版本检测同一套路：这三个都是"采样类"指标（磁盘活动率尤其要读性能计数器），不能塞进
// 每次都要秒回的渲染路径。于是——渲染只同步读缓存文件；缓存过期就 detach 一个后台 node
// 进程去采样、写回缓存，不阻塞本次渲染。每次渲染是独立进程、渲完即退，所以必须落文件缓存
// + 起子进程（内存缓存跨不了进程、未 await 的采样会随进程被杀）。
//
// Windows 取值走 WMI 的 Win32_PerfFormattedData_*（属性名是英文、不受系统语言影响——
// 这是中文 Windows 上读性能计数器最大的坑，用本地化计数器名会取不到）：
//   · CPU  = PercentProcessorTime(_Total)
//   · 磁盘 = 100 - PercentIdleTime(_Total)   ← 即 Task Manager 的"活动时间"，非空间占用
//   · 内存 = 1 - FreePhysicalMemory/TotalVisibleMemorySize  ← 与 Task Manager 口径一致
// 非 Windows 降级：CPU 用两次 os.cpus() 采样差、内存用 os freemem，磁盘取不到就省略。

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import os from 'os';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const CACHE = join(tmpdir(), 'tvs-hud-cache', 'sysmetrics.json');
const TTL_MS = 5000; // 5s：状态栏够"活"，又不至于每次渲染都采样

/** 读缓存 {cpu,mem,disk,at}；不存在/损坏返回 null。 */
function readCache() {
  try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch { return null; }
}

/** 缓存不存在或超过 TTL 视为过期。 */
function cacheStale() {
  try { return Date.now() - statSync(CACHE).mtimeMs >= TTL_MS; }
  catch { return true; }
}

/** 把缓存 mtime 顶到现在（保留上次采到的值）——先占位再起后台进程，避免并发渲染重复 spawn。 */
function touchCache() {
  try {
    mkdirSync(dirname(CACHE), { recursive: true });
    const prev = readCache() || {};
    writeFileSync(CACHE, JSON.stringify({ cpu: prev.cpu ?? null, mem: prev.mem ?? null, disk: prev.disk ?? null, at: Date.now() }));
  } catch { /* 占位失败最坏是多起一个后台进程 */ }
}

/** detach 一个后台 node 进程去采样、写缓存——不阻塞当前渲染。 */
function refreshInBackground() {
  try {
    const self = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [self, '--refresh-sysmetrics'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
  } catch { /* 起不来就算了，下个 TTL 窗口再试 */ }
}

/**
 * @returns {{ cpu: number|null, mem: number|null, disk: number|null }}
 *   最近一次采到的利用率百分比；从未采到时各为 null（渲染端自动省略）。
 */
export function getSysMetrics() {
  if (cacheStale()) {
    touchCache();
    refreshInBackground();
  }
  const c = readCache();
  return { cpu: c?.cpu ?? null, mem: c?.mem ?? null, disk: c?.disk ?? null };
}

// ── 后台采样入口：由 refreshInBackground 起的 detached 子进程调用 ──
// 正常被 render 链 import 时不带这个 flag，下面整段跳过。
if (process.argv.includes('--refresh-sysmetrics')) {
  const m = sample();
  if (m) {
    try {
      mkdirSync(dirname(CACHE), { recursive: true });
      writeFileSync(CACHE, JSON.stringify({ ...m, at: Date.now() }));
    } catch { /* 写失败下次再采 */ }
  }
  process.exit(0);
}

/** 采一次；失败返回 null（保留旧缓存）。 */
function sample() {
  try {
    return process.platform === 'win32' ? sampleWindows() : sampleNode();
  } catch { return null; }
}

/** Windows：一次 PowerShell 调用拿齐 CPU / 磁盘活动率 / 内存（WMI 英文属性，locale 无关）。 */
function sampleWindows() {
  const ps = [
    "$c=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime;",
    "$i=(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter \"Name='_Total'\").PercentIdleTime;",
    "$o=Get-CimInstance Win32_OperatingSystem;",
    "$m=[math]::Round((1-$o.FreePhysicalMemory/$o.TotalVisibleMemorySize)*100);",
    "Write-Output \"$c,$([math]::Max(0,100-$i)),$m\"",
  ].join(' ');
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8', timeout: 8000, windowsHide: true,
  });
  const [cpu, disk, mem] = out.trim().split(',').map((s) => Math.round(Number(s)));
  const ok = (n) => Number.isFinite(n);
  if (!ok(cpu) && !ok(disk) && !ok(mem)) return null;
  return { cpu: ok(cpu) ? cpu : null, mem: ok(mem) ? mem : null, disk: ok(disk) ? disk : null };
}

/** 非 Windows 降级：CPU 两次采样差 + 内存 os freemem；磁盘取不到 → null。 */
function sampleNode() {
  const snap = () => os.cpus().reduce((a, c) => {
    const t = Object.values(c.times).reduce((x, y) => x + y, 0);
    return { idle: a.idle + c.times.idle, total: a.total + t };
  }, { idle: 0, total: 0 });
  const a = snap();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); // 同步睡 200ms（后台进程里可阻塞）
  const b = snap();
  const dt = b.total - a.total;
  const cpu = dt > 0 ? Math.round((1 - (b.idle - a.idle) / dt) * 100) : null;
  const mem = Math.round((1 - os.freemem() / os.totalmem()) * 100);
  return { cpu, mem, disk: null };
}
