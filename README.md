# AI Tools & Skills

Claude AI 配置、技能和规则集合。

## 📁 目录结构

- `rules/` - 项目架构规范、编码规则、代码分析规则
  - **此目录中的规则有不少是用于前端开发的规则，可以根据需要进行调整或扩展。**
- `skills/` - 自定义技能（分析、审查等）
- `commands/` - 自定义命令
- `hooks/` - Git 钩子配置
- `CLAUDE.md` - 项目核心架构说明

## 🚀 使用方式

### 作为 Git Submodule

```bash
# 在你的项目中添加
git submodule add https://github.com/inksnowhailong/ai-tools-skills.git .claude

# 克隆包含此配置的项目时
git clone <your-project>
git submodule update --init --recursive
```

### 更新配置

```bash
cd .claude
git pull origin main
cd ..
git add .claude
git commit -m "chore: 更新 AI 配置"
```

## 📄 许可证

Copyright 2026 inksnowhailong

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
