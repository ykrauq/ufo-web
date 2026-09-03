// The workspace end to end without a browser: load the sample files, run the
// cross-file queries, propose, decide as the human, and build the report.

import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ws from '../src/core/workspace'
import { TOOL_NAMES } from '../src/webmcp/tools'

const SAMPLES = join(__dirname, '..', 'public', 'samples')
const manifest = JSON.parse(readFileSync(join(SAMPLES, 'manifest.json'), 'utf8')) as { files: { path: string }[] }

beforeAll(async () => {
  Object.assign(globalThis.URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined })
  const inputs = manifest.files
    .filter((f) => !f.path.endsWith('invoice-2291.pdf'))
    .map((f) => ({ path: f.path, name: f.path.split('/').pop()!, bytes: new Uint8Array(readFileSync(join(SAMPLES, f.path))), lastModified: null }))
  const r = await ws.addFiles(inputs)
  expect(r.added).toBe(inputs.length)
}, 60000)

describe('tool surface', () => {
  it('has no approve or reject tool', () => {
    expect(TOOL_NAMES.some((n) => /approve|reject|decide/.test(n))).toBe(false)
    expect(TOOL_NAMES).toContain('propose_action')
    expect(TOOL_NAMES.length).toBe(17)
  })
})

describe('queries', () => {
  it('lists files with flags', () => {
    const list = ws.listFiles({})
    expect(list.length).toBe(13)
    expect(list.find((f) => f.path.endsWith('.jpg'))?.flags).toContain('has_gps')
  })
  it('searches text, metadata, and archive entries', () => {
    const hits = ws.search('Meridian')
    expect(hits.length).toBeGreaterThan(3)
    expect(hits.some((h) => h.where.startsWith('metadata'))).toBe(true)
    expect(ws.search('setup-helper').some((h) => h.where === 'archive entry')).toBe(true)
  })
  it('finds by flags, author, mismatch', () => {
    expect(ws.find({ any_flags: ['has_gps', 'has_hidden_sheets'] }).length).toBe(3)
    expect(ws.find({ author: 'okafor' }).length).toBeGreaterThanOrEqual(4)
    expect(ws.find({ type_mismatch: true }).map((f) => f.path)).toEqual(['downloads/statement-august.pdf'])
  })
  it('compares two versions', () => {
    const c = ws.compare('contracts/Q3-services-agreement-v2.docx', 'contracts/Q3-services-agreement-v3.docx')
    expect(c.identicalBytes).toBe(false)
    expect(c.text!.addedLines).toBeGreaterThan(0)
    expect(c.flagsOnlyInB).toContain('has_hidden_text')
  })
  it('builds a timeline with the archived-document anomaly', () => {
    const t = ws.timeline()
    expect(t.events.length).toBeGreaterThan(15)
    expect(t.anomalies.some((a) => a.includes('later than the filesystem'))).toBe(true)
  })
  it('cross-references people, domains, organizations, devices', () => {
    const e = ws.entities()
    const dana = e.people.find((p) => p.name === 'Dana Okafor')
    expect(dana).toBeTruthy()
    expect(dana!.files.length).toBeGreaterThanOrEqual(4)
    expect(dana!.roles).toEqual(expect.arrayContaining(['author', 'comment author']))
    expect(e.domains.some((d) => d.name === 'meridian-dataworks-secure.example')).toBe(true)
    expect(e.organizations.some((o) => o.name === 'Halcyon Ridge Partners LLC')).toBe(true)
    expect(e.devices.some((d) => d.name.includes('Canon'))).toBe(true)
  })
  it('spots the byte-identical copy inside the archive', () => {
    const d = ws.duplicates()
    const group = d.identical.find((g) => g.paths.some((p) => p.includes('old-agreement.docx')))
    expect(group).toBeTruthy()
    expect(group!.paths).toContain('contracts/Q3-services-agreement-v2.docx')
  })
  it('peeks bytes at the top level and one level into an archive', async () => {
    const top = await ws.peekBytes('downloads/statement-august.pdf', 0, 16)
    expect(top.hex).toMatch(/89 50 4e 47/)
    const inner = await ws.peekBytes('archive/backup-2024.zip!/backup/archive-inner.zip', 0, 8)
    expect(inner.hex).toMatch(/50 4b 03 04/)
  })
  it('pages extracted text with provenance and untrusted delimiters', () => {
    const t = ws.extractText('finance/vendor-payments.xlsx', 'sheet Salaries', 0, 40)
    expect(t.unit).toMatch(/^sheet Salaries/)
    expect(t.next_offset).toBe(40)
    expect(t.text).toMatch(/^<<<UNTRUSTED FILE CONTENT/)
  })
})

describe('proposals and decisions', () => {
  it('rejects strip_metadata for kinds the browser cannot clean', () => {
    expect(() => ws.propose({ path: 'hr/onboarding-list.csv', action: 'strip_metadata', reason: 'x' })).toThrow(/not available/)
  })
  it('records agent proposals and human decisions with results', async () => {
    const p1 = ws.propose({ path: 'photos/site-visit-northgate.jpg', action: 'strip_metadata', reason: 'GPS', severity: 'high' })
    const p2 = ws.propose({ path: 'archive/backup-2024.zip', action: 'quarantine', reason: 'exe inside', severity: 'high' })
    const p3 = ws.propose({ path: 'downloads/statement-august.pdf', action: 'rename_extension', reason: 'it is a PNG' })
    const p4 = ws.propose({ path: 'mail/RE wire instructions 2291.eml', action: 'flag', reason: 'reply-to' })
    expect(ws.listProposals('pending').length).toBe(4)
    const d1 = await ws.decide(p1.id, 'executed')
    expect(d1.result?.findingsBefore).toBe(6)
    expect(d1.result?.findingsAfter).toBe(0)
    expect(d1.result?.outputName).toBe('site-visit-northgate.clean.jpg')
    const d2 = await ws.decide(p2.id, 'executed')
    expect(d2.result?.message).toMatch(/quarantine/)
    expect(ws.fileAt('archive/backup-2024.zip')?.quarantined).toBe(true)
    const d3 = await ws.decide(p3.id, 'executed')
    expect(d3.result?.outputName).toBe('statement-august.png')
    const d4 = await ws.decide(p4.id, 'dismissed')
    expect(d4.result).toBeUndefined()
    expect(ws.getState().downloads.length).toBe(2)
  }, 30000)
  it('keeps quarantined files out of the report and lists decisions and CLI commands', async () => {
    const report = ws.buildReport(false)
    expect(report.files.some((r) => r.path === 'archive/backup-2024.zip')).toBe(false)
    expect(report.case.quarantined).toBe(1)
    expect(report.summary.proposals).toEqual({ pending: 0, executed: 3, dismissed: 1 })
    expect(report.beyond.url).toBe('https://universalfileopener.com')
    const md = ws.reportMarkdown(report)
    expect(md).toContain('## Agent suggestions and your decisions')
    expect(md).toContain('**executed**')
    const exported = await ws.exportReport('markdown')
    expect(exported.name).toBe('ufo-web-report.md')
  })
})
