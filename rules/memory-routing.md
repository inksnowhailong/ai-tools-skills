---
name: memory-routing
description: 记忆路由——知识按"跟谁走"归位：项目业务知识进 .memory，个人偏好进原生记忆，禁写 wiki/project_memory
default: on
---

# 记忆路由

知识按"跟谁走"决定唯一归属，写错地方等于白存：

- **跟项目走**（业务真相/红线/决策/术语入口）：项目有 `.memory/` → 由 project-memory-maintainer
  子 Agent 写入（宪法约束）；项目没有 `.memory/` → 原生 auto-memory 的 project 类兜底。
- **跟人走**（我的偏好/纠正过的做法/工作习惯）：原生 auto-memory（user/feedback 类）。
  有 `.memory/` 的项目里，项目事实不写 auto-memory，两边冲突以入库的 `.memory` 为准。
- **跟时间走**（任务/待办）：`~/.tasklog`（tvs-task）。
- **可推导的**（代码结构/签名/调用关系）：不存任何记忆，codegraph / grep 现场查。

**禁止**向 OMC 的 `wiki_*`、`project_memory_write` / `project_memory_add_*`、`notepad_write_*`
写入知识（历史遗留的 project-memory 数据只读参考）。
