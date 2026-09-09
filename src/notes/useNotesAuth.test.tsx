import { act, renderHook, waitFor } from '@testing-library/react'
import { initEmbeddedAuth, initiateFabricLogin } from '@microsoft/rayfin-auth-provider-fabric'
import { RayfinClient } from '@microsoft/rayfin-client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NotesConnection } from './client'
import { useNotesAuth } from './useNotesAuth'

vi.mock('@microsoft/rayfin-auth-provider-fabric', () => ({
  initiateFabricLogin: vi.fn(), initEmbeddedAuth: vi.fn(),
}))
beforeEach(() => { vi.mocked(initEmbeddedAuth).mockResolvedValue(null) })
afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
  sessionStorage.clear()
})
const signedOut = { user: null, isAuthenticated: false, isAnonymous: true }
const signedIn = { user: { id: 'owner', email: 'owner@example.test' }, isAuthenticated: true, isAnonymous: false }
function fixture() {
  const connection: NotesConnection = {
    client: new RayfinClient({ baseUrl: 'https://notes.example.test/', publishableKey: 'pk-test', authStorage: false }),
    fabricOptions: { workspaceId: 'test-workspace', projectId: 'test-app', fabricPortalUrl: 'https://app.fabric.microsoft.com', returnOrigin: window.location.origin },
  }
  const session = vi.spyOn(connection.client.auth, 'getSession').mockReturnValue(signedOut)
  vi.spyOn(connection.client.auth, 'hasRefreshToken').mockReturnValue(false)
  return { connection, session }
}

it('restores the same-item Fabric embedded handoff without opening a popup', async () => {
  window.history.replaceState({}, '', '/?fabricEmbedded=true')
  const { connection } = fixture()
  vi.mocked(initEmbeddedAuth).mockResolvedValue(signedIn)
  const { result } = renderHook(() => useNotesAuth(connection))
  await waitFor(() => expect(result.current.busy).toBe(false))
  expect(initEmbeddedAuth).toHaveBeenCalledWith(connection.client.auth, connection.fabricOptions)
  expect(result.current.session?.user?.id).toBe('owner')
  expect(initiateFabricLogin).not.toHaveBeenCalled()
})

it('never exposes a stale session after failed embedded handoff, including persisted Fabric flags', async () => {
  sessionStorage.setItem('fabricEmbedded', 'true')
  const { connection, session } = fixture()
  session.mockReturnValue(signedIn)
  const { result } = renderHook(() => useNotesAuth(connection))
  await waitFor(() => expect(result.current.busy).toBe(false))
  expect(result.current.session).toBeNull()
  expect(result.current.error).toContain('embedded sign-in')
})

it('does not treat a generic iframe as Fabric and permits explicit popup sign-in', async () => {
  const { connection, session } = fixture()
  vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
  vi.mocked(initiateFabricLogin).mockImplementation(async () => { session.mockReturnValue(signedIn) })
  const { result } = renderHook(() => useNotesAuth(connection))
  await waitFor(() => expect(result.current.busy).toBe(false))
  expect(result.current.error).toBe('')
  expect(result.current.session?.isAuthenticated).toBe(false)
  await act(async () => { await result.current.signIn() })
  expect(initiateFabricLogin).toHaveBeenCalledWith(connection.client.auth, connection.fabricOptions)
  expect(result.current.session?.user?.id).toBe('owner')
})
