// WebMCP registration layer.
//
// Native implementations (ChatGPT's in-app browser, Chrome 149+ with
// chrome://flags/#enable-webmcp-testing) expose `document.modelContext`.
// When no native implementation exists, the MIT @mcp-b/global polyfill is
// loaded on demand so MCP-B extension clients can still call the tools.
//
// Every tool goes through `defineTool`, which enforces the budgets from
// Chrome's tool security guide: short names, bounded descriptions, and a
// bounded result size so a single call can never flood the agent's context.

export type JsonSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolSpec<I = Record<string, unknown>> {
  name: string
  description: string
  inputSchema: JsonSchema
  readOnly?: boolean
  untrusted?: boolean
  /** Return any JSON-serializable value; it is serialized and size-bounded. */
  run: (input: I, signal?: AbortSignal) => Promise<unknown> | unknown
}

export type ModelContextMode = 'native' | 'polyfill' | 'none'

export interface ToolCallRecord {
  id: number
  tool: string
  input: unknown
  startedAt: number
  finishedAt?: number
  ok?: boolean
  outputChars?: number
  output?: string
  error?: string
}

type ToolCallListener = (record: ToolCallRecord) => void

const listeners = new Set<ToolCallListener>()
let callCounter = 0

export function onToolCall(listener: ToolCallListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(record: ToolCallRecord) {
  for (const l of listeners) l({ ...record })
}

export const OUTPUT_CHAR_BUDGET = 1500
export const NAME_CHAR_BUDGET = 30
export const DESCRIPTION_CHAR_BUDGET = 500

interface ModelContextLike {
  registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => unknown
  getTools?: () => unknown
  addEventListener?: (type: string, cb: () => void) => void
}

let mode: ModelContextMode = 'none'
let contextPromise: Promise<ModelContextLike | null> | null = null

function nativeContext(): ModelContextLike | null {
  const d = document as unknown as { modelContext?: ModelContextLike }
  if (d.modelContext && typeof d.modelContext.registerTool === 'function') return d.modelContext
  const n = navigator as unknown as { modelContext?: ModelContextLike }
  if (n.modelContext && typeof n.modelContext.registerTool === 'function') return n.modelContext
  return null
}

export function getModelContext(): Promise<ModelContextLike | null> {
  if (contextPromise) return contextPromise
  contextPromise = (async () => {
    const native = nativeContext()
    if (native) {
      mode = 'native'
      return native
    }
    try {
      await import('@mcp-b/global')
      const ctx = nativeContext()
      if (ctx) {
        mode = 'polyfill'
        return ctx
      }
    } catch (error) {
      console.warn('WebMCP polyfill failed to load', error)
    }
    mode = 'none'
    return null
  })()
  return contextPromise
}

export function getMode(): ModelContextMode {
  return mode
}

/** Serialize a result and keep it inside the per-call output budget. */
export function boundedText(value: unknown, budget = OUTPUT_CHAR_BUDGET): string {
  let text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text === undefined) text = 'null'
  if (text.length <= budget) return text
  // Truncate on a boundary and say so; callers page with offsets/cursors.
  return text.slice(0, budget - 60) + `…[truncated: ${text.length - (budget - 60)} more chars; page or narrow the request]`
}

/** Unwrap the input regardless of which draft of the API the host follows. */
function unwrapInput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if ('params' in obj && Object.keys(obj).length === 1 && obj.params && typeof obj.params === 'object') {
      return obj.params as Record<string, unknown>
    }
    return obj
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return {}
}

function assertBudgets(spec: ToolSpec<never>) {
  if (spec.name.length > NAME_CHAR_BUDGET) throw new Error(`tool name too long: ${spec.name}`)
  if (spec.description.length > DESCRIPTION_CHAR_BUDGET) {
    throw new Error(`tool description too long: ${spec.name} (${spec.description.length})`)
  }
  for (const [key, prop] of Object.entries(spec.inputSchema.properties)) {
    const desc = (prop as { description?: string }).description ?? ''
    if (key.length > NAME_CHAR_BUDGET) throw new Error(`param name too long: ${spec.name}.${key}`)
    if (desc.length > 150) throw new Error(`param description too long: ${spec.name}.${key}`)
  }
}

/** Wrap a ToolSpec as a WebMCP tool descriptor. Exported for tests and the in-page console. */
export function toDescriptor<I>(spec: ToolSpec<I>) {
  assertBudgets(spec as ToolSpec<never>)
  const execute = async (rawInput: unknown, context?: { signal?: AbortSignal }) => {
    const input = unwrapInput(rawInput) as I
    const record: ToolCallRecord = { id: ++callCounter, tool: spec.name, input, startedAt: Date.now() }
    emit(record)
    try {
      const value = await spec.run(input, context?.signal)
      const text = boundedText(value)
      record.finishedAt = Date.now()
      record.ok = true
      record.outputChars = text.length
      record.output = text
      emit(record)
      return { content: [{ type: 'text', text }] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      record.finishedAt = Date.now()
      record.ok = false
      record.error = message
      emit(record)
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
    }
  }
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: {
      readOnlyHint: spec.readOnly ?? false,
      untrustedContentHint: spec.untrusted ?? false,
    },
    execute,
  }
}

export interface ToolGroup {
  name: string
  tools: ToolSpec<never>[]
  controller: AbortController
}

const groups = new Map<string, ToolGroup>()

/** Register a named group of tools; re-registering a group replaces it (fires toolchange). */
export async function registerGroup(name: string, tools: ToolSpec<never>[]): Promise<ModelContextMode> {
  unregisterGroup(name)
  const ctx = await getModelContext()
  const controller = new AbortController()
  groups.set(name, { name, tools, controller })
  if (!ctx) return mode
  for (const spec of tools) {
    try {
      await ctx.registerTool(toDescriptor(spec), { signal: controller.signal })
    } catch (error) {
      console.error('registerTool failed', spec.name, error)
    }
  }
  return mode
}

export function unregisterGroup(name: string) {
  const g = groups.get(name)
  if (!g) return
  g.controller.abort()
  groups.delete(name)
}

export function registeredTools(): ToolSpec<never>[] {
  return [...groups.values()].flatMap((g) => g.tools)
}

/** Execute a registered tool from the page itself (manual console, tests, demo). */
export async function callTool(name: string, input: Record<string, unknown>): Promise<string> {
  const spec = registeredTools().find((t) => t.name === name)
  if (!spec) throw new Error(`unknown tool: ${name}`)
  const result = (await toDescriptor(spec).execute(input)) as { content: { text: string }[] }
  return result.content[0].text
}
