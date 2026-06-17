#!/usr/bin/env node
/**
 * tvs-boss 控制台面板 —— 读花名册，吐字符画 ASCII 总览。
 *
 * 纯渲染、零依赖（沿用 tvs-task/render.mjs 的"读状态→吐字符画"模式，输出按舰队数据重写）。
 * leader 在纯对话里被问"现在啥情况"时调它，把输出原样贴回。无数据时打印空面板。
 * 未来升级：换成一个专门的小 html 页面服务，本脚本是它的字符画前身。
 *
 * 用法：node panel.mjs
 */
import { loadRoster, STAGES } from './roster.mjs';

/** stage → 短标签，给任务流一行展示用 */
const STAGE_LABEL = {
    dispatched: '派发',
    coding: '编码',
    review: '审查',
    test: '测试',
    await_commit: '待提交',
    done: '完成',
};

function render(r) {
    const lines = [];
    lines.push('╔══════════════════ tvs-boss 舰队面板 ══════════════════');

    // 全局总览
    const active = r.tasks.filter((t) => t.stage !== 'done').length;
    lines.push(`║ 项目 ${r.projects.length} ｜ 共享池 ${r.pool.length} ｜ 任务 ${r.tasks.length}（在途 ${active}）`);

    // 任务流：各 stage 计数
    const flow = STAGES.map((s) => `${STAGE_LABEL[s]} ${r.tasks.filter((t) => t.stage === s).length}`).join(' → ');
    lines.push(`║ 流水：${flow}`);
    lines.push('╠═══════════════════════════════════════════════════════');

    // 各项目
    if (!r.projects.length) {
        lines.push('║ （还没登记任何项目）');
    } else {
        for (const p of r.projects) {
            const devs = p.devAgents.length ? p.devAgents.join(', ') : '—';
            lines.push(`║ ▣ ${p.id}   dev: ${devs}`);
            const ts = r.tasks.filter((t) => t.project === p.id && t.stage !== 'done');
            if (!ts.length) {
                lines.push('║     · 无在途任务');
            } else {
                for (const t of ts) {
                    const who = t.owner ? ` @${t.owner}` : '';
                    lines.push(`║     · [${STAGE_LABEL[t.stage] ?? t.stage}]${who} ${t.demand}`);
                }
            }
        }
    }
    lines.push('╠═══════════════════════════════════════════════════════');

    // 共享池
    if (!r.pool.length) {
        lines.push('║ 共享池：（空）');
    } else {
        const byRole = { review: [], test: [], special: [] };
        for (const a of r.pool) (byRole[a.role] ?? (byRole[a.role] = [])).push(`${a.name}(${a.status})`);
        for (const role of ['review', 'test', 'special']) {
            if (byRole[role].length) lines.push(`║ 池·${role}：${byRole[role].join(', ')}`);
        }
    }

    lines.push('╚═══════════════════════════════════════════════════════');
    return lines.join('\n');
}

console.log(render(loadRoster()));
