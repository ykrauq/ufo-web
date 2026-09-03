// Bounded XML helpers over DOMParser. Office parts are parsed as XML documents;
// qualified names ('w:p') are matched with getElementsByTagName, which works on
// XML documents in browsers and in happy-dom.

export function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return null
    return doc
  } catch {
    return null
  }
}

export function els(root: Document | Element, qname: string): Element[] {
  return Array.from(root.getElementsByTagName(qname))
}

export function firstText(root: Document | Element, qname: string): string | null {
  const el = root.getElementsByTagName(qname)[0]
  return el ? (el.textContent ?? '').trim() || null : null
}

export function attr(el: Element, name: string): string | null {
  return el.getAttribute(name)
}
