import type { DateEvent, Finding, Flag, TextUnit } from './types'

export interface PdfResult {
  metadata: Record<string, string | number | boolean | null>
  flags: Flag[]
  findings: Omit<Finding, 'id' | 'path' | 'source'>[]
  dates: DateEvent[]
  text: TextUnit[]
  notes: string[]
}

const PAGE_LIMIT = 60

type PdfJs = typeof import('pdfjs-dist')
let pdfjsPromise: Promise<PdfJs> | null = null

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import('pdfjs-dist')
      if (typeof window !== 'undefined') {
        const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
        lib.GlobalWorkerOptions.workerSrc = worker
      }
      return lib
    })()
  }
  return pdfjsPromise
}

function pdfDate(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s)
  if (!m) return Number.isNaN(Date.parse(s)) ? null : new Date(s).toISOString()
  const [, y, mo = '01', d = '01', h = '00', mi = '00', sec = '00', tz, tzh = '00', tzm = '00'] = m
  const offset = tz === 'Z' || tz === 'z' || !tz ? 'Z' : `${tz}${tzh}:${tzm}`
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${sec}${offset}`
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString()
}

export interface PdfStructure {
  eofCount: number
  trailingBytes: number
  hasJs: boolean
  hasEmbeddedFiles: boolean
  hasOpenAction: boolean
  encrypted: boolean
}

/** Structure-level facts that need no parser: revisions, trailing data, JavaScript strings. */
export function pdfStructure(bytes: Uint8Array): PdfStructure {
  const latin = new TextDecoder('latin1').decode(bytes.length > 12_000_000 ? bytes.subarray(0, 12_000_000) : bytes)
  const eofCount = (latin.match(/%%EOF/g) ?? []).length
  const lastEof = latin.lastIndexOf('%%EOF')
  const afterEof = lastEof < 0 ? '' : latin.slice(lastEof + 5)
  const trailingBytes = afterEof.replace(/^[\r\n\s]*/, '').length
  return {
    eofCount,
    trailingBytes,
    hasJs: /\/JavaScript|\/JS\s*[(<[]/.test(latin),
    hasEmbeddedFiles: /\/EmbeddedFiles|\/FileAttachment/.test(latin),
    hasOpenAction: /\/OpenAction|\/AA\s*<</.test(latin),
    encrypted: /\/Encrypt\s/.test(latin),
  }
}

function pushFlag(out: PdfResult, flag: Flag) {
  if (!out.flags.includes(flag)) out.flags.push(flag)
}

export async function inspectPdf(bytes: Uint8Array, path: string): Promise<PdfResult> {
  const out: PdfResult = { metadata: {}, flags: [], findings: [], dates: [], text: [], notes: [] }
  const structure = pdfStructure(bytes)
  if (structure.eofCount > 1) {
    pushFlag(out, 'has_revision_history')
    out.metadata.revisions = structure.eofCount
    out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_revision_history', where: 'file structure', title: `${structure.eofCount} saved revisions (incremental updates)`, detail: 'Each incremental save appends to the file and keeps the previous version byte-for-byte. Earlier content, including "removed" text or annotations, can be recovered by truncating at an earlier %%EOF.' })
  }
  if (structure.trailingBytes > 16) {
    pushFlag(out, 'has_trailing_data')
    out.metadata.trailingBytes = structure.trailingBytes
    out.findings.push({ category: 'integrity', severity: 'high', flag: 'has_trailing_data', where: 'after %%EOF', title: `${structure.trailingBytes} bytes after the final %%EOF`, detail: 'Readers ignore bytes after the end marker; anything there is a hidden payload.' })
  }
  if (structure.hasJs) {
    pushFlag(out, 'has_javascript')
    out.findings.push({ category: 'security', severity: 'high', flag: 'has_javascript', where: 'objects', title: 'Embedded JavaScript', detail: 'The PDF contains script actions. Scripts can run when the document opens in viewers that support them.' })
  }
  if (structure.hasOpenAction) out.findings.push({ category: 'security', severity: 'medium', where: 'catalog', title: 'Open action or additional-actions dictionary', detail: 'Something is set to trigger automatically when the document opens or a page is viewed.' })
  if (structure.encrypted) {
    pushFlag(out, 'encrypted')
    out.metadata.encrypted = true
  }
  let lib: PdfJs
  try {
    lib = await loadPdfJs()
  } catch (error) {
    out.notes.push(`pdf.js unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return out
  }
  let doc: import('pdfjs-dist').PDFDocumentProxy
  const task = lib.getDocument({ data: bytes.slice(), disableFontFace: true, stopAtErrors: false, ...(typeof window !== 'undefined' ? { standardFontDataUrl: '/pdfjs/standard_fonts/' } : {}) })
  // A wedged parser must never stall the whole inspection queue.
  const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('pdf parse timed out after 45 s')), 45_000))
  try {
    doc = await Promise.race([task.promise, deadline])
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (/password/i.test(msg)) {
      pushFlag(out, 'encrypted')
      out.findings.push({ category: 'info', severity: 'info', flag: 'encrypted', where: 'trailer', title: 'Password-protected PDF', detail: 'Content cannot be read without the password. Metadata may still be readable.' })
    } else out.notes.push(`pdf parse failed: ${msg}`)
    return out
  }
  try {
    out.metadata.pages = doc.numPages
    const meta = await doc.getMetadata().catch(() => null)
    const info = (meta?.info ?? {}) as Record<string, unknown>
    const fields: [string, string][] = [['Title', 'title'], ['Author', 'author'], ['Subject', 'subject'], ['Keywords', 'keywords'], ['Creator', 'creator'], ['Producer', 'producer'], ['PDFFormatVersion', 'pdfVersion']]
    for (const [k, as] of fields) {
      const v = info[k]
      if (typeof v === 'string' && v.trim()) out.metadata[as] = v.trim().slice(0, 300)
    }
    const created = pdfDate(info.CreationDate)
    const modified = pdfDate(info.ModDate)
    if (created) {
      out.metadata.created = created
      out.dates.push({ path, when: created, what: 'PDF created', source: 'Info dictionary' })
    }
    if (modified) {
      out.metadata.modified = modified
      out.dates.push({ path, when: modified, what: 'PDF modified', source: 'Info dictionary' })
    }
    if (info.IsAcroFormPresent) out.metadata.hasForm = true
    if (info.IsXFAPresent) out.metadata.hasXfa = true
    const xmpRaw = meta?.metadata ? (meta.metadata as { getRaw?: () => string }).getRaw?.() : null
    if (xmpRaw) {
      pushFlag(out, 'has_xmp')
      out.metadata.xmpBytes = xmpRaw.length
      const creatorTool = /<xmp:CreatorTool>([^<]+)</.exec(xmpRaw)?.[1]
      const xmpCreator = /<rdf:li[^>]*>([^<]+)<\/rdf:li>/.exec(xmpRaw.split('dc:creator')[1] ?? '')?.[1]
      if (creatorTool) out.metadata.xmpCreatorTool = creatorTool.slice(0, 200)
      if (xmpCreator) out.metadata.xmpCreator = xmpCreator.slice(0, 200)
      const infoAuthor = out.metadata.author
      if (xmpCreator && infoAuthor && xmpCreator !== infoAuthor) {
        out.findings.push({ category: 'hidden', severity: 'medium', where: 'XMP vs Info', title: 'XMP metadata disagrees with the Info dictionary', detail: `Info says author "${infoAuthor}", XMP says "${xmpCreator}". Editing one store and not the other leaves the original name behind.` })
      }
      const ids = [...xmpRaw.matchAll(/(?:DocumentID|InstanceID|OriginalDocumentID)="?([^"<\s]+)/g)].map((m) => m[1])
      if (ids.length) out.metadata.xmpDocumentIds = ids.length
    }
    if (out.metadata.author || out.metadata.xmpCreator) {
      pushFlag(out, 'has_author')
      out.findings.push({ category: 'privacy', severity: 'medium', flag: 'has_author', where: 'Info/XMP', title: 'Author name stored in document metadata', detail: `Author "${out.metadata.author ?? out.metadata.xmpCreator}"${out.metadata.creator ? `, created with ${out.metadata.creator}` : ''}${out.metadata.xmpCreatorTool && out.metadata.xmpCreatorTool !== out.metadata.creator ? ` (XMP: ${out.metadata.xmpCreatorTool})` : ''}.` })
    }
    const attachments = await doc.getAttachments().catch(() => null)
    if (attachments && Object.keys(attachments).length) {
      pushFlag(out, 'has_embedded_files')
      const names = Object.keys(attachments)
      out.metadata.embeddedFiles = names.length
      out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_embedded_files', where: 'EmbeddedFiles', title: `${names.length} embedded file${names.length === 1 ? '' : 's'}: ${names.slice(0, 4).join(', ')}`, detail: 'Files attached inside the PDF are complete documents that travel with it, often unnoticed.' })
    }
    const OPS = lib.OPS
    let invisibleChars = 0
    let whiteChars = 0
    let offPageChars = 0
    const invisibleSamples: string[] = []
    const whiteSamples: string[] = []
    const offPageSamples: string[] = []
    const pages = Math.min(doc.numPages, PAGE_LIMIT)
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const lines: string[] = []
      let lastY: number | null = null
      let current = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        const y = Math.round(item.transform[5])
        const x = item.transform[4]
        const outside = x < -5 || y < -5 || x > viewport.width + 5 || y > viewport.height + 5
        if (outside && item.str.trim()) {
          offPageChars += item.str.length
          if (offPageSamples.length < 3) offPageSamples.push(item.str.slice(0, 120))
          continue
        }
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          lines.push(current)
          current = ''
        }
        current += (current && !current.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') + item.str
        lastY = y
      }
      if (current) lines.push(current)
      out.text.push({ label: `page ${p}`, text: lines.filter((l) => l.trim()).join('\n') })
      try {
        const ops = await page.getOperatorList()
        let mode = 0
        let fillWhite = false
        const stack: { mode: number; fillWhite: boolean }[] = []
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i]
          const args = ops.argsArray[i] as unknown[]
          if (fn === OPS.save) stack.push({ mode, fillWhite })
          else if (fn === OPS.restore) {
            const s = stack.pop()
            if (s) {
              mode = s.mode
              fillWhite = s.fillWhite
            }
          } else if (fn === OPS.setTextRenderingMode) mode = Number(args[0])
          else if (fn === OPS.setFillRGBColor) fillWhite = Number(args[0]) > 0.94 && Number(args[1]) > 0.94 && Number(args[2]) > 0.94
          else if (fn === OPS.setFillGray) fillWhite = Number(args[0]) > 0.94
          else if (fn === OPS.setFillCMYKColor) fillWhite = Number(args[0]) < 0.06 && Number(args[1]) < 0.06 && Number(args[2]) < 0.06 && Number(args[3]) < 0.06
          else if (fn === OPS.showText || fn === OPS.showSpacedText) {
            const glyphs = (Array.isArray(args[0]) ? (args[0] as unknown[]) : []).flatMap((g) => (Array.isArray(g) ? g : [g]))
            let s = ''
            for (const g of glyphs) {
              if (g && typeof g === 'object' && 'unicode' in g) s += (g as { unicode: string }).unicode
            }
            if (!s.trim()) continue
            if (mode === 3 || mode === 7) {
              invisibleChars += s.length
              if (invisibleSamples.length < 3) invisibleSamples.push(s.slice(0, 120))
            } else if (fillWhite && (mode === 0 || mode === 2 || mode === 4 || mode === 6)) {
              whiteChars += s.length
              if (whiteSamples.length < 3) whiteSamples.push(s.slice(0, 120))
            }
          }
        }
      } catch (error) {
        out.notes.push(`page ${p}: operator scan failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      page.cleanup()
    }
    if (doc.numPages > pages) out.notes.push(`only the first ${pages} of ${doc.numPages} pages were read`)
    if (invisibleChars) {
      pushFlag(out, 'has_hidden_text')
      out.metadata.invisibleTextChars = invisibleChars
      out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_hidden_text', where: 'content streams', title: `Invisible text: ${invisibleChars} characters drawn in render mode 3/7`, detail: 'Text in render mode 3 is not painted but is selectable, searchable, and extracted by every text tool. OCR layers use it legitimately; so do people hiding notes.', evidence: invisibleSamples.join('\n') })
      out.text.push({ label: 'invisible text', text: invisibleSamples.join('\n') })
    }
    if (whiteChars) {
      pushFlag(out, 'has_hidden_text')
      out.metadata.whiteTextChars = whiteChars
      out.findings.push({ category: 'hidden', severity: 'high', flag: 'has_hidden_text', where: 'content streams', title: `White text: ${whiteChars} characters filled white`, detail: 'Text painted white on a white page is invisible on screen and paper and fully copyable.', evidence: whiteSamples.join('\n') })
      out.text.push({ label: 'white text', text: whiteSamples.join('\n') })
    }
    if (offPageChars) {
      pushFlag(out, 'has_hidden_text')
      out.metadata.offPageTextChars = offPageChars
      out.findings.push({ category: 'hidden', severity: 'medium', flag: 'has_hidden_text', where: 'outside MediaBox', title: `Text positioned outside the page: ${offPageChars} characters`, detail: 'Content drawn beyond the page boundary never renders but stays in the file.', evidence: offPageSamples.join('\n') })
      out.text.push({ label: 'off-page text', text: offPageSamples.join('\n') })
    }
    const js = await (doc as unknown as { getJSActions?: () => Promise<unknown> }).getJSActions?.().catch(() => null)
    if (js && !out.flags.includes('has_javascript')) {
      pushFlag(out, 'has_javascript')
      out.findings.push({ category: 'security', severity: 'high', flag: 'has_javascript', where: 'document actions', title: 'Document-level JavaScript actions', detail: 'Scripts attached to the document run in viewers that support them.' })
    }
  } finally {
    await task.destroy().catch(() => undefined)
  }
  return out
}
