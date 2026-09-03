import { useEffect, useState } from 'react'
import { getMode, registerGroup, type ModelContextMode } from './webmcp/register'

export function App() {
  const [mode, setMode] = useState<ModelContextMode>('none')
  useEffect(() => {
    void registerGroup('base', [
      {
        name: 'workspace_status',
        description: 'Report what is loaded in the UFO Web workspace and which tools are available.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => ({ files: 0, hint: 'Ask the user to drop files, or call load_sample_case.' }),
      },
    ]).then(() => setMode(getMode()))
  }, [])
  return (
    <main className="app">
      <header className="topbar">
        <h1>UFO Web</h1>
        <p>Drop files. Investigate them with your agent. Nothing leaves your browser.</p>
        <span className={`pill pill-${mode}`}>WebMCP: {mode}</span>
      </header>
      <section className="dropzone">Scaffold. Workspace coming up.</section>
    </main>
  )
}
