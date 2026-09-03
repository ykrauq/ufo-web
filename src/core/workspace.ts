// In-memory workspace: the files, their receipts, the agent's proposals, the
// human's decisions, and the tool-call log. Nothing here touches the network.

import { diffLines } from 'diff'
import type { Finding, Flag, InputFile, Receipt, Severity } from './types'
import { inspectFile } from './inspect'
import { stripMetadata, canStripMetadata, suggestedExtension } from './clean'
import { sha256Hex } from './hash'
import { kindInfo } from './kinds'
import { untrustedBlock } from './text'
import type { ToolCallRecord } from '../webmcp/register'

export type FileStatus = 'queued' | 'inspecting' | 'done' | 'error'

export interface WorkspaceFile {
  path: string
  name: string
  bytes: Uint8Array
  lastModified: number | null
  status: FileStatus
  receipt?: Receipt
  error?: string
  quarantined?: boolean
  flagged?: boolean
}

export type ProposalAction = 'note' | 'flag' | 'strip_metadata' | 'rename_extension' | 'quarantine'
export const PROPOSAL_ACTIONS: ProposalAction[] = ['note', 'flag', 'strip_metadata', 'rename_extension', 'quarantine']

export interface Proposal {
  id: string
  path: string
  action: ProposalAction
  reason: string
  severity: Severity
  proposedBy: 'agent'
  proposedAt: string
  status: 'pending' | 'approved' | 'rejected'
  decidedAt?: string
  decidedBy?: 'human'
  result?: {
    message: string
    outputName?: string
    outputSha256?: string
    outputBytes?: number
    findingsBefore?: number
    findingsAfter?: number
    removed?: string[]
  }
}

export interface Download {
  id: string
  forPath: string
  name: string
  url: string
  bytes: number
  sha256: string
}

export interface WorkspaceState {
  files: WorkspaceFile[]
  proposals: Proposal[]
  toolLog: ToolCallRecord[]
  downloads: Download[]
  selectedPath: string | null
  busy: boolean
  sampleLoaded: boolean
  caseName: string
  events: { at: string; who: 'agent' | 'human' | 'system'; text: string }[]
}

const MAX_FILE_BYTES = 150_000_000
const MAX_TOTAL_BYTES = 600_000_000
const MAX_FILES = 1500

let state: WorkspaceState = {
  files: [],
  proposals: [],
  toolLog: [],
  downloads: [],
  selectedPath: null,
  busy: false,
  sampleLoaded: false,
  caseName: '',
  events: [],
}

const listeners = new Set<() => void>()
let proposalCounter = 0
let inspectBudget = { count: 40, bytes: 40_000_000 }

export function getState(): WorkspaceState {
  return state
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function setState(patch: Partial<WorkspaceState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

function log(who: WorkspaceState['events'][number]['who'], text: string) {
  setState({ events: [...state.events.slice(-199), { at: new Date().toISOString(), who, text }] })
}

export function recordToolCall(record: ToolCallRecord) {
  const existing = state.toolLog.findIndex((r) => r.id === record.id)
  const next = [...state.toolLog]
  if (existing >= 0) next[existing] = record
  else next.push(record)
  setState({ toolLog: next.slice(-200) })
}

export function select(path: string | null) {
  setState({ selectedPath: path })
}

// ------------------------------------------------------------ files

export async function addFiles(inputs: InputFile[]): Promise<{ added: number; skipped: string[] }> {
  const skipped: string[] = []
  const existing = new Set(state.files.map((f) => f.path))
  let total = state.files.reduce((n, f) => n + f.bytes.length, 0)
  const fresh: WorkspaceFile[] = []
  for (const input of inputs) {
    if (existing.has(input.path)) {
      skipped.push(`${input.path}: already loaded`)
      continue
    }
    if (input.bytes.length > MAX_FILE_BYTES) {
      skipped.push(`${input.path}: larger than ${MAX_FILE_BYTES / 1_000_000} MB`)
      continue
    }
    if (total + input.bytes.length > MAX_TOTAL_BYTES || state.files.length + fresh.length >= MAX_FILES) {
      skipped.push(`${input.path}: workspace limit reached`)
      continue
    }
    total += input.bytes.length
    existing.add(input.path)
    fresh.push({ path: input.path, name: input.name, bytes: input.bytes, lastModified: input.lastModified, status: 'queued' })
  }
  if (!fresh.length) return { added: 0, skipped }
  setState({ files: [...state.files, ...fresh].sort((a, b) => a.path.localeCompare(b.path)), busy: true, selectedPath: state.selectedPath ?? fresh[0].path })
  log('system', `${fresh.length} file${fresh.length === 1 ? '' : 's'} added`)
  await inspectQueued()
  return { added: fresh.length, skipped }
}

async function inspectQueued() {
  inspectBudget = { count: 60, bytes: 60_000_000 }
  const queue = state.files.filter((f) => f.status === 'queued')
  const worker = async () => {
    for (;;) {
      const next = queue.shift()
      if (!next) return
      update(next.path, { status: 'inspecting' })
      try {
        const receipt = await inspectFile({ path: next.path, name: next.name, bytes: next.bytes, lastModified: next.lastModified }, { nestedBudget: inspectBudget })
        update(next.path, { status: 'done', receipt })
      } catch (error) {
        update(next.path, { status: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await Promise.all([worker(), worker()])
  setState({ busy: false })
  const total = state.files.reduce((n, f) => n + (f.receipt?.findings.length ?? 0), 0)
  log('system', `inspection complete: ${state.files.length} files, ${total} findings`)
}

function update(path: string, patch: Partial<WorkspaceFile>) {
  setState({ files: state.files.map((f) => (f.path === path ? { ...f, ...patch } : f)) })
}

export function clearWorkspace() {
  for (const d of state.downloads) URL.revokeObjectURL(d.url)
  setState({ files: [], proposals: [], downloads: [], selectedPath: null, busy: false, sampleLoaded: false, caseName: '', events: [] })
}

export async function loadSampleCase(): Promise<{ added: number; name: string }> {
  const manifest = (await (await fetch('/samples/manifest.json')).json()) as { name: string; files: { path: string }[] }
  const inputs: InputFile[] = []
  for (const f of manifest.files) {
    const res = await fetch(`/samples/${f.path.split('/').map(encodeURIComponent).join('/')}`)
    if (!res.ok) continue
    const bytes = new Uint8Array(await res.arrayBuffer())
    inputs.push({ path: f.path, name: f.path.split('/').pop() ?? f.path, bytes, lastModified: null })
  }
  setState({ sampleLoaded: true, caseName: manifest.name })
  const r = await addFiles(inputs)
  return { added: r.added, name: manifest.name }
}

export function fileAt(path: string): WorkspaceFile | undefined {
  return state.files.find((f) => f.path === path) ?? state.files.find((f) => f.path.toLowerCase() === path.toLowerCase()) ?? state.files.find((f) => f.path.endsWith(`/${path}`) || f.name === path)
}

/** All receipts including nested ones, flattened, for cross-file queries. */
export function allReceipts(includeNested = true): Receipt[] {
  const out: Receipt[] = []
  const walk = (r: Receipt) => {
    out.push(r)
    if (includeNested && r.container) r.container.nested.forEach(walk)
  }
  for (const f of state.files) if (f.receipt) walk(f.receipt)
  return out
}

export function receiptAt(path: string): Receipt | undefined {
  return allReceipts().find((r) => r.path === path) ?? fileAt(path)?.receipt
}

function inScope(path: string, scope?: string): boolean {
  if (!scope) return true
  const s = scope.replace(/^\.?\//, '')
  if (s.includes('*')) {
    const re = new RegExp('^' + s.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
    return re.test(path)
  }
  return path.toLowerCase().startsWith(s.toLowerCase()) || path.toLowerCase().includes(`/${s.toLowerCase()}`)
}

// ------------------------------------------------------------ queries

export interface FileSummary {
  path: string
  kind: string
  family: string
  bytes: number
  flags: Flag[]
  findings: number
  high: number
  status: FileStatus
  quarantined?: boolean
  nestedIn?: string
}

export function summarize(r: Receipt, status: FileStatus = 'done'): FileSummary {
  const f = fileAt(r.path)
  return {
    path: r.path,
    kind: r.kind,
    family: r.family,
    bytes: r.sizeBytes,
    flags: r.flags,
    findings: r.findings.length,
    high: r.findings.filter((x) => x.severity === 'high').length,
    status,
    quarantined: f?.quarantined,
    nestedIn: r.depth > 0 ? r.path.split('!/')[0] : undefined,
  }
}

export function listFiles(opts: { filter?: string; kind?: string; flag?: string; family?: string; includeNested?: boolean } = {}): FileSummary[] {
  const out: FileSummary[] = []
  for (const f of state.files) {
    if (!inScope(f.path, opts.filter)) continue
    if (!f.receipt) {
      out.push({ path: f.path, kind: '?', family: 'unknown', bytes: f.bytes.length, flags: [], findings: 0, high: 0, status: f.status, quarantined: f.quarantined })
      continue
    }
    const receipts = opts.includeNested ? flatten(f.receipt) : [f.receipt]
    for (const r of receipts) {
      if (opts.kind && r.kind !== opts.kind) continue
      if (opts.family && r.family !== opts.family) continue
      if (opts.flag && !r.flags.includes(opts.flag as Flag)) continue
      out.push(summarize(r, f.status))
    }
  }
  return out
}

function flatten(r: Receipt): Receipt[] {
  const out = [r]
  if (r.container) for (const n of r.container.nested) out.push(...flatten(n))
  return out
}

export interface SearchHit {
  path: string
  where: string
  snippet: string
}

export function search(query: string, scope?: string, limit = 25): SearchHit[] {
  const q = query.toLowerCase()
  const hits: SearchHit[] = []
  for (const r of allReceipts()) {
    if (hits.length >= limit) break
    if (!inScope(r.path, scope)) continue
    for (const [k, v] of Object.entries(r.metadata)) {
      if (v !== null && String(v).toLowerCase().includes(q)) hits.push({ path: r.path, where: `metadata.${k}`, snippet: String(v).slice(0, 160) })
    }
    for (const f of r.findings) {
      if ((f.title + ' ' + f.detail + ' ' + (f.evidence ?? '')).toLowerCase().includes(q)) hits.push({ path: r.path, where: `finding ${f.id}`, snippet: f.title })
    }
    if (r.text) {
      for (const u of r.text.units) {
        let idx = u.text.toLowerCase().indexOf(q)
        let n = 0
        while (idx >= 0 && n < 3 && hits.length < limit) {
          const start = Math.max(0, idx - 60)
          const line = u.text.slice(0, idx).split('\n').length
          hits.push({ path: r.path, where: `${u.label}, line ${line}`, snippet: u.text.slice(start, idx + q.length + 60).replace(/\s+/g, ' ') })
          idx = u.text.toLowerCase().indexOf(q, idx + q.length)
          n++
        }
      }
    }
    for (const e of r.container?.entries ?? []) {
      if (e.path.toLowerCase().includes(q)) hits.push({ path: r.path, where: 'archive entry', snippet: e.path })
    }
  }
  return hits.slice(0, limit)
}

export interface FindCriteria {
  flags?: string[]
  any_flags?: string[]
  kind?: string
  family?: string
  extension?: string
  author?: string
  name_contains?: string
  min_bytes?: number
  max_bytes?: number
  min_severity?: Severity
  type_mismatch?: boolean
  scope?: string
}

const SEV: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 }

export function find(c: FindCriteria): FileSummary[] {
  const out: FileSummary[] = []
  for (const r of allReceipts()) {
    if (!inScope(r.path, c.scope)) continue
    if (c.kind && r.kind !== c.kind) continue
    if (c.family && r.family !== c.family) continue
    if (c.extension && r.extension !== c.extension.replace(/^\./, '').toLowerCase()) continue
    if (c.name_contains && !r.path.toLowerCase().includes(c.name_contains.toLowerCase())) continue
    if (c.min_bytes !== undefined && r.sizeBytes < c.min_bytes) continue
    if (c.max_bytes !== undefined && r.sizeBytes > c.max_bytes) continue
    if (c.type_mismatch !== undefined && r.nameAndBytesDisagree !== c.type_mismatch) continue
    if (c.flags && !c.flags.every((f) => r.flags.includes(f as Flag))) continue
    if (c.any_flags && !c.any_flags.some((f) => r.flags.includes(f as Flag))) continue
    if (c.author) {
      const a = c.author.toLowerCase()
      const fields = ['author', 'lastModifiedBy', 'artist', 'manager', 'xmpCreator', 'From'].map((k) => String(r.metadata[k] ?? '').toLowerCase())
      if (!fields.some((v) => v.includes(a))) continue
    }
    if (c.min_severity && !r.findings.some((f) => SEV[f.severity] >= SEV[c.min_severity!])) continue
    out.push(summarize(r))
  }
  return out
}

export function findingsIn(scope?: string, categories?: Finding['category'][], minSeverity: Severity = 'info'): Finding[] {
  const out: Finding[] = []
  for (const r of allReceipts()) {
    if (!inScope(r.path, scope)) continue
    for (const f of r.findings) {
      if (categories && !categories.includes(f.category)) continue
      if (SEV[f.severity] < SEV[minSeverity]) continue
      out.push(f)
    }
  }
  return out.sort((a, b) => SEV[b.severity] - SEV[a.severity])
}

export interface CompareResult {
  a: string
  b: string
  identicalBytes: boolean
  sameKind: boolean
  metadataDiff: { key: string; a: string | number | boolean | null; b: string | number | boolean | null }[]
  flagsOnlyInA: Flag[]
  flagsOnlyInB: Flag[]
  text: { comparedUnits: number; addedLines: number; removedLines: number; sample: string[] } | null
}

export function compare(pathA: string, pathB: string): CompareResult {
  const a = receiptAt(pathA)
  const b = receiptAt(pathB)
  if (!a) throw new Error(`not in workspace: ${pathA}`)
  if (!b) throw new Error(`not in workspace: ${pathB}`)
  const keys = new Set([...Object.keys(a.metadata), ...Object.keys(b.metadata)])
  const metadataDiff: CompareResult['metadataDiff'] = []
  for (const k of keys) {
    const va = a.metadata[k] ?? null
    const vb = b.metadata[k] ?? null
    if (va !== vb) metadataDiff.push({ key: k, a: va, b: vb })
  }
  let text: CompareResult['text'] = null
  if (a.text && b.text) {
    const ta = a.text.units.map((u) => u.text).join('\n')
    const tb = b.text.units.map((u) => u.text).join('\n')
    const changes = diffLines(ta, tb)
    let added = 0
    let removed = 0
    const sample: string[] = []
    for (const ch of changes) {
      const lines = ch.value.split('\n').filter((l) => l.length)
      if (ch.added) {
        added += lines.length
        for (const l of lines) if (sample.length < 12) sample.push(`+ ${l.slice(0, 140)}`)
      } else if (ch.removed) {
        removed += lines.length
        for (const l of lines) if (sample.length < 12) sample.push(`- ${l.slice(0, 140)}`)
      }
    }
    text = { comparedUnits: Math.min(a.text.units.length, b.text.units.length), addedLines: added, removedLines: removed, sample }
  }
  return {
    a: a.path,
    b: b.path,
    identicalBytes: a.sha256 === b.sha256,
    sameKind: a.kind === b.kind,
    metadataDiff: metadataDiff.slice(0, 40),
    flagsOnlyInA: a.flags.filter((f) => !b.flags.includes(f)),
    flagsOnlyInB: b.flags.filter((f) => !a.flags.includes(f)),
    text,
  }
}

export interface TimelineEvent {
  when: string
  path: string
  what: string
  source: string
  anomaly?: string
}

export function timeline(scope?: string, limit = 60): { events: TimelineEvent[]; anomalies: string[] } {
  const events: TimelineEvent[] = []
  const anomalies: string[] = []
  const now = Date.now()
  for (const r of allReceipts()) {
    if (!inScope(r.path, scope)) continue
    for (const d of r.dates) events.push({ when: d.when, path: r.path, what: d.what, source: d.source })
    const created = r.dates.find((d) => /created/.test(d.what))
    const modified = r.dates.find((d) => /document modified|PDF modified|image modified/.test(d.what))
    if (created && modified && Date.parse(modified.when) < Date.parse(created.when)) {
      anomalies.push(`${r.path}: modified (${modified.when}) is earlier than created (${created.when}); the clock or the metadata was edited`)
    }
    for (const d of r.dates) {
      if (Date.parse(d.when) > now + 86_400_000) anomalies.push(`${r.path}: ${d.what} is in the future (${d.when})`)
      if (Date.parse(d.when) < Date.parse('1990-01-01')) anomalies.push(`${r.path}: ${d.what} is implausibly old (${d.when})`)
    }
    const fsMod = r.lastModifiedMillis
    if (fsMod && created && Date.parse(created.when) > fsMod + 60_000) anomalies.push(`${r.path}: internal created date is later than the filesystem modification time`)
  }
  events.sort((a, b) => Date.parse(a.when) - Date.parse(b.when))
  for (const e of events) {
    const a = anomalies.find((x) => x.startsWith(e.path) && x.includes(e.what))
    if (a) e.anomaly = a.slice(e.path.length + 2)
  }
  return { events: events.slice(0, limit), anomalies: [...new Set(anomalies)] }
}

// ------------------------------------------------------------ proposals and decisions

export function propose(input: { path: string; action: ProposalAction; reason: string; severity?: Severity }): Proposal {
  const file = fileAt(input.path)
  const receipt = receiptAt(input.path)
  if (!file && !receipt) throw new Error(`not in workspace: ${input.path}`)
  if (!PROPOSAL_ACTIONS.includes(input.action)) throw new Error(`unknown action: ${input.action}`)
  if (input.action === 'strip_metadata') {
    if (!file) throw new Error('strip_metadata applies to top-level files, not entries inside archives')
    if (!file.receipt || !canStripMetadata(file.receipt.kind)) throw new Error(`strip_metadata is not available for ${file.receipt?.kind ?? 'this file'} in the browser edition; the report will carry the CLI command instead`)
  }
  if (input.action === 'rename_extension') {
    if (!file?.receipt) throw new Error('rename_extension applies to top-level inspected files')
    if (!file.receipt.nameAndBytesDisagree) throw new Error('rename_extension only makes sense when name and bytes disagree')
  }
  const p: Proposal = {
    id: `p${++proposalCounter}`,
    path: file?.path ?? receipt!.path,
    action: input.action,
    reason: String(input.reason ?? '').slice(0, 500),
    severity: input.severity ?? 'medium',
    proposedBy: 'agent',
    proposedAt: new Date().toISOString(),
    status: 'pending',
  }
  setState({ proposals: [...state.proposals, p] })
  log('agent', `proposed ${p.action} on ${p.path}: ${p.reason}`)
  return p
}

export function listProposals(status?: Proposal['status']): Proposal[] {
  return state.proposals.filter((p) => !status || p.status === status)
}

/** Human-only. There is deliberately no WebMCP tool that calls this. */
export async function decide(id: string, decision: 'approved' | 'rejected'): Promise<Proposal> {
  const p = state.proposals.find((x) => x.id === id)
  if (!p) throw new Error(`unknown proposal ${id}`)
  if (p.status !== 'pending') return p
  const decided: Proposal = { ...p, status: decision, decidedAt: new Date().toISOString(), decidedBy: 'human' }
  setState({ proposals: state.proposals.map((x) => (x.id === id ? decided : x)) })
  log('human', `${decision} ${p.action} on ${p.path}`)
  if (decision === 'rejected') return decided
  try {
    const result = await perform(decided)
    const done = { ...decided, result }
    setState({ proposals: state.proposals.map((x) => (x.id === id ? done : x)) })
    return done
  } catch (error) {
    const failed = { ...decided, result: { message: `failed: ${error instanceof Error ? error.message : String(error)}` } }
    setState({ proposals: state.proposals.map((x) => (x.id === id ? failed : x)) })
    return failed
  }
}

async function perform(p: Proposal): Promise<NonNullable<Proposal['result']>> {
  const file = fileAt(p.path)
  switch (p.action) {
    case 'note':
      return { message: 'noted in the report' }
    case 'flag':
      if (file) update(file.path, { flagged: true })
      return { message: 'flagged for follow-up' }
    case 'quarantine':
      if (file) update(file.path, { quarantined: true })
      return { message: 'moved to quarantine; excluded from export and downloads' }
    case 'rename_extension': {
      if (!file?.receipt) throw new Error('file not found')
      const ext = suggestedExtension(file.receipt.kind)
      if (!ext) throw new Error('no safe extension for this kind')
      const name = file.name.replace(/(\.[^.]+)?$/, `.${ext}`)
      const d = await addDownload(file.path, name, file.bytes)
      return { message: `download offered as ${name}`, outputName: name, outputSha256: d.sha256, outputBytes: d.bytes }
    }
    case 'strip_metadata': {
      if (!file?.receipt) throw new Error('file not found')
      const cleaned = await stripMetadata(file.bytes, file.receipt.kind, file.name)
      const d = await addDownload(file.path, cleaned.outputName, cleaned.bytes)
      const after = await inspectFile({ path: cleaned.outputName, name: cleaned.outputName, bytes: cleaned.bytes, lastModified: null })
      return {
        message: `cleaned copy ready: ${cleaned.removed.length} item${cleaned.removed.length === 1 ? '' : 's'} removed; findings ${file.receipt.findings.length} -> ${after.findings.length}`,
        outputName: cleaned.outputName,
        outputSha256: d.sha256,
        outputBytes: d.bytes,
        findingsBefore: file.receipt.findings.length,
        findingsAfter: after.findings.length,
        removed: cleaned.removed,
      }
    }
  }
}

async function addDownload(forPath: string, name: string, bytes: Uint8Array): Promise<Download> {
  const sha256 = await sha256Hex(bytes)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }))
  const d: Download = { id: `d${state.downloads.length + 1}`, forPath, name, url, bytes: bytes.length, sha256 }
  setState({ downloads: [...state.downloads, d] })
  return d
}

// ------------------------------------------------------------ report

export interface Report {
  schema: 'ufo-web-report/0.1'
  generatedAt: string
  generator: { name: string; version: string; url: string; source: string }
  case: { name: string; files: number; bytes: number; quarantined: number }
  summary: { findings: Record<Severity, number>; flags: Record<string, number>; proposals: Record<Proposal['status'], number> }
  files: Receipt[]
  proposals: Proposal[]
  reproduce: { cli: string[]; note: string }
  notAvailableInWeb: string[]
}

export function buildReport(includeText = false): Report {
  const files = state.files.filter((f) => f.receipt && !f.quarantined).map((f) => f.receipt!)
  const strip = (r: Receipt): Receipt => ({ ...r, text: includeText ? r.text : r.text ? { chars: r.text.chars, units: r.text.units.map((u) => ({ label: u.label, text: '' })), truncated: r.text.truncated } : undefined, container: r.container ? { ...r.container, nested: r.container.nested.map(strip) } : undefined })
  const findings: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 }
  const flags: Record<string, number> = {}
  for (const r of allReceipts()) {
    for (const f of r.findings) findings[f.severity]++
    for (const fl of r.flags) flags[fl] = (flags[fl] ?? 0) + 1
  }
  const proposals: Record<Proposal['status'], number> = { pending: 0, approved: 0, rejected: 0 }
  for (const p of state.proposals) proposals[p.status]++
  const paths = files.map((r) => `"${r.path}"`)
  const cli = [`ufo inspect --json ${paths.slice(0, 20).join(' ')}${paths.length > 20 ? ' ...' : ''}`]
  for (const r of files.filter((x) => x.family === 'archive')) cli.push(`ufo extract --json -o ./extracted "${r.path}"`)
  return {
    schema: 'ufo-web-report/0.1',
    generatedAt: new Date().toISOString(),
    generator: { name: 'UFO Web', version: '0.1.0', url: 'https://web.universalfileopener.com', source: 'https://github.com/ykrauq/ufo-web' },
    case: { name: state.caseName || 'workspace', files: files.length, bytes: files.reduce((n, r) => n + r.sizeBytes, 0), quarantined: state.files.filter((f) => f.quarantined).length },
    summary: { findings, flags, proposals },
    files: files.map(strip),
    proposals: state.proposals,
    reproduce: { cli, note: 'The ufo command line (UFO for Windows 1.1) emits receipts with the same identity fields, for whole trees, from a shell. Legacy OLE formats, repair, and conversion run there and in the apps.' },
    notAvailableInWeb: [...new Set(files.flatMap((r) => r.notAvailableInWeb))],
  }
}

export function reportMarkdown(report: Report): string {
  const lines: string[] = []
  lines.push(`# UFO Web investigation report`, '', `Generated ${report.generatedAt} by ${report.generator.name} ${report.generator.version} (${report.generator.url}). Nothing left the browser.`, '')
  lines.push(`## Case: ${report.case.name}`, '', `${report.case.files} files, ${report.case.bytes} bytes, ${report.case.quarantined} quarantined.`, '')
  lines.push(`Findings: ${report.summary.findings.high} high, ${report.summary.findings.medium} medium, ${report.summary.findings.low} low, ${report.summary.findings.info} info.`, '')
  lines.push('## Files', '')
  for (const r of report.files) {
    lines.push(`### ${r.path}`, '', `${r.label} (${r.kind}), ${r.sizeBytes} bytes, sha256 ${r.sha256}${r.nameAndBytesDisagree ? `, NAME/BYTES DISAGREE (${r.nameSaysKind} vs ${r.bytesSayKind})` : ''}`, '')
    if (r.flags.length) lines.push(`Flags: ${r.flags.join(', ')}`, '')
    for (const f of r.findings) lines.push(`- [${f.severity}] ${f.title}${f.where ? ` (${f.where})` : ''}: ${f.detail}`)
    if (r.findings.length) lines.push('')
  }
  lines.push('## Agent proposals and human decisions', '')
  if (!report.proposals.length) lines.push('None.', '')
  for (const p of report.proposals) {
    lines.push(`- ${p.id} ${p.action} on ${p.path}: ${p.reason} -> **${p.status}**${p.decidedAt ? ` by human at ${p.decidedAt}` : ''}${p.result ? ` (${p.result.message})` : ''}`)
  }
  lines.push('', '## Reproduce with the ufo command line', '', '```', ...report.reproduce.cli, '```', '', report.reproduce.note, '')
  if (report.notAvailableInWeb.length) {
    lines.push('## Not available in the browser edition', '')
    for (const n of report.notAvailableInWeb) lines.push(`- ${n}`)
  }
  return lines.join('\n')
}

export async function exportReport(format: 'json' | 'markdown', includeText = false): Promise<{ name: string; bytes: number; summary: Report['summary']; download: Download }> {
  const report = buildReport(includeText)
  const body = format === 'markdown' ? reportMarkdown(report) : JSON.stringify(report, null, 2)
  const bytes = new TextEncoder().encode(body)
  const name = `ufo-web-report.${format === 'markdown' ? 'md' : 'json'}`
  const d = await addDownload('(report)', name, bytes)
  log('system', `report exported: ${name}`)
  return { name, bytes: bytes.length, summary: report.summary, download: d }
}

// ------------------------------------------------------------ text access for tools

export function textUnits(path: string): { label: string; chars: number }[] {
  const r = receiptAt(path)
  if (!r?.text) return []
  return r.text.units.map((u) => ({ label: u.label, chars: u.text.length }))
}

export function extractText(path: string, unit?: string, offset = 0, limit = 1200): { path: string; unit: string; offset: number; chars: number; total: number; next_offset: number | null; units: { label: string; chars: number }[]; text: string } {
  const r = receiptAt(path)
  if (!r) throw new Error(`not in workspace: ${path}`)
  if (!r.text || !r.text.units.length) throw new Error(`no extractable text for ${path} (${kindInfo(r.kind).label})`)
  const units = r.text.units
  const u = unit ? units.find((x) => x.label.toLowerCase() === unit.toLowerCase()) ?? units.find((x) => x.label.toLowerCase().startsWith(unit.toLowerCase())) : units[0]
  if (!u) throw new Error(`unknown unit "${unit}"; available: ${units.map((x) => x.label).join(', ')}`)
  const lim = Math.max(1, Math.min(limit, 1200))
  const slice = u.text.slice(offset, offset + lim)
  const next = offset + lim < u.text.length ? offset + lim : null
  return { path: r.path, unit: u.label, offset, chars: slice.length, total: u.text.length, next_offset: next, units: units.map((x) => ({ label: x.label, chars: x.text.length })), text: untrustedBlock(`${r.path} ${u.label} chars ${offset}-${offset + slice.length}`, slice) }
}
