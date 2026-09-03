// A scripted investigation: a fixed sequence of tool calls, sent through the
// browser's own WebMCP API when one is present (navigator/document.modelContext
// getTools + executeTool), otherwise through the page's registry. There is no
// language model behind it. It exists so someone without an agent-capable
// browser can still watch the loop run, and it stops at the approvals, which
// stay with the person.

import { getState, subscribe, say, setDemoRunning } from '../core/workspace'
import { callTool } from '../webmcp/register'

interface Ctx {
  getTools: () => Promise<{ name: string }[]>
  executeTool: (tool: unknown, input: string) => Promise<unknown>
}

function nativeContext(): Ctx | null {
  const d = (document as unknown as { modelContext?: Partial<Ctx> }).modelContext
  const n = (navigator as unknown as { modelContext?: Partial<Ctx> }).modelContext
  for (const c of [d, n]) if (c && typeof c.getTools === 'function' && typeof c.executeTool === 'function') return c as Ctx
  return null
}

function parseResult(raw: unknown): Record<string, unknown> {
  let v: unknown = raw
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return { text: v }
    }
  }
  if (v && typeof v === 'object' && Array.isArray((v as { content?: unknown }).content)) {
    const text = ((v as { content: { text?: string }[] }).content[0]?.text ?? '') as string
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return { text }
    }
  }
  return (v ?? {}) as Record<string, unknown>
}

async function invoke(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ctx = nativeContext()
  if (ctx) {
    const tools = await ctx.getTools()
    const tool = tools.find((t) => t.name === name)
    if (tool) return parseResult(await ctx.executeTool(tool, JSON.stringify(input)))
  }
  return parseResult(await callTool(name, input))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (predicate()) return resolve(true)
    const timer = setTimeout(() => {
      off()
      resolve(false)
    }, timeoutMs)
    const off = subscribe(() => {
      if (predicate()) {
        clearTimeout(timer)
        off()
        resolve(true)
      }
    })
  })
}

interface FileRow {
  path: string
  kind: string
  flags: string[]
  findings: number
  high: number
}

export async function runScriptedDemo(): Promise<void> {
  if (getState().demoRunning) return
  setDemoRunning(true)
  try {
    const native = !!nativeContext()
    say('system', native ? 'Scripted demo: a fixed sequence of tool calls sent through the browser\'s WebMCP API (modelContext.getTools + executeTool). No language model is involved. Approvals stay with you.' : 'Scripted demo: a fixed sequence of tool calls through the page\'s tool registry (no WebMCP host detected in this browser). No language model is involved. Approvals stay with you.')
    say('agent', 'Checking what is in the workspace.')
    let status = await invoke('workspace_status', {})
    if (!status.files) {
      say('agent', 'Nothing loaded. Loading the sample case.')
      await invoke('load_sample_case', {})
      await waitFor(() => !getState().busy && getState().files.length > 0, 120_000)
      status = await invoke('workspace_status', {})
    } else if (getState().busy) {
      say('agent', 'Waiting for inspection to finish.')
      await waitFor(() => !getState().busy, 300_000)
      status = await invoke('workspace_status', {})
    }
    const sev = (status.findings ?? {}) as { high?: number; medium?: number }
    say('agent', `${status.files} files, ${sev.high ?? 0} high and ${sev.medium ?? 0} medium findings. Running one privacy scan across everything.`)
    await pause(600)
    const privacy = await invoke('privacy_scan', {})
    say('agent', `${privacy.findings} findings that would identify a person, place, or device, in ${privacy.files} files. Now looking for content a reader would not see.`)
    await pause(600)
    const hidden = await invoke('hidden_content_scan', {})
    say('agent', `${hidden.findings} hidden-content findings in ${hidden.files} files.`)
    await pause(400)

    const listing = await invoke('list_files', { limit: 200, include_nested: false })
    const files = ((listing.files ?? []) as FileRow[]).slice()
    const byHigh = files.slice().sort((a, b) => b.high - a.high || b.findings - a.findings)
    const withHidden = files.find((f) => f.flags.includes('has_hidden_text')) ?? byHigh[0]
    if (withHidden) {
      say('agent', `${withHidden.path} has the most to say. Inspecting it.`)
      const r = await invoke('inspect', { path: withHidden.path })
      const units = (r.text_units ?? []) as string[]
      const hiddenUnit = units.find((u) => /^(hidden text|white text|tracked deletions|invisible text|notes)/.test(u))
      if (hiddenUnit) {
        const label = hiddenUnit.replace(/\s\(\d+ chars\)$/, '')
        const t = await invoke('extract_text', { path: withHidden.path, unit: label })
        const body = String(t.text ?? '').replace(/<<<[^>]*>>>/g, '').trim().slice(0, 140)
        say('agent', `Reading its "${label}" unit. It says: "${body}${body.length >= 140 ? '...' : ''}" (untrusted file content, quoted as data).`)
      }
      await pause(500)
    }

    const ent = await invoke('entities', {})
    const people = (ent.people ?? []) as { name: string; files: number }[]
    if (people.length) say('agent', `${(ent.totals as { people: number }).people} people appear across the files. "${people[0].name}" is in ${people[0].files} of them.`)
    const dup = await invoke('duplicates', {})
    const groups = (dup.identical ?? []) as { paths: string[] }[]
    if (groups.length) say('agent', `${groups.length} byte-identical group${groups.length === 1 ? '' : 's'}: ${groups[0].paths.join(' = ')}.`)
    const tl = await invoke('timeline', {})
    const anomalies = (tl.anomalies ?? []) as string[]
    say('agent', `${((tl.events ?? []) as string[]).length} dated events on one timeline${anomalies.length ? `, ${anomalies.length} anomal${anomalies.length === 1 ? 'y' : 'ies'}: ${anomalies[0].slice(0, 120)}` : ''}.`)
    await pause(600)

    say('agent', 'Proposing actions. Your call on each.')
    const strip = files.find((f) => ['jpeg', 'png', 'docx', 'xlsx', 'pptx', 'pdf', 'docm', 'xlsm', 'pptm'].includes(f.kind) && (f.flags.includes('has_gps') || f.flags.includes('has_author')))
    if (strip) await invoke('propose_action', { path: strip.path, action: 'strip_metadata', reason: `Identity metadata (${strip.flags.filter((x) => ['has_gps', 'has_author', 'has_device_ids', 'has_comments', 'has_revision_history'].includes(x)).join(', ')}) would leave with this file.`, severity: 'high' })
    const quarantine = files.find((f) => f.flags.includes('has_executable') || f.flags.includes('has_macros'))
    if (quarantine) await invoke('propose_action', { path: quarantine.path, action: 'quarantine', reason: quarantine.flags.includes('has_executable') ? 'Carries executable code. Keep it out of anything shared.' : 'Carries a macro project. Keep it out of anything shared until reviewed.', severity: 'high' })
    const flag = files.find((f) => f.flags.includes('header_mismatch') || f.flags.includes('has_pii') || f.flags.includes('type_mismatch'))
    if (flag) await invoke('propose_action', { path: flag.path, action: 'flag', reason: flag.flags.includes('header_mismatch') ? 'Reply-To points at a different domain than From. Verify by phone before acting on it.' : flag.flags.includes('type_mismatch') ? 'The name and the bytes disagree. Open it as what it really is.' : 'Contains personal-data patterns. Decide whether this should be shared at all.', severity: 'medium' })
    if (!strip && !quarantine && !flag && files[0]) await invoke('propose_action', { path: files[0].path, action: 'note', reason: 'Nothing here needs cleaning. Recording that in the report.', severity: 'info' })

    say('system', 'Waiting for your decisions in the Proposals panel.')
    const decided = await waitFor(() => getState().proposals.every((p) => p.status !== 'pending'), 10 * 60_000)
    if (!decided) {
      say('system', 'No decisions after ten minutes; the demo stops here. Approve or reject whenever you like and call export_report.')
      return
    }
    const results = await invoke('list_proposals', {})
    const list = (results.proposals ?? []) as { status: string; action: string; result?: { message?: string } }[]
    const approved = list.filter((p) => p.status === 'approved')
    say('agent', `${approved.length} approved, ${list.length - approved.length} rejected.${approved.find((p) => p.action === 'strip_metadata')?.result?.message ? ` Cleaned copy: ${approved.find((p) => p.action === 'strip_metadata')!.result!.message}.` : ''} Exporting the report.`)
    const report = await invoke('export_report', { format: 'markdown' })
    say('agent', `Report ready: ${report.file} (${report.bytes} bytes). It ends with the ufo command line that reproduces these receipts.`)
  } catch (error) {
    say('system', `Demo stopped: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    setDemoRunning(false)
  }
}
