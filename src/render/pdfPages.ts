import { loadPdfJs } from '../core/pdf'

/** Render the first pages of a PDF into canvases appended to `container`. */
export async function renderPdfPages(bytes: Uint8Array, container: HTMLElement, opts: { maxPages?: number; scale?: number; signal?: AbortSignal } = {}): Promise<{ pages: number; rendered: number }> {
  const lib = await loadPdfJs()
  const task = lib.getDocument({ data: bytes.slice(), disableFontFace: false, standardFontDataUrl: '/pdfjs/standard_fonts/' })
  const doc = await task.promise
  const max = Math.min(doc.numPages, opts.maxPages ?? 6)
  let rendered = 0
  try {
    for (let p = 1; p <= max; p++) {
      if (opts.signal?.aborted) break
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: opts.scale ?? 1.25 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.className = 'pdf-page'
      canvas.setAttribute('aria-label', `page ${p}`)
      const context = canvas.getContext('2d')
      if (!context) break
      await page.render({ canvasContext: context, viewport, canvas }).promise
      const wrap = document.createElement('div')
      wrap.className = 'pdf-page-wrap'
      wrap.appendChild(canvas)
      const label = document.createElement('span')
      label.className = 'pdf-page-n'
      label.textContent = `${p} / ${doc.numPages}`
      wrap.appendChild(label)
      container.appendChild(wrap)
      rendered++
      page.cleanup()
    }
  } finally {
    await task.destroy().catch(() => undefined)
  }
  return { pages: doc.numPages, rendered }
}
