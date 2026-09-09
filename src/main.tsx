import '@microsoft/rayfin-auth-provider-fabric'
import { createRoot } from 'react-dom/client'
import { createNotesConnection } from './notes/client'
import { App } from './App'
import './styles.css'

const element = document.getElementById('root')
if (!element) throw new Error('Missing app root.')
const root = createRoot(element)

async function start() {
  let content
  try {
    const connection = await createNotesConnection({
      VITE_RAYFIN_API_URL: import.meta.env.VITE_RAYFIN_API_URL,
      VITE_RAYFIN_PUBLISHABLE_KEY: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
      VITE_FABRIC_WORKSPACE_ID: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
      VITE_FABRIC_ITEM_ID: import.meta.env.VITE_FABRIC_ITEM_ID,
      VITE_FABRIC_PORTAL_URL: import.meta.env.VITE_FABRIC_PORTAL_URL,
    }, window.location.origin)
    content = <App connection={connection} />
  } catch (error) {
    content = <section className="panel"><h2>Setup required</h2><p className="error" role="alert">{error instanceof Error ? error.message : 'App initialization failed.'}</p></section>
  }
  root.render(
    <main className="app-shell">
      <header>
        <span className="eyebrow">FABRIC PORTAL / DEMO-ONLY API KEY</span>
        <h1>Notes, model data &amp; Foundry</h1>
        <p>Self-contained SQL notes, semantic-model reads, and a key you provide for this session only.</p>
      </header>
      {content}
      <footer>Rayfin + Semantic Model + Foundry | No separate app registration | No persisted Foundry key</footer>
    </main>,
  )
}
void start()
