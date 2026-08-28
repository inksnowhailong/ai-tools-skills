#!/usr/bin/env node
// tvs-boss 状态栏：扫最近的 .tvs-boss/ → 读 projects.md → git 速查 + 记忆欠账 → 单行输出
import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';

function findTeamRoot(dir) {
  if (existsSync(join(dir, '.tvs-boss'))) return dir;
  const parent = dirname(dir);
  return parent === dir ? null : findTeamRoot(parent);
}

function parseProjects(root) {
  const file = join(root, '.tvs-boss', 'projects.md');
  if (!existsSync(file)) return [];
  const projects = [];
  let cur = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const h = line.match(/^## (.+)/);
    if (h) { if (cur) projects.push(cur); cur = { id: h[1].trim(), path: null }; }
    const p = line.match(/- path:\s*(.+)/);
    if (p && cur) cur.path = p[1].trim();
  }
  if (cur) projects.push(cur);
  return projects.filter(p => p.path && existsSync(p.path));
}

function git(path, cmd) {
  try {
    return execSync(`git -C "${path}" ${cmd}`, {
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch { return ''; }
}

const teamRoot = findTeamRoot(process.cwd());
if (!teamRoot) process.exit(0);

const projects = parseProjects(teamRoot);
if (!projects.length) process.exit(0);

const R = '\x1b[0m', DIM = '\x1b[2m';
const BLUE = '\x1b[38;5;110m', YELLOW = '\x1b[38;5;180m';
const GREEN = '\x1b[38;5;150m', RED = '\x1b[38;5;203m', GRAY = '\x1b[38;5;243m';

/** 项目记忆欠账天数：读 .memory 的机读锚点（团队共享）优先，回退 .hook-state.json；无 .memory 返回 null */
function memoryDebtDays(path) {
  try {
    const mapFile = join(path, '.memory', '跨分支在研功能地图.md');
    let iso = null;
    if (existsSync(mapFile)) {
      const m = readFileSync(mapFile, 'utf8').match(/<!--\s*mem-meta:\s*(\{[\s\S]*?\})\s*-->/);
      if (m) iso = JSON.parse(m[1]).updatedAt || null;
    }
    if (!iso) {
      const stateFile = join(path, '.memory', '.hook-state.json');
      if (!existsSync(stateFile)) return null;
      iso = JSON.parse(readFileSync(stateFile, 'utf8')).lastMaintainedAt || null;
    }
    if (!iso) return Infinity; // 部署了但从未维护过
    return (Date.now() - new Date(iso).getTime()) / 86400000;
  } catch { return null; }
}

const parts = projects.map(({ id, path }) => {
  const dirty = git(path, 'status --porcelain').split('\n').filter(Boolean).length;
  const ahead  = parseInt(git(path, 'rev-list --count @{u}..HEAD')) || 0;
  const behind = parseInt(git(path, 'rev-list --count HEAD..@{u}')) || 0;
  let s = '';
  if (dirty)  s += `${YELLOW}●${dirty}${R}`;
  if (ahead)  s += `${GREEN}↑${ahead}${R}`;
  if (behind) s += `${RED}↓${behind}${R}`;
  if (!s)     s  = `${GRAY}✓${R}`;
  // 记忆欠账信号：>14 天红、>7 天黄；从未维护显示 ∞
  const debt = memoryDebtDays(path);
  if (debt != null && debt > 7) {
    const label = debt === Infinity ? '∞' : `${Math.floor(debt)}d`;
    s += `${debt > 14 ? RED : YELLOW}🧠${label}${R}`;
  }
  return `${BLUE}${id}${R} ${s}`;
});

// 团队记忆体检：.tvs-boss 顶层白名单外文件 + rules/contracts 体积超限（"记忆有界"铁律的机械化）
const teamWarns = [];
try {
  const bossDir = join(teamRoot, '.tvs-boss');
  const whitelist = new Set(['projects.md', 'rules.md', 'contracts.md', 'work']);
  const strays = readdirSync(bossDir).filter(n => !whitelist.has(n));
  if (strays.length) teamWarns.push(`白名单外×${strays.length}`);
  for (const [file, maxLines] of [['rules.md', 80], ['contracts.md', 120]]) {
    const f = join(bossDir, file);
    if (existsSync(f)) {
      const lines = readFileSync(f, 'utf8').split('\n').length;
      if (lines > maxLines) teamWarns.push(`${file} ${lines}行>${maxLines}`);
    }
  }
} catch { /* 体检失败不影响主输出 */ }
const teamSeg = teamWarns.length ? ` ${GRAY}│${R} ${RED}⚠${R}${YELLOW}${teamWarns.join(' ')}${R}` : '';

process.stdout.write(`${DIM}⎇ boss${R} ${GRAY}│${R} ` + parts.join(` ${GRAY}·${R} `) + teamSeg);
