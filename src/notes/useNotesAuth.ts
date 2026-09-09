import {
  initiateFabricLogin,
  initEmbeddedAuth,
} from '@microsoft/rayfin-auth-provider-fabric';
import { isEmbeddedMode } from '@microsoft/fabric-embedded-host';
import { useEffect, useRef, useState } from 'react';

import type { NotesConnection } from './client';
import { errorText as errorMessage } from '../useRequest';

export function useNotesAuth({ client, fabricOptions }: NotesConnection) {
  const [session, setSession] = useState<ReturnType<typeof client.auth.getSession> | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const sessionReady = useRef(false);

  useEffect(() => {
    let active = true;
    sessionReady.current = false;
    const unsubscribe = client.auth.onSessionChange((next) => {
      if (active && sessionReady.current) setSession(next);
    });

    async function restore() {
      const embedded = isEmbeddedMode(fabricOptions);
      const embeddedSession = await initEmbeddedAuth(client.auth, fabricOptions);
      if (embedded && (!embeddedSession?.isAuthenticated || !embeddedSession.user)) {
        throw new Error('Fabric embedded sign-in did not establish a session. Sign in to notes explicitly.');
      }
      if (!embedded && !client.auth.getSession().isAuthenticated && client.auth.hasRefreshToken()) {
        await client.auth.refreshSession();
      }
      if (active) {
        sessionReady.current = true;
        setSession(embedded ? embeddedSession : client.auth.getSession());
      }
    }

    void restore()
      .catch((cause: unknown) => {
        if (active) {
          setSession(null);
          setError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [client, fabricOptions]);

  async function signIn() {
    setError('');
    setBusy(true);
    try {
      await initiateFabricLogin(client.auth, fabricOptions);
      const next = client.auth.getSession();
      if (!next.isAuthenticated || !next.user) {
        throw new Error('Fabric sign-in did not establish a session. Please sign in again.');
      }
      sessionReady.current = true;
      setSession(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setError('');
    setBusy(true);
    try {
      await client.auth.signOut();
      setSession(client.auth.getSession());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return { session, busy, error, signIn, signOut };
}
