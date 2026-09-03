import { RECEIPT_SCHEMA, type Finding, type Flag, type InputFile, type Receipt, type TextUnit, CLI_COMMANDS } from './types'
import { extensionOf, kindInfo, ZIP_BASED } from './kinds'
import { fromMagic, resolveKind } from './detect'
import { sha256Hex } from './hash'
import { listZip, classifyZip, zipTrailingBytes, type ZipListing } from './zip'
import { inspectDocx, inspectXlsx, inspectPptx, inspectOdf, type PartialFinding } from './ooxml'
import { inspectImage } from './image'
import { inspectEmail } from './email'
import { inspectPdf } from './pdf'
import { decodeText, scanHiddenChars, scanInjection, scanPii, scanSecrets } from './text'
import { extractStrings } from './strings'
import { parsePe } from './pe'

export interface InspectOptions {
  depth?: number
  maxDepth?: number
  /** Shared budget for nested container inspection across the whole tree. */
  nestedBudget?: { count: number; bytes: number }
}

let findingCounter = 0
export function nextFindingId(): string {
  return `f${++findingCounter}`
}

const NESTED_MAX_DEPTH = 2
const NESTED_MAX_COUNT = 40
const NESTED_MAX_BYTES = 40_000_000
const TEXT_SCAN_CHARS = 600_000
const FORMAT_PAGE_BASE = 'https://universalfileopener.com/formats/'

function finalize(path: string, partial: PartialFinding): Finding {
  return { id: nextFindingId(), path, source: 'scan', ...partial }
}

function addFlag(receipt: Receipt, flag: Flag) {
  if (!receipt.flags.includes(flag)) receipt.flags.push(flag)
}

function isArchiveKind(kind: string): boolean {
  return kindInfo(kind).family === 'archive'
}

export async function inspectFile(file: InputFile, opts: InspectOptions = {}): Promise<Receipt> {
  const depth = opts.depth ?? 0
  const maxDepth = opts.maxDepth ?? NESTED_MAX_DEPTH
  const budget = opts.nestedBudget ?? { count: NESTED_MAX_COUNT, bytes: NESTED_MAX_BYTES }
  const bytes = file.bytes
  const ext = extensionOf(file.name)
  const errors: string[] = []
  const sha256 = await sha256Hex(bytes)
  const magic = fromMagic(bytes)

  let listing: ZipListing | null = null
  let containerKind: string | null = null
  if (magic.kind === 'zip' && bytes.length > 0) {
    try {
      listing = await listZip(bytes)
      containerKind = await classifyZip(listing)
    } catch (error) {
      errors.push(`zip: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const resolved = resolveKind(ext, magic, containerKind)
  const info = kindInfo(resolved.kind)
  const receipt: Receipt = {
    schema: RECEIPT_SCHEMA,
    path: file.path,
    name: file.name,
    extension: ext ?? '',
    sizeBytes: bytes.length,
    sha256,
    lastModifiedMillis: file.lastModified,
    kind: resolved.kind,
    family: info.family,
    label: info.label,
    nameSaysKind: resolved.nameSaysKind,
    bytesSayKind: resolved.bytesSayKind,
    nameAndBytesDisagree: resolved.nameAndBytesDisagree,
    detection: { method: resolved.method, strength: resolved.strength, note: resolved.note },
    metadata: {},
    dates: [],
    flags: [],
    findings: [],
    notAvailableInWeb: [],
    formatPage: info.page ? `${FORMAT_PAGE_BASE}${info.page}/` : undefined,
    errors,
    inspectedAt: new Date().toISOString(),
    depth,
  }
  if (file.lastModified) {
    receipt.dates.push({ path: file.path, when: new Date(file.lastModified).toISOString(), what: 'file modified (filesystem)', source: 'browser File API' })
  }
  const units: TextUnit[] = []
  let textTruncated = false

  if (resolved.nameAndBytesDisagree) {
    addFlag(receipt, 'type_mismatch')
    const bytesInfo = kindInfo(resolved.bytesSayKind ?? 'binary')
    const nameInfo = kindInfo(resolved.nameSaysKind ?? 'binary')
    const dangerous = bytesInfo.family === 'executable' || bytesInfo.family === 'archive'
    receipt.findings.push(finalize(file.path, {
      category: 'integrity', severity: dangerous ? 'high' : 'medium', flag: 'type_mismatch', where: 'header',
      title: `Name says ${nameInfo.label}, bytes say ${bytesInfo.label}`,
      detail: dangerous
        ? 'The extension misrepresents the content. Renamed executables and archives are the standard way to get a payload past a glance.'
        : 'The extension does not match the content. Often harmless (a renamed export), sometimes a disguise. Open it as what it really is.',
    }))
  }
  if (info.family === 'executable') {
    addFlag(receipt, 'has_executable')
    receipt.findings.push(finalize(file.path, { category: 'security', severity: 'high', flag: 'has_executable', where: 'header', title: `Executable code (${info.label})`, detail: 'This file is a program, not a document. Do not open it to "see what it is"; inspect it here or in a sandbox.' }))
  }
  if (resolved.kind === 'empty') {
    receipt.findings.push(finalize(file.path, { category: 'info', severity: 'info', title: 'Empty file', detail: 'Zero bytes. Nothing to inspect.' }))
  }

  try {
    if (listing) {
      await inspectContainer(receipt, listing, file, depth, maxDepth, budget, units)
    } else if (resolved.kind === 'pdf') {
      const r = await inspectPdf(bytes, file.path)
      merge(receipt, r.metadata, r.flags, r.findings, r.dates, r.notes)
      units.push(...r.text)
    } else if (info.family === 'image') {
      const r = await inspectImage(bytes, resolved.kind, file.path)
      merge(receipt, r.metadata, r.flags, r.findings, r.dates, r.notes)
    } else if (resolved.kind === 'eml') {
      const decoded = decodeText(bytes)
      textTruncated = decoded.truncated
      const r = inspectEmail(decoded.text, file.path)
      merge(receipt, r.metadata, r.flags, r.findings, r.dates, [])
      units.push(...r.text)
    } else if (['text', 'code', 'certificate'].includes(info.family) || ['svg', 'rtf'].includes(resolved.kind)) {
      const decoded = decodeText(bytes)
      textTruncated = decoded.truncated
      receipt.metadata.encoding = decoded.encoding
      if (decoded.hadBom) receipt.metadata.byteOrderMark = true
      receipt.metadata.lines = decoded.text.split('\n').length
      units.push({ label: 'content', text: decoded.text })
      if (resolved.kind === 'pem' && /PRIVATE KEY/.test(decoded.text)) {
        addFlag(receipt, 'has_secrets')
        receipt.findings.push(finalize(file.path, { category: 'security', severity: 'high', flag: 'has_secrets', where: 'content', title: 'Private key material', detail: 'The file contains a PEM private key block.' }))
      }
    } else if (['executable', 'binary', 'unknown', 'database', 'font', 'audio', 'video'].includes(info.family) && bytes.length > 0) {
      const { strings, truncated } = extractStrings(bytes)
      if (strings.length) {
        units.push({ label: 'strings', text: strings.join('\n') })
        textTruncated = truncated
        receipt.metadata.printableStrings = strings.length
      }
      if (resolved.kind === 'exe') {
        const pe = parsePe(bytes)
        if (pe) {
          receipt.metadata.peMachine = pe.machine
          receipt.metadata.peType = pe.isDll ? 'DLL' : 'executable'
          receipt.metadata.peSubsystem = pe.subsystem
          receipt.metadata.peSections = pe.sections.join(',') || null
          if (pe.compiledAt) {
            receipt.metadata.peCompiledAt = pe.compiledAt
            receipt.dates.push({ path: file.path, when: pe.compiledAt, what: 'executable linked (PE timestamp)', source: 'PE header' })
          }
          receipt.findings.push(finalize(file.path, { category: 'info', severity: 'info', where: 'PE header', title: `${pe.is64 ? '64-bit' : '32-bit'} ${pe.machine} ${pe.isDll ? 'DLL' : 'program'}, ${pe.subsystem}${pe.compiledAt ? `, linked ${pe.compiledAt.slice(0, 10)}` : ''}`, detail: pe.note ?? `Sections: ${pe.sections.join(', ') || 'none'}. The link timestamp is set by the compiler and often survives renaming and repacking.` }))
        }
      }
    } else if (resolved.kind === 'ole' || ['doc', 'xls', 'ppt', 'msg'].includes(resolved.kind)) {
      receipt.notAvailableInWeb.push(`Legacy OLE container (${info.label}): metadata and content parsing run in the UFO apps and the ufo CLI, not in the browser edition. Reproduce: ${CLI_COMMANDS.inspect}`)
      receipt.findings.push(finalize(file.path, { category: 'info', severity: 'low', where: 'header', title: `${info.label}: not parsed in the browser edition`, detail: 'Legacy binary Office and Outlook formats carry author names, revision logs, and embedded objects too. Inspect them with the UFO desktop app or ufo inspect.' }))
    }
  } catch (error) {
    errors.push(`inspect: ${error instanceof Error ? error.message : String(error)}`)
    addFlag(receipt, 'parse_error')
  }

  if (units.length) {
    const chars = units.reduce((n, u) => n + u.text.length, 0)
    receipt.text = { chars, units, truncated: textTruncated }
    scanText(receipt, units, info.family, resolved.kind)
  }
  receipt.notAvailableInWeb.push(...capabilities(resolved.kind, info.family))
  receipt.findings.sort((a, b) => rank(b.severity) - rank(a.severity))
  return receipt
}

function rank(s: Finding['severity']): number {
  return { high: 3, medium: 2, low: 1, info: 0 }[s]
}

function merge(receipt: Receipt, metadata: Record<string, string | number | boolean | null>, flags: Flag[], findings: PartialFinding[], dates: Receipt['dates'], notes: string[]) {
  Object.assign(receipt.metadata, metadata)
  for (const f of flags) addFlag(receipt, f)
  for (const f of findings) receipt.findings.push(finalize(receipt.path, f))
  receipt.dates.push(...dates)
  receipt.errors.push(...notes)
}

async function inspectContainer(receipt: Receipt, listing: ZipListing, file: InputFile, depth: number, maxDepth: number, budget: { count: number; bytes: number }, units: TextUnit[]) {
  const kind = receipt.kind
  const trailing = zipTrailingBytes(file.bytes)
  receipt.container = {
    format: kind,
    entryCount: listing.entryCount,
    entries: listing.entries,
    entriesTruncated: listing.truncated,
    nested: [],
    nestedTruncated: false,
  }
  if (listing.encryptedEntries) {
    addFlag(receipt, 'encrypted')
    receipt.metadata.encryptedEntries = listing.encryptedEntries
    receipt.findings.push(finalize(file.path, { category: 'info', severity: 'medium', flag: 'encrypted', where: 'local headers', title: `${listing.encryptedEntries} password-protected entr${listing.encryptedEntries === 1 ? 'y' : 'ies'}`, detail: 'Names and sizes are visible; contents are not readable without the password. Encrypted archives are also how malware is delivered past scanners.' }))
  }
  if (trailing > 0) {
    addFlag(receipt, 'has_trailing_data')
    receipt.metadata.trailingBytes = trailing
    receipt.findings.push(finalize(file.path, { category: 'integrity', severity: 'high', flag: 'has_trailing_data', where: 'after end-of-central-directory', title: `${trailing} bytes after the archive ends`, detail: 'ZIP readers stop at the central directory record. Appended data is invisible to them.' }))
  }
  if (['docx', 'docm'].includes(kind)) {
    const r = await inspectDocx(listing.zip, file.path)
    merge(receipt, r.metadata, r.flags, r.findings, r.dates, r.notes)
    units.push(...r.text)
    return
  }
  if (['xlsx', 'xlsm'].includes(kind)) {
    const r = await inspectXlsx(listing.zip, file.path)
    merge(receipt, r.metadata, r.flags, r.findings, r.dates, r.notes)
    units.push(...r.text)
    return
  }
  if (['pptx', 'pptm'].includes(kind)) {
    const r = await inspectPptx(listing.zip, file.path)
    merge(receipt, r.metadata, r.flags, r.findings, r.dates, r.notes)
    units.push(...r.text)
    return
  }
  if (['odt', 'ods', 'odp'].includes(kind)) {
    const r = await inspectOdf(listing.zip, file.path)
    merge(receipt, r.metadata, r.flags, r.findings, r.dates, r.notes)
    units.push(...r.text)
    return
  }
  // Generic archive: look at what is inside, recursively, within budget.
  const files = listing.entries.filter((e) => !e.isDir)
  receipt.metadata.entries = files.length
  receipt.metadata.uncompressedBytes = files.reduce((n, e) => n + e.sizeBytes, 0)
  const suspiciousNames = files.filter((e) => /\.(exe|scr|dll|bat|cmd|ps1|vbs|js|jar|lnk|hta|msi)$/i.test(e.path))
  const traversal = files.filter((e) => /(^|\/)\.\.(\/|$)|^\/|^[A-Za-z]:/.test(e.path))
  if (traversal.length) {
    receipt.findings.push(finalize(file.path, { category: 'security', severity: 'high', where: 'entry names', title: `${traversal.length} entr${traversal.length === 1 ? 'y' : 'ies'} with path traversal names`, detail: 'Entry names that climb out of the extraction folder ("../") or start at a drive root overwrite files elsewhere when extracted carelessly.', evidence: traversal.slice(0, 3).map((e) => e.path).join('\n') }))
  }
  if (depth < maxDepth) {
    for (const entry of files) {
      if (budget.count <= 0 || budget.bytes <= 0) {
        receipt.container.nestedTruncated = true
        break
      }
      if (entry.sizeBytes > budget.bytes) {
        receipt.container.nestedTruncated = true
        continue
      }
      const zf = listing.zip.file(entry.path)
      if (!zf) continue
      let data: Uint8Array
      try {
        data = await zf.async('uint8array')
      } catch (error) {
        receipt.errors.push(`${entry.path}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      budget.count--
      budget.bytes -= data.length
      const nested = await inspectFile({ path: `${file.path}!/${entry.path}`, name: entry.path.split('/').pop() ?? entry.path, bytes: data, lastModified: entry.modified ? Date.parse(entry.modified) : null }, { depth: depth + 1, maxDepth, nestedBudget: budget })
      entry.kind = nested.kind
      receipt.container.nested.push(nested)
      if (isArchiveKind(nested.kind) || (ZIP_BASED.has(nested.kind) && nested.kind === 'zip')) addFlag(receipt, 'has_nested_archive')
      if (nested.flags.includes('has_executable')) addFlag(receipt, 'has_executable')
      for (const flag of nested.flags) if (['has_gps', 'has_author', 'has_macros', 'has_hidden_text', 'has_pii', 'has_secrets'].includes(flag)) addFlag(receipt, flag as Flag)
    }
  } else {
    receipt.container.nestedTruncated = files.length > 0
  }
  if (receipt.flags.includes('has_nested_archive')) {
    const inner = receipt.container.nested.filter((n) => isArchiveKind(n.kind)).map((n) => n.name)
    receipt.findings.push(finalize(file.path, { category: 'hidden', severity: 'medium', flag: 'has_nested_archive', where: 'entries', title: `Archive inside the archive: ${inner.slice(0, 3).join(', ')}`, detail: 'Nested archives defeat casual inspection and most upload scanners. UFO Web opened them; the findings below come from inside.' }))
  }
  if (suspiciousNames.length || receipt.flags.includes('has_executable')) {
    addFlag(receipt, 'has_executable')
    const names = [...new Set([...suspiciousNames.map((e) => e.path), ...receipt.container.nested.filter((n) => n.flags.includes('has_executable')).map((n) => n.path.split('!/').pop() ?? n.name)])]
    receipt.findings.push(finalize(file.path, { category: 'security', severity: 'high', flag: 'has_executable', where: 'entries', title: `Executable inside: ${names.slice(0, 3).join(', ')}`, detail: 'An archive that carries a program is a delivery mechanism, not a document set. Quarantine unless you expected it.' }))
  }
  const nestedFindings = receipt.container.nested.flatMap((n) => n.findings.filter((f) => f.severity === 'high'))
  if (nestedFindings.length) {
    receipt.findings.push(finalize(file.path, { category: 'hidden', severity: 'medium', where: 'nested files', title: `${nestedFindings.length} high-severity finding${nestedFindings.length === 1 ? '' : 's'} inside nested files`, detail: nestedFindings.slice(0, 4).map((f) => `${f.path.split('!/').slice(1).join('!/')}: ${f.title}`).join('; ') }))
  }
}

function scanText(receipt: Receipt, units: TextUnit[], family: string, kind: string) {
  let corpus = ''
  for (const u of units) {
    if (corpus.length >= TEXT_SCAN_CHARS) break
    corpus += `\n[${u.label}]\n${u.text.slice(0, TEXT_SCAN_CHARS - corpus.length)}`
  }
  const isCode = family === 'code' || ['json', 'yaml', 'config', 'xml', 'html', 'markdown', 'csv', 'text', 'log'].includes(kind)
  const hidden = scanHiddenChars(corpus)
  if (hidden.total) {
    addFlag(receipt, 'has_hidden_chars')
    const summary = Object.entries(hidden.counts).map(([k, v]) => `${v}x ${k}`).join(', ')
    const bidi = Object.keys(hidden.counts).some((k) => /bidi|left-to-right|right-to-left/.test(k))
    const severity = family === 'code' && (bidi || hidden.mixedScriptWords.length) ? 'high' : family === 'code' ? 'medium' : bidi ? 'medium' : 'low'
    receipt.findings.push(finalize(receipt.path, {
      category: 'hidden', severity, flag: 'has_hidden_chars', where: hidden.hits[0] ? `line ${hidden.hits[0].line}` : 'content',
      title: `Invisible or look-alike characters: ${summary}`,
      detail: bidi
        ? 'Bidirectional control characters reorder how code and text display versus how they parse ("Trojan Source"). What a reviewer reads is not what runs.'
        : hidden.mixedScriptWords.length
          ? 'Words mixing Latin with Cyrillic or Greek letters look identical on screen but are different strings: two "identical" identifiers or hostnames that never compare equal.'
          : 'Zero-width and control characters are invisible in editors and viewers but present in the bytes. They break comparisons, hide watermarks, or smuggle data.',
      evidence: [...hidden.hits.slice(0, 5).map((h) => `line ${h.line} col ${h.col} ${h.codepoint}: ${h.context}`), ...hidden.mixedScriptWords.slice(0, 3).map((m) => `line ${m.line}: "${m.word}" mixes ${m.scripts.join(' + ')}`)].join('\n'),
    }))
  }
  const pii = scanPii(corpus)
  if (pii.total) {
    addFlag(receipt, 'has_pii')
    const types = Object.entries(pii.counts).map(([k, v]) => `${v}x ${k}`).join(', ')
    const severe = Object.keys(pii.counts).some((k) => /SSN|card|IBAN/.test(k))
    receipt.findings.push(finalize(receipt.path, { category: 'privacy', severity: severe ? 'high' : 'medium', flag: 'has_pii', where: 'content', title: `Personal data patterns: ${types}`, detail: 'Pattern matches, not confirmations. Card numbers passed a checksum, IBANs passed mod-97; emails and phones are shape matches.', evidence: pii.hits.slice(0, 6).map((h) => `line ${h.line}: ${h.type} ${h.masked}`).join('\n') }))
  }
  if (isCode || family === 'text') {
    const secrets = scanSecrets(corpus)
    if (secrets.total) {
      addFlag(receipt, 'has_secrets')
      receipt.findings.push(finalize(receipt.path, { category: 'security', severity: 'high', flag: 'has_secrets', where: 'content', title: `Credential-like strings: ${Object.entries(secrets.counts).map(([k, v]) => `${v}x ${k}`).join(', ')}`, detail: 'Tokens, keys, and password assignments in shared files are the most common accidental disclosure.', evidence: secrets.hits.slice(0, 4).map((h) => `line ${h.line}: ${h.type} ${h.masked}`).join('\n') }))
    }
  }
  const injection = scanInjection(corpus)
  if (injection.length) {
    addFlag(receipt, 'has_injection_text')
    receipt.findings.push(finalize(receipt.path, { category: 'security', severity: 'medium', flag: 'has_injection_text', where: `line ${injection[0].line}`, title: 'Text addressed to AI agents (prompt injection)', detail: 'The file contains instructions aimed at an AI assistant. UFO Web treats all file text as data; approvals are human-only, so the text cannot act. Your agent should ignore it too.', evidence: injection.slice(0, 3).map((h) => `line ${h.line}: ${h.snippet}`).join('\n') }))
  }
}

function capabilities(kind: string, family: string): string[] {
  const out: string[] = []
  out.push(`Batch receipts for a whole tree, identical schema: ${CLI_COMMANDS.inspect}`)
  if (family === 'archive') out.push(`Safe extraction with sanitized paths and password support: ${CLI_COMMANDS.extract}`)
  if (family === 'image') out.push(`Image conversion (PNG/JPEG/BMP): ${CLI_COMMANDS.convert}`)
  if (kind === 'pdf' || family === 'text' || family === 'code') out.push(`Text comparison of two files from the shell: ${CLI_COMMANDS.compare}`)
  if (['document', 'spreadsheet', 'presentation'].includes(family)) out.push('Editing, OCR, redaction, and conversion of Office documents: UFO for Android and Windows, not the browser edition.')
  if (kind === 'pdf') out.push('PDF editing, OCR, redaction, and page tools: UFO for Android and Windows, not the browser edition.')
  return out
}
