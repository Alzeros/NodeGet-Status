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
