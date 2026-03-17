#!/usr/bin/env node
/**
 * generate-madge.mjs - 生成项目 madge 依赖图
 *
 * 使用方式：
 *   node generate-madge.mjs [目录] [输出文件名]
 *   node generate-madge.mjs src/
 *   node generate-madge.mjs src/ my-graph.svg
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

const DIR = process.argv[2] || 'src'
const OUTPUT_DIR = '.claude/analyze'
const OUTPUT_FILE = process.argv[3] || `madge-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.svg`
const OUTPUT_PATH = join(OUTPUT_DIR, OUTPUT_FILE)
const EXTENSIONS = 'js,ts,jsx,tsx,vue,mjs,cjs'

console.log('📊 生成 madge 依赖图...')
console.log(`  - 扫描目录: ${DIR}`)
console.log(`  - 输出文件: ${OUTPUT_PATH}\n`)

/** 检查命令是否存在 */
function commandExists(cmd) {
    try {
        execSync(`command -v ${cmd}`, { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

/** 检查目录是否存在 */
if (!existsSync(DIR)) {
    console.error(`❌ 目录不存在: ${DIR}`)
    process.exit(1)
}

/** 检查 Graphviz 依赖 */
if (!commandExists('dot')) {
    console.error('❌ 未安装 Graphviz，madge 生成图像需要它')
    console.error('安装方式：')
    console.error('  macOS:   brew install graphviz')
    console.error('  Ubuntu:  sudo apt install graphviz')
    console.error('  Windows: choco install graphviz')
    process.exit(1)
}

/** 创建输出目录 */
mkdirSync(OUTPUT_DIR, { recursive: true })

/** 生成依赖图 */
try {
    execSync(
        `npx madge --image ${OUTPUT_PATH} --extensions ${EXTENSIONS} ${DIR}`,
        { stdio: 'inherit' }
    )
    console.log('\n✅ 生成成功！')
    console.log(`文件位置：${resolve(OUTPUT_PATH)}`)
} catch (error) {
    console.error('\n❌ 生成失败')
    console.error('可能原因：')
    console.error('  - 项目有语法错误或 madge 无法解析')
    console.error('  - 依赖关系过于复杂')
    process.exit(1)
}

/** 检查循环依赖 */
console.log('\n🔍 检查循环依赖...')
try {
    const result = execSync(`npx madge --circular ${DIR}`, { encoding: 'utf-8' })
    if (result.trim()) {
        console.log('⚠️  发现循环依赖：')
        console.log(result)
    } else {
        console.log('✅ 未发现循环依赖')
    }
} catch (error) {
    console.log('⚠️  循环依赖检测失败')
}

console.log('\n建议：')
console.log('  - 用浏览器打开查看（推荐 Chrome）')
console.log('  - 或用 VS Code 的 SVG 预览插件打开')
