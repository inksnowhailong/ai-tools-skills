import { execSync } from 'child_process';
import { basename } from 'path';

function git(repoPath, cmd) {
  try {
    return execSync(`git -C "${repoPath}" ${cmd}`, {
      timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch { return ''; }
}

/** @returns {boolean} cwd 是否在某个 git 工作区内（git -C 从子目录调用天然向上解析仓库根） */
export function isGitRepo(cwd) {
  return git(cwd, 'rev-parse --is-inside-work-tree') === 'true';
}

/** @returns {string|null} 仓库根目录名，用作 workspace.repo.name 缺失时的兜底（无 origin/非仓库时用得到） */
export function repoRootName(cwd) {
  const top = git(cwd, 'rev-parse --show-toplevel');
  return top ? basename(top) : null;
}

/** @returns {string} 当前分支名（detached 时返回短 hash） */
export function branchOf(cwd) {
  const b = git(cwd, 'rev-parse --abbrev-ref HEAD');
  return b === 'HEAD' ? git(cwd, 'rev-parse --short HEAD') : b;
}

/** @returns {{ dirty: number, ahead: number, behind: number, stash: number }} */
export function gitOf(cwd) {
  return {
    dirty:  git(cwd, 'status --porcelain').split('\n').filter(Boolean).length,
    ahead:  parseInt(git(cwd, 'rev-list --count @{u}..HEAD')) || 0,
    behind: parseInt(git(cwd, 'rev-list --count HEAD..@{u}')) || 0,
    stash:  git(cwd, 'stash list').split('\n').filter(Boolean).length,
  };
}

/**
 * 列出该仓库的所有 linked worktree（排除当前所在的主 worktree），各自的脏/ahead/behind。
 * @returns {{ path: string, branch: string, dirty: number, ahead: number, behind: number }[]}
 */
export function worktreesOf(cwd) {
  const raw = git(cwd, 'worktree list --porcelain');
  if (!raw) return [];
  const selfPath = git(cwd, 'rev-parse --show-toplevel');
  const blocks = raw.split(/\n\n+/);
  return blocks.map((block) => {
    const pathLine   = block.match(/^worktree (.+)/m);
    const branchLine = block.match(/^branch refs\/heads\/(.+)/m);
    if (!pathLine || !branchLine) return null;
    const wtPath = pathLine[1].trim();
    if (wtPath === selfPath) return null; // 跳过当前所在的这个 worktree 本身
    const branch = branchLine[1].trim();
    const dirty  = git(wtPath, 'status --porcelain').split('\n').filter(Boolean).length;
    const ahead  = parseInt(git(wtPath, 'rev-list --count @{u}..HEAD')) || 0;
    const behind = parseInt(git(wtPath, 'rev-list --count HEAD..@{u}')) || 0;
    return { path: wtPath, branch, dirty, ahead, behind };
  }).filter(Boolean);
}
