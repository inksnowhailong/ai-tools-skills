---
name: tvs-skill-audit
description: 当用户说"审计 skill、skill 体检、清一下 skill 里的多余内容、检查 skill 文档有没有写给人看的废话、review 一下 skill 文档、skill 文档有没有该删的"等诉求时使用。作用：对 `AIConfig/skills/tvs-*` 下每个 skill 的 `SKILL.md` + `references/*.md` 做 LLM 语义审计，找出"整段写给人类看的设计理由/背景说明"这类对执行无意义的内容；高置信度发现经独立反驳验证后自动精简，其余合并成扁平列表交给用户逐条确认是否要改。
---

# skill 文档体检（tvs-skill-audit）

你要审计的对象是 skill **文档本身**——这些 `SKILL.md`/`references/*.md` 是写给 AI 执行用的指令集，不是写给人看的说明书。凡是整段/整节在向读者解释"为什么这样设计、背景是什么、动机是什么"的内容，都是候选删除项（必要的单行 WHY 说明不算，不要删）。

## 执行步骤

1. **定位待审计 skill 目录**：默认扫描 `AIConfig/skills/` 下所有 `tvs-*` 目录；如果用户在本次请求里明确指定了子集（比如"只查 tvs-task 和 tvs-boss"），只用用户给的子集。

2. **直接在当前对话层调用 `Workflow` 工具**（这一步必须由你自己发起，不能委托给不带 `Workflow` 工具的子 agent，否则会在运行时才发现工具缺失）：
   ```
   Workflow({
     scriptPath: "<本 skill 的 Base directory>/scripts/audit.workflow.mjs",  // 用绝对路径，取自加载本 skill 时系统告知的 Base directory
     args: { skillDirs: [...本次要审计的 skill 目录绝对路径...] }
   })
   ```

3. **处理 Workflow 返回结果** `{ autoFixed, needsApproval, cleanSkillDirs }`：
   - `autoFixed`：已经过独立反驳验证、由独立 fixer agent 自动处理完的改动，按 skill 分组。每条带 `action` 字段——`deleted`（整段删掉/精简）或 `rewritten`（判断这段夹带了别处没有的隐藏约束/触发条件，改写成一句不带"为什么/背景"叙事框架的正文约束、原地替换而非删除）。不是所有自动改动都等于删除。
   - `needsApproval`：跨所有 skill 合并后的**扁平列表**（不是按 skill 分组），包含低置信度发现、被反驳验证判定为 `refuted: true` 的发现、以及自动改动失败被降级的条目。
   - `cleanSkillDirs`：全程零发现的 skill 目录列表，直接用于第 5 步汇总，不用自己反推。

4. **人工确认 `needsApproval`**：把 `needsApproval` 按**每批 ≤4 条**切片，每一片调用一次 `AskUserQuestion`（`multiSelect`，选项 = 该批次里的每条发现，标明来源文件 + 摘要），让用户勾选真正要改的条目。这一步必须在主对话层做（`Workflow` 里的 agent 拿不到 `AskUserQuestion`）。对用户勾选的条目，逐条执行 `Edit`（`old_string` 用该发现的 `quote` 原文）。

5. **给出最终汇总**：自动改了几条（按 `action` 分开报"删了几条 / 改成约束几条"）、用户批准改了几条、用户跳过了几条、`cleanSkillDirs` 里哪些 skill 全程零发现（体检通过）。

6. **不自动 `git commit` / `git push`**——AIConfig 是 git submodule，本 skill 全程只改动工作区文件，提交与推送永远交给用户自己决定。

## Do_Not_Use_When

本 skill 审计的是 **skill 元文档自身**（SKILL.md / references 里"写给人看的解释性内容"），不是审计业务代码。如果用户想审计的是项目业务代码质量、代码坏味道、可维护性，那是 `tvs-clean-code` / `tvs-code-reviewer` 的职责，不要用本 skill。
