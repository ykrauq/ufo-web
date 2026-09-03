import { useEffect, useRef, useState } from 'react'
import { decide, type Proposal } from '../core/workspace'
import { useWorkspace } from './useWorkspace'
import { callTool, registeredTools, getMode } from '../webmcp/register'
import { fmtBytes, fmtTime, SeverityTag } from './common'
import { Icon, actionIcon } from './icons'

export function AgentPanel() {
  const { proposals, toolLog, downloads, events } = useWorkspace()
  const pending = proposals.filter((p) => p.status === 'pending')
  const decided = proposals.filter((p) => p.status !== 'pending').reverse()
  return (
    <div className="agent">
      <Transcript events={events} />
      <section>
        <h3><Icon name="check" /> Proposals {pending.length > 0 ? <span className="count count-hot">{pending.length} pending</span> : <span className="muted">{proposals.length ? 'all decided' : 'none yet'}</span>}</h3>
        {proposals.length === 0 && <p className="muted small">When your agent calls <code>propose_action</code>, it shows up here. Only you can approve.</p>}
        {pending.map((p) => <ProposalCard key={p.id} p={p} download={downloads.find((d) => d.forPath === p.path)} />)}
        {decided.map((p) => <ProposalCard key={p.id} p={p} download={downloads.slice().reverse().find((d) => d.forPath === p.path)} />)}
      </section>
      {downloads.length > 0 && (
        <section>
          <h3><Icon name="download" /> Downloads</h3>
          <ul className="downloads">
            {downloads.slice().reverse().map((d) => (
              <li key={d.id}><a href={d.url} download={d.name}><Icon name="download" size={14} /> {d.name}</a> <span className="muted small">{fmtBytes(d.bytes)} · sha256 {d.sha256.slice(0, 12)}…</span></li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3><Icon name="code" /> Tool calls <span className="count">{toolLog.length}</span></h3>
        {toolLog.length === 0 && <p className="muted small">Calls made through WebMCP appear here as they happen, newest first.</p>}
        <ul className="toollog">
          {toolLog.slice().reverse().slice(0, 40).map((c) => <ToolCall key={c.id} c={c} />)}
        </ul>
      </section>
      <ToolConsole />
    </div>
  )
}

function Transcript({ events }: { events: { at: string; who: 'agent' | 'human' | 'system'; text: string }[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [events.length])
  return (
    <section>
      <h3><Icon name="agent" /> Transcript</h3>
      <div className="transcript" ref={ref}>
        {events.length === 0 && <p className="muted small">What the agent, you, and the page did, in order.</p>}
        {events.slice(-60).map((e, i) => (
          <div key={i} className={`bubble bubble-${e.who}`}>
            <span className={`who who-${e.who}`}>{e.who === 'human' ? 'you' : e.who}</span>
            <span className="bubble-text">{e.text}</span>
            <span className="bubble-time muted">{fmtTime(e.at)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function ProposalCard({ p, download }: { p: Proposal; download?: { url: string; name: string; bytes: number } }) {
  const [busy, setBusy] = useState(false)
  const act = async (d: 'approved' | 'rejected') => {
    setBusy(true)
    try {
      await decide(p.id, d)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`proposal proposal-${p.status}`}>
      <div className="proposal-head">
        <span className="who who-agent">agent</span>
        <Icon name={actionIcon(p.action)} className="proposal-icon" />
        <strong>{p.action.replace('_', ' ')}</strong>
        <SeverityTag severity={p.severity} />
        <span className="mono small muted">{p.id}</span>
      </div>
      <div className="proposal-path mono small">{p.path}</div>
      <div className="proposal-reason">{p.reason}</div>
      {p.status === 'pending' ? (
        <div className="proposal-actions">
          <button className="primary" disabled={busy} onClick={() => act('approved')}><Icon name="check" size={14} /> Approve</button>
          <button disabled={busy} onClick={() => act('rejected')}><Icon name="x" size={14} /> Reject</button>
          <span className="muted small">human-only</span>
        </div>
      ) : (
        <div className={`proposal-result result-${p.status}`}>
          <span className="who who-human">you</span> <b>{p.status}</b> {p.decidedAt && <span className="muted small">{fmtTime(p.decidedAt)}</span>}
          {p.result && <div className="small">{p.result.message}</div>}
          {p.result?.removed && p.result.removed.length > 0 && <div className="small muted">removed: {p.result.removed.join(', ')}</div>}
          {p.status === 'approved' && download && <a className="dl-inline" href={download.url} download={download.name}><Icon name="download" size={14} /> {download.name} ({fmtBytes(download.bytes)})</a>}
        </div>
      )}
    </div>
  )
}

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function ToolCall({ c }: { c: { id: number; tool: string; input: unknown; startedAt: number; finishedAt?: number; ok?: boolean; output?: string; error?: string } }) {
  const [open, setOpen] = useState(false)
  const ms = c.finishedAt ? c.finishedAt - c.startedAt : null
  const inputText = JSON.stringify(c.input)
  return (
    <li className={`toolcall ${c.ok === false ? 'failed' : ''}`}>
      <button className="toolcall-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mono tool-name">{c.tool}</span>
        <span className="mono small muted tool-args">{inputText === '{}' ? '' : inputText.slice(0, 48)}</span>
        <span className="muted small">{ms === null ? 'running' : `${ms} ms`}{c.ok === false ? ' · error' : ''}</span>
      </button>
      {open && (
        <div className="toolcall-body">
          <div className="small muted">input</div>
          <pre>{pretty(inputText)}</pre>
          <div className="small muted">output</div>
          <pre>{c.error ?? pretty(c.output ?? '')}</pre>
        </div>
      )}
    </li>
  )
}

function ToolConsole() {
  const tools = registeredTools()
  const [name, setName] = useState(tools[0]?.name ?? 'workspace_status')
  const [input, setInput] = useState('{}')
  const [output, setOutput] = useState('')
  const [open, setOpen] = useState(false)
  const spec = tools.find((t) => t.name === name) ?? tools[0]
  const run = async () => {
    try {
      const parsed = input.trim() ? (JSON.parse(input) as Record<string, unknown>) : {}
      setOutput(pretty(await callTool(spec.name, parsed)))
    } catch (error) {
      setOutput(`error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return (
    <section>
      <h3><button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '▾' : '▸'} Try a tool by hand</button> <span className="muted small">{tools.length} registered · WebMCP {getMode()}</span></h3>
      {open && (
        <div className="console">
          <select value={spec?.name} onChange={(e) => { const t = tools.find((x) => x.name === e.target.value); setName(e.target.value); setInput(JSON.stringify(t?.example ?? {})) }} aria-label="Tool">
            {tools.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
          {spec && <p className="small muted">{spec.description}</p>}
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} spellCheck={false} aria-label="Tool input JSON" />
          <button className="primary" onClick={run}><Icon name="play" size={14} /> Run {spec?.name}</button>
          {output && <pre className="console-out">{output}</pre>}
        </div>
      )}
    </section>
  )
}
