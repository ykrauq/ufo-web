// Text decoding and the three scanners every text-bearing file goes through:
// hidden characters, personal data patterns, and text addressed to AI agents.

export function printableRatio(bytes: Uint8Array): number {
  if (bytes.length === 0) return 1
  let printable = 0
  for (const b of bytes) {
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b !== 0x7f)) printable++
  }
  return printable / bytes.length
}

export interface DecodedText {
  text: string
  encoding: string
  hadBom: boolean
  truncated: boolean
}

export function decodeText(bytes: Uint8Array, maxBytes = 2_000_000): DecodedText {
  const truncated = bytes.length > maxBytes
  const slice = truncated ? bytes.subarray(0, maxBytes) : bytes
  if (slice.length >= 2 && slice[0] === 0xff && slice[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(slice.subarray(2)), encoding: 'utf-16le', hadBom: true, truncated }
  }
  if (slice.length >= 2 && slice[0] === 0xfe && slice[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(slice.subarray(2)), encoding: 'utf-16be', hadBom: true, truncated }
  }
  const hadBom = slice.length >= 3 && slice[0] === 0xef && slice[1] === 0xbb && slice[2] === 0xbf
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(hadBom ? slice.subarray(3) : slice)
    return { text, encoding: 'utf-8', hadBom, truncated }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(slice), encoding: 'windows-1252', hadBom: false, truncated }
  }
}

// ------------------------------------------------------------ hidden characters

export interface HiddenCharHit {
  line: number
  col: number
  codepoint: string
  name: string
  context: string
}

export interface HiddenCharReport {
  counts: Record<string, number>
  hits: HiddenCharHit[]
  mixedScriptWords: { line: number; word: string; scripts: string[] }[]
  total: number
}

const INVISIBLE: Record<number, string> = {
  0x00ad: 'soft hyphen',
  0x034f: 'combining grapheme joiner',
  0x061c: 'Arabic letter mark',
  0x180e: 'Mongolian vowel separator',
  0x200b: 'zero-width space',
  0x200c: 'zero-width non-joiner',
  0x200d: 'zero-width joiner',
  0x200e: 'left-to-right mark',
  0x200f: 'right-to-left mark',
  0x202a: 'LRE bidi embedding',
  0x202b: 'RLE bidi embedding',
  0x202c: 'pop directional formatting',
  0x202d: 'LRO bidi override',
  0x202e: 'RLO bidi override',
  0x2060: 'word joiner',
  0x2061: 'function application',
  0x2062: 'invisible times',
  0x2063: 'invisible separator',
  0x2064: 'invisible plus',
  0x2066: 'LRI bidi isolate',
  0x2067: 'RLI bidi isolate',
  0x2068: 'FSI bidi isolate',
  0x2069: 'pop directional isolate',
  0xfeff: 'zero-width no-break space (BOM)',
  0xfff9: 'interlinear annotation anchor',
  0xfffa: 'interlinear annotation separator',
  0xfffb: 'interlinear annotation terminator',
}

function hex4(cp: number): string {
  return 'U+' + cp.toString(16).padStart(4, '0').toUpperCase()
}

function charName(cp: number): string | null {
  if (INVISIBLE[cp]) return INVISIBLE[cp]
  if (cp >= 0xe0000 && cp <= 0xe007f) return 'Unicode tag character'
  if (cp >= 0xe000 && cp <= 0xf8ff) return 'private-use character'
  if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) return `control character ${hex4(cp)}`
  if (cp >= 0x7f && cp <= 0x9f) return `control character ${hex4(cp)}`
  if (cp === 0x2028 || cp === 0x2029) return 'line/paragraph separator'
  return null
}

function scriptOf(cp: number): string | null {
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f)) return 'Latin'
  if (cp >= 0x370 && cp <= 0x3ff) return 'Greek'
  if (cp >= 0x400 && cp <= 0x4ff) return 'Cyrillic'
  if (cp >= 0x530 && cp <= 0x58f) return 'Armenian'
  return null
}

export function scanHiddenChars(text: string, maxHits = 40): HiddenCharReport {
  const counts: Record<string, number> = {}
  const hits: HiddenCharHit[] = []
  const mixed: HiddenCharReport['mixedScriptWords'] = []
  let total = 0
  const lines = text.split('\n')
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    let col = 0
    for (const ch of line) {
      const cp = ch.codePointAt(0)!
      const name = li === 0 && col === 0 && cp === 0xfeff ? null : charName(cp)
      if (name) {
        total++
        counts[name] = (counts[name] ?? 0) + 1
        if (hits.length < maxHits) {
          const start = Math.max(0, col - 20)
          const context = line.slice(start, col) + '[' + name + ']' + line.slice(col + ch.length, col + ch.length + 20)
          hits.push({ line: li + 1, col: col + 1, codepoint: hex4(cp), name, context: stripInvisible(context) })
        }
      }
      col += ch.length
    }
    if (mixed.length < maxHits) {
      for (const word of line.split(/[^\p{L}\p{N}_]+/u)) {
        if (word.length < 2) continue
        const scripts = new Set<string>()
        for (const ch of word) {
          const s = scriptOf(ch.codePointAt(0)!)
          if (s) scripts.add(s)
        }
        if (scripts.size > 1 && scripts.has('Latin')) {
          mixed.push({ line: li + 1, word, scripts: [...scripts] })
          total++
          counts['mixed-script word'] = (counts['mixed-script word'] ?? 0) + 1
          if (mixed.length >= maxHits) break
        }
      }
    }
  }
  return { counts, hits, mixedScriptWords: mixed, total }
}

function stripInvisible(s: string): string {
  return [...s].map((ch) => (charName(ch.codePointAt(0)!) ? '?' : ch)).join('')
}

// ------------------------------------------------------------ personal data patterns

export interface PiiHit {
  type: string
  masked: string
  line: number
}

export interface PiiReport {
  counts: Record<string, number>
  hits: PiiHit[]
  total: number
}

function luhn(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const v = ch >= 'A' ? (ch.charCodeAt(0) - 55).toString() : ch
    for (const d of v) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97
  }
  return remainder === 1
}

function mask(s: string): string {
  const clean = s.trim()
  if (clean.length <= 6) return clean[0] + '...'
  return clean.slice(0, 3) + '...' + clean.slice(-3)
}

const PII_PATTERNS: { type: string; re: RegExp; check?: (m: string) => boolean }[] = [
  { type: 'email address', re: /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}/gi },
  { type: 'US SSN-shaped number', re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  { type: 'payment card number', re: /\b(?:\d[ -]?){13,19}\b/g, check: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d) } },
  { type: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, check: ibanValid },
  { type: 'phone number', re: /(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\b\d{3})[ .-]?\d{3}[ .-]?\d{4}\b/g },
  { type: 'street address', re: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St\.|Avenue|Ave\.|Lane|Ln\.|Road|Rd\.|Way|Drive|Dr\.|Boulevard|Blvd\.|Court|Ct\.)\b/g },
  { type: 'IPv4 address', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
]

const SECRET_PATTERNS: { type: string; re: RegExp }[] = [
  { type: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { type: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/g },
  { type: 'credential assignment', re: /\b[A-Za-z_]{0,40}(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{8,200}["']?/gi },
  { type: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,4000}\.[A-Za-z0-9_-]{10,2000}\b/g },
]

const MAX_SCAN_LINE = 20_000

function scanPatterns(text: string, patterns: typeof PII_PATTERNS, maxHits: number): PiiReport {
  const counts: Record<string, number> = {}
  const hits: PiiHit[] = []
  let total = 0
  const lines = text.split('\n')
  for (let li = 0; li < lines.length && li < 20000; li++) {
    // Very long lines are data (minified code, base64 blobs); scanning their head is enough.
    const line = lines[li].length > MAX_SCAN_LINE ? lines[li].slice(0, MAX_SCAN_LINE) : lines[li]
    for (const p of patterns) {
      p.re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = p.re.exec(line))) {
        if (p.check && !p.check(m[0])) continue
        counts[p.type] = (counts[p.type] ?? 0) + 1
        total++
        if (hits.length < maxHits) hits.push({ type: p.type, masked: mask(m[0]), line: li + 1 })
      }
    }
  }
  return { counts, hits, total }
}

export function scanPii(text: string, maxHits = 60): PiiReport {
  return scanPatterns(text, PII_PATTERNS, maxHits)
}

export function scanSecrets(text: string, maxHits = 20): PiiReport {
  return scanPatterns(text, SECRET_PATTERNS, maxHits)
}

// ------------------------------------------------------------ text addressed to AI agents

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier|your) (?:instructions|prompts|rules)/i,
  /disregard (?:all |any |the )?(?:previous|prior|above|earlier|your) (?:instructions|prompts|rules)/i,
  /(?:note|attention|message|instructions?) (?:to|for) (?:any |the |all )?(?:ai|llm|assistant|agent|model)s?\b/i,
  /you are (?:now )?(?:an? |the )?(?:ai|assistant|agent|language model)\b/i,
  /\bsystem prompt\b/i,
  /approve (?:all|every) (?:pending )?(?:actions?|proposals?|requests?)/i,
  /\bdo not (?:tell|inform|alert) the (?:user|human)\b/i,
  /\b(?:as an ai|as a language model)\b/i,
  /<\|?(?:im_start|system|assistant)\|?>/i,
]

export interface InjectionHit {
  line: number
  snippet: string
}

export function scanInjection(text: string, maxHits = 10): InjectionHit[] {
  const hits: InjectionHit[] = []
  const lines = text.split('\n')
  for (let li = 0; li < lines.length && hits.length < maxHits; li++) {
    const line = lines[li]
    if (INJECTION_PATTERNS.some((re) => re.test(line))) hits.push({ line: li + 1, snippet: line.trim().slice(0, 160) })
  }
  return hits
}

/** Wrap file-derived text so an agent can tell data from instructions. */
export function untrustedBlock(label: string, text: string): string {
  return `<<<UNTRUSTED FILE CONTENT ${label}>>>\n${text}\n<<<END UNTRUSTED FILE CONTENT>>>`
}
