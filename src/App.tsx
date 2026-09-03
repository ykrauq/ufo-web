import { useEffect, useState } from 'react'
import { addFiles, clearWorkspace, exportReport, loadSampleCase, recordToolCall, subscribe } from './core/workspace'
import { getMode, onToolCall, registeredTools, type ModelContextMode } from './webmcp/register'
import { registerAllTools, syncTools } from './webmcp/tools'
import { fromDataTransfer, pickFiles, pickFolder } from './ui/ingest'
import { useWorkspace } from './ui/useWorkspace'
import { FilesPanel } from './ui/FilesPanel'
import { DetailPanel } from './ui/DetailPanel'
import { AgentPanel } from './ui/AgentPanel'
import { Icon } from './ui/icons'
import { runScriptedDemo } from './ui/demo'

export function App() {
  const ws = useWorkspace()
  const [mode, setMode] = useState<ModelContextMode>('none')
  const [dragging, setDragging] = useState(false)
  const [toolCount, setToolCount] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

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

  const empty = ws.files.length === 0
  const inspected = ws.files.filter((f) => f.status === 'done' || f.status === 'error').length
  const modeLabel = mode === 'native' ? 'WebMCP native' : mode === 'polyfill' ? 'WebMCP polyfill' : 'WebMCP not detected'

  return (
    <div className={`app${dragging ? ' dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          <div>
            <h1>UFO Web</h1>
            <p>Drop files. Investigate them with your agent. Nothing leaves your browser.</p>
          </div>
        </div>
        <div className="actions">
          <button onClick={() => ingest(pickFiles())} title="Choose files"><Icon name="upload" /> Files</button>
          <button onClick={() => ingest(pickFolder())} title="Choose a folder"><Icon name="folder" /> Folder</button>
          <button onClick={() => void loadSampleCase()} disabled={ws.busy || ws.sampleLoaded} title="Load the synthetic 14-file case"><Icon name="sparkle" /> Sample case</button>
          <button className="accent" onClick={() => void runScriptedDemo()} disabled={ws.demoRunning || ws.busy} title="Replay a fixed sequence of agent tool calls through WebMCP; you still approve"><Icon name="play" /> {ws.demoRunning ? 'Demo running' : 'Scripted demo'}</button>
          {!empty && <button onClick={() => void exportReport('markdown')} title="Download the Markdown report"><Icon name="download" /> Report</button>}
          {!empty && <button onClick={clearWorkspace} disabled={ws.busy} title="Forget everything"><Icon name="x" /> Clear</button>}
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
      {empty ? (
        <main className="empty">
          <section className="hero">
            <h2>A file investigation workspace your agent can use with you.</h2>
            <p>
              Drop a folder. UFO Web reads what is really inside every file, in the tab: true type versus claimed type, hidden and white text,
              tracked changes and comments, hidden sheets and slides, GPS and camera serials, macros, nested archives, look-alike characters in
              code, personal-data patterns. Your agent gets seventeen structured tools to reason across all of it. You keep the approve button.
            </p>
            <div className="hero-actions">
              <button className="primary big" onClick={() => void loadSampleCase()}><Icon name="sparkle" size={18} /> Load the sample case</button>
              <button className="big" onClick={() => ingest(pickFolder())}><Icon name="folder" size={18} /> Open a folder</button>
              <button className="big" onClick={() => ingest(pickFiles())}><Icon name="upload" size={18} /> Open files</button>
            </div>
            <p className="muted small">No upload, no account, no network calls. Reload and it is gone.</p>
          </section>
          <section className="steps">
            <div className="step"><span className="step-n">1</span><Icon name="folder" size={22} /><h3>You drop the files</h3><p>Or a whole folder. Every file is parsed locally and gets a receipt with a SHA-256, its true type, flags and findings.</p></div>
            <div className="step"><span className="step-n">2</span><Icon name="agent" size={22} /><h3>Your agent investigates</h3><p>Privacy and hidden-content scans, entities across files, duplicates, timelines, version diffs, hex peeks. Every call shows up in the panel as it happens.</p></div>
            <div className="step"><span className="step-n">3</span><Icon name="check" size={22} /><h3>You decide</h3><p>The agent proposes; there is no approve tool. You approve in the page, cleaned copies are re-inspected, and the report records who did what.</p></div>
          </section>
          <section className="howto">
            <div>
              <h3><Icon name="agent" /> With ChatGPT</h3>
              <p>Open this page in the ChatGPT desktop app's browser and ask: <em>"Load the sample case, run a privacy scan, and propose what to clean before I send these files."</em></p>
            </div>
            <div>
              <h3><Icon name="code" /> With Chrome 149+</h3>
              <p>Enable <code>chrome://flags/#enable-webmcp-testing</code>. DevTools → Application → WebMCP lists the tools. Or press <b>Scripted demo</b> above to watch a fixed sequence run through the browser's own API.</p>
            </div>
            <div>
              <h3><Icon name="search" /> What the agent can call</h3>
              <p className="mono small">workspace_status · load_sample_case · list_files · inspect · extract_text · search · find · privacy_scan · hidden_content_scan · entities · duplicates · compare · timeline · peek_bytes · propose_action · list_proposals · export_report</p>
            </div>
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
        {ws.caseName && <span>Case: {ws.caseName}</span>}
      </footer>
      {dragging && <div className="drop-overlay"><Icon name="upload" size={40} /> Drop files or folders</div>}
    </div>
  )
}
