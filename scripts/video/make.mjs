// Demo video pipeline.
//
// Scenes come from narration.json. Ordinary scenes are recorded live in
// Chrome 149 through Chrome's own screencast (each frame carries a wall-clock
// timestamp, so narration lines up exactly). A scene with `clip` splices in an
// external screen recording (the real ChatGPT session) with a speed map:
// [[startSec, endSec, speed], ...]; fast segments get a visible badge. Each
// part gets its own narration (edge-tts audio + sentence SRT) and burned-in
// captions, then the parts are concatenated.
//
//   node scripts/video/make.mjs            full pipeline -> scripts/video/out/ufo-web-demo.mp4
//   node scripts/video/make.mjs --tts      narration only
//   node scripts/video/make.mjs --record   recording only
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
const PAD_MS = 650
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.pfb': 'application/octet-stream' }
const ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2']

const narration = JSON.parse(await readFile(join(HERE, 'narration.json'), 'utf8'))
await mkdir(OUT, { recursive: true })

/** Every narrated line, flattened: ordinary scenes and clip lines alike. */
function allLines() {
  const lines = []
  for (const s of narration.scenes) {
    if (s.clip) for (const l of s.lines) lines.push({ id: l.id, text: l.text })
    else lines.push({ id: s.id, text: s.text })
  }
  return lines
}

// ------------------------------------------------------------ narration

async function tts() {
  const durations = {}
  for (const line of allLines()) {
    const hash = createHash('sha1').update(narration.voice + narration.rate + line.text).digest('hex').slice(0, 10)
    const file = join(OUT, `tts-${line.id}-${hash}.mp3`)
    const srt = file.replace(/\.mp3$/, '.srt')
    if (!existsSync(file) || !existsSync(srt)) {
      await run('edge-tts', ['--voice', narration.voice, `--rate=${narration.rate}`, '--text', line.text, '--write-media', file, '--write-subtitles', srt])
    }
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
    durations[line.id] = { file, srt, seconds: Number(stdout.trim()) }
    console.log(`tts ${line.id}: ${durations[line.id].seconds.toFixed(2)}s`)
  }
  await writeFile(join(OUT, 'durations.json'), JSON.stringify(durations, null, 2))
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
  return `<div id="__card" style="position:fixed;inset:0;z-index:2147483646;background:#0b1020;color:#e5e7eb;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:22px;padding:0 120px 120px">
  <div style="display:flex;align-items:center;gap:18px"><img src="/logo.svg" width="96" height="96" alt=""><span style="font-size:54px;font-weight:700;letter-spacing:-.02em">UFO Web</span></div>
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
  // parts: [{ scenes: [{id, startMs}], startMs, endMs, frameFrom, frameTo }] with a clip between consecutive parts
  const parts = [{ scenes: [], startMs: 0, frameFrom: 0 }]
  const clips = []
  let sceneStart = t0
  const scene = async (id, actions) => {
    sceneStart = Date.now()
    const part = parts[parts.length - 1]
    part.scenes.push({ id, startMs: sceneStart - t0 - part.startMs })
    console.log(`scene ${id} @ ${((sceneStart - t0) / 1000).toFixed(1)}s`)
    await actions()
    const need = durations[id].seconds * 1000 + PAD_MS
    const elapsed = Date.now() - sceneStart
    if (elapsed < need) await page.waitForTimeout(need - elapsed)
  }
  const clipBoundary = (clipScene) => {
    const now = Date.now() - t0
    const part = parts[parts.length - 1]
    part.endMs = now
    part.frameTo = frames.length
    clips.push({ afterPart: parts.length - 1, id: clipScene.id })
    parts.push({ scenes: [], startMs: now, frameFrom: frames.length })
    console.log(`clip ${clipScene.id} boundary @ ${(now / 1000).toFixed(1)}s`)
  }
  const move = async (x, y, steps = 25) => page.mouse.move(x, y, { steps })
  const click = async (selectorOrLocator) => {
    const el = typeof selectorOrLocator === 'string' ? page.locator(selectorOrLocator).first() : selectorOrLocator.first()
    await el.waitFor({ state: 'visible' })
    await el.scrollIntoViewIfNeeded()
    const box = await el.boundingBox()
    if (box) await move(box.x + box.width / 2, box.y + box.height / 2, 28)
    await page.waitForTimeout(220)
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
    await page.waitForTimeout(850)
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
  const selectFile = (name) => click(`.file-row[title$="${name}"]`)
  const tab = (name) => click(page.getByRole('tab', { name }))

  const actions = {
    title: async () => {
      await showCard(page, 'Drop files. Investigate them with your agent.', 'Nothing leaves your browser.', 'A WebMCP Challenge entry')
      await page.waitForTimeout(300)
    },
    problem: async () => {
      await hideCard(page)
      await move(700, 520, 40)
      await page.waitForTimeout(1500)
      await move(960, 330, 30)
      await page.waitForTimeout(1200)
      await move(1150, 620, 30)
      await page.waitForTimeout(1200)
      await move(1400, 620, 30)
    },
    preview: async () => {
      await click('text=Load the sample case')
      await page.waitForFunction(() => window.ufoWeb.state().files.length >= 14, null, { timeout: 60000 })
      await page.waitForFunction(() => !window.ufoWeb.state().busy, null, { timeout: 90000 })
      await move(150, 400, 30)
      await page.waitForTimeout(900)
      await selectFile('Q3-services-agreement-v3.docx')
      await tab(/Preview/)
      await page.waitForSelector('.docx-page', { timeout: 30000 })
      await move(760, 520, 30)
      await page.waitForTimeout(1200)
      await click('.reveal-toggle')
      await page.waitForTimeout(2400)
      await selectFile('vendor-payments.xlsx')
      await page.waitForSelector('.xlsx', { timeout: 30000 })
      await click('.reveal-toggle')
      await page.waitForTimeout(600)
      await click('.sheet-tabs button:nth-child(2)')
      await page.waitForTimeout(1800)
      await selectFile('board-update-sept.pptx')
      await page.waitForSelector('.slide', { timeout: 30000 })
      await click('.reveal-toggle')
      await page.waitForTimeout(400)
      await page.mouse.wheel(0, 1400)
      await page.waitForTimeout(1200)
    },
    pdf: async () => {
      await tab(/Findings/)
      await agent('hidden_content_scan')
      await agent('inspect', { path: 'invoices/invoice-2291.pdf', section: 'findings' })
      await move(700, 500, 30)
      await page.waitForTimeout(1500)
      await page.mouse.wheel(0, 200)
    },
    crossfile: async () => {
      await agent('entities')
      await expandLatestCall()
      await page.waitForTimeout(2400)
      await agent('duplicates')
      await expandLatestCall()
      await page.waitForTimeout(2200)
      await agent('compare', { a: 'contracts/Q3-services-agreement-v2.docx', b: 'contracts/Q3-services-agreement-v3.docx' })
      await expandLatestCall()
      await page.waitForTimeout(2000)
      await agent('timeline')
      await expandLatestCall()
      await move(1500, 600, 20)
    },
    about: async () => {
      await click('button[aria-label="About"]')
      await page.waitForSelector('.about')
      await move(900, 500, 30)
      await page.waitForTimeout(800)
      await page.mouse.wheel(0, 500)
      await page.waitForTimeout(900)
      await page.mouse.wheel(0, 500)
    },
    end: async () => {
      await showCard(page, 'web.universalfileopener.com', 'Open source, MIT · github.com/ykrauq/ufo-web', 'The browser edition of Universal File Opener')
    },
  }

  for (const s of narration.scenes) {
    if (s.clip) {
      clipBoundary(s)
      continue
    }
    if (!actions[s.id]) throw new Error(`no actions for scene ${s.id}`)
    await scene(s.id, actions[s.id])
  }
  await page.waitForTimeout(500)
  const tEnd = Date.now() - t0
  const last = parts[parts.length - 1]
  last.endMs = tEnd
  last.frameTo = frames.length

  await cdp.send('Page.stopScreencast').catch(() => {})
  await Promise.all(pending)
  await context.close()
  await browser.close()
  server.close()
  const timeline = {
    parts: parts.map((p) => ({ scenes: p.scenes, durationMs: p.endMs - p.startMs, frames: frames.slice(p.frameFrom, p.frameTo).map((f) => ({ t: Math.round(f.t - t0 - p.startMs), file: f.file })) })),
    clips,
  }
  await writeFile(join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 2))
  console.log(`recorded ${(tEnd / 1000).toFixed(1)}s of scripted scenes, ${frames.length} frames, ${clips.length} clip boundary`)
}

// ------------------------------------------------------------ subtitles

function parseSrt(text) {
  const cues = []
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.trim().split('\n')
    const timing = lines.find((l) => l.includes('-->'))
    if (!timing) continue
    const [a, b] = timing.split('-->').map((s) => s.trim())
    const toMs = (s) => {
      const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s)
      return m ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, '0').slice(0, 3)) : 0
    }
    const body = lines.slice(lines.indexOf(timing) + 1).join(' ').trim()
    if (body) cues.push({ start: toMs(a), end: toMs(b), text: body })
  }
  return cues
}

function assTime(ms) {
  const cs = Math.round(ms / 10)
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

const ASS_HEAD = [
  '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Noto Sans,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H6E0A1020,-1,0,0,0,100,100,0.2,0,4,7,0,2,240,240,54,1',
  '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
]

/** lines: [{ id, startMs, endMs }] on one part's timeline */
async function buildAss(durations, lines, path) {
  const out = [...ASS_HEAD]
  for (const l of lines) {
    const d = durations[l.id]
    if (!d?.srt || !existsSync(d.srt)) continue
    for (const c of parseSrt(await readFile(d.srt, 'utf8'))) {
      const start = l.startMs + c.start
      const end = Math.min(l.startMs + c.end + 120, l.endMs - 40)
      if (end <= start) continue
      const text = c.text.replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/web dot universal ?file ?opener dot com/i, 'web.universalfileopener.com').replace(/get-tools/gi, 'getTools')
      out.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`)
    }
  }
  await writeFile(path, out.join('\n') + '\n')
  return path
}

function audioChain(durations, lines, firstInputIndex) {
  const inputs = []
  const filters = []
  const labels = []
  lines.forEach((l, i) => {
    inputs.push('-i', durations[l.id].file)
    filters.push(`[${firstInputIndex + i}:a]aresample=48000,adelay=${Math.max(0, Math.round(l.startMs))}|${Math.max(0, Math.round(l.startMs))}[a${i}]`)
    labels.push(`[a${i}]`)
  })
  filters.push(`${labels.join('')}amix=inputs=${lines.length}:normalize=0:dropout_transition=0,aformat=sample_rates=48000:channel_layouts=stereo[aout]`)
  return { inputs, filters }
}

// ------------------------------------------------------------ assemble parts

async function buildScriptedPart(durations, part, index) {
  const { frames, scenes, durationMs } = part
  if (!frames.length) throw new Error(`part ${index} has no frames`)
  const list = ['ffconcat version 1.0']
  for (let i = 0; i < frames.length; i++) {
    const start = i === 0 ? 0 : frames[i].t
    const end = i + 1 < frames.length ? frames[i + 1].t : durationMs
    list.push(`file '${frames[i].file}'`, `duration ${(Math.max(1, end - start) / 1000).toFixed(3)}`)
  }
  list.push(`file '${frames[frames.length - 1].file}'`)
  const listPath = join(OUT, `part${index}.txt`)
  await writeFile(listPath, list.join('\n') + '\n')
  const lines = scenes.map((s, i) => ({ id: s.id, startMs: s.startMs, endMs: i + 1 < scenes.length ? scenes[i + 1].startMs : durationMs }))
  const ass = await buildAss(durations, lines, join(OUT, `part${index}.ass`))
  const audio = audioChain(durations, lines, 1)
  const out = join(OUT, `part${index}.mp4`)
  const filters = [`[0:v]fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p,subtitles=${ass}:fontsdir=/usr/share/fonts[vout]`, ...audio.filters]
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, ...audio.inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', ...ENC, '-t', (durationMs / 1000).toFixed(3), out], { maxBuffer: 64 * 1024 * 1024 })
  return out
}

async function buildClipPart(durations, scene, index) {
  const src = join(OUT, scene.clip)
  // Speed map -> trimmed segments concatenated; output times for badges and captions.
  const segs = []
  let t = 0
  for (const [a, b, speed] of scene.speed) {
    const d = (b - a) / speed
    segs.push({ a, b, speed, outStart: t, outEnd: t + d })
    t += d
  }
  const total = t
  const vf = []
  const labels = []
  segs.forEach((s, i) => {
    vf.push(`[0:v]trim=start=${s.a}:end=${s.b},setpts=(PTS-STARTPTS)/${s.speed}[s${i}]`)
    labels.push(`[s${i}]`)
  })
  const badges = segs.filter((s) => s.speed > 1).map((s) => `drawtext=fontfile=${FONT}:text='>> ${s.speed}x':fontsize=44:fontcolor=white:box=1:boxcolor=0x0b1020@0.75:boxborderw=14:x=w-tw-40:y=40:enable='between(t,${s.outStart.toFixed(3)},${s.outEnd.toFixed(3)})'`).join(',')
  const label = `drawtext=fontfile=${FONT}:text='Real session in the ChatGPT desktop browser. Speed changes are marked.':fontsize=26:fontcolor=white:box=1:boxcolor=0x0b1020@0.7:boxborderw=12:x=40:y=40`
  vf.push(`${labels.join('')}concat=n=${segs.length}:v=1:a=0,scale=-2:${H}:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:0:color=0x0b1020,fps=30,format=yuv420p,${label}${badges ? ',' + badges : ''}[v1]`)
  // Narration lines placed at their anchors, pushed later if the previous line overruns.
  const lines = []
  let cursor = 0
  for (const l of scene.lines) {
    const startMs = Math.max(l.at * 1000, cursor)
    const endMs = startMs + durations[l.id].seconds * 1000
    lines.push({ id: l.id, startMs, endMs: Math.min(endMs + 400, total * 1000) })
    cursor = endMs + 350
  }
  const ass = await buildAss(durations, lines, join(OUT, `part${index}.ass`))
  vf[vf.length - 1] = vf[vf.length - 1].replace('[v1]', `,subtitles=${ass}:fontsdir=/usr/share/fonts[vout]`)
  const audio = audioChain(durations, lines, 1)
  const out = join(OUT, `part${index}.mp4`)
  await run('ffmpeg', ['-y', '-i', src, ...audio.inputs, '-filter_complex', [...vf, ...audio.filters].join(';'), '-map', '[vout]', '-map', '[aout]', ...ENC, '-t', total.toFixed(3), out], { maxBuffer: 64 * 1024 * 1024 })
  console.log(`clip part ${index}: ${total.toFixed(1)}s, narration ${lines.map((l) => `${l.id}@${(l.startMs / 1000).toFixed(1)}`).join(' ')}`)
  return out
}

async function mux(durations) {
  const timeline = JSON.parse(await readFile(join(OUT, 'timeline.json'), 'utf8'))
  const clipScenes = narration.scenes.filter((s) => s.clip)
  const order = []
  let partIndex = 0
  for (let i = 0; i < timeline.parts.length; i++) {
    order.push(await buildScriptedPart(durations, timeline.parts[i], partIndex++))
    const clip = timeline.clips.find((c) => c.afterPart === i)
    if (clip) order.push(await buildClipPart(durations, clipScenes.find((s) => s.id === clip.id), partIndex++))
  }
  const listPath = join(OUT, 'final.txt')
  await writeFile(listPath, order.map((p) => `file '${p}'`).join('\n') + '\n')
  const out = join(OUT, 'ufo-web-demo.mp4')
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', out], { maxBuffer: 64 * 1024 * 1024 })
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'default=nw=1', out])
  console.log(`assembled ${order.length} parts -> ${out}\n${probe.stdout.trim()}`)
  return out
}

const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--'))
let durations
if (!only || only === '--tts') durations = await tts()
else durations = JSON.parse(await readFile(join(OUT, 'durations.json'), 'utf8'))
if (!only || only === '--record') await record(durations)
if (!only || only === '--mux') await mux(durations)
