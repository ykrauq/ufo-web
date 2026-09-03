import { useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import exifr from 'exifr'
import type { Receipt } from '../core/types'
import { bytesFor } from '../core/workspace'
import { decodeText } from '../core/text'
import { hexDump } from '../core/strings'
import { renderDocx, renderPptx, renderXlsx, esc, type RenderedBook, type RenderedDeck } from '../render/office'
import { highlightCode } from '../render/code'
import { renderPdfPages } from '../render/pdfPages'
import { Icon } from './icons'

type Mode = 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'code' | 'csv' | 'email' | 'media' | 'bytes' | 'archive' | 'none'

function modeFor(r: Receipt): Mode {
  if (['jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'].includes(r.kind)) return 'image'
  if (r.kind === 'pdf') return 'pdf'
  if (['docx', 'docm'].includes(r.kind)) return 'docx'
  if (['xlsx', 'xlsm'].includes(r.kind)) return 'xlsx'
  if (['pptx', 'pptm'].includes(r.kind)) return 'pptx'
  if (r.kind === 'csv') return 'csv'
  if (r.kind === 'eml') return 'email'
  if (r.family === 'code' || r.family === 'text' || r.family === 'certificate' || ['xml', 'html', 'svg', 'rtf'].includes(r.kind)) return 'code'
  if (r.family === 'audio' || r.family === 'video') return 'media'
  if (r.family === 'archive' || r.container) return 'archive'
  if (r.sizeBytes > 0) return 'bytes'
  return 'none'
}

const MIME: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo' }

function blobUrl(bytes: Uint8Array, type: string): string {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return URL.createObjectURL(new Blob([buf], { type }))
}

function parseCsv(text: string, maxRows = 500): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const delim = (text.split('\n')[0]?.split('\t').length ?? 0) > (text.split('\n')[0]?.split(',').length ?? 0) ? '\t' : ','
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

interface Rendered {
  mode: Mode
  html?: string
  urls: string[]
  imageUrl?: string
  thumbUrl?: string
  mediaUrl?: string
  mediaType?: string
  book?: RenderedBook
  deck?: RenderedDeck
  language?: string
  lines?: number
  invisible?: number
  notes: string[]
  truncated?: boolean
}

export function Preview({ receipt }: { receipt: Receipt }) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; rendered?: Rendered; error?: string }>({ status: 'loading' })
  const [reveal, setReveal] = useState(false)
  const [sheet, setSheet] = useState(0)
  const pdfRef = useRef<HTMLDivElement>(null)
  const [pdfInfo, setPdfInfo] = useState<{ pages: number; rendered: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    setState({ status: 'loading' })
    setPdfInfo(null)
    setSheet(0)
    const run = async () => {
      const bytes = await bytesFor(receipt.path)
      if (!bytes) throw new Error('bytes not available (nested too deep or file gone)')
      const mode = modeFor(receipt)
      const out: Rendered = { mode, urls, notes: [] }
      switch (mode) {
        case 'image': {
          out.imageUrl = blobUrl(bytes, MIME[receipt.kind] ?? 'application/octet-stream')
          urls.push(out.imageUrl)
          try {
            const thumb = await exifr.thumbnail(bytes)
            if (thumb && thumb.length) {
              out.thumbUrl = blobUrl(thumb, 'image/jpeg')
              urls.push(out.thumbUrl)
            }
          } catch {
            /* no thumbnail */
          }
          break
        }
        case 'media': {
          out.mediaType = MIME[receipt.kind] ?? (receipt.family === 'audio' ? 'audio/*' : 'video/*')
          out.mediaUrl = blobUrl(bytes, out.mediaType)
          urls.push(out.mediaUrl)
          break
        }
        case 'docx': {
          const zip = await JSZip.loadAsync(bytes)
          const r = await renderDocx(zip)
          out.html = r.html
          urls.push(...r.urls)
          out.notes.push(...r.notes)
          break
        }
        case 'xlsx': {
          const zip = await JSZip.loadAsync(bytes)
          out.book = await renderXlsx(zip)
          out.notes.push(...out.book.notes)
          break
        }
        case 'pptx': {
          const zip = await JSZip.loadAsync(bytes)
          out.deck = await renderPptx(zip)
          urls.push(...out.deck.urls)
          out.notes.push(...out.deck.notes)
          break
        }
        case 'code': {
          const decoded = decodeText(bytes, 2_000_000)
          const h = await highlightCode(decoded.text, receipt.extension || null, receipt.kind)
          out.html = h.html
          out.language = h.language
          out.lines = h.lines
          out.invisible = h.invisible
          out.truncated = h.truncated || decoded.truncated
          break
        }
        case 'csv': {
          const decoded = decodeText(bytes, 2_000_000)
          const rows = parseCsv(decoded.text)
          const width = Math.max(...rows.map((r) => r.length), 1)
          let html = '<table class="xlsx csv"><thead><tr><th class="rn"></th>'
          for (let c = 0; c < width; c++) html += `<th>${esc(rows[0]?.[c] ?? '')}</th>`
          html += '</tr></thead><tbody>'
          rows.slice(1).forEach((r, i) => {
            html += `<tr><th class="rn">${i + 2}</th>`
            for (let c = 0; c < width; c++) html += `<td>${esc(r[c] ?? '')}</td>`
            html += '</tr>'
          })
          html += '</tbody></table>'
          out.html = html
          out.lines = rows.length
          break
        }
        case 'email': {
          const headers = receipt.text?.units.find((u) => u.label === 'headers')?.text ?? ''
          const body = receipt.text?.units.find((u) => u.label.startsWith('body'))?.text ?? ''
          const rows = headers.split('\n').filter((l) => /^(From|To|Cc|Reply-To|Return-Path|Subject|Date|Message-ID|X-Mailer|X-Originating-IP):/i.test(l))
          out.html = `<table class="kv email-head">${rows.map((l) => { const i = l.indexOf(':'); return `<tr><th>${esc(l.slice(0, i))}</th><td>${esc(l.slice(i + 1).trim())}</td></tr>` }).join('')}</table><pre class="email-body">${esc(body)}</pre>`
          break
        }
        case 'bytes': {
          out.html = `<pre class="hex">${esc(hexDump(bytes, 0, 512))}</pre>`
          break
        }
        default:
          break
      }
      if (cancelled) {
        for (const u of urls) URL.revokeObjectURL(u)
        return
      }
      setState({ status: 'ready', rendered: out })
    }
    run().catch((error) => {
      if (!cancelled) setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    })
    return () => {
      cancelled = true
      for (const u of urls) URL.revokeObjectURL(u)
    }
  }, [receipt.path, receipt.sha256])

  // PDF pages render into a ref after the container exists.
  useEffect(() => {
    if (state.status !== 'ready' || state.rendered?.mode !== 'pdf' || !pdfRef.current) return
    const container = pdfRef.current
    container.innerHTML = ''
    const controller = new AbortController()
    void bytesFor(receipt.path).then((bytes) => {
      if (!bytes) return
      return renderPdfPages(bytes, container, { maxPages: 8, signal: controller.signal }).then((info) => {
        if (!controller.signal.aborted) setPdfInfo(info)
      })
    }).catch((error) => {
      if (!controller.signal.aborted) container.textContent = `Could not render: ${error instanceof Error ? error.message : String(error)}`
    })
    return () => controller.abort()
  }, [state.status, state.rendered?.mode, receipt.path])

  if (state.status === 'loading') return <div className="preview"><p className="muted">Rendering…</p></div>
  if (state.status === 'error' || !state.rendered) return <div className="preview"><p className="muted">Preview unavailable: {state.error}</p></div>
  const r = state.rendered
  const revealable = ['docx', 'xlsx', 'pptx', 'code'].includes(r.mode)
  const hiddenUnits = receipt.text?.units.filter((u) => /hidden|white|tiny|invisible|off-page|deletions|notes/.test(u.label)) ?? []
  return (
    <div className={`preview preview-${r.mode}${reveal ? ' reveal' : ''}`}>
      <div className="preview-bar">
        <span className="muted small">
          {r.mode === 'docx' && 'Structured rendering: paragraphs, runs, tables, lists, images, tracked changes, comments. Not page-accurate.'}
          {r.mode === 'xlsx' && r.book && `${r.book.sheets.length} sheet${r.book.sheets.length === 1 ? '' : 's'} as grids; formulas on hover.`}
          {r.mode === 'pptx' && r.deck && `${r.deck.slides.length} slide${r.deck.slides.length === 1 ? '' : 's'}, text and pictures at their positions.`}
          {r.mode === 'code' && `${r.language} · ${r.lines} lines${r.invisible ? ` · ${r.invisible} invisible character${r.invisible === 1 ? '' : 's'}` : ''}${r.truncated ? ' · truncated' : ''}`}
          {r.mode === 'pdf' && (pdfInfo ? `${pdfInfo.rendered} of ${pdfInfo.pages} page${pdfInfo.pages === 1 ? '' : 's'} rendered` : 'Rendering pages…')}
          {r.mode === 'image' && `${receipt.metadata.width ?? '?'} × ${receipt.metadata.height ?? '?'}`}
          {r.mode === 'csv' && `${r.lines} rows`}
          {r.mode === 'bytes' && 'First 512 bytes. Use peek_bytes for more.'}
        </span>
        {revealable && (
          <label className="reveal-toggle">
            <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
            <Icon name="eyeOff" size={14} /> Reveal hidden
          </label>
        )}
      </div>
      {r.mode === 'image' && (
        <div className="image-wrap">
          <figure><img src={r.imageUrl} alt={receipt.name} /><figcaption className="muted small">the image</figcaption></figure>
          {r.thumbUrl && <figure className="thumb"><img src={r.thumbUrl} alt="embedded EXIF thumbnail" /><figcaption className="muted small">embedded EXIF thumbnail: what a viewer of the metadata sees</figcaption></figure>}
        </div>
      )}
      {r.mode === 'media' && (r.mediaType?.startsWith('audio') ? <audio controls src={r.mediaUrl} /> : <video controls src={r.mediaUrl} />)}
      {r.mode === 'pdf' && <div className="pdf-pages" ref={pdfRef} />}
      {r.mode === 'docx' && <div className="docx" dangerouslySetInnerHTML={{ __html: r.html ?? '' }} />}
      {r.mode === 'xlsx' && r.book && (
        <div className="book">
          <div className="sheet-tabs">
            {r.book.sheets.map((s, i) => <button key={s.name} className={`${i === sheet ? 'active' : ''}${s.state ? ' hid hid-sheet' : ''}`} data-hidden={s.state ?? undefined} onClick={() => setSheet(i)}>{s.name}{s.state ? ` (${s.state})` : ''}</button>)}
          </div>
          {r.book.sheets[sheet] && <div className="sheet" dangerouslySetInnerHTML={{ __html: r.book.sheets[sheet].html }} />}
          {r.book.sheets[sheet]?.state && !reveal && <p className="muted small">This sheet is {r.book.sheets[sheet].state} in Excel. It is shown here because you asked; use Reveal hidden to highlight hidden rows and columns too.</p>}
        </div>
      )}
      {r.mode === 'pptx' && r.deck && (
        <div className="deck">
          {r.deck.slides.map((s) => (
            <div key={s.index} className="slide-block">
              <div dangerouslySetInnerHTML={{ __html: s.html }} />
              {s.notes && <div className="slide-notes hid hid-notes" data-hidden="speaker notes"><b>Speaker notes:</b> {s.notes}</div>}
            </div>
          ))}
        </div>
      )}
      {r.mode === 'code' && (
        <div className="code-wrap">
          <pre className="gutter">{Array.from({ length: Math.min(r.lines ?? 0, 5000) }, (_, i) => i + 1).join('\n')}</pre>
          <pre className="code hljs"><code dangerouslySetInnerHTML={{ __html: r.html ?? '' }} /></pre>
        </div>
      )}
      {(r.mode === 'csv' || r.mode === 'email' || r.mode === 'bytes') && <div className="sheet" dangerouslySetInnerHTML={{ __html: r.html ?? '' }} />}
      {r.mode === 'archive' && <p className="muted">Archives are listed under <b>Inside</b>; click an entry there to preview it.</p>}
      {r.mode === 'none' && <p className="muted">Nothing to show.</p>}
      {r.mode === 'pdf' && hiddenUnits.length > 0 && (
        <details className="hidden-units" open={reveal}>
          <summary>Hidden text in this PDF ({hiddenUnits.length} unit{hiddenUnits.length === 1 ? '' : 's'})</summary>
          {hiddenUnits.map((u) => <div key={u.label}><b>{u.label}</b><pre className="evidence">{u.text.slice(0, 2000)}</pre></div>)}
        </details>
      )}
      {r.notes.length > 0 && <p className="muted small">{r.notes.join('; ')}</p>}
    </div>
  )
}
