#!/usr/bin/env node
/**
 * bootstrap-check.mjs —— tvs-inksnow 插件 SessionStart 钩子（零依赖）
 *
 * 职责极简：只「探测 + 喊 AI」，绝不自己改配置、绝不阻断会话。
 *   - 读 marker（~/.claude/.tvs-inksnow/bootstrap.json）记录的已自举版本
 *   - 与当前插件版本（plugin.json）比对
 *   - 未自举 / 版本升级 → 向会话注入 additionalContext，提示 AI 调 tvs-setup bootstrap
 *   - 已就绪 → 静默退出，不打扰
 *
 * 铁律：任何异常都吞掉并 exit 0——一个装饰性的提示钩子绝不能让消费者开不了会话。
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

try {
    // 插件根：本脚本在 <root>/skills/tvs-setup/scripts/ 下，向上三级；CLAUDE_PLUGIN_ROOT 优先
    const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(SCRIPT_DIR, '..', '..', '..')

    const readVersion = (p) => {
        try { return JSON.parse(readFileSync(p, 'utf8')).version || null } catch { return null }
    }
    const pluginVersion = readVersion(join(pluginRoot, '.claude-plugin', 'plugin.json'))
    if (!pluginVersion) process.exit(0) // 读不到版本就不提示，避免误报

    const markerPath = join(homedir(), '.claude', '.tvs-inksnow', 'bootstrap.json')
    let doneVersion = null
    if (existsSync(markerPath)) {
        try { doneVersion = JSON.parse(readFileSync(markerPath, 'utf8')).version || null } catch { /* 损坏当未自举 */ }
    }

    if (doneVersion === pluginVersion) process.exit(0) // 本版本已自举，静默

    const first = doneVersion == null
    const msg = first
        ? `tvs-inksnow 插件首次安装、尚未自举。请立即调用 tvs-setup skill 执行一次性自举：运行 `
          + `node "\${CLAUDE_PLUGIN_ROOT}/skills/tvs-setup/scripts/tvs.mjs" bootstrap，解读其 JSON 后——`
          + `(1) 它已静默把 skillListingBudgetFraction 归一到 0.02；`
          + `(2) 对缺失且可脚本化的依赖（omc 走 npm、codegraph 走 npx）征得用户同意后直接安装；`
          + `(3) 对纯插件依赖（superpowers）打印 /plugin 命令交用户手动执行。完成后 marker 写入，本提示不再出现。`
        : `tvs-inksnow 插件已从 ${doneVersion} 升级到 ${pluginVersion}，可能引入新依赖。建议重跑 `
          + `node "\${CLAUDE_PLUGIN_ROOT}/skills/tvs-setup/scripts/tvs.mjs" bootstrap 让依赖与配置跟进到新版本。`

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg },
    }))
} catch {
    /* 静默吞掉一切异常 */
}
process.exit(0)
