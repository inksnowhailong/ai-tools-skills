import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.claude', 'hud', 'tvs-hud-config.json');

const DEFAULTS = {
  show: ['git', 'taskCounts', 'taskLine', 'radar', 'worktrees'],
  taskTitleLen: 18,
  taskLineMax: 8,
};

/**
 * @returns {{ show: Set<string>, taskTitleLen: number }}
 */
export function loadConfig() {
  let raw = { ...DEFAULTS };
  try {
    if (existsSync(CONFIG_PATH))
      raw = { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {}
  return { show: new Set(raw.show), taskTitleLen: raw.taskTitleLen, taskLineMax: raw.taskLineMax };
}
