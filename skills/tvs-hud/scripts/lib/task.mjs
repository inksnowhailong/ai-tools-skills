import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ACTIVE_MD = join(homedir(), '.tasklog', 'active.md');
const STALE_DAYS = 5;

/** 路径归一化：反斜杠→斜杠、小写、去尾斜杠 */
export function normPath(p) {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/**
 * 解析 ~/.tasklog/active.md，返回待显示的任务列表。
 * icon: '◑' 进行中 | '◔' 停滞(进行中>5天未更新) | '○' 待开始
 * @returns {{ id: string, title: string, icon: string, paths: string[] }[]}
 */
export function parseActiveTasks() {
  if (!existsSync(ACTIVE_MD)) return [];

  const tasks = [];
  for (const block of readFileSync(ACTIVE_MD, 'utf8').split(/\n(?=## T-\d+)/)) {
    if (!block.startsWith('## T-')) continue;

    const idMatch      = block.match(/^## (T-\d+)\s*·?\s*(.+)/);
    const statusMatch  = block.match(/\*\*状态\*\*：(.+)/);
    const updatedMatch = block.match(/\*\*更新\*\*：(\d{4}-\d{2}-\d{2})/);
    if (!statusMatch) continue;

    const statusText = statusMatch[1].trim();
    const updatedStr = updatedMatch?.[1];
    const icon = resolveIcon(statusText, updatedStr);
    if (!icon) continue;

    const paths = extractPaths(block);
    tasks.push({
      id:         idMatch?.[1] ?? '',
      title:      (idMatch?.[2] ?? '').trim(),
      icon,
      paths,
      updatedStr: updatedStr ?? null,  // radar 停滞判定用
    });
  }
  return tasks;
}

/** @returns {'◑'|'◔'|'○'|null} */
function resolveIcon(statusText, updatedStr) {
  if (statusText.includes('进行中')) {
    const stale = updatedStr
      ? (Date.now() - new Date(updatedStr)) > STALE_DAYS * 86400_000
      : false;
    return stale ? '◔' : '◑';
  }
  if (statusText.includes('待开始')) return '○';
  return null;
}

/** 从任务块里提取所有项目路径（归一化） */
function extractPaths(block) {
  const sec = block.match(/\*\*项目\*\*：([\s\S]*?)(?=\n###|\n\*\*[^项]|\n---|\n## T-|$)/);
  if (!sec) return [];
  return [...sec[1].matchAll(/`([^`]+)`\s*—/g)].map(m => normPath(m[1]));
}
