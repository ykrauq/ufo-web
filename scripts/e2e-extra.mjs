// Additional browser checks in Chrome 149 with WebMCP enabled:
//   1. the declarative form tool appears in the browser's getTools()
//   2. the scripted demo runs through the native API and waits for human approvals
//   3. the file chooser path (Open files) works
//   4. mobile and dark-mode screenshots for review
//
//   node scripts/e2e-extra.mjs [--url https://web.universalfileopener.com]

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, stat, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'

const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'scripts', 'out')
const SAMPLES = join(ROOT, 'public', 'samples')
const CHROME = process.env.CHROME_BIN ?? join(homedir(), '.cache', 'ms-playwright', 'chromium-1228', 'chrome-linux64', 'chrome')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' }

const urlArg = process.argv.indexOf('--url')
const liveUrl = urlArg >= 0 ? process.argv[urlArg + 1].replace(/\/$/, '') : null

function serve() {
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
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })))
}

await mkdir(OUT, { recursive: true })
const { server, port } = liveUrl ? { server: null, port: null } : await serve()
const origin = liveUrl ?? `http://127.0.0.1:${port}`
const extra = (process.env.CHROME_EXTRA_ARGS ?? '').split('|').filter(Boolean)
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--enable-features=WebMCP', ...extra] })
let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures++
}

// 1 + 2: declarative tool, scripted demo through the native API.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${origin}/`)
  await page.waitForSelector('.pill')
  const initial = await page.evaluate(async () => {
    const ctx = document.modelContext ?? navigator.modelContext
    return ctx?.getTools ? (await ctx.getTools()).map((t) => t.name) : []
  })
  check(initial.length >= 17, `all ${initial.length} tools registered at page load (before any files)`)
  const emptyCall = await page.evaluate(() => window.ufoWeb.call('privacy_scan', {}))
  check(/No files in the workspace/.test(emptyCall), 'investigation tool explains the empty workspace instead of failing silently')

  await page.getByRole('button', { name: /Scripted demo/ }).click()
  await page.waitForSelector('.proposal-pending', { timeout: 120000 })
  const pendingCount = await page.locator('.proposal-pending').count()
  check(pendingCount >= 2, `scripted demo produced ${pendingCount} pending proposals and is waiting`)
  const transcript = await page.locator('.bubble').count()
  check(transcript >= 8, `transcript has ${transcript} lines`)
  const usedNative = await page.locator('.bubble-system', { hasText: 'WebMCP API' }).count()
  check(usedNative === 1, 'demo reports it went through the browser\'s WebMCP API')
  await page.screenshot({ path: join(OUT, '05-demo-waiting.png') })
  // Human approves everything.
  while (await page.locator('.proposal-pending button.primary').count()) {
    await page.locator('.proposal-pending button.primary').first().click()
    await page.waitForTimeout(400)
  }
  await page.waitForSelector('.downloads a[download="ufo-web-report.md"]', { timeout: 60000 })
  check(true, 'after approvals the demo exported the report')
  await page.waitForFunction(() => !window.ufoWeb.state().demoRunning, null, { timeout: 30000 })
  await page.screenshot({ path: join(OUT, '06-demo-done.png') })

  const declarative = await page.evaluate(async () => {
    const ctx = document.modelContext ?? navigator.modelContext
    const tools = await ctx.getTools()
    const t = tools.find((x) => x.name === 'filter_file_list')
    return t ? { found: true, description: t.description?.slice(0, 60) } : { found: false, names: tools.map((x) => x.name) }
  })
  check(declarative.found, `declarative form tool filter_file_list visible to the browser${declarative.found ? '' : ` (have: ${declarative.names.join(', ')})`}`)
  if (declarative.found) {
    const res = await page.evaluate(async () => {
      const ctx = document.modelContext ?? navigator.modelContext
      const tools = await ctx.getTools()
      const t = tools.find((x) => x.name === 'filter_file_list')
      try {
        const r = await ctx.executeTool(t, JSON.stringify({ query: 'contracts', flag: '' }))
        return typeof r === 'string' ? r.slice(0, 200) : JSON.stringify(r).slice(0, 200)
      } catch (e) {
        return `error: ${e}`
      }
    })
    console.log('  filter_file_list via executeTool ->', res)
    const shown = await page.locator('.files-count').textContent()
    console.log('  sidebar now says:', shown?.trim())
  }
  check(errors.length === 0, `no page errors (${errors.length})`)
  if (errors.length) console.log(errors.slice(0, 5))
  await page.close()
}

// 3: file chooser
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${origin}/`)
  await page.waitForSelector('.pill')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^Open files$/ }).click()
  const fc = await chooser
  await fc.setFiles([join(SAMPLES, 'photos', 'site-visit-northgate.jpg'), join(SAMPLES, 'hr', 'onboarding-list.csv')])
  await page.waitForFunction(() => window.ufoWeb.state().files.length === 2 && !window.ufoWeb.state().busy, null, { timeout: 60000 })
  const list = JSON.parse(await page.evaluate(() => window.ufoWeb.call('list_files', {})))
  check(list.total === 2 && list.files.some((f) => f.flags.includes('has_gps')), 'files chosen through the file picker are inspected')
  await page.close()
}

// 4: mobile and dark mode
{
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await mobile.newPage()
  await page.goto(`${origin}/`)
  await page.waitForSelector('.pill')
  await page.screenshot({ path: join(OUT, '07-mobile-empty.png') })
  await page.getByRole('button', { name: 'Load the sample case' }).click()
  await page.waitForFunction(() => !window.ufoWeb.state().busy && window.ufoWeb.state().files.length >= 14, null, { timeout: 90000 })
  await page.screenshot({ path: join(OUT, '08-mobile-loaded.png') })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check(!overflow, 'no horizontal overflow at 390px')
  await mobile.close()

  const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const dpage = await dark.newPage()
  await dpage.goto(`${origin}/`)
  await dpage.waitForSelector('.pill')
  await dpage.getByRole('button', { name: 'Load the sample case' }).click()
  await dpage.waitForFunction(() => !window.ufoWeb.state().busy && window.ufoWeb.state().files.length >= 14, null, { timeout: 90000 })
  await dpage.evaluate(() => window.ufoWeb.call('propose_action', { path: 'photos/site-visit-northgate.jpg', action: 'strip_metadata', reason: 'GPS and photographer name.', severity: 'high' }))
  await dpage.waitForSelector('.proposal-pending')
  await dpage.screenshot({ path: join(OUT, '09-dark-loaded.png') })
  await dark.close()
}

await browser.close()
server?.close()
console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
process.exitCode = failures ? 1 : 0
