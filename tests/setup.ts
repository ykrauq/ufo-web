import { JSDOM } from 'jsdom'

const dom = new JSDOM('')
Object.assign(globalThis, { DOMParser: dom.window.DOMParser })
