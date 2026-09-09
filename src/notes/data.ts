import type { NotesClient, Note } from './client';

export const NOTE_PAGE_SIZE = 25;

export type NoteRow = Pick<Note, 'id' | 'title' | 'body'>;
export interface NotesPage {
  items: NoteRow[];
  hasNextPage: boolean;
  endCursor?: string;
}

function currentUserId(client: NotesClient): string {
  const session = client.auth.getSession();
  if (!session.isAuthenticated || !session.user) {
    throw new Error('Sign in before accessing notes.');
  }
  return session.user.id;
}

export function noteInput(title: string, body: string) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle || trimmedTitle.length > 200 || body.length > 4000) {
    throw new Error('Enter a title of 1-200 characters and a body of at most 4000 characters.');
  }
  return { title: trimmedTitle, body };
}

export function readNotes(client: NotesClient, cursor?: string): Promise<NotesPage> {
  const query = client.data.Note
    .select(['id', 'title', 'body'])
    .where({ user_id: { eq: currentUserId(client) } })
    .orderBy({ title: 'asc', id: 'asc' })
    .first(NOTE_PAGE_SIZE);

  return (cursor ? query.after(cursor) : query).executePaginated();
}

export function saveNote(client: NotesClient, title: string, body: string, id?: string) {
  const userId = currentUserId(client);
  const input = noteInput(title, body);
  return id
    ? client.data.Note.update({ id }, input)
    : client.data.Note.create({ ...input, user_id: userId });
}

export function deleteNote(client: NotesClient, id: string) {
  currentUserId(client);
  return client.data.Note.delete({ id });
}
