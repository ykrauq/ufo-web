import type { DateEvent, Finding, Flag, TextUnit } from './types'

export interface EmailResult {
  metadata: Record<string, string | number | boolean | null>
  flags: Flag[]
  findings: Omit<Finding, 'id' | 'path' | 'source'>[]
  dates: DateEvent[]
  text: TextUnit[]
  attachments: { name: string; contentType: string; approxBytes: number }[]
}

function unfoldHeaders(raw: string): { headers: [string, string][]; body: string } {
  const sep = raw.search(/\r?\n\r?\n/)
  const head = sep < 0 ? raw : raw.slice(0, sep)
  const body = sep < 0 ? '' : raw.slice(sep).replace(/^\r?\n\r?\n/, '')
  const lines = head.split(/\r?\n/)
  const headers: [string, string][] = []
  for (const line of lines) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1][1] += ' ' + line.trim()
    else {
      const m = /^([\w-]+):\s*(.*)$/.exec(line)
      if (m) headers.push([m[1], m[2]])
    }
  }
  return { headers, body }
}

function domainOf(addr: string): string | null {
  const m = /@([A-Za-z0-9.-]+)/.exec(addr)
  return m ? m[1].toLowerCase() : null
}

function decodeQuotedPrintable(s: string): string {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function pushFlag(out: EmailResult, flag: Flag) {
  if (!out.flags.includes(flag)) out.flags.push(flag)
}

export function inspectEmail(text: string, path: string): EmailResult {
  const out: EmailResult = { metadata: {}, flags: [], findings: [], dates: [], text: [], attachments: [] }
  const { headers, body } = unfoldHeaders(text)
  const get = (name: string) => headers.filter(([k]) => k.toLowerCase() === name.toLowerCase()).map(([, v]) => v)
  const first = (name: string) => get(name)[0] ?? null
  for (const h of ['From', 'To', 'Cc', 'Bcc', 'Reply-To', 'Return-Path', 'Subject', 'Date', 'Message-ID', 'X-Mailer', 'User-Agent', 'X-Originating-IP', 'In-Reply-To']) {
    const v = first(h)
    if (v) out.metadata[h] = v.slice(0, 300)
  }
  const received = get('Received')
  out.metadata.receivedHops = received.length
  const date = first('Date')
  if (date && !Number.isNaN(Date.parse(date))) out.dates.push({ path, when: new Date(date).toISOString(), what: 'email sent (Date header)', source: 'headers' })
  for (const r of received) {
    const m = /;\s*(.+)$/.exec(r)
    if (m && !Number.isNaN(Date.parse(m[1]))) out.dates.push({ path, when: new Date(m[1]).toISOString(), what: 'email relayed (Received header)', source: 'headers' })
  }
  const from = first('From') ?? ''
  const replyTo = first('Reply-To')
  const returnPath = first('Return-Path')
  const fromDomain = domainOf(from)
  const replyDomain = replyTo ? domainOf(replyTo) : null
  const returnDomain = returnPath ? domainOf(returnPath) : null
  if (fromDomain && replyDomain && replyDomain !== fromDomain) {
    pushFlag(out, 'header_mismatch')
    out.findings.push({ category: 'security', severity: 'high', flag: 'header_mismatch', where: 'headers', title: 'Reply-To domain differs from From domain', detail: `From ${fromDomain}, replies go to ${replyDomain}. Classic pattern in payment-diversion and account-takeover mail.`, evidence: `From: ${from}\nReply-To: ${replyTo}` })
  }
  if (fromDomain && returnDomain && returnDomain !== fromDomain && returnDomain !== replyDomain) {
    pushFlag(out, 'header_mismatch')
    out.findings.push({ category: 'security', severity: 'medium', flag: 'header_mismatch', where: 'headers', title: 'Return-Path domain differs from From domain', detail: `Bounces go to ${returnDomain}, not ${fromDomain}. Legitimate bulk senders do this too, so weigh it with the other signals.` })
  }
  const originating = first('X-Originating-IP')
  const mailer = first('X-Mailer') ?? first('User-Agent')
  if (originating || mailer || received.length) {
    out.findings.push({ category: 'privacy', severity: 'low', where: 'headers', title: 'Sender infrastructure exposed in headers', detail: `${received.length} Received hop${received.length === 1 ? '' : 's'}${originating ? `, originating IP ${originating}` : ''}${mailer ? `, client "${mailer}"` : ''}.` })
  }
  const ct = first('Content-Type') ?? ''
  const bm = /boundary="?([^";]+)"?/i.exec(ct)
  if (bm) {
    const escaped = bm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const parts = body.split(new RegExp(`--${escaped}(?:--)?\\r?\\n`))
    for (const part of parts) {
      const { headers: ph, body: pb } = unfoldHeaders(part)
      const pct = ph.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
      const disp = ph.find(([k]) => k.toLowerCase() === 'content-disposition')?.[1] ?? ''
      const enc = ph.find(([k]) => k.toLowerCase() === 'content-transfer-encoding')?.[1] ?? ''
      const nameMatch = /(?:file)?name="?([^";]+)"?/i.exec(disp) ?? /name="?([^";]+)"?/i.exec(pct)
      if (/attachment/i.test(disp) || (nameMatch && !/^text\//i.test(pct))) {
        const approx = /base64/i.test(enc) ? Math.floor(pb.replace(/\s+/g, '').length * 0.75) : pb.length
        out.attachments.push({ name: nameMatch?.[1] ?? 'unnamed', contentType: pct.split(';')[0].trim() || 'unknown', approxBytes: approx })
      } else if (/^text\/plain/i.test(pct)) {
        out.text.push({ label: 'body', text: /quoted-printable/i.test(enc) ? decodeQuotedPrintable(pb) : pb })
      } else if (/^text\/html/i.test(pct) && !out.text.some((t) => t.label === 'body')) {
        const html = /quoted-printable/i.test(enc) ? decodeQuotedPrintable(pb) : pb
        out.text.push({ label: 'body (html, stripped)', text: html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() })
      }
    }
  } else {
    out.text.push({ label: 'body', text: body })
  }
  out.text.unshift({ label: 'headers', text: headers.map(([k, v]) => `${k}: ${v}`).join('\n') })
  if (out.attachments.length) {
    pushFlag(out, 'has_attachments')
    out.metadata.attachments = out.attachments.length
    const risky = out.attachments.filter((a) => /\.(exe|scr|js|vbs|bat|cmd|ps1|hta|jar|iso|img|lnk|docm|xlsm|pptm)$/i.test(a.name))
    out.findings.push({ category: risky.length ? 'security' : 'info', severity: risky.length ? 'high' : 'info', flag: 'has_attachments', where: 'MIME parts', title: `${out.attachments.length} attachment${out.attachments.length === 1 ? '' : 's'}${risky.length ? `, ${risky.length} executable or macro-capable` : ''}`, detail: out.attachments.map((a) => `${a.name} (${a.contentType}, ~${a.approxBytes} bytes)`).join('; ') })
  }
  return out
}
