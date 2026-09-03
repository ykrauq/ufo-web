import { JSDOM } from 'jsdom'

const dom = new JSDOM('')
Object.assign(globalThis, { DOMParser: dom.window.DOMParser })

// pdf.js 6 uses Promise.try, which arrived in Node 24. Chrome 128+ has it.
const P = Promise as unknown as { try?: (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }
if (typeof P.try !== 'function') {
  P.try = (fn, ...args) => new Promise((resolve) => resolve(fn(...args)))
}
