import JSZip from 'jszip'
import type { ContainerEntry } from './types'
import { extensionOf, kindFromExtension } from './kinds'

export interface ZipListing {
  zip: JSZip
  entries: ContainerEntry[]
  entryCount: number
  encryptedEntries: number
  truncated: boolean
}

export const ZIP_ENTRY_LIMIT = 2000

export async function listZip(bytes: Uint8Array): Promise<ZipListing> {
  const zip = await JSZip.loadAsync(bytes)
  const entries: ContainerEntry[] = []
  let count = 0
  for (const [name, file] of Object.entries(zip.files)) {
    count++
    if (entries.length >= ZIP_ENTRY_LIMIT) continue
    const raw = (file as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } })._data
    const size = raw?.uncompressedSize ?? 0
    const csize = raw?.compressedSize
    entries.push({
      path: name,
      sizeBytes: size < 0 ? 0 : size,
      compressedBytes: csize !== undefined && csize >= 0 ? csize : undefined,
      isDir: file.dir,
      modified: file.date ? file.date.toISOString() : undefined,
      kind: file.dir ? undefined : kindFromExtension(extensionOf(name)) ?? undefined,
    })
  }
  return { zip, entries, entryCount: count, encryptedEntries: countEncryptedEntries(bytes), truncated: count > entries.length }
}

/** Count local file headers whose general-purpose bit 0 (encryption) is set. */
export function countEncryptedEntries(bytes: Uint8Array, limit = 4096): number {
  let n = 0
  let scanned = 0
  const end = bytes.length - 30
  for (let i = 0; i <= end && scanned < limit; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      scanned++
      const flag = bytes[i + 6] | (bytes[i + 7] << 8)
      if (flag & 1) n++
      const nameLen = bytes[i + 26] | (bytes[i + 27] << 8)
      const extraLen = bytes[i + 28] | (bytes[i + 29] << 8)
      i += 29 + nameLen + extraLen
    }
  }
  return n
}

/** Bytes after the end-of-central-directory record: appended payloads hide here. */
export function zipTrailingBytes(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 65557)
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      const commentLen = bytes[i + 20] | (bytes[i + 21] << 8)
      const end = i + 22 + commentLen
      return Math.max(0, bytes.length - end)
    }
  }
  return 0
}

/** Refine a ZIP into the package format its entries reveal. */
export async function classifyZip(listing: ZipListing): Promise<string> {
  const names = new Set(listing.entries.map((e) => e.path))
  const has = (n: string) => names.has(n)
  if (has('[Content_Types].xml')) {
    const ct = await readText(listing.zip, '[Content_Types].xml', 200_000)
    if (ct) {
      if (ct.includes('wordprocessingml.document.macroEnabled')) return 'docm'
      if (ct.includes('spreadsheetml.sheet.macroEnabled') || ct.includes('ms-excel.sheet.macroEnabled')) return 'xlsm'
      if (ct.includes('presentationml.presentation.macroEnabled') || ct.includes('ms-powerpoint.presentation.macroEnabled')) return 'pptm'
      if (ct.includes('wordprocessingml')) return 'docx'
      if (ct.includes('spreadsheetml')) return 'xlsx'
      if (ct.includes('presentationml')) return 'pptx'
      if (ct.includes('FixedDocumentSequence') || ct.includes('/xps')) return 'xps'
    }
    if (has('word/document.xml')) return 'docx'
    if (has('xl/workbook.xml')) return 'xlsx'
    if (has('ppt/presentation.xml')) return 'pptx'
  }
  if (has('mimetype')) {
    const mime = (await readText(listing.zip, 'mimetype', 200)) ?? ''
    if (mime.includes('opendocument.text')) return 'odt'
    if (mime.includes('opendocument.spreadsheet')) return 'ods'
    if (mime.includes('opendocument.presentation')) return 'odp'
    if (mime.includes('epub')) return 'epub'
  }
  if (has('AndroidManifest.xml') && [...names].some((n) => n.endsWith('.dex'))) return 'apk'
  if (has('META-INF/MANIFEST.MF') && [...names].some((n) => n.endsWith('.class'))) return 'jar'
  return 'zip'
}

export async function readText(zip: JSZip, path: string, maxBytes: number): Promise<string | null> {
  const f = zip.file(path)
  if (!f) return null
  const bytes = await f.async('uint8array')
  return new TextDecoder().decode(bytes.subarray(0, maxBytes))
}

export async function readBytes(zip: JSZip, path: string, maxBytes: number): Promise<Uint8Array | null> {
  const f = zip.file(path)
  if (!f) return null
  const bytes = await f.async('uint8array')
  return bytes.length > maxBytes ? bytes.subarray(0, maxBytes) : bytes
}
