import exifr from 'exifr'
import type { DateEvent, Finding, Flag } from './types'

export interface ImageResult {
  metadata: Record<string, string | number | boolean | null>
  flags: Flag[]
  findings: Omit<Finding, 'id' | 'path' | 'source'>[]
  dates: DateEvent[]
  notes: string[]
}

function asString(v: unknown): string | null {
  if (v === undefined || v === null) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'object') return null
  return String(v)
}

function pushFlag(out: ImageResult, flag: Flag) {
  if (!out.flags.includes(flag)) out.flags.push(flag)
}

export async function inspectImage(bytes: Uint8Array, kind: string, path: string): Promise<ImageResult> {
  const out: ImageResult = { metadata: {}, flags: [], findings: [], dates: [], notes: [] }
  const dims = dimensions(bytes, kind)
  if (dims) {
    out.metadata.width = dims.w
    out.metadata.height = dims.h
  }
  if (kind === 'png') pngTextChunks(bytes, out)
  if (kind === 'jpeg') jpegTrailing(bytes, out)
  if (!['jpeg', 'tiff', 'heic', 'avif', 'png', 'webp'].includes(kind)) return out
  let parsed: Record<string, unknown> | undefined
  try {
    parsed = (await exifr.parse(bytes, { tiff: true, xmp: true, iptc: true, icc: false, gps: true, interop: false, ifd1: true, mergeOutput: true, translateValues: true, reviveValues: true })) as Record<string, unknown> | undefined
  } catch (error) {
    out.notes.push(`metadata parse failed: ${error instanceof Error ? error.message : String(error)}`)
    return out
  }
  if (!parsed) return out
  const take = (keys: string[], as: string) => {
    for (const k of keys) {
      const v = asString(parsed![k])
      if (v) {
        out.metadata[as] = v
        return v
      }
    }
    return null
  }
  const make = take(['Make'], 'cameraMake')
  const model = take(['Model'], 'cameraModel')
  const software = take(['Software', 'CreatorTool'], 'software')
  const artist = take(['Artist', 'Creator', 'By-line', 'creator', 'OwnerName', 'CameraOwnerName'], 'artist')
  const copyright = take(['Copyright', 'Rights', 'CopyrightNotice'], 'copyright')
  const description = take(['ImageDescription', 'Description', 'Caption-Abstract', 'UserComment', 'description'], 'description')
  const serial = take(['BodySerialNumber', 'SerialNumber', 'InternalSerialNumber', 'CameraSerialNumber'], 'bodySerialNumber')
  const lensSerial = take(['LensSerialNumber'], 'lensSerialNumber')
  take(['LensModel', 'Lens'], 'lens')
  const original = take(['DateTimeOriginal', 'CreateDate', 'DateCreated'], 'dateTimeOriginal')
  const modify = take(['ModifyDate', 'DateTime'], 'modifyDate')
  const pairs: [string | null, string][] = [[original, 'photo taken'], [modify, 'image modified']]
  for (const [when, what] of pairs) {
    if (when && !Number.isNaN(Date.parse(when))) out.dates.push({ path, when: new Date(when).toISOString(), what, source: 'EXIF' })
  }
  const lat = parsed.latitude as number | undefined
  const lon = parsed.longitude as number | undefined
  if (typeof lat === 'number' && typeof lon === 'number') {
    pushFlag(out, 'has_gps')
    out.metadata.gpsLatitude = Number(lat.toFixed(5))
    out.metadata.gpsLongitude = Number(lon.toFixed(5))
    if (parsed.GPSAltitude !== undefined) out.metadata.gpsAltitude = asString(parsed.GPSAltitude)
    out.findings.push({ category: 'privacy', severity: 'high', flag: 'has_gps', where: 'EXIF GPS', title: `GPS location embedded: ${lat.toFixed(4)}, ${lon.toFixed(4)}`, detail: 'The exact position where the photo was taken travels inside the file. Anyone who receives it can map it.' })
  }
  if (artist || copyright) {
    pushFlag(out, 'has_author')
    out.findings.push({ category: 'privacy', severity: 'medium', flag: 'has_author', where: 'EXIF/IPTC', title: 'Photographer or owner name embedded', detail: `${artist ? `Artist "${artist}"` : ''}${artist && copyright ? '; ' : ''}${copyright ? `copyright "${copyright}"` : ''}.` })
  }
  if (serial || lensSerial) {
    pushFlag(out, 'has_device_ids')
    out.findings.push({ category: 'privacy', severity: 'medium', flag: 'has_device_ids', where: 'EXIF', title: 'Camera body or lens serial number embedded', detail: `Serial numbers uniquely identify the device across every photo it has ever taken${make || model ? ` (${[make, model].filter(Boolean).join(' ')})` : ''}.` })
  }
  if (description) {
    out.findings.push({ category: 'privacy', severity: 'medium', where: 'EXIF/IPTC', title: 'Description or comment field carries text', detail: 'Free-text fields often hold names, locations, or notes typed into a photo tool.', evidence: description.slice(0, 200) })
  }
  if (make || model || software) {
    out.findings.push({ category: 'info', severity: 'info', where: 'EXIF', title: `Device and software: ${[make, model].filter(Boolean).join(' ') || 'unknown device'}${software ? `, ${software}` : ''}`, detail: 'Make, model, and editing software fingerprint the workflow that produced the image.' })
  }
  if (parsed.xmp || Object.keys(parsed).some((k) => /^(xmp|dc|photoshop|crs|aux)$/i.test(k))) pushFlag(out, 'has_xmp')
  try {
    const thumb = await exifr.thumbnail(bytes)
    if (thumb && thumb.length > 0) {
      pushFlag(out, 'has_thumbnail')
      out.metadata.embeddedThumbnailBytes = thumb.length
      out.findings.push({ category: 'privacy', severity: 'medium', flag: 'has_thumbnail', where: 'EXIF IFD1', title: `Embedded thumbnail (${thumb.length} bytes)`, detail: 'Thumbnails are generated when the photo is taken and are not always updated when the image is cropped or redacted. They can show the uncropped original.' })
    }
  } catch {
    /* no thumbnail */
  }
  return out
}

function dimensions(bytes: Uint8Array, kind: string): { w: number; h: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    if (kind === 'png' && bytes.length >= 24) return { w: dv.getUint32(16), h: dv.getUint32(20) }
    if (kind === 'gif' && bytes.length >= 10) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) }
    if (kind === 'bmp' && bytes.length >= 26) return { w: dv.getInt32(18, true), h: Math.abs(dv.getInt32(22, true)) }
    if (kind === 'jpeg') {
      let i = 2
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null
        const marker = bytes[i + 1]
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2
          continue
        }
        const len = dv.getUint16(i + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) }
        }
        i += 2 + len
      }
    }
  } catch {
    return null
  }
  return null
}

/** PNG textual chunks (tEXt/zTXt/iTXt) hold author, software, comments. */
function pngTextChunks(bytes: Uint8Array, out: ImageResult) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let i = 8
  const texts: string[] = []
  let count = 0
  while (i + 12 <= bytes.length && count < 200) {
    const len = dv.getUint32(i)
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const data = bytes.subarray(i + 8, i + 8 + Math.min(len, 4000))
      const nul = data.indexOf(0)
      const key = new TextDecoder('latin1').decode(data.subarray(0, nul < 0 ? data.length : nul))
      let value = ''
      if (type === 'tEXt') value = new TextDecoder('latin1').decode(data.subarray(nul + 1))
      else if (type === 'iTXt') {
        const rest = data.subarray(nul + 1)
        const compressed = rest[0] === 1
        let p = 2
        const lang = rest.indexOf(0, p)
        p = lang + 1
        const trans = rest.indexOf(0, p)
        p = trans + 1
        value = compressed ? '(compressed iTXt)' : new TextDecoder('utf-8').decode(rest.subarray(p))
      } else value = '(compressed zTXt)'
      texts.push(`${key}: ${value.replace(/\s+/g, ' ').slice(0, 200)}`)
      out.metadata[`png:${key}`] = value.slice(0, 500)
      count++
    }
    if (type === 'eXIf') pushFlag(out, 'has_xmp')
    if (type === 'IEND') {
      const trailing = bytes.length - (i + 12)
      if (trailing > 0) {
        pushFlag(out, 'has_trailing_data')
        out.metadata.trailingBytes = trailing
        out.findings.push({ category: 'integrity', severity: 'high', flag: 'has_trailing_data', where: 'after IEND', title: `${trailing} bytes appended after the image ends`, detail: 'Image viewers stop at IEND; anything after it is a hidden payload, often a second file.' })
      }
      break
    }
    i += 12 + len
  }
  if (texts.length) {
    const hasAuthor = texts.some((t) => /^(Author|Artist|Copyright)/i.test(t))
    if (hasAuthor) pushFlag(out, 'has_author')
    out.findings.push({ category: 'privacy', severity: hasAuthor ? 'medium' : 'low', flag: hasAuthor ? 'has_author' : undefined, where: 'PNG text chunks', title: `${texts.length} text chunk${texts.length === 1 ? '' : 's'} embedded`, detail: 'PNG text chunks carry author, software, and comment strings that survive copy-paste between tools.', evidence: texts.slice(0, 5).join('\n') })
  }
}

/** Bytes after the JPEG EOI marker: a common place to append an archive. */
function jpegTrailing(bytes: Uint8Array, out: ImageResult) {
  for (let i = bytes.length - 2; i >= Math.max(2, bytes.length - 8_000_000); i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      const trailing = bytes.length - (i + 2)
      if (trailing > 16) {
        pushFlag(out, 'has_trailing_data')
        out.metadata.trailingBytes = trailing
        out.findings.push({ category: 'integrity', severity: 'high', flag: 'has_trailing_data', where: 'after EOI', title: `${trailing} bytes appended after the image ends`, detail: 'Decoders stop at the end-of-image marker; appended bytes are invisible in any viewer and often hold a ZIP or script.' })
      }
      return
    }
  }
}
