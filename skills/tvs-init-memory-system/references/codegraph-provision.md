## 产物 5：codegraph 供给（委托官方安装器）

codegraph 自带**跨工具安装器**，会自动识别 Cursor / Claude Code / Codex 并写好各自的 MCP 配置与指令文件。**本 Skill 不自写任何 MCP 配置**，只按 `CODEGRAPH_STATE` 调它的官方命令。任何一步失败都**不阻塞**，记入 `CODEGRAPH_STATUS` 供收尾摘要。

### 执行分支

| `CODEGRAPH_STATE` | 执行动作 | 完成后 `CODEGRAPH_STATUS` |
|---|---|---|
| `ready` | 跳过 | `ready` |
| `cli_only` | `codegraph init -i` | `init_done` / `init_failed` |
| `missing` | 跑官方安装器，再 `codegraph init -i` | `ready` / `install_failed` / `init_failed` |
| `no_node` | 跳过 | `no_node` |

### 官方安装命令

- 交互一行（自动识别并配置当前工具、提示装 PATH）：`npx @colbymchenry/codegraph`
- 非交互（自动化部署推荐）：`npm i -g @colbymchenry/codegraph` → `codegraph install --target=<tool> --yes`（`<tool>` = cursor / claude / codex）→ `codegraph init -i`
- 安装器会自动写好当前工具的 codegraph 指令文件（Cursor `.cursor/rules/codegraph.mdc` / Claude `CLAUDE.md` / Codex `~/.codex/AGENTS.md`）——**这些不由本 Skill 写**。

### 执行规则

- 任何一步失败都不抛出，把原始错误前 200 字符收进 `CODEGRAPH_STATUS`。
- `codegraph init -i` 即使失败也不重试，交给用户 / 宪法第 4 条的自愈规则。
- 语言不被 codegraph 支持时，init 仍会成功但索引为空——AI 查不到自然走 grep/read，是预期降级，不算错误。

### 强制 + 兜底（v4 强化）

codegraph 在 v4 里**不再只是主 Agent 的可选结构层，而是维护子 Agent 自检路径/符号的依赖**——所以安装更强、更主动；但**装不上仍不阻塞工作**（子 Agent 自检回退 git cat-file/Glob、主 Agent 结构查询回退 grep/read）。另在 `CODEGRAPH_STATE=missing/no_node` 时，于收尾摘要把"codegraph 未就绪"列为**显著待办**（团队每位成员本地都需装，`.codegraph/` 不入库）。下面状态写法不变：

- 成功（`ready` / `init_done`）→ 宪法的"codegraph 当前状态"块写"已就绪"。
- 失败（`install_failed` / `init_failed` / `no_node`）→ 宪法的"codegraph 当前状态"块写降级提示：AI 结构查询回退 grep/read，并提示用户手动 `npx @colbymchenry/codegraph`。

### 状态汇总落盘

写入 `.memory/.codegraph-status.json`（已 gitignore）：

```json
{
  "status": "ready | init_done | install_failed | init_failed | no_node",
  "checkedAt": "<ISO 时间>",
  "tool": "<cursor | claude-code | codex>",
  "dbPath": ".codegraph/codegraph.db",
  "error": "<原始错误前 200 字符 或 null>"
}
```

后续用户手动装好后删掉此文件，hook / 宪法即不再报告"codegraph 不可用"。
