// Human-approved actions. Each returns a new byte array and never touches the
// original. "strip_metadata" removes identity and history metadata; it does not
// change document content (tracked changes and hidden text are content and stay).

import JSZip from 'jszip'
import { PDFDocument, PDFName } from 'pdf-lib'
import { KINDS } from './kinds'

export interface CleanResult {
  bytes: Uint8Array
  removed: string[]
  outputName: string
}

export function canStripMetadata(kind: string): boolean {
  return ['jpeg', 'png', 'docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm', 'pdf'].includes(kind)
}

export async function stripMetadata(bytes: Uint8Array, kind: string, name: string): Promise<CleanResult> {
  const base = name.replace(/(\.[^.]+)?$/, '')
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
  const outputName = `${base}.clean${ext}`
  if (kind === 'jpeg') return { ...stripJpeg(bytes), outputName }
  if (kind === 'png') return { ...stripPng(bytes), outputName }
  if (['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm'].includes(kind)) return { ...(await stripOoxml(bytes, kind)), outputName }
  if (kind === 'pdf') return { ...(await stripPdf(bytes)), outputName }
  throw new Error(`strip_metadata is not available for ${kind} in the browser edition`)
}

export function suggestedExtension(kind: string): string | null {
  return KINDS[kind]?.ext[0] ?? null
}

// ------------------------------------------------------------ JPEG

function stripJpeg(bytes: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  const removed: string[] = []
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG')
  const parts: Uint8Array[] = [bytes.subarray(0, 2)]
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(bytes.subarray(i, i + 2))
      i += 2
      continue
    }
    if (marker === 0xda) {
      // Start of scan: copy through the end-of-image marker, drop anything after it.
      let end = bytes.length
      for (let j = bytes.length - 2; j > i; j--) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          end = j + 2
          break
        }
      }
      if (end < bytes.length) removed.push(`${bytes.length - end} trailing bytes after EOI`)
      parts.push(bytes.subarray(i, end))
      break
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    const segment = bytes.subarray(i, i + 2 + len)
    const payload = bytes.subarray(i + 4, i + 2 + len)
    const head = new TextDecoder('latin1').decode(payload.subarray(0, 29))
    let drop = false
    if (marker === 0xe1 && (head.startsWith('Exif\0') || head.startsWith('http://ns.adobe.com/xap/'))) {
      drop = true
      removed.push(head.startsWith('Exif') ? 'EXIF (APP1)' : 'XMP (APP1)')
    } else if (marker === 0xed) {
      drop = true
      removed.push('Photoshop/IPTC (APP13)')
    } else if (marker === 0xfe) {
      drop = true
      removed.push('comment (COM)')
    } else if (marker === 0xe1 && head.startsWith('http://ns.adobe.com/xmp/extension/')) {
      drop = true
      removed.push('extended XMP (APP1)')
    }
    if (!drop) parts.push(segment)
    i += 2 + len
  }
  return { bytes: concat(parts), removed }
}

// ------------------------------------------------------------ PNG

function stripPng(bytes: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  const removed: string[] = []
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  let i = 8
  while (i + 12 <= bytes.length) {
    const len = dv.getUint32(i)
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
    const chunk = bytes.subarray(i, i + 12 + len)
    if (['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) removed.push(`${type} chunk`)
    else parts.push(chunk)
    i += 12 + len
    if (type === 'IEND') {
      if (i < bytes.length) removed.push(`${bytes.length - i} trailing bytes after IEND`)
      break
    }
  }
  return { bytes: concat(parts), removed }
}

// ------------------------------------------------------------ OOXML

async function stripOoxml(bytes: Uint8Array, kind: string): Promise<{ bytes: Uint8Array; removed: string[] }> {
  const removed: string[] = []
  const zip = await JSZip.loadAsync(bytes)
  const core = zip.file('docProps/core.xml')
  if (core) {
    let xml = await core.async('string')
    for (const tag of ['dc:creator', 'cp:lastModifiedBy', 'dc:description', 'cp:keywords', 'cp:category', 'dc:subject', 'cp:lastPrinted']) {
      const re = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'g')
      if (re.test(xml)) {
        xml = xml.replace(re, `<${tag}></${tag}>`)
        removed.push(tag)
      }
    }
    xml = xml.replace(/<cp:revision>[^<]*<\/cp:revision>/, '<cp:revision>1</cp:revision>')
    zip.file('docProps/core.xml', xml)
  }
  const app = zip.file('docProps/app.xml')
  if (app) {
    let xml = await app.async('string')
    for (const tag of ['Company', 'Manager', 'HyperlinkBase']) {
      const re = new RegExp(`<${tag}>[^<]*</${tag}>`)
      if (re.test(xml)) {
        xml = xml.replace(re, `<${tag}></${tag}>`)
        removed.push(`app:${tag}`)
      }
    }
    xml = xml.replace(/<TotalTime>[^<]*<\/TotalTime>/, '<TotalTime>0</TotalTime>')
    zip.file('docProps/app.xml', xml)
  }
  const dropParts = Object.keys(zip.files).filter((n) => /^docProps\/(custom\.xml|thumbnail\.[a-z]+)$/i.test(n) || /^word\/(comments|commentsExtended|commentsIds|people)\.xml$/.test(n))
  for (const part of dropParts) {
    zip.remove(part)
    removed.push(part)
  }
  // Content types and package relationships must no longer mention removed parts.
  const ct = zip.file('[Content_Types].xml')
  if (ct && dropParts.length) {
    let xml = await ct.async('string')
    for (const part of dropParts) xml = xml.replace(new RegExp(`<Override[^>]*PartName="/${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`), '')
    zip.file('[Content_Types].xml', xml)
  }
  for (const relPath of ['_rels/.rels', 'word/_rels/document.xml.rels']) {
    const rel = zip.file(relPath)
    if (!rel) continue
    let xml = await rel.async('string')
    for (const part of dropParts) {
      const leaf = part.split('/').pop()!
      xml = xml.replace(new RegExp(`<Relationship[^>]*Target="[^"]*${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`), '')
    }
    zip.file(relPath, xml)
  }
  if (kind.startsWith('doc')) {
    const docPart = zip.file('word/document.xml')
    if (docPart) {
      let xml = await docPart.async('string')
      const before = xml.length
      xml = xml.replace(/<w:commentRangeStart[^>]*\/>|<w:commentRangeEnd[^>]*\/>/g, '')
      xml = xml.replace(/<w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:commentReference[^>]*\/><\/w:r>/g, '')
      xml = xml.replace(/\s+w:rsid(?:R|RPr|RDefault|Del|P|Sect|Tr)?="[0-9A-Fa-f]{8}"/g, '')
      if (xml.length !== before) removed.push('comment anchors and rsid attributes in document.xml')
      zip.file('word/document.xml', xml)
    }
    const settings = zip.file('word/settings.xml')
    if (settings) {
      let xml = await settings.async('string')
      if (/<w:rsids>/.test(xml)) {
        xml = xml.replace(/<w:rsids>[\s\S]*?<\/w:rsids>/, '')
        removed.push('editing session identifiers (rsids)')
      }
      zip.file('word/settings.xml', xml)
    }
  }
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return { bytes: out, removed }
}

// ------------------------------------------------------------ PDF

async function stripPdf(bytes: Uint8Array): Promise<{ bytes: Uint8Array; removed: string[] }> {
  const removed: string[] = []
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const before = { title: doc.getTitle(), author: doc.getAuthor(), subject: doc.getSubject(), producer: doc.getProducer(), creator: doc.getCreator(), keywords: doc.getKeywords() }
  doc.setTitle('')
  doc.setAuthor('')
  doc.setSubject('')
  doc.setKeywords([])
  doc.setProducer('')
  doc.setCreator('')
  for (const [k, v] of Object.entries(before)) if (v) removed.push(`Info ${k}`)
  if (doc.catalog.has(PDFName.of('Metadata'))) {
    doc.catalog.delete(PDFName.of('Metadata'))
    removed.push('XMP metadata stream')
  }
  const out = await doc.save({ useObjectStreams: false, addDefaultPage: false })
  removed.push('previous revisions (file rewritten as a single revision)')
  return { bytes: out, removed }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
