import { afterEach, expect, it, vi } from 'vitest'
import { createNotesConnection } from './client'

afterEach(() => vi.unstubAllGlobals())
const generated = {
  VITE_RAYFIN_API_URL: 'https://local-notes.example.test',
  VITE_RAYFIN_PUBLISHABLE_KEY: 'pk-test',
  VITE_FABRIC_WORKSPACE_ID: 'own-workspace',
  VITE_FABRIC_ITEM_ID: 'own-item',
}

it('uses the deployed runtime configuration even when old notes overrides exist', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    apiUrl: 'https://own-notes.example.test',
    publishableKey: 'pk-own', workspaceId: 'deployed-workspace', itemId: 'deployed-item',
  }))))
  const connection = await createNotesConnection({
    ...generated, VITE_NOTES_API_URL: 'https://old.example.test', VITE_NOTES_ITEM_ID: 'old',
  }, 'https://sample.example.test')
  expect(connection.fabricOptions.projectId).toBe('deployed-item')
  expect(connection.fabricOptions.workspaceId).toBe('deployed-workspace')
})

it('uses only own mapped defaults on localhost when runtime config is absent', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
  const connection = await createNotesConnection(generated, 'http://localhost:5175')
  expect(connection.fabricOptions.projectId).toBe('own-item')
  await expect(createNotesConnection({ VITE_NOTES_ITEM_ID: 'old' }, 'http://localhost:5175')).rejects.toThrow('Deploy this sample')
  await expect(createNotesConnection(generated, 'https://sample.example.test')).rejects.toThrow('Deploy this sample')
})

it('does not fall back to stale configuration on runtime network or validation failures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
  await expect(createNotesConnection(generated, 'http://localhost:5175')).rejects.toThrow()
})
