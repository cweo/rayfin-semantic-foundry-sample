import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RayfinClient } from '@microsoft/rayfin-client'
import type { AppSchema } from '../rayfin/data/schema'
import type { NotesConnection } from './notes/client'
import { App } from './App'

const auth = vi.hoisted(() => ({
  session: { isAuthenticated: true, user: { id: 'first-user', email: 'first@example.test' } },
  busy: false, error: '', signIn: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./notes/useNotesAuth', () => ({ useNotesAuth: () => auth }))
vi.mock('./notes/NotesPanel', () => ({ NotesPanel: () => null }))
vi.mock('./SemanticModelPanel', () => ({ SemanticModelPanel: () => null }))
const connection: NotesConnection = {
  client: new RayfinClient<AppSchema>({ baseUrl: 'https://notes.example.test/', publishableKey: 'pk-test', authStorage: false }),
  fabricOptions: { workspaceId: 'test-workspace', projectId: 'test-app', fabricPortalUrl: 'https://app.fabric.microsoft.com', returnOrigin: 'http://localhost:5175' },
}
beforeEach(() => {
  auth.session.isAuthenticated = true
  auth.session.user.id = 'first-user'
})
afterEach(cleanup)
function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Foundry settings' }))
}

it('clears the key immediately on sign-out, even before the auth promise settles', () => {
  render(<App connection={connection} />)
  openSettings()
  fireEvent.change(screen.getByLabelText('Your Foundry API key (memory only)'), { target: { value: 'demo-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign out and clear key' }))
  expect(auth.signOut).toHaveBeenCalledOnce()
  openSettings()
  expect(screen.getByLabelText('Your Foundry API key (memory only)')).toHaveValue('')
})
it('does not carry credentials or panel state across Fabric account changes', () => {
  const app = render(<App connection={connection} />)
  openSettings()
  fireEvent.change(screen.getByLabelText('Your Foundry API key (memory only)'), { target: { value: 'demo-key' } })
  auth.session.user.id = 'second-user'
  app.rerender(<App connection={connection} />)
  openSettings()
  expect(screen.getByLabelText('Your Foundry API key (memory only)')).toHaveValue('')
  auth.session.isAuthenticated = false
  app.rerender(<App connection={connection} />)
  expect(screen.queryByLabelText('Your Foundry API key (memory only)')).not.toBeInTheDocument()
})
