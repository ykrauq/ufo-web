import type JSZip from 'jszip'
import type { DateEvent, Finding, Flag, TextUnit } from './types'
import { readText, readBytes } from './zip'
import { parseXml, els, firstText, attr } from './xml'

export type PartialFinding = Omit<Finding, 'id' | 'path' | 'source'>

export interface OoxmlResult {
  metadata: Record<string, string | number | boolean | null>
  flags: Flag[]
  findings: PartialFinding[]
  dates: DateEvent[]
  text: TextUnit[]
  notes: string[]
}

const PART_LIMIT = 8_000_000

function near(hex: string): boolean {
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return r >= 0xf0 && g >= 0xf0 && b >= 0xf0
}

function excerpt(s: string, n = 160): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '...' : t
}

function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}

function pushFlag(out: OoxmlResult, flag: Flag) {
  if (!out.flags.includes(flag)) out.flags.push(flag)
}

/** docProps/core.xml, docProps/app.xml, docProps/custom.xml */
async function packageProps(zip: JSZip, out: OoxmlResult, path: string): Promise<void> {
  const core = await readText(zip, 'docProps/core.xml', 200_000)
  if (core) {
    const doc = parseXml(core)
    if (doc) {
      const fields: [string, string][] = [
        ['dc:creator', 'author'], ['cp:lastModifiedBy', 'lastModifiedBy'], ['dc:title', 'title'], ['dc:subject', 'subject'],
        ['dc:description', 'description'], ['cp:keywords', 'keywords'], ['cp:category', 'category'], ['cp:revision', 'revision'],
        ['dcterms:created', 'created'], ['dcterms:modified', 'modified'], ['cp:lastPrinted', 'lastPrinted'],
      ]
      for (const [q, key] of fields) {
        const v = firstText(doc, q)
        if (v) out.metadata[key] = key === 'revision' ? Number(v) : v
      }
      const author = out.metadata.author as string | undefined
      const editor = out.metadata.lastModifiedBy as string | undefined
      if (author || editor) {
        pushFlag(out, 'has_author')
        out.findings.push({
          category: 'privacy', severity: 'medium', flag: 'has_author', where: 'docProps/core.xml',
          title: 'Author names stored in document properties',
          detail: `Creator "${author ?? '-'}"${editor && editor !== author ? `, last modified by "${editor}"` : ''}. Names travel with the file when it is shared.`,
        })
      }
      for (const key of ['created', 'modified', 'lastPrinted'] as const) {
        const v = out.metadata[key]
        if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) {
          out.dates.push({ path, when: new Date(v).toISOString(), what: `document ${key}`, source: 'docProps/core.xml' })
        }
      }
      const rev = out.metadata.revision
      if (typeof rev === 'number' && rev > 1) {
        out.findings.push({
          category: 'info', severity: 'info', where: 'docProps/core.xml',
          title: `Revision counter ${rev}`,
          detail: 'The document has been saved many times. Combined with tracked changes or comments, earlier wording may still be inside.',
        })
      }
    }
  }
  const app = await readText(zip, 'docProps/app.xml', 200_000)
  if (app) {
    const doc = parseXml(app)
    if (doc) {
      const fields: [string, string][] = [['Application', 'application'], ['AppVersion', 'appVersion'], ['Company', 'company'], ['Manager', 'manager'], ['Template', 'template'], ['TotalTime', 'editingMinutes']]
      for (const [q, key] of fields) {
        const v = firstText(doc, q)
        if (v) out.metadata[key] = key === 'editingMinutes' ? Number(v) : v
      }
      if (out.metadata.company || out.metadata.manager) {
        out.findings.push({
          category: 'privacy', severity: 'low', where: 'docProps/app.xml',
          title: 'Organization details in extended properties',
          detail: `Company "${out.metadata.company ?? '-'}"${out.metadata.manager ? `, manager "${out.metadata.manager}"` : ''}.`,
        })
      }
    }
  }
  const custom = await readText(zip, 'docProps/custom.xml', 200_000)
  if (custom) {
    const doc = parseXml(custom)
    const n = doc ? els(doc, 'property').length : 0
    if (n > 0) {
      out.metadata.customProperties = n
      out.findings.push({ category: 'privacy', severity: 'low', where: 'docProps/custom.xml', title: `${plural(n, 'custom document property', 'custom document properties')}`, detail: 'Custom properties often carry document-management IDs, classification labels, or reviewer names.' })
    }
  }
}

async function externalLinks(zip: JSZip, out: OoxmlResult, relsPaths: string[]): Promise<void> {
  const targets: string[] = []
  for (const p of relsPaths) {
    const text = await readText(zip, p, 500_000)
    if (!text) continue
    const doc = parseXml(text)
    if (!doc) continue
    for (const rel of els(doc, 'Relationship')) {
      if (attr(rel, 'TargetMode') === 'External') {
        const t = attr(rel, 'Target') ?? ''
        if (t && !t.startsWith('mailto:')) targets.push(t)
      }
    }
  }
  if (targets.length) {
    pushFlag(out, 'has_external_links')
    out.metadata.externalLinks = targets.length
    const hosts = [...new Set(targets.map((t) => { try { return new URL(t).host } catch { return t.slice(0, 40) } }))]
    out.findings.push({ category: 'info', severity: 'low', flag: 'has_external_links', where: 'relationships', title: plural(targets.length, 'external link'), detail: `Targets: ${hosts.slice(0, 5).join(', ')}${hosts.length > 5 ? '...' : ''}. Internal share paths and drive names leak this way.`, evidence: targets.slice(0, 3).join('\n') })
  }
}

async function macrosAndEmbeddings(zip: JSZip, out: OoxmlResult, prefix: string): Promise<void> {
  const names = Object.keys(zip.files)
  const vba = names.filter((n) => /vbaProject\.bin$/i.test(n))
  if (vba.length) {
    pushFlag(out, 'has_macros')
    out.metadata.vbaProject = vba[0]
    const bin = await readBytes(zip, vba[0], 2_000_000)
    const ascii = bin ? new TextDecoder('latin1').decode(bin) : ''
    const autoRun = /Auto_?Open|Workbook_Open|Document_Open|AutoExec|Auto_Close/i.test(ascii)
    out.findings.push({
      category: 'security', severity: autoRun ? 'high' : 'medium', flag: 'has_macros', where: vba[0],
      title: autoRun ? 'VBA macro project with an auto-run entry point' : 'VBA macro project present',
      detail: autoRun ? 'The project names an Auto_Open/Document_Open style procedure, which runs when the file opens with macros enabled.' : 'The file contains executable macro code. Treat it as untrusted until the code is reviewed.',
    })
  }
  const embedded = names.filter((n) => n.startsWith(`${prefix}/embeddings/`) && !zip.files[n].dir)
  if (embedded.length) {
    pushFlag(out, 'has_embedded_files')
    out.metadata.embeddedObjects = embedded.length
    out.findings.push({ category: 'hidden', severity: 'medium', flag: 'has_embedded_files', where: `${prefix}/embeddings/`, title: plural(embedded.length, 'embedded object'), detail: `Embedded files travel inside the package: ${embedded.map((e) => e.split('/').pop()).slice(0, 4).join(', ')}. They may be complete original documents.` })
  }
  const media = names.filter((n) => n.startsWith(`${prefix}/media/`) && !zip.files[n].dir)
  if (media.length) out.metadata.mediaFiles = media.length
}

function runText(r: Element, tag = 'w:t'): string {
  return els(r, tag).map((t) => t.textContent ?? '').join('')
}

// ------------------------------------------------------------ Word

export async function inspectDocx(zip: JSZip, path: string): Promise<OoxmlResult> {
  const out: OoxmlResult = { metadata: {}, flags: [], findings: [], dates: [], text: [], notes: [] }
  await packageProps(zip, out, path)
  await macrosAndEmbeddings(zip, out, 'word')
  await externalLinks(zip, out, ['word/_rels/document.xml.rels'])
  const xml = await readText(zip, 'word/document.xml', PART_LIMIT)
  const doc = xml ? parseXml(xml) : null
  if (!doc) {
    out.notes.push('word/document.xml missing or unparseable')
    return out
  }
  const paras: string[] = []
  for (const p of els(doc, 'w:p')) {
    const line = runText(p)
    if (line.trim()) paras.push(line)
  }
  out.text.push({ label: 'body', text: paras.join('\n') })

  const ins = els(doc, 'w:ins')
  const del = els(doc, 'w:del')
  if (ins.length || del.length) {
    pushFlag(out, 'has_tracked_changes')
    const authors = new Set([...ins, ...del].map((e) => attr(e, 'w:author')).filter(Boolean) as string[])
    const deleted = del.map((d) => runText(d, 'w:delText')).filter((s) => s.trim())
    const inserted = ins.map((i) => runText(i)).filter((s) => s.trim())
    out.metadata.trackedInsertions = ins.length
    out.metadata.trackedDeletions = del.length
    out.findings.push({
      category: 'hidden', severity: 'high', flag: 'has_tracked_changes', where: 'word/document.xml',
      title: `Tracked changes: ${plural(ins.length, 'insertion')}, ${plural(del.length, 'deletion')}`,
      detail: `Authors: ${[...authors].join(', ') || 'unknown'}. Deleted text is still in the file and readable by any recipient who shows markup.`,
      evidence: [...deleted.map((d) => `deleted: ${excerpt(d)}`), ...inserted.map((i) => `inserted: ${excerpt(i)}`)].slice(0, 6).join('\n'),
    })
    if (deleted.length) out.text.push({ label: 'tracked deletions', text: deleted.join('\n') })
    for (const e of [...ins, ...del]) {
      const d = attr(e, 'w:date')
      if (d && !Number.isNaN(Date.parse(d))) out.dates.push({ path, when: new Date(d).toISOString(), what: `tracked ${e.tagName === 'w:ins' ? 'insertion' : 'deletion'} by ${attr(e, 'w:author') ?? '?'}`, source: 'word/document.xml' })
    }
  }

  const hiddenRuns: string[] = []
  const whiteRuns: string[] = []
  const tinyRuns: string[] = []
  for (const r of els(doc, 'w:r')) {
    const rpr = r.getElementsByTagName('w:rPr')[0]
    if (!rpr) continue
    const text = runText(r)
    if (!text.trim()) continue
    if (rpr.getElementsByTagName('w:vanish').length) hiddenRuns.push(text)
    const color = rpr.getElementsByTagName('w:color')[0]
    if (color && near(attr(color, 'w:val') ?? '')) whiteRuns.push(text)
    const sz = rpr.getElementsByTagName('w:sz')[0]
    const half = sz ? Number(attr(sz, 'w:val')) : NaN
    if (!Number.isNaN(half) && half <= 4) tinyRuns.push(text)
  }
  if (hiddenRuns.length) {
    pushFlag(out, 'has_hidden_text')
    out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_hidden_text', where: 'word/document.xml', title: `Hidden text (${plural(hiddenRuns.length, 'run')} marked "vanish")`, detail: 'Text formatted as hidden does not print or display by default but is in the file and one checkbox away from visible.', evidence: hiddenRuns.map((t) => excerpt(t)).slice(0, 4).join('\n') })
    out.text.push({ label: 'hidden text', text: hiddenRuns.join('\n') })
  }
  if (whiteRuns.length) {
    pushFlag(out, 'has_hidden_text')
    out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_hidden_text', where: 'word/document.xml', title: `White or near-white text (${plural(whiteRuns.length, 'run')})`, detail: 'Text coloured to match the page is invisible on screen and paper but fully searchable and copyable.', evidence: whiteRuns.map((t) => excerpt(t)).slice(0, 4).join('\n') })
    out.text.push({ label: 'white text', text: whiteRuns.join('\n') })
  }
  if (tinyRuns.length) {
    pushFlag(out, 'has_hidden_text')
    out.findings.push({ category: 'hidden', severity: 'medium', flag: 'has_hidden_text', where: 'word/document.xml', title: `Tiny text at 2pt or smaller (${plural(tinyRuns.length, 'run')})`, detail: 'Text set at 1-2 points reads as a stray mark on the page. It is a common way to hide notes or watermarks.', evidence: tinyRuns.map((t) => excerpt(t)).slice(0, 4).join('\n') })
    out.text.push({ label: 'tiny text', text: tinyRuns.join('\n') })
  }

  const cx = await readText(zip, 'word/comments.xml', PART_LIMIT)
  const cdoc = cx ? parseXml(cx) : null
  if (cdoc) {
    const comments = els(cdoc, 'w:comment')
    if (comments.length) {
      pushFlag(out, 'has_comments')
      out.metadata.comments = comments.length
      const authors = [...new Set(comments.map((c) => attr(c, 'w:author')).filter(Boolean) as string[])]
      const bodies = comments.map((c) => `${attr(c, 'w:author') ?? '?'}: ${excerpt(runText(c))}`)
      out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_comments', where: 'word/comments.xml', title: `${plural(comments.length, 'reviewer comment')} by ${authors.join(', ')}`, detail: 'Comments ship with the document and are visible to anyone who opens it with markup on.', evidence: bodies.slice(0, 4).join('\n') })
      out.text.push({ label: 'comments', text: bodies.join('\n') })
      for (const c of comments) {
        const d = attr(c, 'w:date')
        if (d && !Number.isNaN(Date.parse(d))) out.dates.push({ path, when: new Date(d).toISOString(), what: `comment by ${attr(c, 'w:author') ?? '?'}`, source: 'word/comments.xml' })
      }
    }
  }

  const settings = await readText(zip, 'word/settings.xml', 2_000_000)
  const sdoc = settings ? parseXml(settings) : null
  if (sdoc) {
    const rsids = els(sdoc, 'w:rsid').length
    if (rsids) {
      out.metadata.revisionSessions = rsids
      pushFlag(out, 'has_revision_history')
      out.findings.push({ category: 'info', severity: 'info', flag: 'has_revision_history', where: 'word/settings.xml', title: `${plural(rsids, 'editing session identifier')} (rsid)`, detail: 'Word records an identifier per editing session. They reveal how many separate sessions produced the document and link paragraphs to sessions.' })
    }
    if (els(sdoc, 'w:trackRevisions').length) out.metadata.trackRevisionsOn = true
    if (els(sdoc, 'w:documentProtection').length) out.metadata.documentProtection = true
  }
  const headersFooters = Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))
  for (const hf of headersFooters) {
    const t = await readText(zip, hf, 1_000_000)
    const d = t ? parseXml(t) : null
    if (!d) continue
    const s = els(d, 'w:t').map((x) => x.textContent ?? '').join(' ').trim()
    if (s) out.text.push({ label: hf.replace('word/', '').replace('.xml', ''), text: s })
  }
  return out
}

// ------------------------------------------------------------ Excel

export async function inspectXlsx(zip: JSZip, path: string): Promise<OoxmlResult> {
  const out: OoxmlResult = { metadata: {}, flags: [], findings: [], dates: [], text: [], notes: [] }
  await packageProps(zip, out, path)
  await macrosAndEmbeddings(zip, out, 'xl')
  const relsPaths = Object.keys(zip.files).filter((n) => n.startsWith('xl/') && n.endsWith('.rels'))
  await externalLinks(zip, out, relsPaths)
  const wb = await readText(zip, 'xl/workbook.xml', PART_LIMIT)
  const wdoc = wb ? parseXml(wb) : null
  if (!wdoc) {
    out.notes.push('xl/workbook.xml missing or unparseable')
    return out
  }
  const relText = await readText(zip, 'xl/_rels/workbook.xml.rels', 1_000_000)
  const rdoc = relText ? parseXml(relText) : null
  const relMap = new Map<string, string>()
  if (rdoc) for (const r of els(rdoc, 'Relationship')) relMap.set(attr(r, 'Id') ?? '', attr(r, 'Target') ?? '')
  const shared: string[] = []
  const sst = await readText(zip, 'xl/sharedStrings.xml', PART_LIMIT)
  const sdoc = sst ? parseXml(sst) : null
  if (sdoc) for (const si of els(sdoc, 'si')) shared.push(els(si, 't').map((t) => t.textContent ?? '').join(''))

  const sheets = els(wdoc, 'sheet')
  const hidden: string[] = []
  let hiddenRows = 0
  let hiddenCols = 0
  out.metadata.sheets = sheets.length
  for (const sh of sheets) {
    const name = attr(sh, 'name') ?? 'sheet'
    const state = attr(sh, 'state')
    if (state === 'hidden' || state === 'veryHidden') hidden.push(`${name}${state === 'veryHidden' ? ' (veryHidden)' : ''}`)
    const rid = attr(sh, 'r:id') ?? ''
    let target = relMap.get(rid) ?? ''
    if (!target) continue
    if (!target.startsWith('xl/')) target = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const sx = await readText(zip, target, PART_LIMIT)
    const sheetDoc = sx ? parseXml(sx) : null
    if (!sheetDoc) continue
    for (const col of els(sheetDoc, 'col')) if (attr(col, 'hidden') === '1' || attr(col, 'hidden') === 'true') hiddenCols++
    const rows: string[] = []
    let rowCount = 0
    for (const row of els(sheetDoc, 'row')) {
      rowCount++
      const rowHidden = attr(row, 'hidden') === '1' || attr(row, 'hidden') === 'true'
      if (rowHidden) hiddenRows++
      if (rows.length >= 2000) continue
      const cells: string[] = []
      for (const c of els(row, 'c')) {
        const t = attr(c, 't')
        const v = c.getElementsByTagName('v')[0]?.textContent ?? ''
        if (t === 's') cells.push(shared[Number(v)] ?? '')
        else if (t === 'inlineStr') cells.push(els(c, 't').map((x) => x.textContent ?? '').join(''))
        else cells.push(v)
      }
      const line = cells.join('\t').trim()
      if (line) rows.push(rowHidden ? `${line}\t[hidden row]` : line)
    }
    out.text.push({ label: `sheet ${name}${state ? ` [${state}]` : ''}`, text: rows.join('\n') })
    if (rowCount > 2000) out.notes.push(`sheet ${name}: only the first 2000 rows were read`)
  }
  if (hidden.length) {
    pushFlag(out, 'has_hidden_sheets')
    out.metadata.hiddenSheets = hidden.length
    out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_hidden_sheets', where: 'xl/workbook.xml', title: `${plural(hidden.length, 'hidden sheet')}: ${hidden.join(', ')}`, detail: 'Hidden and veryHidden sheets do not show as tabs but ship with the workbook and are one Unhide away. veryHidden needs the VBA editor, which is why people use it to stash data.' })
  }
  if (hiddenRows || hiddenCols) {
    pushFlag(out, 'has_hidden_rows_cols')
    out.metadata.hiddenRows = hiddenRows
    out.metadata.hiddenColumns = hiddenCols
    out.findings.push({ category: 'hidden', severity: 'medium', flag: 'has_hidden_rows_cols', where: 'worksheets', title: `Hidden rows/columns: ${plural(hiddenRows, 'row')}, ${plural(hiddenCols, 'column')}`, detail: 'Hidden rows and columns still contain their values. Recipients can unhide them in one click.' })
  }
  const dn = els(wdoc, 'definedName').filter((d) => attr(d, 'hidden') === '1')
  if (dn.length) out.metadata.hiddenDefinedNames = dn.length
  return out
}

// ------------------------------------------------------------ PowerPoint

export async function inspectPptx(zip: JSZip, path: string): Promise<OoxmlResult> {
  const out: OoxmlResult = { metadata: {}, flags: [], findings: [], dates: [], text: [], notes: [] }
  await packageProps(zip, out, path)
  await macrosAndEmbeddings(zip, out, 'ppt')
  const relsPaths = Object.keys(zip.files).filter((n) => n.startsWith('ppt/') && n.endsWith('.rels'))
  await externalLinks(zip, out, relsPaths)
  const pres = await readText(zip, 'ppt/presentation.xml', PART_LIMIT)
  const pdoc = pres ? parseXml(pres) : null
  const relText = await readText(zip, 'ppt/_rels/presentation.xml.rels', 1_000_000)
  const rdoc = relText ? parseXml(relText) : null
  const relMap = new Map<string, string>()
  if (rdoc) for (const r of els(rdoc, 'Relationship')) relMap.set(attr(r, 'Id') ?? '', attr(r, 'Target') ?? '')
  const order: string[] = []
  if (pdoc) {
    for (const s of els(pdoc, 'p:sldId')) {
      const t = relMap.get(attr(s, 'r:id') ?? '')
      if (t) order.push(t.startsWith('/') ? t.slice(1) : `ppt/${t}`)
    }
  }
  if (!order.length) order.push(...Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort())
  const hiddenSlides: number[] = []
  out.metadata.slides = order.length
  for (let i = 0; i < order.length; i++) {
    const sx = await readText(zip, order[i], PART_LIMIT)
    const sdoc = sx ? parseXml(sx) : null
    if (!sdoc) continue
    const root = sdoc.documentElement
    const isHidden = attr(root, 'show') === '0'
    if (isHidden) hiddenSlides.push(i + 1)
    const text = els(sdoc, 'a:p').map((p) => els(p, 'a:t').map((t) => t.textContent ?? '').join('')).filter((s) => s.trim()).join('\n')
    out.text.push({ label: `slide ${i + 1}${isHidden ? ' [hidden]' : ''}`, text })
    const relPath = order[i].replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')
    const rt = await readText(zip, relPath, 500_000)
    const rd = rt ? parseXml(rt) : null
    if (!rd) continue
    for (const r of els(rd, 'Relationship')) {
      if (!(attr(r, 'Type') ?? '').endsWith('/notesSlide')) continue
      const target = (attr(r, 'Target') ?? '').replace(/^\.\.\//, 'ppt/')
      const nt = await readText(zip, target, PART_LIMIT)
      const nd = nt ? parseXml(nt) : null
      if (!nd) continue
      const notes = els(nd, 'a:p').map((p) => els(p, 'a:t').map((t) => t.textContent ?? '').join('')).filter((s) => s.trim() && !/^\d+$/.test(s.trim())).join('\n')
      if (notes.trim()) {
        out.text.push({ label: `notes ${i + 1}`, text: notes })
        pushFlag(out, 'has_speaker_notes')
        out.findings.push({ category: 'hidden', severity: 'medium', flag: 'has_speaker_notes', where: `slide ${i + 1}`, title: `Speaker notes on slide ${i + 1}`, detail: 'Notes are not shown during a presentation but ship with the file and print in notes view.', evidence: excerpt(notes) })
      }
    }
  }
  if (hiddenSlides.length) {
    pushFlag(out, 'has_hidden_slides')
    out.metadata.hiddenSlides = hiddenSlides.length
    out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_hidden_slides', where: `slide ${hiddenSlides.join(', ')}`, title: `${plural(hiddenSlides.length, 'hidden slide')} (${hiddenSlides.join(', ')})`, detail: 'Hidden slides are skipped in slideshow mode but remain in the deck for anyone who opens it in the editor.' })
  }
  return out
}

// ------------------------------------------------------------ OpenDocument

export async function inspectOdf(zip: JSZip, path: string): Promise<OoxmlResult> {
  const out: OoxmlResult = { metadata: {}, flags: [], findings: [], dates: [], text: [], notes: [] }
  const meta = await readText(zip, 'meta.xml', 1_000_000)
  const mdoc = meta ? parseXml(meta) : null
  if (mdoc) {
    const fields: [string, string][] = [['meta:initial-creator', 'author'], ['dc:creator', 'lastModifiedBy'], ['meta:creation-date', 'created'], ['dc:date', 'modified'], ['meta:generator', 'application'], ['meta:editing-cycles', 'revision'], ['dc:title', 'title']]
    for (const [q, key] of fields) {
      const v = firstText(mdoc, q)
      if (v) out.metadata[key] = v
    }
    if (out.metadata.author || out.metadata.lastModifiedBy) {
      pushFlag(out, 'has_author')
      out.findings.push({ category: 'privacy', severity: 'medium', flag: 'has_author', where: 'meta.xml', title: 'Author names stored in document metadata', detail: `Creator "${out.metadata.author ?? '-'}", last edited by "${out.metadata.lastModifiedBy ?? '-'}".` })
    }
    for (const key of ['created', 'modified'] as const) {
      const v = out.metadata[key]
      if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) out.dates.push({ path, when: new Date(v).toISOString(), what: `document ${key}`, source: 'meta.xml' })
    }
  }
  const content = await readText(zip, 'content.xml', PART_LIMIT)
  const cdoc = content ? parseXml(content) : null
  if (cdoc) {
    const paras = [...els(cdoc, 'text:p'), ...els(cdoc, 'text:h')].map((p) => p.textContent ?? '').filter((s) => s.trim())
    out.text.push({ label: 'body', text: paras.join('\n') })
    const changes = els(cdoc, 'text:tracked-changes')
    const regions = changes.length ? els(changes[0], 'text:changed-region').length : 0
    if (regions) {
      pushFlag(out, 'has_tracked_changes')
      out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_tracked_changes', where: 'content.xml', title: `Tracked changes (${plural(regions, 'region')})`, detail: 'Change history is stored in the document.' })
    }
    const annotations = els(cdoc, 'office:annotation')
    if (annotations.length) {
      pushFlag(out, 'has_comments')
      out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_comments', where: 'content.xml', title: plural(annotations.length, 'comment'), detail: 'Comments ship with the document.', evidence: annotations.map((a) => excerpt(a.textContent ?? '')).slice(0, 3).join('\n') })
    }
  }
  return out
}
