import { useEffect, useState } from 'react'
import { addFiles, clearWorkspace, exportReport, loadSampleCase, recordToolCall, subscribe, getState } from './core/workspace'
import { getMode, onToolCall, registeredTools, type ModelContextMode } from './webmcp/register'
import { registerBaseTools, syncTools } from './webmcp/tools'
import { fromDataTransfer, pickFiles, pickFolder } from './ui/ingest'
import { useWorkspace } from './ui/useWorkspace'
import { FilesPanel } from './ui/FilesPanel'
import { DetailPanel } from './ui/DetailPanel'
import { AgentPanel } from './ui/AgentPanel'

export function App() {
  const ws = useWorkspace()
  const [mode, setMode] = useState<ModelContextMode>('none')
  const [dragging, setDragging] = useState(false)
  const [toolCount, setToolCount] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void registerBaseTools().then(() => {
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
  return (
    <div className={`app${dragging ? ' dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <div>
            <h1>UFO Web</h1>
            <p>Drop files. Investigate them with your agent. Nothing leaves your browser.</p>
          </div>
        </div>
        <div className="actions">
          <button onClick={() => ingest(pickFiles())}>Open files</button>
          <button onClick={() => ingest(pickFolder())}>Open folder</button>
          <button onClick={() => void loadSampleCase()} disabled={ws.busy}>Load sample case</button>
          {!empty && <button onClick={() => void exportReport('markdown')}>Export report</button>}
          {!empty && <button onClick={clearWorkspace} disabled={ws.busy}>Clear</button>}
        </div>
        <div className={`pill pill-${mode}`} title="How this page is exposing tools to agents">
          WebMCP {mode === 'native' ? 'native' : mode === 'polyfill' ? 'polyfill' : 'not detected'} · {toolCount} tools{ws.busy ? ' · inspecting' : ''}
        </div>
      </header>
      {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
      {empty ? (
        <main className="empty">
          <div className="hero">
            <h2>A file investigation workspace that your agent can use with you.</h2>
            <p>Drop a folder of files. UFO Web reads what is really inside them: true type versus claimed type, hidden text, tracked changes, comments, hidden sheets and slides, GPS and device serials, macros, nested archives, look-alike characters in code, personal data patterns. Your agent gets structured tools to reason across all of it. You get the approve button.</p>
            <div className="hero-actions">
              <button className="primary big" onClick={() => void loadSampleCase()}>Load the sample case</button>
              <button className="big" onClick={() => ingest(pickFolder())}>Open a folder</button>
              <button className="big" onClick={() => ingest(pickFiles())}>Open files</button>
            </div>
            <p className="muted">Everything runs in this tab. No upload, no account, no network calls. Reload and it is gone.</p>
          </div>
          <div className="howto">
            <div>
              <h3>With ChatGPT</h3>
              <p>Open this page in the ChatGPT desktop app's browser and ask: <em>"Load the sample case, run a privacy scan, and propose what to clean before I send these files."</em></p>
            </div>
            <div>
              <h3>With Chrome</h3>
              <p>Chrome 149+ with <code>chrome://flags/#enable-webmcp-testing</code> enabled. DevTools → Application → WebMCP lists the tools; the "Try a tool by hand" panel does the same in-page.</p>
            </div>
            <div>
              <h3>What the agent can call</h3>
              <p className="mono small">workspace_status · load_sample_case · list_files · inspect · extract_text · search · find · privacy_scan · hidden_content_scan · compare · timeline · propose_action · list_proposals · export_report</p>
            </div>
          </div>
        </main>
      ) : (
        <main className="workspace">
          <aside className="col col-files"><FilesPanel /></aside>
          <section className="col col-detail"><DetailPanel /></section>
          <aside className="col col-agent"><AgentPanel /></aside>
        </main>
      )}
      <footer className="foot">
        <span>Open source, MIT. <a href="https://github.com/ykrauq/ufo-web" target="_blank" rel="noreferrer">github.com/ykrauq/ufo-web</a></span>
        <span>The browser edition of <a href="https://universalfileopener.com" target="_blank" rel="noreferrer">Universal File Opener</a>. Same receipt fields as <code>ufo inspect --json</code>.</span>
        <span>{getState().caseName ? `Case: ${getState().caseName}` : ''}</span>
      </footer>
      {dragging && <div className="drop-overlay">Drop files or folders</div>}
    </div>
  )
}
