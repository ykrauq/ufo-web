import { useEffect, useRef } from 'react'
import { select, setFilter, type WorkspaceFile } from '../core/workspace'
import { useWorkspace } from './useWorkspace'
import { fmtBytes, FlagChip, SeverityDot } from './common'
import { Icon, familyIcon } from './icons'

const FILTER_FLAGS = ['has_gps', 'has_author', 'has_hidden_text', 'has_tracked_changes', 'has_comments', 'has_hidden_sheets', 'has_hidden_slides', 'has_macros', 'has_executable', 'has_nested_archive', 'type_mismatch', 'has_pii', 'has_secrets', 'has_hidden_chars', 'has_injection_text', 'header_mismatch', 'encrypted']

function topSeverity(f: WorkspaceFile) {
  const r = f.receipt
  if (!r || !r.findings.length) return null
  return r.findings[0].severity
}

function matches(f: WorkspaceFile, query: string, flag: string): boolean {
  if (query && !f.path.toLowerCase().includes(query.toLowerCase())) return false
  if (flag && !(f.receipt?.flags ?? []).includes(flag as never)) return false
  return true
}

type ToolSubmitEvent = Event & { agentInvoked?: boolean; respondWith?: (p: Promise<unknown>) => void }

/**
 * The filter is also a WebMCP declarative tool: the form carries toolname /
 * tooldescription / toolparamdescription / toolautosubmit attributes, so a
 * browser that implements the declarative API exposes it as `filter_file_list`.
 * The agent and the person then look at the same filtered list.
 */
export function FilesPanel() {
  const { files, selectedPath, filter } = useWorkspace()
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    form.setAttribute('toolname', 'filter_file_list')
    form.setAttribute('tooldescription', 'Filter the file list in the UFO Web sidebar by a path substring and/or a flag. The person sees the same filtered list. Returns the matching paths.')
    form.setAttribute('toolautosubmit', '')
    form.querySelector('input[name=query]')?.setAttribute('toolparamdescription', 'Path or name substring, e.g. contracts or .pdf; empty for all')
    form.querySelector('select[name=flag]')?.setAttribute('toolparamdescription', 'Only files carrying this flag, e.g. has_gps; empty for all')
  }, [])

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const query = String(data.get('query') ?? '')
    const flag = String(data.get('flag') ?? '')
    setFilter({ query, flag })
    const native = e.nativeEvent as ToolSubmitEvent
    if (typeof native.respondWith === 'function') {
      const shown = files.filter((f) => matches(f, query, flag)).map((f) => f.path)
      native.respondWith(Promise.resolve({ content: [{ type: 'text', text: JSON.stringify({ shown: shown.length, files: shown.slice(0, 60) }) }] }))
    }
  }

  const visible = files.filter((f) => matches(f, filter.query, filter.flag))
  const groups = new Map<string, WorkspaceFile[]>()
  for (const f of visible) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.'
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir)!.push(f)
  }
  return (
    <div className="files">
      <form ref={formRef} className="filter" onSubmit={onSubmit}>
        <label className="filter-input"><Icon name="search" size={14} /><input name="query" type="search" placeholder="Filter files" defaultValue={filter.query} aria-label="Filter files by path" /></label>
        <select name="flag" defaultValue={filter.flag} aria-label="Filter by flag">
          <option value="">any flag</option>
          {FILTER_FLAGS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button type="submit" className="filter-go" aria-label="Apply filter"><Icon name="check" size={14} /></button>
      </form>
      <div className="files-count muted small">{visible.length} of {files.length} files{filter.query || filter.flag ? ' (filtered)' : ''}</div>
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
                  <Icon name={r ? familyIcon(r.family, r.kind) : 'file'} className="file-icon" />
                  <span className="file-name">{f.name}</span>
                  <span className="file-kind">{r ? r.kind : f.status === 'error' ? 'error' : f.status === 'inspecting' ? '…' : 'queued'}</span>
                  <span className="file-size">{fmtBytes(f.bytes.length)}</span>
                </span>
                {r && r.flags.length > 0 && (
                  <span className="file-flags">
                    {r.flags.slice(0, 4).map((fl) => <FlagChip key={fl} flag={fl} />)}
                    {r.flags.length > 4 && <span className="more">+{r.flags.length - 4}</span>}
                  </span>
                )}
                {(f.quarantined || f.flagged) && <span className="file-flags">{f.quarantined && <span className="badge badge-bad">quarantined</span>}{f.flagged && <span className="badge badge-warn">flagged</span>}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
