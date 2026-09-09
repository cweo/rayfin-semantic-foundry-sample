import { useState } from 'react'
import type { NotesConnection } from './notes/client'
import { useNotesAuth } from './notes/useNotesAuth'
import { NotesPanel } from './notes/NotesPanel'
import { SemanticModelPanel } from './SemanticModelPanel'
import { OpenAIPanel } from './OpenAIPanel'

export function App({ connection }: { connection: NotesConnection }) {
  const { session, busy, error, signIn, signOut } = useNotesAuth(connection)
  const [keySession, setKeySession] = useState(0)
  const user = session?.isAuthenticated ? session.user : null
  return (
    <>
      <section className="panel session">
        <div>
          <strong>{user ? user.email || user.id : 'Sign in with Fabric'}</strong>
          <p className="muted">Own private SQL notes, portal-proxied model data, and an explicit demo API key.</p>
        </div>
        <button disabled={busy} onClick={() => {
          if (user) { setKeySession((current) => current + 1); void signOut() }
          else void signIn()
        }}>{busy ? 'Checking Fabric session...' : user ? 'Sign out and clear key' : 'Sign in with Fabric'}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {user && !busy ? (
        <div key={`${user.id}:${keySession}`}>
          <NotesPanel client={connection.client} />
          <SemanticModelPanel />
          <OpenAIPanel />
        </div>
      ) : <p role="status">{busy ? 'Completing Fabric authentication...' : 'Sign in to use the sample. No saved API key or mock identity is used.'}</p>}
    </>
  )
}
