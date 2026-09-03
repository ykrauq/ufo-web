// Review screenshots of the preview renderers, the About page, and both themes.
//   node scripts/shots.mjs [--url https://web.universalfileopener.com]

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, stat, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'

const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'scripts', 'out', 'shots')
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
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--enable-features=WebMCP'] })
const errors = []

async function session(theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${theme}: ${e}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${theme}: ${m.text()}`) })
  await page.goto(`${origin}/`)
  await page.waitForSelector('.pill')
  await page.screenshot({ path: join(OUT, `${theme}-01-home.png`) })
  await page.goto(`${origin}/#about`)
  await page.waitForSelector('.about')
  await page.screenshot({ path: join(OUT, `${theme}-02-about.png`), fullPage: true })
  await page.goto(`${origin}/`)
  await page.waitForSelector('.pill')
  await page.getByRole('button', { name: 'Load the sample case' }).click()
  await page.waitForFunction(() => !window.ufoWeb.state().busy && window.ufoWeb.state().files.length >= 14, null, { timeout: 90000 })
  const previews = [
    ['contracts/Q3-services-agreement-v3.docx', 'docx'],
    ['finance/vendor-payments.xlsx', 'xlsx'],
    ['slides/board-update-sept.pptx', 'pptx'],
    ['invoices/invoice-2291.pdf', 'pdf'],
    ['src/auth_check.py', 'code'],
    ['photos/site-visit-northgate.jpg', 'image'],
    ['hr/onboarding-list.csv', 'csv'],
    ['mail/RE wire instructions 2291.eml', 'email'],
  ]
  let n = 3
  for (const [path, label] of previews) {
    await page.evaluate((p) => window.ufoWeb.call('inspect', { path: p }), path)
    await page.getByRole('tab', { name: /Preview/ }).click()
    await page.waitForFunction(() => !document.querySelector('.preview p')?.textContent?.includes('Rendering'), null, { timeout: 30000 }).catch(() => {})
    if (label === 'pdf') await page.waitForSelector('.pdf-page', { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(OUT, `${theme}-${String(n++).padStart(2, '0')}-${label}.png`) })
    const toggle = page.locator('.reveal-toggle input')
    if (await toggle.count()) {
      await toggle.check()
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(OUT, `${theme}-${String(n++).padStart(2, '0')}-${label}-reveal.png`) })
      if (label === 'xlsx') {
        await page.locator('.sheet-tabs button').nth(1).click()
        await page.waitForTimeout(200)
        await page.screenshot({ path: join(OUT, `${theme}-${String(n++).padStart(2, '0')}-xlsx-hidden-sheet.png`) })
      }
    }
  }
  await context.close()
}

await session('light')
await session('dark')
await browser.close()
server?.close()
console.log(errors.length ? `errors:\n  ${errors.join('\n  ')}` : 'no page errors')
console.log(`screenshots in ${OUT}`)
