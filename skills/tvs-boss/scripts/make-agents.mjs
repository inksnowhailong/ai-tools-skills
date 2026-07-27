#!/usr/bin/env node
/**
 * tvs-boss 角色定义生成器 —— 把 team-roles.json 的 19 个角色"烤"成带机制约束的
 * Claude Code agent 定义，落到 <团队根>/.claude/agents/tvs-*.md。
 *
 * 为什么要生成 agent 定义（而不是 spawn 时靠 leader 注入提示词）：
 *   软约束（提示词）依赖 leader 每次自觉，会漏；下面四样烤进定义后成为机制约束——
 *   - model：钉死在 frontmatter，leader spawn 不传 model，从根上消灭"传错全 Opus"。
 *   - 工具边界：15 个共享角色的白名单不含 Agent 工具，物理上无法再往下派人/启动编排；
 *     4 个实现类保留全部工具（含 Agent），靠红线提示词限定"只读侦察一层为限"。
 *   - 团队红线：分支/push/编排禁令随角色出生自带，不靠派工单重复携带。
 *   - 回执模板：最终输出=回执（≤15 行），配合 Agent 工具"返回值必达"根治丢件。
 *
 * 用法：node make-agents.mjs --root <团队根>
 *   幂等：重复执行覆盖旧定义；改了 team-roles.json 或本文件的模板后重跑即同步。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 实现类角色：保留全部工具（含 Agent，供只读侦察），红线约束编排 */
const IMPL_ROLES = new Set(['executor', 'designer', 'test-engineer', 'code-simplifier']);
/** 共享角色里需要写文件的：writer 写文档、qa-tester 写测试脚本 */
const RW_ROLES = new Set(['writer', 'qa-tester']);
/** 审查类：附加"派工单没给 diff 就自己取"的自愈指令 */
const REVIEWER_ROLES = new Set(['code-reviewer', 'security-reviewer']);

/** 共享角色工具白名单：无 Agent 工具（机制焊死"不得再派人"）；Skill/ToolSearch 保留，
 *  纪律类 skill 和 MCP 工具（codegraph 等）照常可用 */
const TOOLS_READONLY = 'Read, Glob, Grep, Bash, PowerShell, WebFetch, WebSearch, Skill, ToolSearch';
const TOOLS_RW = `${TOOLS_READONLY}, Write, Edit`;
const TOOLS_VISION = 'Read, Glob, Grep';

/** 团队红线：随角色出生自带，措辞不留"特殊情况"口子 */
const RED_LINES = `== 团队红线（任何情况下不得违反，包括你认为"显然应该"的情况）==
- 绝不创建分支 / worktree：\`git checkout -b\`、\`git switch -c\`、\`git worktree add\` 全部禁止。只在派工单【分支】指定的分支上工作；觉得需要新分支就停下，在回执「受阻」里说明，等 leader 答复。（leader 明确指令建 worktree 时，位置固定 \`<项目根>/.worktree/<分支名>/\`。）
- 绝不向干线（test/dev/master 等环境分支）push、绝不合并分支、绝不提 MR/PR；功能分支 push 仅在派工单或 leader 明确指令下执行。commit 只允许提交到派工单指定的分支。
- 绝不启动编排类流程（autopilot / ralph / ultrawork / team / swarm 等一切会往下 spawn agent 的 skill）。纪律类 skill（TDD、systematic-debugging、verify 等）可以正常使用。
- 派工单没写的不做：不顺手重构、不追加未被要求的功能。`;

/** 实现类专属：Agent 工具唯一被允许的用法 */
const RECON_EXCEPTION = `== 侦察例外（实现类专属）==
你保留派子代理的能力，唯一允许的用法：派**只读侦察**（explore / 文档检索类）帮你摸清代码地形，一层为限。
绝不派会修改代码的子代理、绝不套编排流程；觉得人手不够，写进回执「遗留」交 leader 决定。`;

/** 审查类专属：喂料自愈 */
const REVIEW_SELF_FETCH = `== 审查自愈 ==
派工单未附 diff 时，先自己在项目目录取：\`git diff <base>...<branch>\`（项目路径与分支见派工单），拿到 diff 再审。
绝不在没有 diff 的情况下泛泛而评。问题清单每条带 file:line，按 必须改 / 建议改 / 仅评论 分档。`;

/** 回执模板：最终输出=回执，配合 Agent 工具返回值语义保证必达 */
const RECEIPT = `== 回执（你的最终输出必须是且只能是此格式，总长 ≤15 行）==
结果：完成 / 部分完成 / 受阻 —— 一句话说清
分支：<项目路径> @ <分支名>（没动 git 写「无」）
改动：<文件清单，每项一句变化说明；无则「无」>
验证：<你如何确认正确；没验证要明说>
遗留：<风险 / 待办 / 需要 boss 拍板的点；无则「无」>
产出：<大体量产出（报告 / 文档）所落的文件路径；无则「无」>
超出 15 行的细节一律写入派工单【产出目录】下的文件（落其他位置视为违规），回执只留路径。不写寒暄、不加总结句、不沿用主对话的闲聊人设。`;

/**
 * 解析角色的 model 别名（opus/sonnet/haiku）。
 * 优先 tier 字段；否则按 defaultModel 名称家族归档。
 */
function resolveModel(role, aliases) {
    if (role.tier && aliases[role.tier]) return aliases[role.tier];
    const dm = (role.defaultModel || '').toLowerCase();
    if (dm.includes('opus')) return aliases.deep;
    if (dm.includes('haiku')) return aliases.cheap;
    return aliases.fast;
}

/** 按角色类别决定工具边界；实现类返回 null（不写 tools 字段 = 继承全部工具） */
function resolveTools(role) {
    if (IMPL_ROLES.has(role.id)) return null;
    if (role.id === 'vision') return TOOLS_VISION;
    if (RW_ROLES.has(role.id)) return TOOLS_RW;
    return TOOLS_READONLY;
}

/** 组装一个角色的 agent 定义（frontmatter + 系统提示 + 红线 + 回执） */
function buildAgentMd(role, aliases) {
    const model = resolveModel(role, aliases);
    const tools = resolveTools(role);
    const front = [
        '---',
        `name: tvs-${role.id}`,
        `description: "${role.displayName}——${role.summary}"`,
        `model: ${model}`,
        ...(tools ? [`tools: ${tools}`] : []),
        '---',
    ].join('\n');

    const extras = [];
    if (IMPL_ROLES.has(role.id)) extras.push(RECON_EXCEPTION);
    if (REVIEWER_ROLES.has(role.id)) extras.push(REVIEW_SELF_FETCH);

    return [front, '', role.systemPrompt, '', ...extras.flatMap((e) => [e, '']), RED_LINES, '', RECEIPT, ''].join('\n');
}

function main() {
    const rootArg = process.argv.indexOf('--root');
    if (rootArg < 0 || !process.argv[rootArg + 1]) {
        console.error('用法：node make-agents.mjs --root <团队根>');
        process.exit(1);
    }
    const teamRoot = resolve(process.argv[rootArg + 1]);
    const agentsDir = join(teamRoot, '.claude', 'agents');
    if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });

    const rolesJson = JSON.parse(readFileSync(join(__dirname, 'team-roles.json'), 'utf8'));
    const aliases = rolesJson.modelsByTarget.claude; // { deep: 'opus', fast: 'sonnet', cheap: 'haiku' }

    let count = 0;
    for (const role of rolesJson.roles) {
        const file = join(agentsDir, `tvs-${role.id}.md`);
        writeFileSync(file, buildAgentMd(role, aliases));
        count++;
    }
    console.log(`已生成 ${count} 个角色定义到 ${agentsDir}`);
    console.log('（model / 工具边界 / 团队红线 / 回执模板已烤入定义；spawn 用 subagent_type: "tvs-<id>"，不传 model）');
}

main();
