// Clean-room structured rendering of OOXML packages to HTML strings.
//
// Purpose: show a person what is in a document, with hidden content made
// visible on demand. Paragraphs, runs, tables, lists, images, tracked
// changes, comments, sheet grids and positioned slide text are rendered.
// Page layout fidelity is not a goal; the UFO apps own that.
//
// Every string that comes from the file passes through esc(). Images become
// blob: URLs the caller revokes.

import type JSZip from 'jszip'
import { parseXml, els, attr } from '../core/xml'

export interface RenderedDoc {
  html: string
  urls: string[]
  notes: string[]
}

export interface RenderedSheet {
  name: string
  state: string | null
  html: string
  rows: number
  hiddenRows: number
  hiddenCols: number
}

export interface RenderedBook {
  sheets: RenderedSheet[]
  notes: string[]
}

export interface RenderedSlide {
  index: number
  hidden: boolean
  html: string
  notes: string
}

export interface RenderedDeck {
  slides: RenderedSlide[]
  width: number
  height: number
  urls: string[]
  notes: string[]
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function text(zip: JSZip, path: string, max = 12_000_000): Promise<string | null> {
  const f = zip.file(path)
  if (!f) return null
  const b = await f.async('uint8array')
  return new TextDecoder().decode(b.subarray(0, max))
}

interface Rel {
  target: string
  type: string
  external: boolean
}

async function rels(zip: JSZip, path: string): Promise<Map<string, Rel>> {
  const map = new Map<string, Rel>()
  const t = await text(zip, path, 2_000_000)
  const doc = t ? parseXml(t) : null
  if (!doc) return map
  for (const r of els(doc, 'Relationship')) {
    map.set(attr(r, 'Id') ?? '', { target: attr(r, 'Target') ?? '', type: (attr(r, 'Type') ?? '').split('/').pop() ?? '', external: attr(r, 'TargetMode') === 'External' })
  }
  return map
}

function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' }

async function mediaUrl(zip: JSZip, path: string, urls: string[], cache: Map<string, string>): Promise<string | null> {
  const hit = cache.get(path)
  if (hit) return hit
  const f = zip.file(path)
  if (!f) return null
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const mime = MIME[ext] ?? 'application/octet-stream'
  if (!mime.startsWith('image/') || mime === 'image/emf' || mime === 'image/wmf' || mime === 'image/tiff') return null
  const bytes = await f.async('uint8array')
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const url = URL.createObjectURL(new Blob([buf], { type: mime }))
  urls.push(url)
  cache.set(path, url)
  return url
}

function nearWhite(hex: string | null): boolean {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return false
  return parseInt(hex.slice(0, 2), 16) >= 0xf0 && parseInt(hex.slice(2, 4), 16) >= 0xf0 && parseInt(hex.slice(4, 6), 16) >= 0xf0
}

function twipsToPx(v: string | null, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n / 15) : fallback
}

function child(el: Element, qname: string): Element | null {
  for (const c of Array.from(el.children)) if (c.tagName === qname) return c
  return null
}

// ------------------------------------------------------------ Word

interface DocxCtx {
  zip: JSZip
  rels: Map<string, Rel>
  comments: Map<string, { author: string; date: string; text: string }>
  numFmt: Map<string, string>
  urls: string[]
  cache: Map<string, string>
  notes: string[]
  openComments: string[]
}

async function docxNumbering(zip: JSZip): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const t = await text(zip, 'word/numbering.xml', 4_000_000)
  const doc = t ? parseXml(t) : null
  if (!doc) return map
  const abstractFmt = new Map<string, string>()
  for (const a of els(doc, 'w:abstractNum')) {
    const lvl = els(a, 'w:lvl')[0]
    const fmt = lvl ? attr(child(lvl, 'w:numFmt') ?? lvl, 'w:val') : null
    abstractFmt.set(attr(a, 'w:abstractNumId') ?? '', fmt ?? 'bullet')
  }
  for (const n of els(doc, 'w:num')) {
    const abs = child(n, 'w:abstractNumId')
    map.set(attr(n, 'w:numId') ?? '', abstractFmt.get(attr(abs!, 'w:val') ?? '') ?? 'bullet')
  }
  return map
}

async function docxComments(zip: JSZip): Promise<DocxCtx['comments']> {
  const map = new Map<string, { author: string; date: string; text: string }>()
  const t = await text(zip, 'word/comments.xml', 4_000_000)
  const doc = t ? parseXml(t) : null
  if (!doc) return map
  for (const c of els(doc, 'w:comment')) {
    map.set(attr(c, 'w:id') ?? '', { author: attr(c, 'w:author') ?? '?', date: attr(c, 'w:date') ?? '', text: els(c, 'w:t').map((x) => x.textContent ?? '').join('') })
  }
  return map
}

function runStyle(rpr: Element | null): { style: string; classes: string[]; tags: string[]; title: string } {
  const classes: string[] = []
  const tags: string[] = []
  const style: string[] = []
  const titles: string[] = []
  if (!rpr) return { style: '', classes, tags, title: '' }
  if (child(rpr, 'w:b') && attr(child(rpr, 'w:b')!, 'w:val') !== '0' && attr(child(rpr, 'w:b')!, 'w:val') !== 'false') tags.push('b')
  if (child(rpr, 'w:i') && attr(child(rpr, 'w:i')!, 'w:val') !== '0' && attr(child(rpr, 'w:i')!, 'w:val') !== 'false') tags.push('i')
  const u = child(rpr, 'w:u')
  if (u && attr(u, 'w:val') !== 'none') style.push('text-decoration:underline')
  if (child(rpr, 'w:strike') || child(rpr, 'w:dstrike')) style.push('text-decoration:line-through')
  const color = attr(child(rpr, 'w:color') ?? rpr, 'w:val')
  if (color && color !== 'auto' && /^[0-9a-f]{6}$/i.test(color)) {
    style.push(`color:#${color}`)
    if (nearWhite(color)) {
      classes.push('hid', 'hid-white')
      titles.push('white or near-white text')
    }
  }
  const highlight = child(rpr, 'w:highlight')
  if (highlight && attr(highlight, 'w:val') && attr(highlight, 'w:val') !== 'none') style.push(`background:${attr(highlight, 'w:val')}`)
  const shd = child(rpr, 'w:shd')
  const fill = shd ? attr(shd, 'w:fill') : null
  if (fill && /^[0-9a-f]{6}$/i.test(fill)) style.push(`background:#${fill}`)
  const sz = child(rpr, 'w:sz')
  const half = sz ? Number(attr(sz, 'w:val')) : NaN
  if (!Number.isNaN(half) && half > 0) {
    style.push(`font-size:${(half / 2) * (96 / 72)}px`)
    if (half <= 4) {
      classes.push('hid', 'hid-tiny')
      titles.push(`${half / 2}pt text`)
    }
  }
  if (child(rpr, 'w:vanish')) {
    classes.push('hid', 'hid-vanish')
    titles.push('hidden (vanish) text')
  }
  const va = child(rpr, 'w:vertAlign')
  if (va && attr(va, 'w:val') === 'superscript') tags.push('sup')
  if (va && attr(va, 'w:val') === 'subscript') tags.push('sub')
  if (child(rpr, 'w:caps')) style.push('text-transform:uppercase')
  if (child(rpr, 'w:smallCaps')) style.push('font-variant:small-caps')
  const fonts = child(rpr, 'w:rFonts')
  const face = fonts ? attr(fonts, 'w:ascii') : null
  if (face && /mono|courier|consolas/i.test(face)) style.push('font-family:ui-monospace,monospace')
  return { style: style.join(';'), classes, tags, title: titles.join(', ') }
}

async function renderRun(r: Element, ctx: DocxCtx, textTag = 'w:t'): Promise<string> {
  const rpr = child(r, 'w:rPr')
  const { style, classes, tags, title } = runStyle(rpr)
  let inner = ''
  for (const c of Array.from(r.children)) {
    switch (c.tagName) {
      case textTag:
      case 'w:t':
      case 'w:delText':
        inner += esc(c.textContent ?? '')
        break
      case 'w:tab':
        inner += '<span class="tab"></span>'
        break
      case 'w:br':
        inner += attr(c, 'w:type') === 'page' ? '<hr class="page-break">' : '<br>'
        break
      case 'w:cr':
        inner += '<br>'
        break
      case 'w:noBreakHyphen':
        inner += '&#8209;'
        break
      case 'w:sym':
        inner += '&#9633;'
        break
      case 'w:drawing':
      case 'w:pict':
      case 'w:object': {
        const blip = c.getElementsByTagName('a:blip')[0] ?? c.getElementsByTagName('v:imagedata')[0]
        const rid = blip ? attr(blip, 'r:embed') ?? attr(blip, 'r:id') : null
        const rel = rid ? ctx.rels.get(rid) : undefined
        if (rel && !rel.external) {
          const url = await mediaUrl(ctx.zip, resolve('word', rel.target), ctx.urls, ctx.cache)
          const ext = c.getElementsByTagName('wp:extent')[0]
          const w = ext ? Math.round(Number(attr(ext, 'cx')) / 9525) : 0
          const inline = !!c.getElementsByTagName('wp:inline').length
          if (url) inner += `<img class="docx-img${inline ? '' : ' floating'}" src="${url}" alt="embedded image"${w ? ` style="width:${Math.min(w, 800)}px"` : ''}>`
          else inner += '<span class="docx-obj">[image: unsupported format]</span>'
        } else inner += '<span class="docx-obj">[drawing]</span>'
        break
      }
      case 'w:footnoteReference':
      case 'w:endnoteReference':
        inner += `<sup class="note-ref">${esc(attr(c, 'w:id') ?? '')}</sup>`
        break
      case 'w:commentReference':
        inner += `<sup class="cm-ref" title="${esc(ctx.comments.get(attr(c, 'w:id') ?? '')?.text ?? 'comment')}">[c${esc(attr(c, 'w:id') ?? '')}]</sup>`
        break
      case 'w:fldChar':
      case 'w:instrText':
      case 'w:rPr':
      case 'w:lastRenderedPageBreak':
        break
      default:
        break
    }
  }
  if (!inner) return ''
  let html = inner
  for (const t of tags) html = `<${t}>${html}</${t}>`
  const cls = classes.length ? ` class="${classes.join(' ')}"` : ''
  const tt = title ? ` title="${esc(title)}" data-hidden="${esc(title)}"` : ''
  return style || classes.length ? `<span${cls}${tt} style="${style}">${html}</span>` : html
}

async function renderInline(el: Element, ctx: DocxCtx): Promise<string> {
  let out = ''
  for (const c of Array.from(el.children)) {
    switch (c.tagName) {
      case 'w:r':
        out += await renderRun(c, ctx)
        break
      case 'w:hyperlink': {
        const rid = attr(c, 'r:id')
        const rel = rid ? ctx.rels.get(rid) : undefined
        const href = rel?.external ? rel.target : null
        const inner = await renderInline(c, ctx)
        out += href && /^https?:\/\//i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noreferrer noopener" title="${esc(href)}">${inner}</a>` : `<a class="anchor" title="${esc(href ?? 'internal link')}">${inner}</a>`
        break
      }
      case 'w:ins': {
        const inner = await renderInline(c, ctx)
        out += `<ins class="trk trk-ins" title="inserted by ${esc(attr(c, 'w:author') ?? '?')} ${esc(attr(c, 'w:date') ?? '')}">${inner}</ins>`
        break
      }
      case 'w:del': {
        let inner = ''
        for (const r of Array.from(c.children)) if (r.tagName === 'w:r') inner += await renderRun(r, ctx, 'w:delText')
        out += `<del class="trk trk-del hid hid-deleted" data-hidden="deleted text" title="deleted by ${esc(attr(c, 'w:author') ?? '?')} ${esc(attr(c, 'w:date') ?? '')}">${inner}</del>`
        break
      }
      case 'w:commentRangeStart': {
        const id = attr(c, 'w:id') ?? ''
        const cm = ctx.comments.get(id)
        ctx.openComments.push(id)
        out += `<mark class="cm" title="${esc(cm ? `${cm.author}: ${cm.text}` : 'comment')}">`
        break
      }
      case 'w:commentRangeEnd': {
        const id = attr(c, 'w:id') ?? ''
        const i = ctx.openComments.lastIndexOf(id)
        if (i >= 0) {
          ctx.openComments.splice(i, 1)
          out += '</mark>'
        }
        break
      }
      case 'w:sdt': {
        const content = child(c, 'w:sdtContent')
        if (content) out += await renderInline(content, ctx)
        break
      }
      case 'w:smartTag':
      case 'w:fldSimple':
      case 'w:customXml':
      case 'w:dir':
      case 'w:bdo':
        out += await renderInline(c, ctx)
        break
      case 'w:moveFrom':
      case 'w:moveTo':
        out += await renderInline(c, ctx)
        break
      default:
        break
    }
  }
  return out
}

function paragraphOpen(p: Element, ctx: DocxCtx): { open: string; close: string; list: { fmt: string; level: number } | null } {
  const ppr = child(p, 'w:pPr')
  const styleId = ppr ? attr(child(ppr, 'w:pStyle') ?? ppr, 'w:val') : null
  let tag = 'p'
  if (styleId) {
    const m = /^(?:Heading|heading|Title|Subtitle)(\d)?/.exec(styleId) ?? (/^[1-9]$/.test(styleId) ? [styleId, styleId] : null)
    if (m) {
      const n = m[1] ? Number(m[1]) : styleId.startsWith('Title') ? 1 : 2
      tag = `h${Math.min(6, Math.max(1, n === 1 && styleId.startsWith('Heading') ? 2 : n))}`
    }
  }
  const style: string[] = []
  if (ppr) {
    const jc = child(ppr, 'w:jc')
    const val = jc ? attr(jc, 'w:val') : null
    if (val === 'center' || val === 'right') style.push(`text-align:${val}`)
    if (val === 'both' || val === 'distribute') style.push('text-align:justify')
    const ind = child(ppr, 'w:ind')
    if (ind) {
      const left = twipsToPx(attr(ind, 'w:left') ?? attr(ind, 'w:start'), 0)
      const first = twipsToPx(attr(ind, 'w:firstLine'), 0)
      const hanging = twipsToPx(attr(ind, 'w:hanging'), 0)
      if (left) style.push(`margin-left:${left}px`)
      if (first) style.push(`text-indent:${first}px`)
      if (hanging) style.push(`text-indent:-${hanging}px;padding-left:${hanging}px`)
    }
    const shd = child(ppr, 'w:shd')
    const fill = shd ? attr(shd, 'w:fill') : null
    if (fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toLowerCase() !== 'ffffff') style.push(`background:#${fill}`)
    const bdr = child(ppr, 'w:pBdr')
    if (bdr && bdr.children.length) style.push('border-bottom:1px solid #bbb')
    if (child(ppr, 'w:pageBreakBefore')) style.push('border-top:1px dashed #cbd5e1;padding-top:12px')
  }
  let list: { fmt: string; level: number } | null = null
  const num = ppr ? child(ppr, 'w:numPr') : null
  if (num) {
    const id = child(num, 'w:numId')
    const lvl = child(num, 'w:ilvl')
    const fmt = ctx.numFmt.get(id ? attr(id, 'w:val') ?? '' : '') ?? 'bullet'
    list = { fmt, level: lvl ? Number(attr(lvl, 'w:val') ?? 0) : 0 }
  }
  const st = style.length ? ` style="${style.join(';')}"` : ''
  return { open: `<${tag}${st}>`, close: `</${tag}>`, list }
}

async function renderBlocks(container: Element, ctx: DocxCtx): Promise<string> {
  let out = ''
  let openList: { fmt: string; level: number } | null = null
  const closeList = () => {
    if (openList) {
      out += openList.fmt === 'bullet' ? '</ul>' : '</ol>'
      openList = null
    }
  }
  for (const c of Array.from(container.children)) {
    switch (c.tagName) {
      case 'w:p': {
        const { open, close, list } = paragraphOpen(c, ctx)
        const inner = await renderInline(c, ctx)
        if (ctx.openComments.length) {
          // Close ranges at paragraph end and reopen in the next one to keep the HTML well formed.
          out += ''
        }
        if (list) {
          if (!openList || openList.fmt !== list.fmt) {
            closeList()
            out += list.fmt === 'bullet' ? '<ul>' : '<ol>'
            openList = list
          }
          out += `<li style="margin-left:${list.level * 22}px">${inner || '&nbsp;'}</li>`
        } else {
          closeList()
          out += `${open}${inner || '<br>'}${close}`
        }
        break
      }
      case 'w:tbl': {
        closeList()
        out += await renderTable(c, ctx)
        break
      }
      case 'w:sdt': {
        const content = child(c, 'w:sdtContent')
        if (content) out += await renderBlocks(content, ctx)
        break
      }
      case 'w:sectPr':
      case 'w:bookmarkStart':
      case 'w:bookmarkEnd':
      case 'w:proofErr':
        break
      case 'w:customXml':
        out += await renderBlocks(c, ctx)
        break
      default:
        break
    }
  }
  closeList()
  return out
}

async function renderTable(tbl: Element, ctx: DocxCtx): Promise<string> {
  let out = '<table class="docx-table">'
  for (const tr of Array.from(tbl.children)) {
    if (tr.tagName !== 'w:tr') continue
    out += '<tr>'
    for (const tc of Array.from(tr.children)) {
      if (tc.tagName !== 'w:tc') continue
      const tcpr = child(tc, 'w:tcPr')
      const span = tcpr ? attr(child(tcpr, 'w:gridSpan') ?? tcpr, 'w:val') : null
      const shd = tcpr ? child(tcpr, 'w:shd') : null
      const fill = shd ? attr(shd, 'w:fill') : null
      const w = tcpr ? child(tcpr, 'w:tcW') : null
      const width = w && attr(w, 'w:type') === 'dxa' ? twipsToPx(attr(w, 'w:w'), 0) : 0
      const style = [fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toLowerCase() !== 'auto' ? `background:#${fill}` : '', width ? `width:${width}px` : ''].filter(Boolean).join(';')
      out += `<td${span && Number(span) > 1 ? ` colspan="${Number(span)}"` : ''}${style ? ` style="${style}"` : ''}>${await renderBlocks(tc, ctx)}</td>`
    }
    out += '</tr>'
  }
  return out + '</table>'
}

export async function renderDocx(zip: JSZip): Promise<RenderedDoc> {
  const urls: string[] = []
  const notes: string[] = []
  const xml = await text(zip, 'word/document.xml')
  const doc = xml ? parseXml(xml) : null
  if (!doc) return { html: '<p class="muted">word/document.xml could not be parsed.</p>', urls, notes: ['document.xml unparseable'] }
  const ctx: DocxCtx = { zip, rels: await rels(zip, 'word/_rels/document.xml.rels'), comments: await docxComments(zip), numFmt: await docxNumbering(zip), urls, cache: new Map(), notes, openComments: [] }
  const body = doc.getElementsByTagName('w:body')[0]
  if (!body) return { html: '<p class="muted">No body.</p>', urls, notes }
  const sect = child(body, 'w:sectPr')
  const pg = sect ? child(sect, 'w:pgSz') : null
  const mar = sect ? child(sect, 'w:pgMar') : null
  const width = twipsToPx(pg ? attr(pg, 'w:w') : null, 816)
  const pad = { top: twipsToPx(mar ? attr(mar, 'w:top') : null, 96), right: twipsToPx(mar ? attr(mar, 'w:right') : null, 96), bottom: twipsToPx(mar ? attr(mar, 'w:bottom') : null, 96), left: twipsToPx(mar ? attr(mar, 'w:left') : null, 96) }
  let header = ''
  let footer = ''
  if (sect) {
    for (const ref of Array.from(sect.children)) {
      if ((ref.tagName === 'w:headerReference' || ref.tagName === 'w:footerReference') && attr(ref, 'w:type') === 'default') {
        const rel = ctx.rels.get(attr(ref, 'r:id') ?? '')
        if (!rel) continue
        const part = await text(zip, resolve('word', rel.target), 2_000_000)
        const pd = part ? parseXml(part) : null
        if (!pd) continue
        const sub: DocxCtx = { ...ctx, rels: await rels(zip, resolve('word', rel.target).replace(/([^/]+)$/, '_rels/$1.rels')), openComments: [] }
        const html = await renderBlocks(pd.documentElement, sub)
        if (ref.tagName === 'w:headerReference') header = `<div class="docx-header">${html}</div>`
        else footer = `<div class="docx-footer">${html}</div>`
      }
    }
  }
  const main = await renderBlocks(body, ctx)
  while (ctx.openComments.length) {
    ctx.openComments.pop()
  }
  const commentList = ctx.comments.size
    ? `<ol class="docx-comments">${[...ctx.comments.entries()].map(([id, c]) => `<li><b>c${esc(id)}</b> <span class="muted">${esc(c.author)} ${esc(c.date.slice(0, 10))}</span>: ${esc(c.text)}</li>`).join('')}</ol>`
    : ''
  const html = `<div class="docx-page" style="width:${width}px;padding:${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px">${header}${main}${footer}</div>${commentList}`
  return { html, urls, notes }
}

// ------------------------------------------------------------ Excel

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function colName(n: number): string {
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function excelSerialToIso(v: number): string {
  const ms = Math.round((v - 25569) * 86400 * 1000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return String(v)
  return v % 1 === 0 ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 16).replace('T', ' ')
}

export async function renderXlsx(zip: JSZip, maxRows = 500, maxCols = 60): Promise<RenderedBook> {
  const notes: string[] = []
  const wb = await text(zip, 'xl/workbook.xml')
  const wdoc = wb ? parseXml(wb) : null
  if (!wdoc) return { sheets: [], notes: ['workbook.xml unparseable'] }
  const relMap = await rels(zip, 'xl/_rels/workbook.xml.rels')
  const shared: string[] = []
  const sst = await text(zip, 'xl/sharedStrings.xml')
  const sdoc = sst ? parseXml(sst) : null
  if (sdoc) for (const si of els(sdoc, 'si')) shared.push(els(si, 't').map((t) => t.textContent ?? '').join(''))
  const dateStyles = new Set<number>()
  const styles = await text(zip, 'xl/styles.xml', 4_000_000)
  const stdoc = styles ? parseXml(styles) : null
  if (stdoc) {
    const custom = new Map<string, string>()
    for (const nf of els(stdoc, 'numFmt')) custom.set(attr(nf, 'numFmtId') ?? '', attr(nf, 'formatCode') ?? '')
    const xfs = stdoc.getElementsByTagName('cellXfs')[0]
    if (xfs) {
      els(xfs, 'xf').forEach((xf, i) => {
        const id = Number(attr(xf, 'numFmtId') ?? -1)
        const code = custom.get(String(id)) ?? ''
        if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dmy]{2,}|h:mm/i.test(code)) dateStyles.add(i)
      })
    }
  }
  const sheets: RenderedSheet[] = []
  for (const sh of els(wdoc, 'sheet')) {
    const name = attr(sh, 'name') ?? 'sheet'
    const state = attr(sh, 'state')
    const rel = relMap.get(attr(sh, 'r:id') ?? '')
    if (!rel) continue
    const path = resolve('xl', rel.target)
    const sx = await text(zip, path)
    const sdoc2 = sx ? parseXml(sx) : null
    if (!sdoc2) {
      notes.push(`${name}: unparseable`)
      continue
    }
    const hiddenCols = new Set<number>()
    const widths = new Map<number, number>()
    for (const col of els(sdoc2, 'col')) {
      const min = Number(attr(col, 'min'))
      const max = Math.min(Number(attr(col, 'max')), maxCols)
      const hidden = attr(col, 'hidden') === '1' || attr(col, 'hidden') === 'true'
      const w = Number(attr(col, 'width'))
      for (let c = min; c <= max; c++) {
        if (hidden) hiddenCols.add(c)
        if (w) widths.set(c, Math.round(w * 7 + 5))
      }
    }
    const merges = new Map<string, { cs: number; rs: number }>()
    const covered = new Set<string>()
    for (const m of els(sdoc2, 'mergeCell')) {
      const ref = attr(m, 'ref') ?? ''
      const [a, b] = ref.split(':')
      if (!a || !b) continue
      const c1 = colIndex(a), c2 = colIndex(b)
      const r1 = Number(a.replace(/^[A-Z]+/, '')), r2 = Number(b.replace(/^[A-Z]+/, ''))
      merges.set(a, { cs: c2 - c1 + 1, rs: r2 - r1 + 1 })
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (!(r === r1 && c === c1)) covered.add(`${colName(c)}${r}`)
    }
    const rows = els(sdoc2, 'row')
    let maxCol = 1
    const grid: { r: number; hidden: boolean; cells: Map<number, { v: string; f: string | null; cls: string }> }[] = []
    let hiddenRows = 0
    let nextRow = 1
    for (const row of rows.slice(0, maxRows)) {
      // `r` on rows and cells is optional in the schema; without it, order is position.
      const r = Number(attr(row, 'r')) || nextRow
      nextRow = r + 1
      const hidden = attr(row, 'hidden') === '1' || attr(row, 'hidden') === 'true'
      if (hidden) hiddenRows++
      const cells = new Map<number, { v: string; f: string | null; cls: string }>()
      let nextCol = 1
      for (const c of els(row, 'c')) {
        const ref = attr(c, 'r')
        const ci = ref ? colIndex(ref) : nextCol
        nextCol = ci + 1
        if (ci > maxCols) continue
        maxCol = Math.max(maxCol, ci)
        const t = attr(c, 't')
        const s = Number(attr(c, 's') ?? -1)
        const raw = c.getElementsByTagName('v')[0]?.textContent ?? ''
        const f = c.getElementsByTagName('f')[0]?.textContent ?? null
        let v = raw
        let cls = ''
        if (t === 's') v = shared[Number(raw)] ?? ''
        else if (t === 'inlineStr') v = els(c, 't').map((x) => x.textContent ?? '').join('')
        else if (t === 'b') v = raw === '1' ? 'TRUE' : 'FALSE'
        else if (t === 'e') { v = raw; cls = 'err' }
        else if (raw !== '' && !Number.isNaN(Number(raw))) {
          cls = 'num'
          if (dateStyles.has(s)) v = excelSerialToIso(Number(raw))
        }
        cells.set(ci, { v, f, cls })
      }
      grid.push({ r, hidden, cells })
    }
    for (const c of hiddenCols) if (c > maxCol) hiddenCols.delete(c)
    let html = `<table class="xlsx"><thead><tr><th class="rn"></th>`
    for (let c = 1; c <= maxCol; c++) html += `<th class="${hiddenCols.has(c) ? 'hid hid-col' : ''}"${widths.get(c) ? ` style="min-width:${widths.get(c)}px"` : ''} data-hidden="hidden column">${colName(c)}</th>`
    html += '</tr></thead><tbody>'
    for (const row of grid) {
      html += `<tr class="${row.hidden ? 'hid hid-row' : ''}" data-hidden="hidden row"><th class="rn">${row.r}</th>`
      for (let c = 1; c <= maxCol; c++) {
        const ref = `${colName(c)}${row.r}`
        if (covered.has(ref)) continue
        const cell = row.cells.get(c)
        const merge = merges.get(ref)
        const span = merge ? ` colspan="${Math.min(merge.cs, maxCol - c + 1)}" rowspan="${merge.rs}"` : ''
        const cls = [hiddenCols.has(c) ? 'hid hid-col' : '', cell?.cls ?? ''].filter(Boolean).join(' ')
        html += `<td${span}${cls ? ` class="${cls}"` : ''}${cell?.f ? ` title="=${esc(cell.f)}"` : ''} data-hidden="hidden column">${cell ? esc(cell.v) : ''}</td>`
      }
      html += '</tr>'
    }
    html += '</tbody></table>'
    if (rows.length > maxRows) html += `<p class="muted small">${rows.length - maxRows} more rows not shown.</p>`
    sheets.push({ name, state, html, rows: rows.length, hiddenRows, hiddenCols: hiddenCols.size })
  }
  return { sheets, notes }
}

// ------------------------------------------------------------ PowerPoint

interface PptCtx {
  zip: JSZip
  rels: Map<string, Rel>
  slidePath: string
  urls: string[]
  cache: Map<string, string>
  cx: number
  cy: number
  /** Where the next shape without its own transform goes (percent of slide height). */
  autoTop: number
}

function emuPct(v: string | null, total: number): number {
  const n = Number(v)
  return Number.isFinite(n) && total > 0 ? (n / total) * 100 : 0
}

function pptRunHtml(r: Element): string {
  const rpr = child(r, 'a:rPr')
  const t = r.getElementsByTagName('a:t')[0]?.textContent ?? ''
  if (!t) return ''
  const style: string[] = []
  const tags: string[] = []
  if (rpr) {
    if (attr(rpr, 'b') === '1') tags.push('b')
    if (attr(rpr, 'i') === '1') tags.push('i')
    if (attr(rpr, 'u') && attr(rpr, 'u') !== 'none') style.push('text-decoration:underline')
    const sz = Number(attr(rpr, 'sz'))
    if (sz) style.push(`font-size:${(sz / 100) * (96 / 72) * 0.75}px`)
    const clr = rpr.getElementsByTagName('a:srgbClr')[0]
    const val = clr ? attr(clr, 'val') : null
    if (val && /^[0-9a-f]{6}$/i.test(val)) style.push(`color:#${val}`)
  }
  let html = esc(t)
  for (const tag of tags) html = `<${tag}>${html}</${tag}>`
  return style.length ? `<span style="${style.join(';')}">${html}</span>` : html
}

function pptTextBody(body: Element): string {
  let out = ''
  for (const p of Array.from(body.children)) {
    if (p.tagName !== 'a:p') continue
    const ppr = child(p, 'a:pPr')
    const algn = ppr ? attr(ppr, 'algn') : null
    const lvl = ppr ? Number(attr(ppr, 'lvl') ?? 0) : 0
    const bullet = ppr ? !child(ppr, 'a:buNone') && (child(ppr, 'a:buChar') || child(ppr, 'a:buAutoNum') || lvl > 0) : false
    let inner = ''
    for (const c of Array.from(p.children)) {
      if (c.tagName === 'a:r') inner += pptRunHtml(c)
      else if (c.tagName === 'a:br') inner += '<br>'
      else if (c.tagName === 'a:fld') inner += esc(c.getElementsByTagName('a:t')[0]?.textContent ?? '')
    }
    const style = [algn === 'ctr' ? 'text-align:center' : algn === 'r' ? 'text-align:right' : '', lvl ? `margin-left:${lvl * 18}px` : ''].filter(Boolean).join(';')
    out += `<p${style ? ` style="${style}"` : ''}>${bullet ? '<span class="bullet">•</span> ' : ''}${inner || '&nbsp;'}</p>`
  }
  return out
}

async function pptShape(sp: Element, ctx: PptCtx, kind: 'sp' | 'pic' | 'frame'): Promise<string> {
  const xfrm = sp.getElementsByTagName('a:xfrm')[0]
  const off = xfrm ? child(xfrm, 'a:off') : null
  const ext = xfrm ? child(xfrm, 'a:ext') : null
  const ph = sp.getElementsByTagName('p:ph')[0]
  const phType = ph ? attr(ph, 'type') ?? 'body' : null
  const shapeName = sp.getElementsByTagName('p:cNvPr')[0]?.getAttribute('name') ?? ''
  const titleLike = phType === 'title' || phType === 'ctrTitle' || /^title/i.test(shapeName)
  let left = off ? emuPct(attr(off, 'x'), ctx.cx) : 5
  let top = off ? emuPct(attr(off, 'y'), ctx.cy) : -1
  let width = ext ? emuPct(attr(ext, 'cx'), ctx.cx) : 90
  let height = ext ? emuPct(attr(ext, 'cy'), ctx.cy) : -1
  if (top < 0 || height <= 0) {
    // No transform of its own (inherited from the layout): stack it below the previous such shape.
    if (titleLike && ctx.autoTop < 20) {
      top = 6
      height = 15
      ctx.autoTop = 24
    } else {
      top = ctx.autoTop
      height = Math.max(10, Math.min(60, 96 - ctx.autoTop))
      ctx.autoTop = Math.min(90, ctx.autoTop + height)
    }
    left = 5
    width = 90
  }
  if (width <= 0) width = 90
  const style = `left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${width.toFixed(2)}%;height:${height.toFixed(2)}%`
  if (kind === 'pic') {
    const blip = sp.getElementsByTagName('a:blip')[0]
    const rid = blip ? attr(blip, 'r:embed') : null
    const rel = rid ? ctx.rels.get(rid) : undefined
    const url = rel && !rel.external ? await mediaUrl(ctx.zip, resolve(ctx.slidePath.replace(/\/[^/]+$/, ''), rel.target), ctx.urls, ctx.cache) : null
    return url ? `<img class="shape pic" style="${style}" src="${url}" alt="slide image">` : `<div class="shape pic-missing" style="${style}">[image]</div>`
  }
  if (kind === 'frame') {
    const tbl = sp.getElementsByTagName('a:tbl')[0]
    if (tbl) {
      let t = '<table class="ppt-table">'
      for (const tr of els(tbl, 'a:tr')) {
        t += '<tr>'
        for (const tc of els(tr, 'a:tc')) t += `<td>${pptTextBody(tc.getElementsByTagName('a:txBody')[0] ?? tc)}</td>`
        t += '</tr>'
      }
      return `<div class="shape" style="${style}">${t}</table></div>`
    }
    return `<div class="shape muted" style="${style}">[chart or embedded object]</div>`
  }
  const fill = sp.getElementsByTagName('p:spPr')[0]?.getElementsByTagName('a:solidFill')[0]?.getElementsByTagName('a:srgbClr')[0]
  const bg = fill ? attr(fill, 'val') : null
  const body = sp.getElementsByTagName('p:txBody')[0]
  const isTitle = titleLike
  return `<div class="shape${isTitle ? ' title' : ''}" style="${style}${bg && /^[0-9a-f]{6}$/i.test(bg) ? `;background:#${bg}` : ''}">${body ? pptTextBody(body) : ''}</div>`
}

async function pptTree(tree: Element, ctx: PptCtx): Promise<string> {
  let out = ''
  for (const c of Array.from(tree.children)) {
    if (c.tagName === 'p:sp') out += await pptShape(c, ctx, 'sp')
    else if (c.tagName === 'p:pic') out += await pptShape(c, ctx, 'pic')
    else if (c.tagName === 'p:graphicFrame') out += await pptShape(c, ctx, 'frame')
    else if (c.tagName === 'p:grpSp') out += await pptTree(c, ctx)
  }
  return out
}

export async function renderPptx(zip: JSZip, maxSlides = 60): Promise<RenderedDeck> {
  const urls: string[] = []
  const notes: string[] = []
  const pres = await text(zip, 'ppt/presentation.xml')
  const pdoc = pres ? parseXml(pres) : null
  const size = pdoc?.getElementsByTagName('p:sldSz')[0]
  const cx = size ? Number(attr(size, 'cx')) || 9144000 : 9144000
  const cy = size ? Number(attr(size, 'cy')) || 6858000 : 6858000
  const relMap = await rels(zip, 'ppt/_rels/presentation.xml.rels')
  const order: string[] = []
  if (pdoc) for (const s of els(pdoc, 'p:sldId')) {
    const rel = relMap.get(attr(s, 'r:id') ?? '')
    if (rel) order.push(resolve('ppt', rel.target))
  }
  if (!order.length) order.push(...Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort())
  const slides: RenderedSlide[] = []
  const cache = new Map<string, string>()
  for (let i = 0; i < Math.min(order.length, maxSlides); i++) {
    const path = order[i]
    const sx = await text(zip, path)
    const sdoc = sx ? parseXml(sx) : null
    if (!sdoc) {
      notes.push(`${path}: unparseable`)
      continue
    }
    const slideRels = await rels(zip, path.replace(/([^/]+)$/, '_rels/$1.rels'))
    const ctx: PptCtx = { zip, rels: slideRels, slidePath: path, urls, cache, cx, cy, autoTop: 6 }
    const hidden = attr(sdoc.documentElement, 'show') === '0'
    const bgFill = sdoc.getElementsByTagName('p:bg')[0]?.getElementsByTagName('a:srgbClr')[0]
    const bg = bgFill ? attr(bgFill, 'val') : null
    const tree = sdoc.getElementsByTagName('p:spTree')[0]
    const html = `<div class="slide${hidden ? ' hid hid-slide' : ''}" data-hidden="hidden slide" style="aspect-ratio:${cx}/${cy}${bg && /^[0-9a-f]{6}$/i.test(bg) ? `;background:#${bg}` : ''}">${tree ? await pptTree(tree, ctx) : ''}<span class="slide-n">${i + 1}${hidden ? ' · hidden' : ''}</span></div>`
    let notesText = ''
    for (const [, r] of slideRels) {
      if (r.type === 'notesSlide') {
        const nt = await text(zip, resolve(path.replace(/\/[^/]+$/, ''), r.target))
        const nd = nt ? parseXml(nt) : null
        if (nd) notesText = els(nd, 'a:p').map((p) => els(p, 'a:t').map((t) => t.textContent ?? '').join('')).filter((s) => s.trim() && !/^\d+$/.test(s.trim())).join('\n')
      }
    }
    slides.push({ index: i + 1, hidden, html, notes: notesText })
  }
  if (order.length > maxSlides) notes.push(`${order.length - maxSlides} more slides not rendered`)
  return { slides, width: cx, height: cy, urls, notes }
}
