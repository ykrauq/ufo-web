import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
const ROOT = new URL('..', import.meta.url).pathname
const CHROME = process.env.CHROME_BIN ?? join(homedir(), '.cache', 'ms-playwright', 'chromium-1228', 'chrome-linux64', 'chrome')
const logo = await readFile(join(ROOT, '..', 'public', 'logo.svg'), 'utf8')
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1280px;height:720px;background:#0b1020;color:#e5e7eb;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
.wrap{position:relative;width:1280px;height:720px;display:flex;flex-direction:column;justify-content:center;padding:0 80px;box-sizing:border-box}
.brand{display:flex;align-items:center;gap:18px;margin-bottom:26px}.brand svg{width:84px;height:84px;border-radius:20px}.brand span{font-size:44px;font-weight:700;letter-spacing:-.02em}
h1{font-size:74px;line-height:1.05;margin:0 0 18px;letter-spacing:-.025em;max-width:1050px}
h1 b{color:#38bdf8}
p{font-size:34px;color:#94a3b8;margin:0 0 30px}
.pill{display:inline-flex;align-items:center;gap:12px;font-size:26px;background:#111a2e;border:2px solid #22c55e;color:#4ade80;border-radius:999px;padding:10px 22px;width:max-content}
.pill i{width:14px;height:14px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 6px rgba(34,197,94,.25)}
.glow{position:absolute;right:-140px;top:-140px;width:620px;height:620px;border-radius:50%;background:radial-gradient(circle,rgba(56,189,248,.28),transparent 60%)}
.bar{position:absolute;left:0;right:0;top:0;height:10px;background:linear-gradient(90deg,#38bdf8,#6d28d9 60%,#0369a1)}
</style></head><body><div class="wrap"><div class="bar"></div><div class="glow"></div>
<div class="brand">${logo}<span>UFO Web</span></div>
<h1>Your AI agent investigates the files.<br><b>You keep the execute button.</b></h1>
<p>Hidden text, tracked changes, GPS, macros, nested archives. Nothing leaves your browser.</p>
<div class="pill"><i></i>WebMCP native · works in ChatGPT's browser</div>
</div></body></html>`
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
await page.setContent(html)
await page.waitForTimeout(300)
await page.screenshot({ path: join(ROOT, 'out', 'thumbnail.png'), type: 'png' })
await browser.close()
console.log('thumbnail written')
