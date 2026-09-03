import type { Family } from './types'

export interface KindInfo {
  label: string
  family: Family
  ext: string[]
  /** Slug of the matching page at universalfileopener.com/formats/<slug>/ */
  page?: string
}

export const KINDS: Record<string, KindInfo> = {
  pdf: { label: 'PDF document', family: 'document', ext: ['pdf'], page: 'pdf' },
  docx: { label: 'Word document (OOXML)', family: 'document', ext: ['docx', 'dotx'], page: 'docx' },
  docm: { label: 'Word document, macro-enabled', family: 'document', ext: ['docm', 'dotm'], page: 'docx' },
  xlsx: { label: 'Excel workbook (OOXML)', family: 'spreadsheet', ext: ['xlsx', 'xltx'], page: 'xlsx' },
  xlsm: { label: 'Excel workbook, macro-enabled', family: 'spreadsheet', ext: ['xlsm', 'xltm'], page: 'xlsx' },
  pptx: { label: 'PowerPoint presentation (OOXML)', family: 'presentation', ext: ['pptx', 'potx', 'ppsx'], page: 'pptx' },
  pptm: { label: 'PowerPoint presentation, macro-enabled', family: 'presentation', ext: ['pptm', 'ppsm'], page: 'pptx' },
  odt: { label: 'OpenDocument text', family: 'document', ext: ['odt', 'ott'], page: 'odt' },
  ods: { label: 'OpenDocument spreadsheet', family: 'spreadsheet', ext: ['ods', 'ots'], page: 'ods' },
  odp: { label: 'OpenDocument presentation', family: 'presentation', ext: ['odp', 'otp'], page: 'odp' },
  doc: { label: 'Word 97-2003 document (OLE)', family: 'document', ext: ['doc', 'dot'], page: 'doc' },
  xls: { label: 'Excel 97-2003 workbook (OLE)', family: 'spreadsheet', ext: ['xls', 'xlt'], page: 'xls' },
  ppt: { label: 'PowerPoint 97-2003 (OLE)', family: 'presentation', ext: ['ppt', 'pps', 'pot'], page: 'ppt' },
  msg: { label: 'Outlook message (OLE)', family: 'email', ext: ['msg'], page: 'msg' },
  ole: { label: 'OLE compound file', family: 'binary', ext: [] },
  rtf: { label: 'Rich Text Format', family: 'document', ext: ['rtf'], page: 'rtf' },
  epub: { label: 'EPUB e-book', family: 'document', ext: ['epub'], page: 'epub' },
  xps: { label: 'XPS document', family: 'document', ext: ['xps', 'oxps'], page: 'xps' },
  zip: { label: 'ZIP archive', family: 'archive', ext: ['zip'], page: 'zip' },
  jar: { label: 'Java archive', family: 'archive', ext: ['jar', 'war', 'ear'] },
  apk: { label: 'Android package', family: 'archive', ext: ['apk'], page: 'apk' },
  '7z': { label: '7-Zip archive', family: 'archive', ext: ['7z'], page: '7z' },
  rar: { label: 'RAR archive', family: 'archive', ext: ['rar'], page: 'rar' },
  gzip: { label: 'gzip stream', family: 'archive', ext: ['gz', 'tgz'], page: 'targz' },
  bzip2: { label: 'bzip2 stream', family: 'archive', ext: ['bz2', 'tbz2'] },
  xz: { label: 'xz stream', family: 'archive', ext: ['xz', 'txz'] },
  zstd: { label: 'Zstandard stream', family: 'archive', ext: ['zst'] },
  tar: { label: 'tar archive', family: 'archive', ext: ['tar'], page: 'targz' },
  iso: { label: 'ISO 9660 disc image', family: 'archive', ext: ['iso'], page: 'iso' },
  cab: { label: 'Microsoft cabinet', family: 'archive', ext: ['cab'] },
  jpeg: { label: 'JPEG image', family: 'image', ext: ['jpg', 'jpeg', 'jpe', 'jfif'], page: 'jpg' },
  png: { label: 'PNG image', family: 'image', ext: ['png'], page: 'png' },
  gif: { label: 'GIF image', family: 'image', ext: ['gif'], page: 'gif' },
  webp: { label: 'WebP image', family: 'image', ext: ['webp'], page: 'webp' },
  tiff: { label: 'TIFF image', family: 'image', ext: ['tif', 'tiff'], page: 'tiff' },
  bmp: { label: 'Windows bitmap', family: 'image', ext: ['bmp', 'dib'], page: 'bmp' },
  heic: { label: 'HEIF/HEIC image', family: 'image', ext: ['heic', 'heif', 'hif'], page: 'heic' },
  avif: { label: 'AVIF image', family: 'image', ext: ['avif'], page: 'avif' },
  ico: { label: 'Windows icon', family: 'image', ext: ['ico', 'cur'], page: 'ico' },
  svg: { label: 'SVG vector image', family: 'image', ext: ['svg'], page: 'svg' },
  psd: { label: 'Photoshop document', family: 'image', ext: ['psd'] },
  jxl: { label: 'JPEG XL image', family: 'image', ext: ['jxl'], page: 'jxl' },
  mp3: { label: 'MP3 audio', family: 'audio', ext: ['mp3'], page: 'mp3' },
  wav: { label: 'WAV audio', family: 'audio', ext: ['wav'], page: 'wav' },
  flac: { label: 'FLAC audio', family: 'audio', ext: ['flac'], page: 'flac' },
  ogg: { label: 'Ogg container', family: 'audio', ext: ['ogg', 'oga', 'opus'], page: 'opus' },
  m4a: { label: 'MPEG-4 audio', family: 'audio', ext: ['m4a'], page: 'm4a' },
  mp4: { label: 'MPEG-4 video', family: 'video', ext: ['mp4', 'm4v'], page: 'mp4' },
  mov: { label: 'QuickTime movie', family: 'video', ext: ['mov'] },
  mkv: { label: 'Matroska video', family: 'video', ext: ['mkv'], page: 'mkv' },
  webm: { label: 'WebM video', family: 'video', ext: ['webm'] },
  avi: { label: 'AVI video', family: 'video', ext: ['avi'], page: 'avi' },
  exe: { label: 'Windows executable (PE)', family: 'executable', ext: ['exe', 'dll', 'sys', 'scr', 'com'] },
  elf: { label: 'ELF executable', family: 'executable', ext: ['so', 'elf', 'o'] },
  macho: { label: 'Mach-O executable', family: 'executable', ext: ['dylib'] },
  class: { label: 'Java class', family: 'executable', ext: ['class'] },
  dex: { label: 'Dalvik executable', family: 'executable', ext: ['dex'] },
  wasm: { label: 'WebAssembly module', family: 'executable', ext: ['wasm'] },
  lnk: { label: 'Windows shortcut', family: 'executable', ext: ['lnk'] },
  sqlite: { label: 'SQLite database', family: 'database', ext: ['sqlite', 'db', 'sqlite3', 'db3'], page: 'sqlite' },
  pcap: { label: 'Packet capture', family: 'binary', ext: ['pcap', 'pcapng', 'cap'] },
  eml: { label: 'Email message (RFC 822)', family: 'email', ext: ['eml', 'mbox'], page: 'eml' },
  ics: { label: 'iCalendar', family: 'text', ext: ['ics'], page: 'ics' },
  vcf: { label: 'vCard', family: 'text', ext: ['vcf'], page: 'vcf' },
  pem: { label: 'PEM certificate or key', family: 'certificate', ext: ['pem', 'crt', 'cer', 'key'], page: 'certificates' },
  der: { label: 'DER certificate or key', family: 'certificate', ext: ['der', 'p12', 'pfx'], page: 'certificates' },
  json: { label: 'JSON', family: 'text', ext: ['json', 'jsonl', 'geojson'], page: 'json' },
  csv: { label: 'CSV table', family: 'text', ext: ['csv', 'tsv'], page: 'csv' },
  markdown: { label: 'Markdown', family: 'text', ext: ['md', 'markdown', 'mdown'], page: 'markdown' },
  html: { label: 'HTML page', family: 'text', ext: ['html', 'htm', 'xhtml'], page: 'html' },
  mhtml: { label: 'Saved web page (MHTML)', family: 'text', ext: ['mht', 'mhtml'], page: 'mht' },
  xml: { label: 'XML', family: 'text', ext: ['xml', 'xsd', 'xsl', 'plist'], page: 'config' },
  yaml: { label: 'YAML', family: 'text', ext: ['yml', 'yaml'], page: 'config' },
  config: { label: 'Configuration text', family: 'text', ext: ['ini', 'toml', 'cfg', 'conf', 'env', 'properties'], page: 'config' },
  log: { label: 'Log file', family: 'text', ext: ['log'], page: 'logs' },
  text: { label: 'Plain text', family: 'text', ext: ['txt', 'text', 'nfo', 'srt', 'vtt'], page: 'txt' },
  code: { label: 'Source code', family: 'code', ext: ['py', 'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'r', 'scala', 'lua', 'pl', 'dart', 'gradle', 'css', 'scss', 'vue', 'svelte', 'tf', 'proto', 'graphql'], page: 'code' },
  ttf: { label: 'TrueType font', family: 'font', ext: ['ttf', 'ttc'], page: 'ttf' },
  otf: { label: 'OpenType font', family: 'font', ext: ['otf'], page: 'ttf' },
  woff: { label: 'WOFF web font', family: 'font', ext: ['woff'], page: 'woff' },
  woff2: { label: 'WOFF2 web font', family: 'font', ext: ['woff2'], page: 'woff' },
  torrent: { label: 'BitTorrent metadata', family: 'text', ext: ['torrent'] },
  mobi: { label: 'Mobipocket e-book', family: 'document', ext: ['mobi', 'prc', 'azw'], page: 'mobi' },
  binary: { label: 'Unrecognized binary data', family: 'binary', ext: ['bin', 'dat'], page: 'unknown' },
  empty: { label: 'Empty file', family: 'unknown', ext: [] },
}

const byExt = new Map<string, string>()
for (const [kind, info] of Object.entries(KINDS)) for (const e of info.ext) byExt.set(e, kind)

export function kindFromExtension(ext: string | null): string | null {
  if (!ext) return null
  return byExt.get(ext.toLowerCase()) ?? null
}

export function kindInfo(kind: string): KindInfo {
  return KINDS[kind] ?? { label: kind, family: 'unknown', ext: [] }
}

/** Kinds that are ZIP packages: a .zip name is not a mismatch for these. */
export const ZIP_BASED = new Set(['docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm', 'odt', 'ods', 'odp', 'epub', 'xps', 'jar', 'apk', 'zip'])
export const OLE_BASED = new Set(['doc', 'xls', 'ppt', 'msg', 'ole'])

/** Extension of a name, lowercase, or null. */
export function extensionOf(name: string): string | null {
  const base = name.split('/').pop() ?? name
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return null
  const ext = base.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : null
}
