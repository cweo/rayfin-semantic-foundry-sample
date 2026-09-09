import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { useRequest } from '../useRequest';
import type { NotesClient } from './client';
import {
  deleteNote, readNotes, saveNote, type NoteRow, type NotesPage,
} from './data';

export function NotesPanel({ client }: { client: NotesClient }) {
  const { busy, error, run } = useRequest();
  const [page, setPage] = useState<NotesPage | null>(null);
  const [revision, setRevision] = useState(0);
  const [editingId, setEditingId] = useState<string>();
  const [confirmId, setConfirmId] = useState<string>();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback((cursor?: string) => {
    void run(() => readNotes(client, cursor), setPage);
  }, [client, run]);

  useEffect(() => { load(); }, [load, revision]);

  function resetEditor() {
    setEditingId(undefined);
    setTitle('');
    setBody('');
  }

  function edit(note: NoteRow) {
    setEditingId(note.id);
    setTitle(note.title);
    setBody(note.body);
    setConfirmId(undefined);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    setNotice('');
    void run(
      () => saveNote(client, title, body, editingId),
      () => {
        resetEditor();
        setNotice('Note saved.');
        setRevision((value) => value + 1);
      },
    );
  }

  function remove(id: string) {
    setNotice('');
    void run(
      () => deleteNote(client, id),
      () => {
        if (editingId === id) resetEditor();
        setConfirmId(undefined);
        setNotice('Note deleted.');
        setRevision((value) => value + 1);
      },
    );
  }

  return (
    <section className="panel" aria-labelledby="notes-title">
      <div className="panel-heading">
        <span className="step">01</span>
        <div>
          <h2 id="notes-title">My notes</h2>
          <p className="muted">Managed SQL | Private to your Fabric identity</p>
        </div>
      </div>
      <form onSubmit={save}>
        <label htmlFor="note-title">{editingId ? 'Edit note title' : 'New note title'}</label>
        <input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)}
          maxLength={200} required disabled={busy} autoComplete="off" />
        <label htmlFor="note-body">Body</label>
        <textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)}
          maxLength={4000} rows={3} disabled={busy} />
        <div className="actions">
          <button disabled={busy} type="submit">{editingId ? 'Save changes' : 'Create note'}</button>
          {editingId && (
            <button className="secondary" type="button" onClick={resetEditor} disabled={busy}>
              Cancel edit
            </button>
          )}
        </div>
      </form>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {busy && <p className="muted" role="status">Working on your notes...</p>}
      {page?.items.length === 0 && <p className="empty">No notes yet. Create your first one above.</p>}
      <div className="notes-list">
        {page?.items.map((note) => (
          <article className="note" key={note.id}>
            <h3>{note.title}</h3>
            <p className="note-body">{note.body || '(Empty note)'}</p>
            <div className="actions">
              <button className="secondary" onClick={() => edit(note)} disabled={busy}>Edit</button>
              {confirmId === note.id ? (
                <>
                  <span>Delete this note?</span>
                  <button className="danger" onClick={() => remove(note.id)} disabled={busy}>
                    Confirm delete
                  </button>
                  <button className="secondary" onClick={() => setConfirmId(undefined)} disabled={busy}>
                    Keep note
                  </button>
                </>
              ) : (
                <button className="secondary" onClick={() => setConfirmId(note.id)} disabled={busy}>
                  Delete
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="actions pagination">
        <button className="secondary" onClick={() => load()} disabled={busy}>Refresh / first page</button>
        <button className="secondary" onClick={() => load(page?.endCursor)}
          disabled={busy || !page?.hasNextPage || !page.endCursor}>
          Next 25
        </button>
        {page && <small className="muted">{page.items.length} notes on this page</small>}
      </div>
    </section>
  );
}
