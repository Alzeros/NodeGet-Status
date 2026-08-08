import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildConfig } from "../config/index.mjs"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envLocalPath = resolve(projectRoot, '.env.local')

if (existsSync(envLocalPath)) {
  const content = readFileSync(envLocalPath, 'utf-8')
  const regex = /^\s*([A-Za-z0-9_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^#\r\n]*))/gm
  let match
  while ((match = regex.exec(content)) !== null) {
    const key = match[1]
    const value = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4].trim())
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

const outputPath = resolve(projectRoot, 'dist/config.json')
const finalConfig = buildConfig()

writeFileSync(outputPath, JSON.stringify(finalConfig, null, 2) + '\n', 'utf-8')
console.log(`[build-config] wrote ${finalConfig.site_tokens.length} site_tokens to ${outputPath}`)

const siteLogo = finalConfig.user_preferences.site_logo
if (siteLogo) {
  const indexPath = resolve(projectRoot, 'dist/index.html')
  if (existsSync(indexPath)) {
    let html = readFileSync(indexPath, 'utf-8')
    html = html.replace(
      /<link rel="icon"[^>]*href="[^"]*"[^>]*>/,
      `<link rel="icon" type="image/png" href="${siteLogo}" />`,
    )
    writeFileSync(indexPath, html, 'utf-8')
    console.log(`[build-config] updated favicon to ${siteLogo}`)
  }
}

// 注入 preconnect / dns-prefetch：在 HTML 解析阶段就提前预热后端 WebSocket 以及图床
// （logo / favicon）所在域名的 DNS + TCP + TLS，握手不再等到 JS 执行后才开始。
// 所有 origin 均从 config 读取，换后端或图床时无需手改 index.html。
const preconnectOrigins = (() => {
  const raw = []
  for (const t of finalConfig.site_tokens ?? []) {
    if (t?.backend_url) raw.push(t.backend_url)
  }
  if (finalConfig.user_preferences?.site_logo) raw.push(finalConfig.user_preferences.site_logo)

  const origins = new Set()
  for (const u of raw) {
    try {
      const url = new URL(u)
      let proto = url.protocol
      if (proto === 'wss:') proto = 'https:'
      else if (proto === 'ws:') proto = 'http:'
      if (proto !== 'https:' && proto !== 'http:') continue
      origins.add(`${proto}//${url.host}`)
    } catch {
      // 跳过无法解析的地址
    }
  }
  return [...origins]
})()

if (preconnectOrigins.length) {
  const indexPath = resolve(projectRoot, 'dist/index.html')
  if (existsSync(indexPath)) {
    let html = readFileSync(indexPath, 'utf-8')
    const MARK_START = '<!-- preconnect:auto:start -->'
    const MARK_END = '<!-- preconnect:auto:end -->'
    // 先移除旧的注入块，保证脚本可重复执行而不累积
    html = html.replace(new RegExp(`\\s*${MARK_START}[\\s\\S]*?${MARK_END}`), '')
    const links = preconnectOrigins
      .map(o => `    <link rel="preconnect" href="${o}" />\n    <link rel="dns-prefetch" href="${o}" />`)
      .join('\n')
    const block = `${MARK_START}\n${links}\n    ${MARK_END}`
    // 插到 viewport meta 之后：保持 <meta charset> 在最前（HTML 规范约定），
    // 同时仍在 <head> 靠前位置，让浏览器的预加载扫描器尽早发起连接
    html = html.replace(
      /(<meta name="viewport"[^>]*>)/,
      `$1\n    ${block}`,
    )
    writeFileSync(indexPath, html, 'utf-8')
    console.log(`[build-config] injected preconnect for ${preconnectOrigins.join(', ')}`)
  }
}
