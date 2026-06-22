#!/usr/bin/env node
// tvs-boss 状态栏：扫最近的 .tvs-boss/ → 读 projects.md → git 速查 → 单行输出
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
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

const parts = projects.map(({ id, path }) => {
  const dirty = git(path, 'status --porcelain').split('\n').filter(Boolean).length;
  const ahead  = parseInt(git(path, 'rev-list --count @{u}..HEAD')) || 0;
  const behind = parseInt(git(path, 'rev-list --count HEAD..@{u}')) || 0;
  let s = '';
  if (dirty)  s += `${YELLOW}●${dirty}${R}`;
  if (ahead)  s += `${GREEN}↑${ahead}${R}`;
  if (behind) s += `${RED}↓${behind}${R}`;
  if (!s)     s  = `${GRAY}✓${R}`;
  return `${BLUE}${id}${R} ${s}`;
});

process.stdout.write(`${DIM}⎇ boss${R} ${GRAY}│${R} ` + parts.join(` ${GRAY}·${R} `));
