// Printable-string extraction and hex dumps for files without a text layer:
// executables, databases, fonts, media, and anything unrecognized.

export function extractStrings(bytes: Uint8Array, minLength = 6, maxCount = 300, maxScan = 4_000_000): { strings: string[]; truncated: boolean } {
  const end = Math.min(bytes.length, maxScan)
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    if (s.length < minLength || seen.has(s)) return
    seen.add(s)
    out.push(s)
  }
  // ASCII runs
  let run = ''
  for (let i = 0; i < end && out.length < maxCount; i++) {
    const b = bytes[i]
    if (b >= 0x20 && b <= 0x7e) run += String.fromCharCode(b)
    else {
      if (run.length >= minLength) push(run)
      run = ''
    }
  }
  if (run.length >= minLength) push(run)
  // UTF-16LE runs (ASCII letters interleaved with NUL), common in Windows binaries
  run = ''
  for (let i = 0; i + 1 < end && out.length < maxCount; i += 2) {
    const b = bytes[i]
    if (bytes[i + 1] === 0 && b >= 0x20 && b <= 0x7e) run += String.fromCharCode(b)
    else {
      if (run.length >= minLength) push(run)
      run = ''
    }
  }
  if (run.length >= minLength) push(run)
  return { strings: out, truncated: out.length >= maxCount || bytes.length > maxScan }
}

export function hexDump(bytes: Uint8Array, offset = 0, length = 256): string {
  const start = Math.max(0, Math.min(offset, bytes.length))
  const stop = Math.min(bytes.length, start + Math.max(1, Math.min(length, 1024)))
  const lines: string[] = []
  for (let i = start; i < stop; i += 16) {
    const chunk = bytes.subarray(i, Math.min(stop, i + 16))
    const hex = [...chunk].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = [...chunk].map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('')
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`)
  }
  return lines.join('\n')
}
