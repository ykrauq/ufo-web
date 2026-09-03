// Minimal Portable Executable header reader: enough to date a binary and say
// what it is, without executing or disassembling anything.

export interface PeInfo {
  machine: string
  is64: boolean
  isDll: boolean
  subsystem: string
  sections: string[]
  compiledAt: string | null
  note?: string
}

const MACHINES: Record<number, string> = { 0x14c: 'x86', 0x8664: 'x64', 0x1c0: 'ARM', 0xaa64: 'ARM64', 0x200: 'Itanium' }
const SUBSYSTEMS: Record<number, string> = { 1: 'native', 2: 'Windows GUI', 3: 'Windows console', 7: 'POSIX', 9: 'Windows CE', 10: 'EFI application', 16: 'Windows boot' }

export function parsePe(bytes: Uint8Array): PeInfo | null {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const e = dv.getUint32(0x3c, true)
  if (e + 24 > bytes.length || bytes[e] !== 0x50 || bytes[e + 1] !== 0x45 || bytes[e + 2] !== 0 || bytes[e + 3] !== 0) {
    return { machine: 'unknown', is64: false, isDll: false, subsystem: 'unknown', sections: [], compiledAt: null, note: 'MZ header without a PE signature (DOS stub only, or truncated)' }
  }
  const machine = dv.getUint16(e + 4, true)
  const sectionCount = dv.getUint16(e + 6, true)
  const stamp = dv.getUint32(e + 8, true)
  const optSize = dv.getUint16(e + 20, true)
  const characteristics = dv.getUint16(e + 22, true)
  const optStart = e + 24
  const magic = optStart + 2 <= bytes.length ? dv.getUint16(optStart, true) : 0
  const is64 = magic === 0x20b
  const subsystem = optStart + 70 <= bytes.length ? dv.getUint16(optStart + 68, true) : 0
  const sections: string[] = []
  let p = optStart + optSize
  for (let i = 0; i < Math.min(sectionCount, 32) && p + 40 <= bytes.length; i++, p += 40) {
    let name = ''
    for (let j = 0; j < 8; j++) {
      const b = bytes[p + j]
      if (b === 0) break
      name += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '?'
    }
    sections.push(name)
  }
  const compiledAt = stamp > 315532800 && stamp < 4102444800 ? new Date(stamp * 1000).toISOString() : null
  const packed = sections.some((s) => /^(UPX|\.aspack|\.themida|\.vmp|\.petite|MPRESS)/i.test(s))
  return {
    machine: MACHINES[machine] ?? `0x${machine.toString(16)}`,
    is64,
    isDll: (characteristics & 0x2000) !== 0,
    subsystem: SUBSYSTEMS[subsystem] ?? `subsystem ${subsystem}`,
    sections,
    compiledAt,
    note: packed ? 'section names suggest a packer' : sectionCount === 0 ? 'no sections' : undefined,
  }
}
