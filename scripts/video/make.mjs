// Produce the demo video: narration with edge-tts, a scripted Chrome 149 session
// captured through Chrome's own screencast (every frame carries a wall-clock
// timestamp, so narration lines up exactly), then ffmpeg assembles frames and
// audio. Tool calls in the recording go through navigator.modelContext.executeTool,
// the browser's own WebMCP API.
//
//   node scripts/video/make.mjs            full pipeline -> scripts/video/out/ufo-web-demo.mp4
//   node scripts/video/make.mjs --tts      narration only
//   node scripts/video/make.mjs --record   recording only (uses cached narration durations)
//   node scripts/video/make.mjs --mux      assemble only

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, stat, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'

const run = promisify(execFile)
const HERE = new URL('.', import.meta.url).pathname
const ROOT = join(HERE, '..', '..')
const DIST = join(ROOT, 'dist')
const OUT = join(HERE, 'out')
const FRAMES = join(OUT, 'frames')
const CHROME = process.env.CHROME_BIN ?? join(homedir(), '.cache', 'ms-playwright', 'chromium-1228', 'chrome-linux64', 'chrome')
const W = 1920
const H = 1080
const PAD_MS = 700
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }

const narration = JSON.parse(await readFile(join(HERE, 'narration.json'), 'utf8'))
await mkdir(OUT, { recursive: true })

// ------------------------------------------------------------ narration

async function tts() {
  const durations = {}
  for (const scene of narration.scenes) {
    const hash = createHash('sha1').update(narration.voice + narration.rate + scene.text).digest('hex').slice(0, 10)
    const file = join(OUT, `tts-${scene.id}-${hash}.mp3`)
    if (!existsSync(file)) {
      await run('edge-tts', ['--voice', narration.voice, `--rate=${narration.rate}`, '--text', scene.text, '--write-media', file])
    }
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
    durations[scene.id] = { file, seconds: Number(stdout.trim()) }
    console.log(`tts ${scene.id}: ${durations[scene.id].seconds.toFixed(2)}s`)
  }
  await writeFile(join(OUT, 'durations.json'), JSON.stringify(durations, null, 2))
  const total = Object.values(durations).reduce((n, d) => n + d.seconds, 0)
  console.log(`narration total ${total.toFixed(1)}s + pads ${(narration.scenes.length * PAD_MS / 1000).toFixed(1)}s`)
  return durations
}

// ------------------------------------------------------------ static server

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

// ------------------------------------------------------------ cursor overlay and cards

const CURSOR_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById('__cursor')) return
    const c = document.createElement('div')
    c.id = '__cursor'
    c.style.cssText = 'position:fixed;left:-100px;top:-100px;z-index:2147483647;width:26px;height:26px;pointer-events:none;transition:transform .12s;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))'
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.5 L12 13.5 L19 13.5 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.documentElement.appendChild(c)
    document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    document.addEventListener('mousedown', () => { c.style.transform = 'scale(.8)' }, true)
    document.addEventListener('mouseup', () => { c.style.transform = 'scale(1)' }, true)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install)
  else install()
})()
`

function cardHtml(title, subtitle, small) {
  return `<div id="__card" style="position:fixed;inset:0;z-index:2147483646;background:#0b1220;color:#e5e7eb;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:22px;padding:0 120px">
  <div style="display:flex;align-items:center;gap:18px"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="96" height="96"><rect width="64" height="64" rx="14" fill="#0f172a"/><ellipse cx="32" cy="36" rx="24" ry="8" fill="#38bdf8"/><ellipse cx="32" cy="30" rx="12" ry="9" fill="#e0f2fe"/><circle cx="20" cy="37" r="2.2" fill="#0f172a"/><circle cx="32" cy="39" r="2.2" fill="#0f172a"/><circle cx="44" cy="37" r="2.2" fill="#0f172a"/></svg><span style="font-size:54px;font-weight:700;letter-spacing:-.02em">UFO Web</span></div>
  <h1 style="font-size:64px;line-height:1.1;margin:0;max-width:1400px">${title}</h1>
  <p style="font-size:30px;color:#94a3b8;margin:0">${subtitle}</p>
  ${small ? `<div style="font-size:22px;color:#64748b;margin-top:30px">${small}</div>` : ''}
</div>`
}

async function showCard(page, title, subtitle, small) {
  await page.evaluate((html) => {
    document.getElementById('__card')?.remove()
    document.documentElement.insertAdjacentHTML('beforeend', html)
  }, cardHtml(title, subtitle, small))
}

async function hideCard(page) {
  await page.evaluate(() => document.getElementById('__card')?.remove())
}

// ------------------------------------------------------------ recording

async function record(durations) {
  await rm(FRAMES, { recursive: true, force: true })
  await mkdir(FRAMES, { recursive: true })
  const { server, port } = await serve()
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--enable-features=WebMCP', '--force-device-scale-factor=1'] })
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'light' })
  await context.addInitScript(CURSOR_SCRIPT)
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.waitForSelector('.pill')

  // Chrome's screencast: one JPEG per compositor frame, stamped with wall-clock time.
  // Started after the only navigation, because a cross-process navigation ends it.
  const cdp = await context.newCDPSession(page)
  const frames = []
  const pending = []
  let index = 0
  cdp.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
    const file = join(FRAMES, `f${String(index++).padStart(6, '0')}.jpg`)
    frames.push({ t: metadata.timestamp * 1000, file })
    pending.push(writeFile(file, Buffer.from(data, 'base64')))
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 })

  const t0 = Date.now()
  const timeline = []
  let sceneStart = t0
  const scene = async (id, actions) => {
    sceneStart = Date.now()
    timeline.push({ id, startMs: sceneStart - t0 })
    console.log(`scene ${id} @ ${((sceneStart - t0) / 1000).toFixed(1)}s`)
    await actions()
    const need = durations[id].seconds * 1000 + PAD_MS
    const elapsed = Date.now() - sceneStart
    if (elapsed < need) await page.waitForTimeout(need - elapsed)
  }
  const move = async (x, y, steps = 25) => page.mouse.move(x, y, { steps })
  const click = async (selector) => {
    const el = page.locator(selector).first()
    await el.waitFor({ state: 'visible' })
    const box = await el.boundingBox()
    if (box) await move(box.x + box.width / 2, box.y + box.height / 2, 30)
    await page.waitForTimeout(250)
    await el.click()
  }
  const agent = async (name, input = {}) => {
    const res = await page.evaluate(async ([n, i]) => {
      const ctx = document.modelContext ?? navigator.modelContext
      const tools = await ctx.getTools()
      const tool = tools.find((t) => t.name === n)
      if (!tool) throw new Error('tool not registered: ' + n)
      return ctx.executeTool(tool, JSON.stringify(i))
    }, [name, input])
    await page.waitForTimeout(900)
    return res
  }
  const expandLatestCall = async () => {
    const head = page.locator('.toollog .toolcall-head').first()
    if (await head.count()) {
      const box = await head.boundingBox()
      if (box) await move(box.x + 40, box.y + box.height / 2, 20)
      await head.click()
    }
  }

  await showCard(page, 'Drop files. Investigate them with your agent.', 'Nothing leaves your browser.', 'A WebMCP Challenge entry')
  await page.waitForTimeout(300)
  await scene('title', async () => {})

  await hideCard(page)
  await scene('problem', async () => {
    await move(700, 500, 40)
    await page.waitForTimeout(1500)
    await move(960, 180, 30)
    await page.waitForTimeout(1200)
    await move(1060, 470, 30)
    await page.waitForTimeout(1200)
    await move(1350, 470, 30)
  })

  await scene('load', async () => {
    await click('text=Load the sample case')
    await page.waitForFunction(() => window.ufoWeb.state().files.length >= 14, null, { timeout: 60000 })
    await page.waitForFunction(() => !window.ufoWeb.state().busy, null, { timeout: 90000 })
    await move(150, 300, 30)
    await page.waitForTimeout(600)
    await move(150, 700, 40)
    await page.waitForTimeout(600)
    await move(150, 1000, 40)
  })

  await scene('agent', async () => {
    await move(1500, 330, 30)
    await agent('workspace_status')
    await agent('privacy_scan')
    await expandLatestCall()
    await move(1500, 520, 20)
  })

  await scene('contract', async () => {
    await agent('inspect', { path: 'contracts/Q3-services-agreement-v3.docx' })
    await move(700, 450, 30)
    await page.waitForTimeout(1600)
    await page.mouse.wheel(0, 260)
    await page.waitForTimeout(2200)
    await agent('extract_text', { path: 'contracts/Q3-services-agreement-v3.docx', unit: 'hidden text' })
    await expandLatestCall()
    await move(1500, 520, 20)
  })

  await scene('pdf', async () => {
    await agent('hidden_content_scan')
    await agent('inspect', { path: 'invoices/invoice-2291.pdf', section: 'findings' })
    await move(700, 450, 30)
    await page.waitForTimeout(1500)
    await page.mouse.wheel(0, 200)
  })

  await scene('crossfile', async () => {
    await agent('compare', { a: 'contracts/Q3-services-agreement-v2.docx', b: 'contracts/Q3-services-agreement-v3.docx' })
    await expandLatestCall()
    await page.waitForTimeout(2500)
    await agent('timeline')
    await expandLatestCall()
    await move(1500, 560, 20)
  })

  await scene('archive', async () => {
    await agent('inspect', { path: 'archive/backup-2024.zip', section: 'container' })
    await move(700, 420, 30)
    await page.waitForTimeout(2600)
    await agent('inspect', { path: 'src/auth_check.py', section: 'findings' })
    await move(700, 480, 30)
  })

  await scene('propose', async () => {
    await agent('inspect', { path: 'photos/site-visit-northgate.jpg' })
    await agent('propose_action', { path: 'photos/site-visit-northgate.jpg', action: 'strip_metadata', reason: 'GPS coordinates, the photographer name, and the camera body serial travel with this photo.', severity: 'high' })
    await agent('propose_action', { path: 'archive/backup-2024.zip', action: 'quarantine', reason: 'Nested archive carrying a renamed executable (setup-helper.exe).', severity: 'high' })
    await agent('propose_action', { path: 'mail/RE wire instructions 2291.eml', action: 'flag', reason: 'Reply-To points at a different domain than From; new wire instructions. Verify by phone before paying.', severity: 'high' })
    await page.waitForTimeout(1500)
    await click('.proposal-pending:has-text("strip metadata") button.primary')
    await page.waitForSelector('.downloads a[download$=".jpg"]', { timeout: 30000 })
    await page.waitForTimeout(1200)
    await click('.proposal-pending:has-text("quarantine") button.primary')
    await page.waitForTimeout(900)
    await click('.proposal-pending:has-text("flag") button.primary')
    await move(1500, 300, 20)
  })

  await scene('injection', async () => {
    await agent('inspect', { path: 'README.txt', section: 'findings' })
    await move(700, 420, 30)
  })

  await scene('export', async () => {
    await agent('export_report', { format: 'markdown' })
    await move(1500, 700, 30)
    await page.waitForTimeout(800)
    await expandLatestCall()
  })

  await showCard(page, 'web.universalfileopener.com', 'Open source, MIT · github.com/ykrauq/ufo-web', 'Same receipt fields as <code>ufo inspect --json</code>, the Universal File Opener command line')
  await scene('end', async () => {})
  await page.waitForTimeout(600)
  const tEnd = Date.now()

  await cdp.send('Page.stopScreencast').catch(() => {})
  await Promise.all(pending)
  await context.close()
  await browser.close()
  server.close()
  await writeFile(join(OUT, 'timeline.json'), JSON.stringify({ t0, tEnd, totalMs: tEnd - t0, scenes: timeline, frames: frames.map((f) => ({ t: Math.round(f.t - t0), file: f.file })) }, null, 2))
  console.log(`recorded ${((tEnd - t0) / 1000).toFixed(1)}s, ${frames.length} frames`)
}

// ------------------------------------------------------------ assemble

async function mux(durations) {
  const { totalMs, scenes, frames } = JSON.parse(await readFile(join(OUT, 'timeline.json'), 'utf8'))
  if (!frames.length) throw new Error('no frames recorded')
  // The first frame stands in for everything before it; the last is held to the end.
  const lines = ['ffconcat version 1.0']
  for (let i = 0; i < frames.length; i++) {
    const start = i === 0 ? 0 : frames[i].t
    const end = i + 1 < frames.length ? frames[i + 1].t : totalMs
    const duration = Math.max(1, end - start) / 1000
    lines.push(`file '${frames[i].file}'`, `duration ${duration.toFixed(3)}`)
  }
  lines.push(`file '${frames[frames.length - 1].file}'`)
  const list = join(OUT, 'frames.txt')
  await writeFile(list, lines.join('\n') + '\n')

  const inputs = ['-f', 'concat', '-safe', '0', '-i', list]
  const filters = [`[0:v]fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p[vout]`]
  const labels = []
  scenes.forEach((s, i) => {
    inputs.push('-i', durations[s.id].file)
    const delay = Math.max(0, Math.round(s.startMs))
    filters.push(`[${i + 1}:a]aresample=48000,adelay=${delay}|${delay}[a${i}]`)
    labels.push(`[a${i}]`)
  })
  filters.push(`${labels.join('')}amix=inputs=${scenes.length}:normalize=0:dropout_transition=0[aout]`)
  const out = join(OUT, 'ufo-web-demo.mp4')
  await run('ffmpeg', ['-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-t', (totalMs / 1000).toFixed(3), '-movflags', '+faststart', out], { maxBuffer: 64 * 1024 * 1024 })
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'default=nw=1', out])
  console.log(`assembled -> ${out}\n${probe.stdout.trim()}`)
  return out
}

const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--'))
let durations
if (!only || only === '--tts') durations = await tts()
else durations = JSON.parse(await readFile(join(OUT, 'durations.json'), 'utf8'))
if (!only || only === '--record') await record(durations)
if (!only || only === '--mux') await mux(durations)
