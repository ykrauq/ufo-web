// The clean-room Office renderers against the sample case: structure comes
// through, hidden content is marked, nothing from the file lands unescaped.

import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { renderDocx, renderPptx, renderXlsx } from '../src/render/office'
import { markInvisible } from '../src/render/code'

const SAMPLES = join(__dirname, '..', 'public', 'samples')
const load = (rel: string) => new Uint8Array(readFileSync(join(SAMPLES, rel)))

beforeAll(() => {
  Object.assign(globalThis.URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined })
})

describe('Word', () => {
  it('renders paragraphs, tracked changes, comments, and marks hidden runs', async () => {
    const zip = await JSZip.loadAsync(load('contracts/Q3-services-agreement-v3.docx'))
    const r = await renderDocx(zip)
    expect(r.html).toContain('<div class="docx-page"')
    expect(r.html).toContain('SERVICES AGREEMENT')
    expect(r.html).toMatch(/<ins class="trk trk-ins"[^>]*>.*\$1,620,000/)
    expect(r.html).toMatch(/<del class="trk trk-del hid hid-deleted"[^>]*>.*\$1,450,000/)
    expect(r.html).toMatch(/class="hid hid-vanish"[^>]*>Internal note/)
    expect(r.html).toMatch(/class="hid hid-white"[^>]*style="[^"]*color:#FFFFFF/)
    expect(r.html).toMatch(/class="hid hid-tiny"/)
    expect(r.html).toContain('<mark class="cm"')
    expect(r.html).toContain('docx-comments')
    expect(r.html).toContain('href="https://drive.example-internal.net/halcyon/schedule-a"')
  })
  it('escapes markup that arrives as text', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "quotes"</w:t></w:r></w:p></w:body></w:document>')
    const r = await renderDocx(zip)
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;')
  })
})

describe('Excel', () => {
  it('renders every sheet including the veryHidden one, with hidden rows and columns marked', async () => {
    const zip = await JSZip.loadAsync(load('finance/vendor-payments.xlsx'))
    const r = await renderXlsx(zip)
    expect(r.sheets.map((s) => s.name)).toEqual(['Vendor payments', 'Salaries (do not distribute)'])
    expect(r.sheets[1].state).toBe('veryHidden')
    expect(r.sheets[0].hiddenCols).toBe(1)
    expect(r.sheets[1].hiddenRows).toBe(1)
    expect(r.sheets[0].html).toContain('Meridian Data Works')
    expect(r.sheets[0].html).toMatch(/<th class="hid hid-col"[^>]*>E<\/th>/)
    expect(r.sheets[1].html).toMatch(/<tr class="hid hid-row"[^>]*><th class="rn">4<\/th>/)
    expect(r.sheets[1].html).toContain('Larkspur')
  })
})

describe('PowerPoint', () => {
  it('renders slides at their positions, marks the hidden one, and carries notes', async () => {
    const zip = await JSZip.loadAsync(load('slides/board-update-sept.pptx'))
    const r = await renderPptx(zip)
    expect(r.slides.length).toBe(3)
    expect(r.slides[2].hidden).toBe(true)
    expect(r.slides[2].html).toContain('hid hid-slide')
    expect(r.slides[2].html).toContain('Meridian overrun')
    expect(r.slides[0].notes).toContain('audit letter')
    expect(r.slides[0].html).toMatch(/class="shape title" style="left:[\d.]+%;top:[\d.]+%/)
  })
})

describe('code', () => {
  it('marks invisible characters with their code point', () => {
    const { html, count } = markInvisible('check_t​oken(‮user)')
    expect(count).toBe(2)
    expect(html).toContain('data-hidden="U+200B zero-width space"')
    expect(html).toContain('data-hidden="U+202E RLO bidi override"')
  })
})
