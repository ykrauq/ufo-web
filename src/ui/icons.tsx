// Small inline icon set (stroke icons, 24x24 viewBox). No external assets:
// the CSP allows nothing but the origin itself.

import type { Family, FindingCategory } from '../core/types'

const P: Record<string, string> = {
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  table: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18',
  slides: 'M2 3h20v13H2z M12 16v5 M8 21h8',
  image: 'M3 3h18v18H3z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21',
  archive: 'M21 8v13H3V8 M1 3h22v5H1z M10 12h4',
  code: 'M16 18l6-6-6-6 M8 6l-6 6 6 6',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  pdf: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 17v-6h2a1.5 1.5 0 0 1 0 3H9',
  binary: 'M5 4h14v16H5z M9 8h2v4H9z M13 12h2v4h-2z',
  audio: 'M9 18V5l12-2v13 M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  video: 'M23 7l-7 5 7 5V7z M1 5h15v14H1z',
  db: 'M12 8c5 0 9-1.3 9-3s-4-3-9-3-9 1.3-9 3 4 3 9 3z M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5 M3 12c0 1.7 4 3 9 3s9-1.3 9-3',
  font: 'M4 20h4 M16 20h4 M6 20l6-16 6 16 M9 13h6',
  cert: 'M12 2l7 4v6c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z M9 12l2 2 4-4',
  text: 'M4 7V4h16v3 M9 20h6 M12 4v16',
  unknown: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01',
  eyeOff: 'M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.1-6 M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2 M14.1 14.1a3 3 0 1 1-4.2-4.2 M1 1l22 22',
  ghost: 'M4 21V10a8 8 0 0 1 16 0v11l-3-2-3 2-2-2-2 2-3-2z M9 11h.01 M15 11h.01',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  agent: 'M12 2a3 3 0 0 1 3 3v1h2a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h2V5a3 3 0 0 1 3-3z M9 13h.01 M15 13h.01 M9 17h6',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18 M6 6l12 12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  play: 'M5 3l14 9-14 9V3z',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  flag: 'M4 22V4a1 1 0 0 1 1-1h12l-2 4 2 4H5',
  broom: 'M19 3l-6 6 M11 9l4 4-6 6H4l-1-1 6-6 M4 20l3-3',
  quarantine: 'M12 2l10 6v8l-10 6L2 16V8z M12 8v8 M8 10l8 4 M16 10l-8 4',
  rename: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  note: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
}

export function Icon({ name, size = 16, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  const d = P[name] ?? P.file
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export function familyIcon(family: Family, kind?: string): string {
  if (kind === 'pdf') return 'pdf'
  switch (family) {
    case 'document': return 'doc'
    case 'spreadsheet': return 'table'
    case 'presentation': return 'slides'
    case 'image': return 'image'
    case 'archive': return 'archive'
    case 'code': return 'code'
    case 'email': return 'mail'
    case 'executable': return 'binary'
    case 'audio': return 'audio'
    case 'video': return 'video'
    case 'database': return 'db'
    case 'font': return 'font'
    case 'certificate': return 'cert'
    case 'text': return 'text'
    case 'binary': return 'binary'
    default: return 'unknown'
  }
}

export function categoryIcon(category: FindingCategory): string {
  switch (category) {
    case 'privacy': return 'eyeOff'
    case 'hidden': return 'ghost'
    case 'integrity': return 'shield'
    case 'security': return 'alert'
    default: return 'info'
  }
}

export function actionIcon(action: string): string {
  switch (action) {
    case 'strip_metadata': return 'broom'
    case 'quarantine': return 'quarantine'
    case 'rename_extension': return 'rename'
    case 'flag': return 'flag'
    default: return 'note'
  }
}
