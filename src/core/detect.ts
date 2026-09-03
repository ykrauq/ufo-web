import { kindFromExtension, ZIP_BASED, OLE_BASED, KINDS } from './kinds'
import { printableRatio } from './text'

interface Signature {
  kind: string
  offset: number
  bytes: number[]
  strong: boolean
}

const S = (kind: string, bytes: number[] | string, strong = true, offset = 0): Signature => ({
  kind,
  offset,
  bytes: typeof bytes === 'string' ? [...bytes].map((c) => c.charCodeAt(0)) : bytes,
  strong,
})

// Strong signatures may overrule a contradictory name. Weak ones are
// text-shaped bytes ordinary text can legitimately begin with, so they stay name-led.
const SIGNATURES: Signature[] = [
  S('png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  S('jpeg', [0xff, 0xd8, 0xff]),
  S('gif', 'GIF87a'), S('gif', 'GIF89a'),
  S('tiff', [0x49, 0x49, 0x2a, 0x00]), S('tiff', [0x4d, 0x4d, 0x00, 0x2a]),
  S('bmp', 'BM', false),
  S('ico', [0x00, 0x00, 0x01, 0x00]), S('ico', [0x00, 0x00, 0x02, 0x00]),
  S('psd', '8BPS'),
  S('jxl', [0xff, 0x0a]), S('jxl', [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20]),
  S('zip', [0x50, 0x4b, 0x03, 0x04]), S('zip', [0x50, 0x4b, 0x05, 0x06]), S('zip', [0x50, 0x4b, 0x07, 0x08]),
  S('7z', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  S('rar', [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]),
  S('gzip', [0x1f, 0x8b]),
  S('bzip2', 'BZh'),
  S('xz', [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]),
  S('zstd', [0x28, 0xb5, 0x2f, 0xfd]),
  S('cab', 'MSCF'),
  S('tar', 'ustar', true, 257),
  S('iso', 'CD001', true, 32769),
  S('ole', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  S('exe', 'MZ'),
  S('elf', [0x7f, 0x45, 0x4c, 0x46]),
  S('macho', [0xfe, 0xed, 0xfa, 0xce]), S('macho', [0xfe, 0xed, 0xfa, 0xcf]),
  S('macho', [0xcf, 0xfa, 0xed, 0xfe]), S('macho', [0xce, 0xfa, 0xed, 0xfe]),
  S('dex', 'dex\n'),
  S('wasm', [0x00, 0x61, 0x73, 0x6d]),
  S('lnk', [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00]),
  S('sqlite', 'SQLite format 3 '),
  S('pcap', [0xa1, 0xb2, 0xc3, 0xd4]), S('pcap', [0xd4, 0xc3, 0xb2, 0xa1]), S('pcap', [0x0a, 0x0d, 0x0d, 0x0a]),
  S('flac', 'fLaC'),
  S('ogg', 'OggS'),
  S('mp3', 'ID3', false),
  S('otf', 'OTTO'),
  S('woff', 'wOFF'),
  S('woff2', 'wOF2'),
  S('ttf', 'true'), S('ttf', 'ttcf'),
  S('rtf', '{\\rtf', false),
  S('pem', '-----BEGIN', false),
  S('ics', 'BEGIN:VCALENDAR', false),
  S('vcf', 'BEGIN:VCARD', false),
  S('torrent', 'd8:announce', false),
  S('mobi', 'BOOKMOBI', true, 60),
]

function matchAt(bytes: Uint8Array, sig: Signature): boolean {
  if (bytes.length < sig.offset + sig.bytes.length) return false
  for (let i = 0; i < sig.bytes.length; i++) if (bytes[sig.offset + i] !== sig.bytes[i]) return false
  return true
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = ''
  for (let i = start; i < Math.min(bytes.length, start + len); i++) s += String.fromCharCode(bytes[i])
  return s
}

function indexOfAscii(bytes: Uint8Array, needle: string, limit: number): number {
  const n = [...needle].map((c) => c.charCodeAt(0))
  const end = Math.min(bytes.length, limit) - n.length
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer
    return i
  }
  return -1
}

export interface MagicResult {
  kind: string | null
  strong: boolean
  note?: string
}

/** What the bytes say, independent of the name. Container refinement happens in inspect. */
export function fromMagic(bytes: Uint8Array): MagicResult {
  if (bytes.length === 0) return { kind: 'empty', strong: true }
  if (ascii(bytes, 0, 4) === 'RIFF') {
    const form = ascii(bytes, 8, 4)
    if (form === 'WEBP') return { kind: 'webp', strong: true }
    if (form === 'WAVE') return { kind: 'wav', strong: true }
    if (form === 'AVI ') return { kind: 'avi', strong: true }
  }
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4)
    if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|avci)$/.test(brand)) return { kind: 'heic', strong: true, note: `brand ${brand}` }
    if (/^(avif|avis)$/.test(brand)) return { kind: 'avif', strong: true }
    if (brand === 'M4A ') return { kind: 'm4a', strong: true }
    if (brand === 'qt  ') return { kind: 'mov', strong: true }
    return { kind: 'mp4', strong: true, note: `brand ${brand.trim()}` }
  }
  if (matchAt(bytes, S('x', [0x1a, 0x45, 0xdf, 0xa3]))) {
    return indexOfAscii(bytes, 'webm', 64) >= 0 ? { kind: 'webm', strong: true } : { kind: 'mkv', strong: true }
  }
  // Java class and fat Mach-O share CAFEBABE; class files carry a version >= 45 at byte 7.
  if (matchAt(bytes, S('x', [0xca, 0xfe, 0xba, 0xbe]))) {
    return bytes.length > 7 && bytes[7] >= 45 ? { kind: 'class', strong: true } : { kind: 'macho', strong: true }
  }
  // %PDF may be preceded by junk; the spec tolerates it within the first 1024 bytes.
  const pdfAt = indexOfAscii(bytes, '%PDF-', 1024)
  if (pdfAt >= 0) return { kind: 'pdf', strong: true, note: pdfAt > 0 ? `header at offset ${pdfAt}` : undefined }
  for (const sig of SIGNATURES) if (matchAt(bytes, sig)) return { kind: sig.kind, strong: sig.strong }
  if (bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2 && (bytes[1] & 0x18) !== 0x08) {
    return { kind: 'mp3', strong: false, note: 'frame sync only' }
  }
  return sniffText(bytes)
}

function sniffText(bytes: Uint8Array): MagicResult {
  const head = bytes.subarray(0, 4096)
  const hasUtf16Bom = head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))
  const ratio = printableRatio(head)
  if (!hasUtf16Bom && ratio < 0.9) return { kind: null, strong: false }
  const text = new TextDecoder(hasUtf16Bom ? 'utf-16' : 'utf-8').decode(head).replace(/^\uFEFF/, '')
  const trimmed = text.trimStart()
  const lower = trimmed.slice(0, 512).toLowerCase()
  if (lower.startsWith('<?xml')) {
    if (lower.includes('<svg')) return { kind: 'svg', strong: false }
    return { kind: 'xml', strong: false }
  }
  if (lower.startsWith('<svg')) return { kind: 'svg', strong: false }
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) return { kind: 'html', strong: false }
  if (/^(from|received|return-path|delivered-to|mime-version|subject|x-[a-z-]+|message-id|date):/i.test(trimmed)) {
    return { kind: 'eml', strong: false }
  }
  if (/^[{[]/.test(trimmed)) return { kind: 'json', strong: false }
  return { kind: 'text', strong: false }
}

export interface Resolved {
  kind: string
  nameSaysKind: string | null
  bytesSayKind: string | null
  nameAndBytesDisagree: boolean
  method: 'magic' | 'container' | 'extension' | 'sniff' | 'none'
  strength: 'strong' | 'weak' | 'none'
  note?: string
}

/**
 * Combine the name's claim and the bytes' claim. `containerKind` is the
 * refinement produced by looking inside a ZIP or OLE container.
 */
export function resolveKind(ext: string | null, magic: MagicResult, containerKind: string | null): Resolved {
  const nameSaysKind = kindFromExtension(ext)
  let bytesSayKind = magic.kind
  let method: Resolved['method'] = magic.kind ? (magic.strong ? 'magic' : 'sniff') : 'none'
  if (containerKind) {
    bytesSayKind = containerKind
    method = 'container'
  }
  let kind: string
  let strength: Resolved['strength']
  if (bytesSayKind && (magic.strong || containerKind)) {
    kind = bytesSayKind
    strength = 'strong'
    if (kind === 'ole' && nameSaysKind && OLE_BASED.has(nameSaysKind)) kind = nameSaysKind
    if (kind === 'zip' && nameSaysKind && ZIP_BASED.has(nameSaysKind) && !containerKind) kind = nameSaysKind
  } else if (nameSaysKind) {
    kind = nameSaysKind
    strength = bytesSayKind ? 'weak' : 'none'
    method = 'extension'
    // A text-shaped name over clearly binary bytes is suspicious in itself.
    if (!bytesSayKind && (KINDS[nameSaysKind]?.family === 'text' || KINDS[nameSaysKind]?.family === 'code')) kind = 'binary'
  } else if (bytesSayKind) {
    kind = bytesSayKind
    strength = 'weak'
  } else {
    kind = 'binary'
    strength = 'none'
  }
  const disagree = computeDisagree(nameSaysKind, bytesSayKind, kind, !!containerKind || magic.strong)
  return { kind, nameSaysKind, bytesSayKind, nameAndBytesDisagree: disagree, method, strength, note: magic.note }
}

function computeDisagree(nameSays: string | null, bytesSay: string | null, kind: string, strong: boolean): boolean {
  if (!nameSays || !bytesSay || !strong) return false
  if (nameSays === bytesSay || nameSays === kind) return false
  if (nameSays === 'zip' && ZIP_BASED.has(bytesSay)) return false
  if (OLE_BASED.has(nameSays) && bytesSay === 'ole') return false
  const macroPairs: Record<string, string> = { docm: 'docx', xlsm: 'xlsx', pptm: 'pptx' }
  if (macroPairs[bytesSay] === nameSays || macroPairs[nameSays] === bytesSay) return false
  const textish = (k: string) => KINDS[k]?.family === 'text' || KINDS[k]?.family === 'code'
  if (textish(nameSays) && textish(bytesSay)) return false
  return true
}
