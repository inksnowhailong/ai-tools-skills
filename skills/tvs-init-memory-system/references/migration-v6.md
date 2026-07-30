# 存量升级：v5 账本 → v6（增量，不动已有正文）

> 适用：已部署 v5 账本的项目（如 crestrail、shirehub、shirehub-central、shirehub_studio_web）。
> v6 是纯增量：不重写任何既有记忆内容，只补三件事。v4 项目先走 migration-v5.md 蒸馏，再回本文件。

## 步骤

### 1. 更新维护员与宪法（复制式覆盖各自段落）

- 用 skill 内 `references/maintainer-agent.md` 最新正文替换项目的 `project-memory-maintainer` 定义正文
  （frontmatter 里项目自定的 model 等字段保留）。
- 项目常驻规则（CLAUDE.md / AGENTS.md / .mdc）中「记忆系统宪法」段：在"查询流水线"节补 v6 的
  分数使用行为与墓碑禁令三行（见 constitution.md），其余不动。

### 2. 补墓碑骨架

按 `memory-skeleton.md` 的 `墓碑.md` 骨架在 `.memory/` 下创建（已有则跳过）；
`记忆索引.md` 文件清单表补 `墓碑.md` 一行。

### 3. 更新 hook 脚本 + SessionStart 注册（仅 Claude Code）

- 用 skill 内 `scripts/memory-precheck.mjs` 覆盖项目的 `.claude/hooks/memory-precheck.mjs`，
  **重新注入原 preset 名与 teamMode 设置**（对照旧文件顶部 CONFIG）。
- `.claude/settings.json` 的 `hooks` 合并进 `SessionStart` 事件（命令带 `--print-index`），
  已有其它 SessionStart 项则追加数组元素，不覆盖。
- 验证：`node .claude/hooks/memory-precheck.mjs --print-index` 输出索引全文；`--status` 正常。

### 4. 存量条目不补分数

既有导航行/红线条目**不要求回填分数**——无元数据视为 2 分（代码互证档）对待；
维护员此后新增/修改条目时按 v6 格式带分数。此规则已含在维护员正文，无需项目侧配置。

### 5. 收尾

`--mark-done` 刷新基线；向用户展示 git diff 供 review 后提交。
