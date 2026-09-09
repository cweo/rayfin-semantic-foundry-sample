import { RayfinClient } from '@microsoft/rayfin-client'
import { describe, expect, it, vi } from 'vitest'
import type { Note } from './client'
import { deleteNote, noteInput, readNotes, saveNote } from './data'

function fixture(owner = 'fabric-note-owner') {
  const client = new RayfinClient<{ Note: Note }>({
    baseUrl: 'https://notes.example.test/',
    publishableKey: 'pk-test',
    authStorage: false,
  })
  vi.spyOn(client.auth, 'getSession').mockReturnValue({
    user: { id: owner, email: 'owner@example.test' },
    isAuthenticated: true,
    isAnonymous: false,
  })
  return client
}

describe('private SQL notes integration', () => {
  it.each(['owner-alice', 'owner-bob'])('creates notes using the current Fabric session owner (%s)', async (owner) => {
    const client = fixture(owner)
    const create = vi.spyOn(client.data.Note, 'create').mockResolvedValue({
      id: 'note-id', title: 'Hello', body: 'Body', user_id: owner,
    })
    await saveNote(client, ' Hello ', 'Body')
    expect(create).toHaveBeenCalledWith({ title: 'Hello', body: 'Body', user_id: owner })
  })
  it('updates only content and deletes by ID', async () => {
    const client = fixture()
    const note = { id: 'note-id', title: 'Updated', body: 'Body', user_id: 'fabric-note-owner' }
    const update = vi.spyOn(client.data.Note, 'update').mockResolvedValue(note)
    const remove = vi.spyOn(client.data.Note, 'delete').mockResolvedValue(note)
    await saveNote(client, 'Updated', 'Body', 'note-id')
    await deleteNote(client, 'note-id')
    expect(update).toHaveBeenCalledWith({ id: 'note-id' }, { title: 'Updated', body: 'Body' })
    expect(remove).toHaveBeenCalledWith({ id: 'note-id' })
  })
  it('requires the notes session instead of accepting a Lakehouse/MSAL identity', () => {
    const client = fixture()
    vi.mocked(client.auth.getSession).mockReturnValue({ user: null, isAuthenticated: false, isAnonymous: true })
    expect(() => saveNote(client, 'Title', '')).toThrow('Sign in')
    expect(() => readNotes(client)).toThrow('Sign in')
    expect(() => deleteNote(client, 'note-id')).toThrow('Sign in')
  })
  it('preserves the existing field limits', () => {
    expect(() => noteInput(' ', '')).toThrow()
    expect(() => noteInput('x'.repeat(201), '')).toThrow()
    expect(() => noteInput('Title', 'x'.repeat(4001))).toThrow()
    expect(noteInput('  Title  ', ' body ')).toEqual({ title: 'Title', body: ' body ' })
  })
})
