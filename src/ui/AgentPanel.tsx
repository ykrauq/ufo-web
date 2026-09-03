import { useState } from 'react'
import { decide, type Proposal } from '../core/workspace'
import { useWorkspace } from './useWorkspace'
import { callTool, registeredTools, getMode } from '../webmcp/register'
import { fmtBytes, fmtTime, SeverityTag } from './common'

export function AgentPanel() {
  const { proposals, toolLog, downloads, events } = useWorkspace()
  const pending = proposals.filter((p) => p.status === 'pending')
  const decided = proposals.filter((p) => p.status !== 'pending').reverse()
  return (
    <div className="agent">
      <section>
        <h3>Proposals <span className="muted">{pending.length} pending</span></h3>
        {proposals.length === 0 && <p className="muted small">When your agent calls <code>propose_action</code>, it shows up here. Only you can approve.</p>}
        {pending.map((p) => <ProposalCard key={p.id} p={p} />)}
        {decided.map((p) => <ProposalCard key={p.id} p={p} />)}
      </section>
      {downloads.length > 0 && (
        <section>
          <h3>Downloads</h3>
          <ul className="downloads">
            {downloads.slice().reverse().map((d) => (
              <li key={d.id}><a href={d.url} download={d.name}>{d.name}</a> <span className="muted small">{fmtBytes(d.bytes)} · sha256 {d.sha256.slice(0, 12)}...</span></li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Agent activity <span className="muted">{toolLog.length} calls</span></h3>
        {toolLog.length === 0 && <p className="muted small">Tool calls made through WebMCP appear here as they happen.</p>}
        <ul className="toollog">
          {toolLog.slice().reverse().slice(0, 40).map((c) => <ToolCall key={c.id} c={c} />)}
        </ul>
      </section>
      <ToolConsole />
      <section>
        <h3>Log</h3>
        <ul className="events small">{events.slice().reverse().slice(0, 12).map((e, i) => <li key={i}><span className={`who who-${e.who}`}>{e.who}</span> {e.text}</li>)}</ul>
      </section>
    </div>
  )
}

function ProposalCard({ p }: { p: Proposal }) {
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
        <SeverityTag severity={p.severity} />
        <strong>{p.action.replace('_', ' ')}</strong>
        <span className="mono small muted">{p.id}</span>
      </div>
      <div className="proposal-path mono small">{p.path}</div>
      <div className="proposal-reason">{p.reason}</div>
      {p.status === 'pending' ? (
        <div className="proposal-actions">
          <button className="primary" disabled={busy} onClick={() => act('approved')}>Approve</button>
          <button disabled={busy} onClick={() => act('rejected')}>Reject</button>
        </div>
      ) : (
        <div className="proposal-result">
          <span className={`who who-human`}>you</span> <b>{p.status}</b> {p.decidedAt && <span className="muted small">{fmtTime(p.decidedAt)}</span>}
          {p.result && <div className="small">{p.result.message}</div>}
          {p.result?.removed && p.result.removed.length > 0 && <div className="small muted">removed: {p.result.removed.join(', ')}</div>}
        </div>
      )}
    </div>
  )
}

function ToolCall({ c }: { c: { id: number; tool: string; input: unknown; startedAt: number; finishedAt?: number; ok?: boolean; output?: string; error?: string } }) {
  const [open, setOpen] = useState(false)
  const ms = c.finishedAt ? c.finishedAt - c.startedAt : null
  return (
    <li className={`toolcall ${c.ok === false ? 'failed' : ''}`}>
      <button className="toolcall-head" onClick={() => setOpen(!open)}>
        <span className="mono">{c.tool}</span>
        <span className="muted small">{ms === null ? 'running' : `${ms} ms`}{c.ok === false ? ' · error' : ''}</span>
      </button>
      {open && (
        <div className="toolcall-body">
          <div className="small muted">input</div>
          <pre>{JSON.stringify(c.input)}</pre>
          <div className="small muted">output</div>
          <pre>{c.error ?? c.output ?? ''}</pre>
        </div>
      )}
    </li>
  )
}

function ToolConsole() {
  const { files } = useWorkspace()
  const tools = registeredTools()
  const [name, setName] = useState(tools[0]?.name ?? 'workspace_status')
  const [input, setInput] = useState('{}')
  const [output, setOutput] = useState('')
  const [open, setOpen] = useState(false)
  const spec = tools.find((t) => t.name === name) ?? tools[0]
  void files
  const run = async () => {
    try {
      const parsed = input.trim() ? (JSON.parse(input) as Record<string, unknown>) : {}
      setOutput(await callTool(spec.name, parsed))
    } catch (error) {
      setOutput(`error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return (
    <section>
      <h3><button className="link" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Try a tool by hand</button> <span className="muted small">{tools.length} registered · WebMCP {getMode()}</span></h3>
      {open && (
        <div className="console">
          <select value={spec?.name} onChange={(e) => { const t = tools.find((x) => x.name === e.target.value); setName(e.target.value); setInput(JSON.stringify(t?.example ?? {}, null, 0)) }}>
            {tools.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
          {spec && <p className="small muted">{spec.description}</p>}
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} spellCheck={false} />
          <button className="primary" onClick={run}>Run {spec?.name}</button>
          {output && <pre className="console-out">{output}</pre>}
        </div>
      )}
    </section>
  )
}
