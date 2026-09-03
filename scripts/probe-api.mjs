// Exercise the browser's own WebMCP API surface (not the in-page shortcut):
// which object carries it, which methods exist, whether our registrations show
// up in getTools(), and whether executeTool() round-trips a call.

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'

const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')
const CHROME = process.env.CHROME_BIN ?? join(homedir(), '.cache', 'ms-playwright', 'chromium-1228', 'chrome-linux64', 'chrome')
const FLAGS = (process.env.CHROME_FLAGS ?? '--enable-features=WebMCP').split(' ').filter(Boolean)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = join(DIST, url === '/' ? 'index.html' : url)
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', ...FLAGS] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`) })
await page.goto(`http://127.0.0.1:${port}/`)
await page.waitForSelector('.pill')

const surface = await page.evaluate(() => {
  const describe = (obj) => {
    if (!obj) return null
    const names = new Set()
    let p = obj
    while (p && p !== Object.prototype) {
      for (const n of Object.getOwnPropertyNames(p)) names.add(n)
      p = Object.getPrototypeOf(p)
    }
    return [...names].filter((n) => n !== 'constructor').sort()
  }
  return { document: describe(document.modelContext), navigator: describe(navigator.modelContext), same: document.modelContext === navigator.modelContext }
})
console.log('surface:', JSON.stringify(surface))

const ctxExpr = 'document.modelContext ?? navigator.modelContext'
const before = await page.evaluate(async (expr) => {
  const ctx = eval(expr)
  if (!ctx?.getTools) return 'no getTools'
  const tools = await ctx.getTools()
  return tools.map((t) => t.name)
}, ctxExpr)
console.log('getTools before files:', JSON.stringify(before))

await page.click('text=Load the sample case')
await page.waitForFunction(() => !window.ufoWeb.state().busy && window.ufoWeb.state().files.length >= 14, null, { timeout: 90000 })
const after = await page.evaluate(async (expr) => {
  const ctx = eval(expr)
  if (!ctx?.getTools) return { error: 'no getTools' }
  const tools = await ctx.getTools()
  const names = tools.map((t) => t.name)
  const sample = tools.find((t) => t.name === 'privacy_scan')
  const descriptor = sample ? { name: sample.name, description: sample.description?.slice(0, 80), inputSchema: typeof sample.inputSchema, annotations: sample.annotations } : null
  let exec = null
  if (ctx.executeTool) {
    const tool = tools.find((t) => t.name === 'workspace_status')
    try {
      const r = await ctx.executeTool(tool, '{}')
      exec = typeof r === 'string' ? r.slice(0, 160) : JSON.stringify(r).slice(0, 160)
    } catch (e) {
      exec = `executeTool error: ${e}`
    }
  }
  return { count: names.length, names, descriptor, exec }
}, ctxExpr)
console.log('getTools after files:', JSON.stringify(after, null, 1))

// toolchange event: clear the workspace and see whether the browser noticed.
await page.evaluate((expr) => {
  const ctx = eval(expr)
  window.__toolchange = 0
  ctx?.addEventListener?.('toolchange', () => window.__toolchange++)
}, ctxExpr)
await page.getByRole('button', { name: 'Clear' }).click()
await page.waitForTimeout(500)
console.log('toolchange events after clear:', await page.evaluate(() => window.__toolchange))
const afterClear = await page.evaluate(async (expr) => {
  const ctx = eval(expr)
  if (!ctx?.getTools) return 'no getTools'
  return (await ctx.getTools()).map((t) => t.name)
}, ctxExpr)
console.log('getTools after clear:', JSON.stringify(afterClear))
console.log('console errors/warnings:', errors.length ? '\n  ' + errors.join('\n  ') : 'none')
await browser.close()
server.close()
