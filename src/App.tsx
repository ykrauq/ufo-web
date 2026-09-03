import { useEffect, useState } from 'react'
import { addFiles, clearWorkspace, exportReport, loadSampleCase, recordToolCall, subscribe } from './core/workspace'
import { getMode, onToolCall, registeredTools, type ModelContextMode } from './webmcp/register'
import { registerAllTools, syncTools } from './webmcp/tools'
import { fromDataTransfer, pickFiles, pickFolder } from './ui/ingest'
import { useWorkspace } from './ui/useWorkspace'
import { FilesPanel } from './ui/FilesPanel'
import { DetailPanel } from './ui/DetailPanel'
import { AgentPanel } from './ui/AgentPanel'
import { About } from './ui/About'
import { Icon } from './ui/icons'
import { runScriptedDemo } from './ui/demo'
import { applyTheme, effectiveTheme, getTheme, nextTheme, type Theme } from './ui/theme'

export function App() {
  const ws = useWorkspace()
  const [mode, setMode] = useState<ModelContextMode>('none')
  const [dragging, setDragging] = useState(false)
  const [toolCount, setToolCount] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [about, setAbout] = useState(() => location.hash === '#about')
  const [theme, setTheme] = useState<Theme>(() => getTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const onHash = () => setAbout(location.hash === '#about')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    let cancelled = false
    void registerAllTools().then(() => {
      if (cancelled) return
      setMode(getMode())
      setToolCount(registeredTools().length)
    })
    const offCalls = onToolCall(recordToolCall)
    const offState = subscribe(() => {
      void syncTools().then(() => setToolCount(registeredTools().length))
    })
    return () => {
      cancelled = true
      offCalls()
      offState()
    }
  }, [])

  const ingest = async (promise: Promise<Awaited<ReturnType<typeof pickFiles>>>) => {
    const inputs = await promise
    if (!inputs.length) return
    const r = await addFiles(inputs)
    if (r.skipped.length) setNotice(`${r.added} added, ${r.skipped.length} skipped: ${r.skipped.slice(0, 3).join('; ')}`)
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    await ingest(fromDataTransfer(e.dataTransfer))
  }

  const openAbout = () => {
    location.hash = 'about'
    setAbout(true)
  }
  const closeAbout = () => {
    history.replaceState(null, '', location.pathname)
    setAbout(false)
  }

  const empty = ws.files.length === 0
  const inspected = ws.files.filter((f) => f.status === 'done' || f.status === 'error').length
  const modeLabel = mode === 'native' ? 'WebMCP native' : mode === 'polyfill' ? 'WebMCP polyfill' : 'WebMCP not detected'
  const dark = effectiveTheme(theme) === 'dark'

  return (
    <div className={`app${dragging ? ' dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }} onDrop={onDrop}>
      <header className="topbar">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); closeAbout() }}>
          <img src="/logo.svg" alt="Universal File Opener" width={34} height={34} />
          <div>
            <h1>UFO Web</h1>
            <p>Drop files. Investigate them with your agent. Nothing leaves your browser.</p>
          </div>
        </a>
        <div className="actions">
          <button onClick={() => ingest(pickFiles())} title="Choose files"><Icon name="upload" /> Files</button>
          <button onClick={() => ingest(pickFolder())} title="Choose a folder"><Icon name="folder" /> Folder</button>
          <button onClick={() => void loadSampleCase()} disabled={ws.busy || ws.sampleLoaded} title="Load the synthetic 14-file case"><Icon name="sparkle" /> Sample case</button>
          <button className="accent" onClick={() => void runScriptedDemo()} disabled={ws.demoRunning || ws.busy} title="Replay a fixed sequence of agent tool calls through WebMCP; you still decide"><Icon name="play" /> {ws.demoRunning ? 'Demo running' : 'Scripted demo'}</button>
          {!empty && <button onClick={() => void exportReport('markdown')} title="Download the Markdown report"><Icon name="download" /> Report</button>}
          {!empty && <button onClick={clearWorkspace} disabled={ws.busy} title="Forget everything"><Icon name="x" /> Clear</button>}
          <button className="icon-btn" onClick={() => setTheme(nextTheme(theme))} title={dark ? 'Switch to light' : 'Switch to dark'} aria-label="Toggle theme"><Icon name={dark ? 'sun' : 'moon'} /></button>
          <button className="icon-btn" onClick={about ? closeAbout : openAbout} title="About UFO Web" aria-label="About"><Icon name="info" /></button>
        </div>
        <div className={`pill pill-${mode}`} title="How this page is exposing tools to agents">
          <span className="dot" />{modeLabel} · {toolCount} tools
        </div>
      </header>
      {ws.busy && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={ws.files.length} aria-valuenow={inspected}>
          <div className="progress-bar" style={{ width: `${ws.files.length ? Math.max(4, (inspected / ws.files.length) * 100) : 4}%` }} />
          <span className="progress-text">Inspecting {inspected} of {ws.files.length}</span>
        </div>
      )}
      {notice && <div className="notice" onClick={() => setNotice(null)} role="status">{notice}</div>}
      {about ? (
        <About onClose={closeAbout} />
      ) : empty ? (
        <main className="empty">
          <section className="hero">
            <img src="/logo.svg" alt="" width={72} height={72} className="hero-logo" />
            <h2>Investigate files with your agent.<br />Nothing leaves your browser.</h2>
            <p>
              Drop a folder. See what is really inside every file: true type, hidden text, tracked changes, GPS, macros,
              nested archives. Your agent gets seventeen tools to reason across all of it. You press execute.
            </p>
            <div className="hero-actions">
              <button className="primary big" onClick={() => void loadSampleCase()}><Icon name="sparkle" size={18} /> Load the sample case</button>
              <button className="big" onClick={() => ingest(pickFolder())}><Icon name="folder" size={18} /> Open a folder</button>
              <button className="big" onClick={() => ingest(pickFiles())}><Icon name="upload" size={18} /> Open files</button>
            </div>
            <p className="muted small">No upload, no account, no third-party requests. Reload and it is gone. <button className="link" onClick={openAbout}>How it works</button></p>
          </section>
          <section className="steps">
            <div className="step"><span className="step-n">1</span><Icon name="folder" size={22} /><h3>Drop</h3><p>Every file gets a receipt: SHA-256, true type, flags, findings, and a preview.</p></div>
            <div className="step"><span className="step-n">2</span><Icon name="agent" size={22} /><h3>Investigate</h3><p>Your agent scans, reads hidden text, cross-references people and copies, and suggests.</p></div>
            <div className="step"><span className="step-n">3</span><Icon name="check" size={22} /><h3>Execute</h3><p>You run or dismiss each suggestion. Cleaned copies are re-inspected. The report records it all.</p></div>
          </section>
        </main>
      ) : (
        <main className="workspace">
          <aside className="col col-files"><FilesPanel /></aside>
          <section className="col col-detail"><DetailPanel /></section>
          <aside className="col col-agent"><AgentPanel /></aside>
        </main>
      )}
      <footer className="foot">
        <span>Open source, MIT · <a href="https://github.com/ykrauq/ufo-web" target="_blank" rel="noreferrer">github.com/ykrauq/ufo-web</a></span>
        <span>The browser edition of <a href="https://universalfileopener.com" target="_blank" rel="noreferrer">Universal File Opener</a>. Same receipt fields as <code>ufo inspect --json</code>.</span>
        <span><button className="link" onClick={openAbout}>About</button></span>
        {ws.caseName && <span>Case: {ws.caseName}</span>}
      </footer>
      {dragging && <div className="drop-overlay"><Icon name="upload" size={40} /> Drop files or folders</div>}
    </div>
  )
}
