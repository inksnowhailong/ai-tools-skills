# PRESETS（按语言/框架切换的配置预设）

> 由 SKILL.md 前置检查阶段按需读取。机制层与项目栈无关，触发 PATTERNS 必须按栈切换。

本 skill 的机制层（基线 / mark-done / lint-memory / 自检 / 阈值）跟项目栈无关，但触发 PATTERNS 必须按项目栈切换，否则会出现"hook 永远不触发"或"触发频率失调"。

以下是内置的 4 个起步 preset，每个 preset 定义 5 类 PATTERNS：

### preset: nodejs-frontend

INCLUDE_PATTERNS:
- `/^src\//`, `/^app\//`, `/^pages\//`, `/^components\//`, `/^lib\//`
- `/^package(-lock)?\.json$/`, `/^pnpm-lock\.yaml$/`, `/^pnpm-workspace\.yaml$/`, `/^yarn\.lock$/`
- `/^tsconfig.*\.json$/`, `/^jsconfig.*\.json$/`
- `/^next\.config\./`, `/^vite\.config\./`, `/^nuxt\.config\./`, `/^webpack\.config\./`, `/^tailwind\.config\./`, `/^postcss\.config\./`, `/^vitest\.config\./`, `/^jest\.config\./`, `/^eslint\.config\./`
- `/^middleware\./`, `/^i18n\//`, `/^public\/images\//`, `/^public\/icons\//`

CORE_CONFIG_PATTERNS:
- `/^package(-lock)?\.json$/`, `/^pnpm-lock\.yaml$/`, `/^pnpm-workspace\.yaml$/`, `/^yarn\.lock$/`
- `/^tsconfig.*\.json$/`
- `/^next\.config\./`, `/^vite\.config\./`, `/^nuxt\.config\./`, `/^middleware\./`

ARCHITECTURE_PATTERNS:
- `/^src\/lib\/(api|stores|hooks)\//`
- `/^src\/components\/(layouts|ui)\//`
- `/^src\/app\/api\//`
- `/^src\/(auth|middleware)\//`

### preset: nodejs-backend

INCLUDE_PATTERNS:
- `/^src\//`, `/^lib\//`, `/^routes\//`, `/^controllers\//`, `/^services\//`, `/^models\//`, `/^middleware\//`
- `/^package(-lock)?\.json$/`, `/^pnpm-lock\.yaml$/`, `/^yarn\.lock$/`
- `/^tsconfig.*\.json$/`, `/^jsconfig.*\.json$/`
- `/^nest-cli\./`, `/^vitest\.config\./`, `/^jest\.config\./`, `/^eslint\.config\./`

CORE_CONFIG_PATTERNS:
- `/^package(-lock)?\.json$/`, `/^pnpm-lock\.yaml$/`, `/^yarn\.lock$/`
- `/^tsconfig.*\.json$/`, `/^nest-cli\./`

ARCHITECTURE_PATTERNS:
- `/^src\/(routes|controllers|services|models|middleware)\//`
- `/^src\/(db|database|prisma|drizzle)\//`

### preset: python

INCLUDE_PATTERNS:
- `/^src\//`, `/^app\//`, `/^lib\//`, `/^[a-z_]+\/__init__\.py$/`
- `/^pyproject\.toml$/`, `/^setup\.(py|cfg)$/`, `/^requirements.*\.txt$/`, `/^Pipfile(\.lock)?$/`, `/^poetry\.lock$/`
- `/^pytest\.ini$/`, `/^mypy\.ini$/`, `/^\.flake8$/`, `/^\.pylintrc$/`, `/^tox\.ini$/`
- `/^manage\.py$/`, `/^wsgi\.py$/`, `/^asgi\.py$/`

CORE_CONFIG_PATTERNS:
- `/^pyproject\.toml$/`, `/^setup\.(py|cfg)$/`, `/^requirements.*\.txt$/`, `/^Pipfile(\.lock)?$/`, `/^poetry\.lock$/`

ARCHITECTURE_PATTERNS:
- `/^src\/(models|services|api|core)\//`
- `/^app\/(models|views|api)\//`

### preset: go

INCLUDE_PATTERNS:
- `/^cmd\//`, `/^internal\//`, `/^pkg\//`, `/^api\//`, `/^services\//`
- `/^go\.mod$/`, `/^go\.sum$/`
- `/^\.golangci\.ya?ml$/`

CORE_CONFIG_PATTERNS:
- `/^go\.mod$/`, `/^go\.sum$/`

ARCHITECTURE_PATTERNS:
- `/^internal\/(domain|usecase|adapter|infrastructure)\//`
- `/^pkg\/(http|grpc|db)\//`

### preset: rust-fullstack（社区追加：Rust 后端 + frontend-nextjs/ 前端混合仓库）

INCLUDE_PATTERNS:
- `/^src\//`, `/^migrations\//`, `/^tests\//`
- `/^Cargo\.(toml|lock)$/`
- `/^frontend-nextjs\/(app|components|lib|hooks)\//`
- `/^frontend-nextjs\/package(-lock)?\.json$/`, `/^frontend-nextjs\/pnpm-lock\.yaml$/`, `/^frontend-nextjs\/yarn\.lock$/`
- `/^frontend-nextjs\/tsconfig.*\.json$/`
- `/^frontend-nextjs\/(next|tailwind|postcss)\.config\./`, `/^frontend-nextjs\/middleware\./`

CORE_CONFIG_PATTERNS:
- `/^Cargo\.(toml|lock)$/`, `/^migrations\//`
- `/^frontend-nextjs\/package(-lock)?\.json$/`, `/^frontend-nextjs\/pnpm-lock\.yaml$/`
- `/^frontend-nextjs\/tsconfig.*\.json$/`, `/^frontend-nextjs\/next\.config\./`

ARCHITECTURE_PATTERNS:
- `/^src\/main\.rs$/`, `/^src\/\w*(engine|handlers|migrate|builtins)\w*\.rs$/`
- `/^migrations\//`
- `/^frontend-nextjs\/lib\//`, `/^frontend-nextjs\/app\/api\//`

### 通用 EXCLUDE_PATTERNS（所有 preset 共享）

- `/^\.memory\//`, `/^\.cursor\//`, `/^\.claude\//`, `/^\.codex\//`, `/^\.omc\//`, `/^\.omx\//`, `/^AIConfig\//`
- `/^docs\//`, `/^README/i`, `/(^|\/)CHANGELOG/i`
- `/^\.next\//`, `/^dist\//`, `/^build\//`, `/^out\//`, `/^target\//`, `/^coverage\//`
- `/^node_modules\//`, `/^__pycache__\//`, `/^vendor\//`, `/^logs\//`
- `/\.(pyc|pyo|class)$/`

### 通用 lintMemoryStalePathPatterns 占位

每个 preset 都用占位（`src/legacy/`、`src/old/`、`src/deprecated/`）。**真实旧路径每个项目特定**，由项目首次 init 后视情况补进 hook 脚本 CONFIG。

### 扩展指南

如果你的项目栈不在上面 4 个 preset 里（如 Rust / Java / Ruby / Elixir），请直接在本节追加新 preset 定义，并在产物 2 的 `PRESET_REGISTRY` 中注册。模板鼓励社区共建 preset。


## Preset 选择优先级

按以下优先级决定 preset：

1. **用户参数显式指定**：如果用户在调用本 Skill 时同时说明 `preset=nodejs-frontend` / `preset=python` 等（或自然语言表达"用 python preset"），按指定值。
2. **自动检测**（按文件优先级，先找到的优先）：
   - 存在 `package.json` 且含 next / vite / nuxt 依赖 → `nodejs-frontend`
   - 存在 `package.json` 且含 express / nest / fastify / koa / hono 依赖 → `nodejs-backend`
   - 存在 `package.json` 但不含上述任一 → `nodejs-backend` 默认
   - 存在 `pyproject.toml` / `requirements.txt` / `Pipfile` / `setup.py` → `python`
   - 存在 `go.mod` → `go`
   - 都没匹配 → 暂停部署，告知用户"未识别项目栈，请重新调用本 Skill 并明确指定 `preset=xxx`（如 `运行 tvs-init-memory-system，preset=python`），或在 PRESETS 节追加新 preset"
3. 输出选定的 preset 名称给用户确认，例如："检测到项目栈：nodejs-frontend。如需切换，重新运行并指定 preset=..."。

伪代码：

```text
if 用户调用参数包含 preset=<name>:
  selectedPreset = <name>
else if package.json has next/vite/nuxt:
  selectedPreset = nodejs-frontend
else if package.json has express/nest/fastify/koa/hono:
  selectedPreset = nodejs-backend
else if package.json exists:
  selectedPreset = nodejs-backend
else if pyproject.toml / requirements.txt / Pipfile / setup.py exists:
  selectedPreset = python
else if go.mod exists:
  selectedPreset = go
else:
  stop and ask user to specify preset
```
