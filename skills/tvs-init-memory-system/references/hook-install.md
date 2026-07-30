# Hook 预检脚本：安装与注册

## 安装脚本（v4.1 起为复制，不再让 AI 从模板抄写）

脚本本体随本 skill 分发：`<skill-path>/scripts/memory-precheck.mjs`（含全部 preset 的 PRESET_REGISTRY）。安装两步：

1. **复制**到宿主 hooks 目录：Cursor `.cursor/hooks/memory-precheck.mjs` / Claude `.claude/hooks/memory-precheck.mjs` / Codex `.codex/hooks/memory-precheck.mjs`。
2. **注入 preset**：把脚本顶部 `const SELECTED_PRESET = '<selected-preset>'` 中的占位替换为前置检查阶段选定的 preset 名（仅这一处需要改）。

另外按需检查：
- `CONFIG.lintMemoryStalePathPatterns` 使用通用占位（src/legacy/ 等），真实旧路径由项目后续按情况补进。
- 阈值（文件数/行数/冷却/衰减/集成线候选）都在脚本顶部 CONFIG，按项目节奏调整。

安装后自检：`node <宿主路径>/memory-precheck.mjs --status` 能输出 JSON 即安装成功。

## 产物 3：Hook 注册（按宿主格式）

三工具的脚本相同，**注册格式不同**。已存在配置时一律"先读后合并"，不直接覆盖。

### Cursor → `.cursor/hooks.json`

```json
{
  "version": 1,
  "hooks": {
    "stop": [
      { "command": "node .cursor/hooks/memory-precheck.mjs", "timeout": 15, "loop_limit": 1, "failClosed": false }
    ],
    "sessionEnd": [
      { "command": "node .cursor/hooks/memory-precheck.mjs", "timeout": 15, "loop_limit": 1, "failClosed": false }
    ]
  }
}
```

合并规则：已存在则合并 `stop` / `sessionEnd` 数组，保留其它字段；缺 `timeout` / `loop_limit` / `failClosed` 则补齐。

### Claude Code → `.claude/settings.json` 的 `hooks`

Claude Code 的 hook schema 与 Cursor 不同（事件名首字母大写、`hooks` 数组里每项是 `{type:"command", command}`）。`Stop` 表示主 Agent 回复结束、`SessionEnd` 表示会话结束：

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node .claude/hooks/memory-precheck.mjs" } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "node .claude/hooks/memory-precheck.mjs" } ] }
    ],
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node .claude/hooks/memory-precheck.mjs --print-index" } ] }
    ]
  }
}
```

`.claude/settings.json` 可入库随仓库走（团队共享）。已存在则合并对应事件数组。

> **SessionStart 索引注入（v6，仅 Claude Code）**：SessionStart hook 的 stdout 会作为
> additionalContext 注入会话开头，把"应该读索引"从赌模型自觉变为确定性注入。
> Cursor / Codex 无等价的上下文注入语义，维持宪法引导读取，不注册此事件。

### Codex → `.codex/config.toml` + `.codex/hooks.json`

Codex 需先在 `config.toml` 打开 hooks 特性，再在 `hooks.json` 定义：

```toml
# .codex/config.toml
[features]
hooks = true
```

```json
// .codex/hooks.json
{
  "hooks": {
    "SessionStart": [
      { "command": "node .codex/hooks/memory-precheck.mjs" }
    ],
    "PostToolUse": [
      { "command": "node .codex/hooks/memory-precheck.mjs" }
    ]
  }
}
```

> 说明：Codex hooks 事件集与 Cursor/Claude 不完全一致（以 `SessionStart` / `PostToolUse` 等为主），且子 Agent 不自动 spawn。所以 Codex 上 hook 的作用是"提示该维护了"，真正的维护由主 Agent/用户**显式唤起** `project-memory-maintainer`。若当前 Codex 版本 hooks 仍为实验特性或事件名有变，按其文档调整，并在记忆宪法里写明"Codex 下记忆维护需显式触发"。

