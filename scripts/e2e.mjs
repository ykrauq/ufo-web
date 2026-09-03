// End-to-end check against a real Chromium with WebMCP enabled.
//
//   node scripts/e2e.mjs            run the flow against dist/ and print results
//   node scripts/e2e.mjs --probe    try flag combinations, report which exposes document.modelContext
//
// CHROME_BIN overrides the browser binary; CHROME_FLAGS overrides the feature flags.

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, stat, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'

const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'scripts', 'out')
const DEFAULT_CHROME = join(homedir(), '.cache', 'ms-playwright', 'chromium-1228', 'chrome-linux64', 'chrome')
const CHROME = process.env.CHROME_BIN ?? DEFAULT_CHROME
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.wasm': 'application/wasm' }

function serve(dir) {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = join(dir, url === '/' ? 'index.html' : url)
    try {
      const s = await stat(file)
      if (s.isDirectory()) file = join(file, 'index.html')
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })))
}

async function launch(flags) {
  return chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', ...flags] })
}

async function probe(port) {
  const candidates = [
    [],
    ['--enable-features=WebMCP'],
    ['--enable-features=WebMCPTesting'],
    ['--enable-features=WebMCP,WebMCPTesting'],
    ['--enable-blink-features=WebMCP'],
    ['--enable-blink-features=WebMCPTesting'],
    ['--enable-features=WebMCP', '--enable-blink-features=WebMCP'],
    ['--enable-experimental-web-platform-features'],
  ]
  for (const flags of candidates) {
    const browser = await launch(flags)
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${port}/`)
    const result = await page.evaluate(() => ({
      document: typeof document.modelContext,
      navigator: typeof navigator.modelContext,
      registerTool: typeof document.modelContext?.registerTool,
      executeTool: typeof document.modelContext?.executeTool,
      getTools: typeof document.modelContext?.getTools,
    }))
    console.log(JSON.stringify(flags), '->', JSON.stringify(result))
    await browser.close()
  }
}

async function flow(port, flags, liveUrl) {
  await mkdir(OUT, { recursive: true })
  const browser = await launch(flags)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(liveUrl ? `${liveUrl}/` : `http://127.0.0.1:${port}/`)
  await page.waitForSelector('.pill')
  const mode = await page.evaluate(() => window.ufoWeb.mode())
  const native = await page.evaluate(() => typeof document.modelContext?.getTools === 'function' && !document.modelContext.__polyfill)
  console.log('WebMCP mode:', mode, '| native getTools:', native)
  const toolsBefore = await page.evaluate(() => window.ufoWeb.tools())
  console.log('tools before files:', toolsBefore.join(', '))
  await page.screenshot({ path: join(OUT, '01-empty.png') })

  await page.click('text=Load the sample case')
  await page.waitForFunction(() => document.querySelectorAll('.file-row').length >= 14, null, { timeout: 30000 })
  await page.waitForFunction(() => !window.ufoWeb.state().busy && window.ufoWeb.state().files.every((f) => f.status === 'done' || f.status === 'error'), null, { timeout: 90000 })
  const toolsAfter = await page.evaluate(() => window.ufoWeb.tools())
  console.log('tools after files:', toolsAfter.length, toolsAfter.join(', '))
  await page.screenshot({ path: join(OUT, '02-loaded.png') })

  const call = async (name, input = {}) => {
    const raw = await page.evaluate(([n, i]) => window.ufoWeb.call(n, i), [name, input])
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  const status = await call('workspace_status')
  console.log('workspace_status:', JSON.stringify(status))
  const files = await call('list_files', {})
  for (const f of files.files) console.log(`  ${f.path}  ${f.kind}  flags=${f.flags.join(',')}  findings=${f.findings}`)
  const privacy = await call('privacy_scan', {})
  console.log('privacy_scan:', privacy.findings, 'findings across', privacy.files, 'files', JSON.stringify(privacy.counts))
  const hidden = await call('hidden_content_scan', {})
  console.log('hidden_content_scan:', hidden.findings, 'findings across', hidden.files, 'files')
  const pdf = await call('inspect', { path: 'invoices/invoice-2291.pdf', section: 'findings' })
  console.log('pdf findings:', JSON.stringify(pdf.findings?.map((f) => `[${f.sev}] ${f.title}`)))
  const text = await call('extract_text', { path: 'contracts/Q3-services-agreement-v3.docx', unit: 'hidden text' })
  console.log('extract_text hidden:', text.text?.slice(0, 200))
  const cmp = await call('compare', { a: 'contracts/Q3-services-agreement-v2.docx', b: 'contracts/Q3-services-agreement-v3.docx' })
  console.log('compare: +', cmp.text?.addedLines, '-', cmp.text?.removedLines, 'metadata diffs', cmp.metadataDiff?.length)
  const tl = await call('timeline', {})
  console.log('timeline events:', tl.events?.length, 'anomalies:', tl.anomalies?.length)
  const proposal = await call('propose_action', { path: 'photos/site-visit-northgate.jpg', action: 'strip_metadata', reason: 'GPS location, photographer name, and camera serial travel with this photo.', severity: 'high' })
  console.log('propose_action:', JSON.stringify(proposal))
  await page.waitForSelector('.proposal-pending')
  await page.screenshot({ path: join(OUT, '03-proposal.png') })
  await page.click('.proposal-pending button.primary')
  await page.waitForSelector('.downloads a', { timeout: 30000 })
  const proposals = await call('list_proposals', {})
  console.log('after approval:', JSON.stringify(proposals.proposals[0]?.result))
  const report = await call('export_report', { format: 'markdown' })
  console.log('export_report:', JSON.stringify(report).slice(0, 300))
  await page.screenshot({ path: join(OUT, '04-approved.png') })

  // Native WebMCP path, when the browser has it: discover and execute through the API itself.
  if (native) {
    const viaApi = await page.evaluate(async () => {
      const tools = await document.modelContext.getTools()
      const names = tools.map((t) => t.name)
      const tool = tools.find((t) => t.name === 'workspace_status')
      let result = null
      if (tool && document.modelContext.executeTool) result = await document.modelContext.executeTool(tool, '{}')
      return { names, result: typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200) }
    })
    console.log('native getTools:', viaApi.names.length, 'tools; executeTool ->', viaApi.result)
  }
  console.log('page errors:', errors.length ? errors : 'none')
  await browser.close()
  return errors.length === 0
}

// --url https://web.universalfileopener.com runs the flow against a deployed origin instead of dist/.
const urlArg = process.argv.indexOf('--url')
const liveUrl = urlArg >= 0 ? process.argv[urlArg + 1].replace(/\/$/, '') : null
if (!liveUrl && !existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ missing; run npm run build first')
  process.exit(2)
}
const { server, port } = liveUrl ? { server: null, port: null } : await serve(DIST)
try {
  if (process.argv.includes('--probe')) await probe(port)
  else {
    const flags = (process.env.CHROME_FLAGS ?? '--enable-features=WebMCP,WebMCPTesting --enable-blink-features=WebMCP').split(' ').filter(Boolean)
    const ok = await flow(port, flags, liveUrl)
    process.exitCode = ok ? 0 : 1
  }
} finally {
  server?.close()
}
