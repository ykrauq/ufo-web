import { select, type WorkspaceFile } from '../core/workspace'
import { useWorkspace } from './useWorkspace'
import { fmtBytes, FlagChip, SeverityDot } from './common'

function topSeverity(f: WorkspaceFile) {
  const r = f.receipt
  if (!r || !r.findings.length) return null
  return r.findings[0].severity
}

export function FilesPanel() {
  const { files, selectedPath } = useWorkspace()
  const groups = new Map<string, WorkspaceFile[]>()
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.'
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir)!.push(f)
  }
  return (
    <div className="files">
      {[...groups.entries()].map(([dir, list]) => (
        <div key={dir} className="group">
          <div className="group-title">{dir === '.' ? '(root)' : dir}</div>
          {list.map((f) => {
            const sev = topSeverity(f)
            const r = f.receipt
            return (
              <button key={f.path} className={`file-row${selectedPath === f.path ? ' selected' : ''}${f.quarantined ? ' quarantined' : ''}`} onClick={() => select(f.path)} title={f.path}>
                <span className="file-main">
                  {sev ? <SeverityDot severity={sev} /> : <span className="sev sev-none" />}
                  <span className="file-name">{f.name}</span>
                  <span className="file-kind">{r ? r.kind : f.status === 'error' ? 'error' : '...'}</span>
                  <span className="file-size">{fmtBytes(f.bytes.length)}</span>
                </span>
                {r && r.flags.length > 0 && (
                  <span className="file-flags">
                    {r.flags.slice(0, 4).map((fl) => <FlagChip key={fl} flag={fl} />)}
                    {r.flags.length > 4 && <span className="more">+{r.flags.length - 4}</span>}
                  </span>
                )}
                {f.quarantined && <span className="file-flags"><span className="badge badge-bad">quarantined</span></span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
