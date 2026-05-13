import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import themeTemplate from '../nodeget-theme.json' with { type: 'json' }
import pkg from '../package.json' with { type: 'json' }

// 本地开发时加载 .env.local
const envLocalPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local')
if (existsSync(envLocalPath)) {
  const content = readFileSync(envLocalPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    // 去掉首尾的引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

themeTemplate.version = pkg.version

// 计算项目根目录和输出文件路径
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(projectRoot, 'dist/nodeget-theme.json')

/**
 * 解析单个 SITE_n 环境变量字符串
 * 格式示例: "name=Master,backend_url=wss://example.com,token=ABC"
 */
function parseSiteEnv(rawEnv) {
  const site = {}
  const pattern = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,]*))(?:\s*,\s*|\s*$)/g
  let match
  while ((match = pattern.exec(rawEnv))) {
    const key = match[1]
    const value = match[2] !== undefined
      ? match[2].replace(/\\(.)/g, '$1')
      : (match[3] ?? '').trim()
    site[key] = value
  }
  return site
}

// 从环境变量 SITE_1, SITE_2, ... 构建 token 列表
const siteTokens = []
for (let i = 1;; i++) {
  const envVar = process.env[`SITE_${i}`]
  if (!envVar) break

  const fields = parseSiteEnv(envVar)
  siteTokens.push({
    name: fields.name || `master-${i}`,
    backend_url: fields.backend_url || fields.url || '',
    token: fields.token || '',
  })
}

// 如果没有 SITE_n 环境变量，保持模板不变
if (!siteTokens.length) {
  console.log('[build-config] no SITE_n env vars found, keeping template')
  writeFileSync(outputPath, JSON.stringify(themeTemplate, null, 2) + '\n')
  process.exit(0)
}

// 构建最终配置
const finalConfig = {
  ...themeTemplate,
  user_preferences: {
    ...themeTemplate.user_preferences,
    site_name: process.env.SITE_NAME || 'NodeGet Status',
    site_logo: process.env.SITE_LOGO || '',
    footer: process.env.SITE_FOOTER || 'Powered by NodeGet',
  },
  site_tokens: siteTokens,
}

// 写入输出文件
writeFileSync(outputPath, JSON.stringify(finalConfig, null, 2) + '\n')
console.log(`[build-config] wrote ${siteTokens.length} site_tokens to ${outputPath}`)