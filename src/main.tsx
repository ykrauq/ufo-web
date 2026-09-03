import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { callTool, registeredTools, getMode } from './webmcp/register'
import { getState } from './core/workspace'
import './styles.css'

// Console access for people poking at the page without an agent:
//   ufoWeb.tools()  ufoWeb.call('privacy_scan', {})  ufoWeb.state()
Object.assign(window, {
  ufoWeb: {
    tools: () => registeredTools().map((t) => t.name),
    call: (name: string, input: Record<string, unknown> = {}) => callTool(name, input),
    state: getState,
    mode: getMode,
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
