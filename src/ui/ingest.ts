import type { InputFile } from '../core/types'

const SKIP = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.git|node_modules)(\/|$)/

async function toInput(file: File, path: string): Promise<InputFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return { path, name: file.name, bytes, lastModified: file.lastModified || null }
}

function cleanPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '')
}

export async function fromFileList(list: FileList | File[]): Promise<InputFile[]> {
  const out: InputFile[] = []
  for (const f of Array.from(list)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    const path = cleanPath(rel)
    if (SKIP.test(path)) continue
    out.push(await toInput(f, path))
  }
  return out
}

type Entry = FileSystemEntry & { isFile: boolean; isDirectory: boolean; fullPath: string }

function readEntries(reader: FileSystemDirectoryReader): Promise<Entry[]> {
  return new Promise((resolve, reject) => reader.readEntries((entries) => resolve(entries as Entry[]), reject))
}

function fileOf(entry: Entry): Promise<File> {
  return new Promise((resolve, reject) => (entry as unknown as FileSystemFileEntry).file(resolve, reject))
}

async function walkEntry(entry: Entry, out: InputFile[], limit: number): Promise<void> {
  if (out.length >= limit) return
  const path = cleanPath(entry.fullPath)
  if (SKIP.test(path)) return
  if (entry.isFile) {
    out.push(await toInput(await fileOf(entry), path))
    return
  }
  if (entry.isDirectory) {
    const reader = (entry as unknown as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await readEntries(reader)
      if (!batch.length) break
      for (const e of batch) await walkEntry(e, out, limit)
    }
  }
}

export async function fromDataTransfer(dt: DataTransfer, limit = 1500): Promise<InputFile[]> {
  const out: InputFile[] = []
  const items = Array.from(dt.items ?? [])
  const entries = items.map((i) => (i.webkitGetAsEntry ? (i.webkitGetAsEntry() as Entry | null) : null))
  if (entries.some(Boolean)) {
    for (const e of entries) if (e) await walkEntry(e, out, limit)
    return out
  }
  return fromFileList(dt.files)
}

function pick(attrs: { directory?: boolean }): Promise<InputFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (attrs.directory) input.setAttribute('webkitdirectory', '')
    input.style.display = 'none'
    input.onchange = async () => {
      const files = input.files ? await fromFileList(input.files) : []
      input.remove()
      resolve(files)
    }
    input.oncancel = () => {
      input.remove()
      resolve([])
    }
    document.body.appendChild(input)
    input.click()
  })
}

export function pickFiles(): Promise<InputFile[]> {
  return pick({})
}

type DirHandle = { name: string; values: () => AsyncIterable<{ kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File> } & DirHandle> }

async function walkHandle(handle: DirHandle, prefix: string, out: InputFile[], limit: number) {
  for await (const child of handle.values()) {
    if (out.length >= limit) return
    const path = `${prefix}${child.name}`
    if (SKIP.test(path)) continue
    if (child.kind === 'file' && child.getFile) out.push(await toInput(await child.getFile(), path))
    else if (child.kind === 'directory') await walkHandle(child, `${path}/`, out, limit)
  }
}

export async function pickFolder(): Promise<InputFile[]> {
  const w = window as unknown as { showDirectoryPicker?: (o?: { mode: 'read' }) => Promise<DirHandle> }
  if (w.showDirectoryPicker) {
    try {
      const handle = await w.showDirectoryPicker({ mode: 'read' })
      const out: InputFile[] = []
      await walkHandle(handle, `${handle.name}/`, out, 1500)
      return out
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return []
      // Fall through to the input element on any other failure.
    }
  }
  return pick({ directory: true })
}
