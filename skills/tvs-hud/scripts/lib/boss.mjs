import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

// ── 内部工具 ──────────────────────────────────────────────────────────────────
function git(repoPath, cmd) {
  try {
    return execSync(`git -C "${repoPath}" ${cmd}`, {
      timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch { return ''; }
}

// ── 团队根 & 项目解析 ─────────────────────────────────────────────────────────

/**
 * 从 dir 向上找最近的 .tvs-boss/ 目录，返回其父目录（团队根）。
 * @returns {string|null}
 */
export function findTeamRoot(dir) {
  if (existsSync(join(dir, '.tvs-boss'))) return dir;
  const parent = dirname(dir);
  return parent === dir ? null : findTeamRoot(parent);
}

/**
 * 解析 .tvs-boss/projects.md，返回存在于磁盘的项目列表。
 * @returns {{ id: string, path: string }[]}
 */
export function parseProjects(root) {
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

// ── git 状态查询 ──────────────────────────────────────────────────────────────

/**
 * @returns {{ dirty: number, ahead: number, behind: number }}
 */
export function gitOf(repoPath) {
  return {
    dirty:  git(repoPath, 'status --porcelain').split('\n').filter(Boolean).length,
    ahead:  parseInt(git(repoPath, 'rev-list --count @{u}..HEAD')) || 0,
    behind: parseInt(git(repoPath, 'rev-list --count HEAD..@{u}')) || 0,
  };
}

/** @returns {string} 当前分支名 */
export function branchOf(repoPath) {
  return git(repoPath, 'rev-parse --abbrev-ref HEAD');
}

/** @returns {number} 距上次提交的天数，取不到时返回 null */
export function lastCommitAgeOf(repoPath) {
  const ct = git(repoPath, 'log -1 --format=%ct');
  if (!ct) return null;
  return Math.floor((Date.now() / 1000 - Number(ct)) / 86400);
}

/** @returns {number} stash 条数 */
export function stashCountOf(repoPath) {
  const out = git(repoPath, 'stash list');
  return out ? out.split('\n').filter(Boolean).length : 0;
}

// ── git worktree ──────────────────────────────────────────────────────────────

/**
 * 列出该仓库的所有 linked worktree（排除主 worktree）。
 * 每个条目包含：path / branch（短名）/ dirty / ahead / behind
 * @returns {{ path: string, branch: string, dirty: number, ahead: number, behind: number }[]}
 */
export function worktreesOf(repoPath) {
  const raw = git(repoPath, 'worktree list --porcelain');
  if (!raw) return [];

  // 按空行分块，第一块是主 worktree，跳过
  const blocks = raw.split(/\n\n+/).slice(1);
  return blocks.map(block => {
    const pathLine   = block.match(/^worktree (.+)/m);
    const branchLine = block.match(/^branch refs\/heads\/(.+)/m);
    if (!pathLine || !branchLine) return null;

    const wtPath  = pathLine[1].trim();
    const branch  = branchLine[1].trim();
    const dirty   = git(wtPath, 'status --porcelain').split('\n').filter(Boolean).length;
    const ahead   = parseInt(git(wtPath, 'rev-list --count @{u}..HEAD')) || 0;
    const behind  = parseInt(git(wtPath, 'rev-list --count HEAD..@{u}')) || 0;
    return { path: wtPath, branch, dirty, ahead, behind };
  }).filter(Boolean);
}
