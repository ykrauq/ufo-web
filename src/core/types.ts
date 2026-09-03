// Receipt schema shared in spirit with the `ufo inspect --json` command line:
// the identity fields (path, name, kind, extension, sizeBytes, sha256,
// lastModifiedMillis, nameSaysKind, bytesSayKind, nameAndBytesDisagree) use
// the same names so a web receipt and a CLI receipt line up field for field.

export const RECEIPT_SCHEMA = 'ufo-receipt/0.1'

export type Family =
  | 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'image' | 'audio' | 'video'
  | 'executable' | 'database' | 'email' | 'text' | 'code' | 'font' | 'certificate' | 'binary' | 'unknown'

export type Severity = 'info' | 'low' | 'medium' | 'high'
export type FindingCategory = 'privacy' | 'hidden' | 'integrity' | 'security' | 'info'

export type Flag =
  | 'has_gps' | 'has_author' | 'has_device_ids' | 'has_comments' | 'has_tracked_changes' | 'has_hidden_text'
  | 'has_macros' | 'has_hidden_sheets' | 'has_hidden_rows_cols' | 'has_hidden_slides' | 'has_speaker_notes'
  | 'has_embedded_files' | 'has_nested_archive' | 'has_executable' | 'type_mismatch' | 'has_pii'
  | 'has_hidden_chars' | 'has_injection_text' | 'has_trailing_data' | 'encrypted' | 'has_xmp'
  | 'has_revision_history' | 'has_external_links' | 'has_thumbnail' | 'has_javascript' | 'has_attachments'
  | 'header_mismatch' | 'has_secrets' | 'parse_error'

export interface Finding {
  id: string
  path: string
  category: FindingCategory
  severity: Severity
  title: string
  detail: string
  /** Bounded excerpt proving the finding; treated as untrusted file content. */
  evidence?: string
  /** Where inside the file: 'page 2', 'sheet Salaries', 'line 14', 'EXIF' ... */
  where?: string
  source: 'scan' | 'agent'
  flag?: Flag
}

export interface DateEvent {
  path: string
  /** ISO 8601 */
  when: string
  what: string
  source: string
}

export interface ContainerEntry {
  path: string
  sizeBytes: number
  compressedBytes?: number
  isDir: boolean
  modified?: string
  kind?: string
}

export interface ContainerInfo {
  format: string
  entryCount: number
  entries: ContainerEntry[]
  entriesTruncated: boolean
  nested: Receipt[]
  nestedTruncated: boolean
}

export interface TextUnit {
  /** 'page 1', 'sheet Vendor payments', 'slide 3', 'notes 1', 'body', 'headers', 'comments' */
  label: string
  text: string
}

export interface TextInfo {
  chars: number
  units: TextUnit[]
  truncated: boolean
}

export interface Detection {
  method: 'magic' | 'container' | 'extension' | 'sniff' | 'none'
  strength: 'strong' | 'weak' | 'none'
  note?: string
}

export interface Receipt {
  schema: typeof RECEIPT_SCHEMA
  path: string
  name: string
  extension: string
  sizeBytes: number
  sha256: string
  lastModifiedMillis: number | null
  kind: string
  family: Family
  label: string
  nameSaysKind: string | null
  bytesSayKind: string | null
  nameAndBytesDisagree: boolean
  detection: Detection
  container?: ContainerInfo
  metadata: Record<string, string | number | boolean | null>
  dates: DateEvent[]
  text?: TextInfo
  flags: Flag[]
  findings: Finding[]
  /** Capabilities the browser edition does not have, with the CLI command that does. */
  notAvailableInWeb: string[]
  formatPage?: string
  errors: string[]
  inspectedAt: string
  depth: number
}

export interface InputFile {
  path: string
  name: string
  bytes: Uint8Array
  lastModified: number | null
}

export const CLI_COMMANDS = {
  inspect: 'ufo inspect --json <file>...',
  extract: 'ufo extract --json -o <dir> <archive>',
  convert: 'ufo convert --json -o <out.png|jpg|bmp> <image>',
  compare: 'ufo compare --json <a> <b>',
} as const
