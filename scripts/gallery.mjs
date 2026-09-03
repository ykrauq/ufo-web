// Gallery screenshots for the Devpost project page, 3:2 at 1440x960.
//   node scripts/gallery.mjs [--url https://web.universalfileopener.com]
// Writes docs/gallery/*.png

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, stat, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'

const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'docs', 'gallery')
const CHROME = process.env.CHROME_BIN ?? join(homedir(), '.cache', 'ms-playwright', 'chromium-1228', 'chrome-linux64', 'chrome')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.pfb': 'application/octet-stream' }
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
const errors = []
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) })

async function loadSample(page) {
  await page.goto(`${origin}/`)
  await page.waitForSelector('.pill')
  await page.getByRole('button', { name: 'Load the sample case' }).click()
  await page.waitForFunction(() => !window.ufoWeb.state().busy && window.ufoWeb.state().files.length >= 14, null, { timeout: 90000 })
}

async function preview(page, path, reveal) {
  await page.evaluate((p) => window.ufoWeb.call('inspect', { path: p }), path)
  await page.getByRole('tab', { name: /Preview/ }).click()
  await page.waitForFunction(() => !document.querySelector('.preview p')?.textContent?.includes('Rendering'), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(400)
  if (reveal) {
    await page.locator('.reveal-toggle input').check()
    await page.waitForTimeout(200)
  }
}

async function light() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'light' })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${origin}/`)
  await page.waitForSelector('.pill')
  await shot(page, '01-home')

  await loadSample(page)
  // An agent-style investigation so the transcript and tool log are populated.
  const calls = [
    ['workspace_status', {}],
    ['list_files', {}],
    ['privacy_scan', {}],
    ['hidden_content_scan', {}],
    ['inspect', { path: 'invoices/invoice-2291.pdf' }],
    ['extract_text', { path: 'contracts/Q3-services-agreement-v3.docx' }],
    ['compare', { a: 'contracts/Q3-services-agreement-v2.docx', b: 'contracts/Q3-services-agreement-v3.docx' }],
    ['timeline', {}],
    ['entities', {}],
  ]
  for (const [tool, input] of calls) await page.evaluate(([t, i]) => window.ufoWeb.call(t, i), [tool, input])
  await page.evaluate(() => window.ufoWeb.call('propose_action', { path: 'photos/site-visit-northgate.jpg', action: 'strip_metadata', reason: 'GPS location, photographer name, and camera serial travel with this photo.', severity: 'high' }))
  await page.evaluate(() => window.ufoWeb.call('propose_action', { path: 'downloads/statement-august.pdf', action: 'rename_extension', reason: 'The bytes are a PNG image, not a PDF. The name is wrong.', severity: 'medium' }))
  await page.waitForSelector('.proposal-pending')
  await page.evaluate(() => window.ufoWeb.call('inspect', { path: 'invoices/invoice-2291.pdf' }))
  await page.getByRole('tab', { name: /Findings/ }).click()
  await page.waitForTimeout(300)
  await shot(page, '02-findings-and-suggestions')

  await preview(page, 'contracts/Q3-services-agreement-v3.docx', true)
  await shot(page, '03-word-reveal-hidden')

  await preview(page, 'finance/vendor-payments.xlsx', true)
  await page.locator('.sheet-tabs button').nth(1).click()
  await page.waitForTimeout(200)
  await shot(page, '04-excel-veryhidden-sheet')

  await preview(page, 'src/auth_check.py', true)
  await shot(page, '05-code-invisible-characters')

  // The person executes both suggestions.
  while (await page.locator('.proposal-pending button.primary').count()) {
    await page.locator('.proposal-pending button.primary').first().click()
    await page.waitForTimeout(500)
  }
  await page.evaluate(() => window.ufoWeb.call('list_proposals', {}))
  await page.evaluate(() => window.ufoWeb.call('export_report', { format: 'markdown' }))
  await page.waitForSelector('.downloads a', { timeout: 30000 })
  await page.evaluate(() => window.ufoWeb.call('inspect', { path: 'photos/site-visit-northgate.jpg' }))
  await page.getByRole('tab', { name: /Findings/ }).click()
  await page.waitForTimeout(300)
  await shot(page, '06-executed-and-report')
  await context.close()
}

async function dark() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await loadSample(page)
  await page.evaluate(() => window.ufoWeb.call('hidden_content_scan', {}))
  await page.evaluate(() => window.ufoWeb.call('propose_action', { path: 'finance/budget-model.xlsm', action: 'quarantine', reason: 'Macro project with an auto-run entry point and a veryHidden sheet.', severity: 'high' }))
  await preview(page, 'slides/board-update-sept.pptx', true)
  await shot(page, '07-dark-powerpoint-hidden-slide')
  await context.close()
}

await light()
await dark()
await browser.close()
server?.close()
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors')
console.log(`wrote ${OUT}`)
