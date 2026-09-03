// Syntax highlighting with highlight.js, languages loaded on demand, plus
// visible markers for characters that are invisible in every editor.

import hljs from 'highlight.js/lib/core'

type Loader = () => Promise<{ default: Parameters<typeof hljs.registerLanguage>[1] }>

const LOADERS: Record<string, Loader> = {
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  python: () => import('highlight.js/lib/languages/python'),
  java: () => import('highlight.js/lib/languages/java'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  go: () => import('highlight.js/lib/languages/go'),
  rust: () => import('highlight.js/lib/languages/rust'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  php: () => import('highlight.js/lib/languages/php'),
  swift: () => import('highlight.js/lib/languages/swift'),
  bash: () => import('highlight.js/lib/languages/bash'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  dos: () => import('highlight.js/lib/languages/dos'),
  sql: () => import('highlight.js/lib/languages/sql'),
  r: () => import('highlight.js/lib/languages/r'),
  scala: () => import('highlight.js/lib/languages/scala'),
  lua: () => import('highlight.js/lib/languages/lua'),
  perl: () => import('highlight.js/lib/languages/perl'),
  dart: () => import('highlight.js/lib/languages/dart'),
  css: () => import('highlight.js/lib/languages/css'),
  scss: () => import('highlight.js/lib/languages/scss'),
  json: () => import('highlight.js/lib/languages/json'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  xml: () => import('highlight.js/lib/languages/xml'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  ini: () => import('highlight.js/lib/languages/ini'),
  diff: () => import('highlight.js/lib/languages/diff'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  plaintext: () => import('highlight.js/lib/languages/plaintext'),
}

const EXT: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift', sh: 'bash', bash: 'bash', zsh: 'bash',
  ps1: 'powershell', bat: 'dos', cmd: 'dos', sql: 'sql', r: 'r', scala: 'scala', lua: 'lua', pl: 'perl', dart: 'dart', css: 'css', scss: 'scss', json: 'json', jsonl: 'json',
  geojson: 'json', yml: 'yaml', yaml: 'yaml', xml: 'xml', html: 'xml', htm: 'xml', xhtml: 'xml', svg: 'xml', plist: 'xml', xsd: 'xml', xsl: 'xml', vue: 'xml', md: 'markdown',
  markdown: 'markdown', mdown: 'markdown', ini: 'ini', toml: 'ini', cfg: 'ini', conf: 'ini', env: 'ini', properties: 'ini', diff: 'diff', patch: 'diff', dockerfile: 'dockerfile',
  proto: 'protobuf', graphql: 'graphql', gradle: 'kotlin',
}

const loaded = new Set<string>()

export function languageFor(ext: string | null, kind: string): string {
  if (ext && EXT[ext]) return EXT[ext]
  if (kind === 'json') return 'json'
  if (kind === 'xml' || kind === 'html' || kind === 'svg') return 'xml'
  if (kind === 'yaml') return 'yaml'
  if (kind === 'markdown') return 'markdown'
  if (kind === 'config') return 'ini'
  return 'plaintext'
}

const INVISIBLE_RE = /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2028\u2029\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB]|[\u{E0000}-\u{E007F}]/gu

const NAMES: Record<number, string> = {
  0x00ad: 'soft hyphen', 0x034f: 'combining grapheme joiner', 0x061c: 'Arabic letter mark', 0x180e: 'Mongolian vowel separator', 0x200b: 'zero-width space', 0x200c: 'zero-width non-joiner',
  0x200d: 'zero-width joiner', 0x200e: 'LRM', 0x200f: 'RLM', 0x202a: 'LRE', 0x202b: 'RLE', 0x202c: 'PDF', 0x202d: 'LRO', 0x202e: 'RLO bidi override', 0x2060: 'word joiner', 0x2066: 'LRI', 0x2067: 'RLI', 0x2068: 'FSI', 0x2069: 'PDI', 0xfeff: 'BOM',
}

/** Replace invisible characters with marked spans that CSS reveals on demand. */
export function markInvisible(html: string): { html: string; count: number } {
  let count = 0
  const out = html.replace(INVISIBLE_RE, (ch) => {
    count++
    const cp = ch.codePointAt(0)!
    const label = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
    const name = NAMES[cp] ?? (cp >= 0xe0000 ? 'tag character' : 'invisible')
    return `<span class="hid hid-char" data-hidden="${label} ${name}" title="${label} ${name}">${ch}</span>`
  })
  return { html: out, count }
}

export async function highlightCode(code: string, ext: string | null, kind: string, maxChars = 200_000): Promise<{ html: string; language: string; lines: number; invisible: number; truncated: boolean }> {
  const truncated = code.length > maxChars
  const src = truncated ? code.slice(0, maxChars) : code
  let language = languageFor(ext, kind)
  if (!loaded.has(language)) {
    try {
      const mod = await (LOADERS[language] ?? LOADERS.plaintext)()
      hljs.registerLanguage(language, mod.default)
      loaded.add(language)
    } catch {
      language = 'plaintext'
      if (!loaded.has('plaintext')) {
        hljs.registerLanguage('plaintext', (await LOADERS.plaintext()).default)
        loaded.add('plaintext')
      }
    }
  }
  let highlighted: string
  try {
    highlighted = hljs.highlight(src, { language, ignoreIllegals: true }).value
  } catch {
    highlighted = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  const marked = markInvisible(highlighted)
  return { html: marked.html, language, lines: src.split('\n').length, invisible: marked.count, truncated }
}
