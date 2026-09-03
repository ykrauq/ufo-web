import { useState } from 'react'
import type { Receipt } from '../core/types'
import { allReceipts, entities, duplicates, fileAt, receiptAt, select } from '../core/workspace'
import { useWorkspace } from './useWorkspace'
import { fmtBytes, FlagChip, SeverityTag } from './common'
import { Icon, familyIcon, categoryIcon } from './icons'

type Tab = 'overview' | 'metadata' | 'text' | 'container' | 'json'

export function DetailPanel() {
  const { selectedPath, files } = useWorkspace()
  const [tab, setTab] = useState<Tab>('overview')
  const [unit, setUnit] = useState<string | null>(null)
  const file = selectedPath ? fileAt(selectedPath) : undefined
  const receipt = selectedPath ? receiptAt(selectedPath) : undefined
  if (!files.length) return null
  if (!selectedPath || (!file && !receipt)) return <Overview />
  if (file && !receipt) {
    return (
      <div className="detail">
        <div className="detail-head"><h2>{file.name}</h2></div>
        <p className="muted">{file.status === 'error' ? `Inspection failed: ${file.error}` : 'Inspecting…'}</p>
      </div>
    )
  }
  const r = receipt!
  const units = r.text?.units ?? []
  const activeUnit = units.find((u) => u.label === unit) ?? units[0]
  const parent = r.depth > 0 ? r.path.split('!/')[0] : null
  return (
    <div className="detail">
      <div className="detail-head">
        {parent && <button className="link small" onClick={() => select(parent)}>← inside {parent}</button>}
        <h2><Icon name={familyIcon(r.family, r.kind)} size={20} className="head-icon" /> {r.name}</h2>
        <div className="detail-sub">
          <span>{r.label}</span>
          <span>{fmtBytes(r.sizeBytes)}</span>
          {r.formatPage && <a href={r.formatPage} target="_blank" rel="noreferrer">What is inside a .{r.extension || r.kind} file?</a>}
        </div>
        <div className="detail-flags">{r.flags.map((f) => <FlagChip key={f} flag={f} />)}</div>
      </div>
      <div className="tabs" role="tablist">
        {(['overview', 'metadata', 'text', 'container', 'json'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} disabled={(t === 'text' && !units.length) || (t === 'container' && !r.container)}>
            {t === 'overview' ? `Findings (${r.findings.length})` : t === 'text' ? `Text (${units.length})` : t === 'container' ? `Inside (${r.container?.entryCount ?? 0})` : t === 'json' ? 'Receipt JSON' : 'Metadata'}
          </button>
        ))}
      </div>
      {tab === 'overview' && (
        <div className="tab-body">
          <table className="kv">
            <tbody>
              <tr><th>Name says</th><td>{r.nameSaysKind ?? 'nothing (no extension)'}</td></tr>
              <tr><th>Bytes say</th><td>{r.bytesSayKind ?? 'unrecognized'} <span className="muted">({r.detection.method}, {r.detection.strength}{r.detection.note ? `, ${r.detection.note}` : ''})</span></td></tr>
              {r.nameAndBytesDisagree && <tr><th>Verdict</th><td className="bad">Name and bytes disagree</td></tr>}
              <tr><th>SHA-256</th><td className="mono small">{r.sha256}</td></tr>
            </tbody>
          </table>
          {r.findings.length === 0 && <p className="muted">No findings. Identity and structure look ordinary.</p>}
          <ul className="findings">
            {r.findings.map((f) => (
              <li key={f.id} className={`finding finding-${f.severity}`}>
                <div className="finding-head"><Icon name={categoryIcon(f.category)} className="finding-icon" /><SeverityTag severity={f.severity} /><strong>{f.title}</strong>{f.where && <span className="muted">{f.where}</span>}<span className="muted mono fid">{f.id}</span></div>
                <div className="finding-detail">{f.detail}</div>
                {f.evidence && <pre className="evidence">{f.evidence}</pre>}
              </li>
            ))}
          </ul>
          {r.notAvailableInWeb.length > 0 && (
            <details className="niw">
              <summary>Not in the browser edition ({r.notAvailableInWeb.length})</summary>
              <ul>{r.notAvailableInWeb.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </details>
          )}
          {r.errors.length > 0 && <details><summary className="muted">Notes ({r.errors.length})</summary><ul className="muted small">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
        </div>
      )}
      {tab === 'metadata' && (
        <div className="tab-body">
          {Object.keys(r.metadata).length === 0 && <p className="muted">No metadata fields extracted.</p>}
          <table className="kv">
            <tbody>{Object.entries(r.metadata).map(([k, v]) => <tr key={k}><th>{k}</th><td className="wrap">{String(v)}</td></tr>)}</tbody>
          </table>
          {r.dates.length > 0 && (
            <>
              <h3>Dates found inside</h3>
              <ul className="small dates">{r.dates.map((d, i) => <li key={i}><span className="mono">{d.when.replace('T', ' ').slice(0, 19)}</span> {d.what} <span className="muted">({d.source})</span></li>)}</ul>
            </>
          )}
        </div>
      )}
      {tab === 'text' && activeUnit && (
        <div className="tab-body">
          <div className="unit-picker">
            {units.map((u) => <button key={u.label} className={u.label === activeUnit.label ? 'active' : ''} onClick={() => setUnit(u.label)}>{u.label} <span className="muted">{u.text.length}</span></button>)}
          </div>
          <pre className="text-view">{activeUnit.text.slice(0, 20000) || '(empty)'}{activeUnit.text.length > 20000 ? '\n…[truncated in view]' : ''}</pre>
        </div>
      )}
      {tab === 'container' && r.container && (
        <div className="tab-body">
          <p className="muted">{r.container.format}: {r.container.entryCount} entries{r.container.entriesTruncated ? ' (list truncated)' : ''}. {r.container.nested.length} inspected inside{r.container.nestedTruncated ? ', budget reached' : ''}.</p>
          <table className="entries">
            <thead><tr><th>Entry</th><th>Kind</th><th>Size</th><th>Modified</th></tr></thead>
            <tbody>
              {r.container.entries.slice(0, 300).map((e) => {
                const nested = r.container!.nested.find((n) => n.path === `${r.path}!/${e.path}`)
                return (
                  <tr key={e.path}>
                    <td className="mono small">{nested ? <button className="link" onClick={() => select(nested.path)}>{e.path}</button> : e.path}</td>
                    <td>{e.isDir ? 'dir' : e.kind ?? ''}{nested && nested.findings.length ? <span className="badge badge-warn">{nested.findings.length} findings</span> : null}</td>
                    <td>{e.isDir ? '' : fmtBytes(e.sizeBytes)}</td>
                    <td className="small muted">{e.modified?.slice(0, 19).replace('T', ' ') ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'json' && <div className="tab-body"><pre className="text-view">{JSON.stringify(stripText(r), null, 2)}</pre></div>}
    </div>
  )
}

function stripText(r: Receipt): Receipt {
  return { ...r, text: r.text ? { ...r.text, units: r.text.units.map((u) => ({ label: u.label, text: u.text.length > 400 ? u.text.slice(0, 400) + '…' : u.text })) } : undefined, container: r.container ? { ...r.container, nested: r.container.nested.map(stripText) } : undefined }
}

const RANK = { high: 3, medium: 2, low: 1, info: 0 } as const

function Overview() {
  const receipts = allReceipts()
  const findings = receipts.flatMap((r) => r.findings)
  const counts = { high: 0, medium: 0, low: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  const flags = new Map<string, number>()
  for (const r of receipts) for (const f of r.flags) flags.set(f, (flags.get(f) ?? 0) + 1)
  const top = [...findings].sort((a, b) => RANK[b.severity] - RANK[a.severity]).slice(0, 10)
  const ent = entities()
  const dup = duplicates()
  return (
    <div className="detail">
      <div className="detail-head"><h2>Workspace</h2>
        <div className="detail-sub"><span>{receipts.filter((r) => r.depth === 0).length} files</span><span>{receipts.filter((r) => r.depth > 0).length} inside archives</span><span>{findings.length} findings</span></div>
      </div>
      <div className="tab-body">
        <div className="stat-row">
          <div className="stat stat-high"><b>{counts.high}</b><span>high</span></div>
          <div className="stat stat-medium"><b>{counts.medium}</b><span>medium</span></div>
          <div className="stat stat-low"><b>{counts.low}</b><span>low</span></div>
          <div className="stat stat-info"><b>{counts.info}</b><span>info</span></div>
        </div>
        <div className="detail-flags">{[...flags.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => <span key={f} className="flag-count"><FlagChip flag={f} /> {n}</span>)}</div>
        <div className="overview-grid">
          <div>
            <h3>Top findings</h3>
            <ul className="findings compact">
              {top.map((f) => (
                <li key={f.id} className={`finding finding-${f.severity}`}>
                  <div className="finding-head"><Icon name={categoryIcon(f.category)} className="finding-icon" /><SeverityTag severity={f.severity} /><strong>{f.title}</strong></div>
                  <div className="finding-detail"><button className="link" onClick={() => select(f.path.split('!/')[0])}>{f.path}</button></div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Who appears where</h3>
            {ent.people.length === 0 && <p className="muted small">No names found in metadata.</p>}
            <ul className="entity-list">
              {ent.people.slice(0, 8).map((p) => <li key={p.name}><Icon name="user" size={14} /> <b>{p.name}</b> <span className="muted small">{p.files.length} file{p.files.length === 1 ? '' : 's'} · {p.roles.slice(0, 3).join(', ')}</span></li>)}
            </ul>
            {ent.domains.length > 0 && <p className="small muted">Domains: {ent.domains.slice(0, 5).map((d) => d.name).join(', ')}</p>}
            {ent.organizations.length > 0 && <p className="small muted">Organizations: {ent.organizations.slice(0, 4).map((d) => d.name).join(', ')}</p>}
            {dup.identical.length > 0 && (
              <>
                <h3>Byte-identical copies</h3>
                <ul className="small">{dup.identical.slice(0, 5).map((g) => <li key={g.sha256}>{g.paths.map((p, i) => <span key={p}>{i > 0 && ' = '}<button className="link" onClick={() => select(p.split('!/')[0])}>{p}</button></span>)}</li>)}</ul>
              </>
            )}
          </div>
        </div>
        <p className="muted small">Select a file on the left, or ask your agent: "run a privacy scan and propose what to clean".</p>
      </div>
    </div>
  )
}
