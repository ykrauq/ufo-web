import type { Severity } from '../core/types'

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function SeverityDot({ severity }: { severity: Severity }) {
  return <span className={`sev sev-${severity}`} title={severity} />
}

export function SeverityTag({ severity }: { severity: Severity }) {
  return <span className={`tag tag-${severity}`}>{severity}</span>
}

export function Badge({ children, tone = 'neutral', title }: { children: React.ReactNode; tone?: 'neutral' | 'warn' | 'bad' | 'good' | 'info'; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>
}

const FLAG_LABEL: Record<string, string> = {
  has_gps: 'GPS',
  has_author: 'author',
  has_device_ids: 'serial',
  has_comments: 'comments',
  has_tracked_changes: 'tracked',
  has_hidden_text: 'hidden text',
  has_macros: 'macros',
  has_hidden_sheets: 'hidden sheet',
  has_hidden_rows_cols: 'hidden rows',
  has_hidden_slides: 'hidden slide',
  has_speaker_notes: 'notes',
  has_embedded_files: 'embedded',
  has_nested_archive: 'nested zip',
  has_executable: 'executable',
  type_mismatch: 'mismatch',
  has_pii: 'PII',
  has_hidden_chars: 'hidden chars',
  has_injection_text: 'injection',
  has_trailing_data: 'trailing data',
  encrypted: 'encrypted',
  has_xmp: 'XMP',
  has_revision_history: 'revisions',
  has_external_links: 'links',
  has_thumbnail: 'thumbnail',
  has_javascript: 'JavaScript',
  has_attachments: 'attachments',
  header_mismatch: 'header mismatch',
  has_secrets: 'secrets',
  parse_error: 'parse error',
}

const FLAG_TONE: Record<string, 'warn' | 'bad' | 'info' | 'neutral'> = {
  has_executable: 'bad', type_mismatch: 'bad', has_macros: 'bad', has_secrets: 'bad', header_mismatch: 'bad', has_trailing_data: 'bad', has_javascript: 'bad',
  has_gps: 'warn', has_hidden_text: 'warn', has_hidden_sheets: 'warn', has_hidden_slides: 'warn', has_tracked_changes: 'warn', has_comments: 'warn', has_pii: 'warn', has_hidden_chars: 'warn', has_injection_text: 'warn', has_nested_archive: 'warn', has_embedded_files: 'warn', has_revision_history: 'warn',
}

export function FlagChip({ flag }: { flag: string }) {
  return <Badge tone={FLAG_TONE[flag] ?? 'info'} title={flag}>{FLAG_LABEL[flag] ?? flag}</Badge>
}
