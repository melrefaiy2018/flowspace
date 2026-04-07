import { useCallback, useEffect, useState } from 'react';

const IDENTITY_EVENT = 'flowspace:identity-updated';

function identityStorageKey(email?: string | null) {
  return email ? `flowspace.settings.identity.${email}` : 'flowspace.settings.identity';
}

function fallbackIdentity(email?: string | null, defaultName?: string | null) {
  return defaultName?.trim() || email?.split('@')[0] || 'FlowSpace user';
}

export function getWorkspaceIdentity(email?: string | null, defaultName?: string | null) {
  if (typeof window === 'undefined') return fallbackIdentity(email, defaultName);
  const stored = window.localStorage.getItem(identityStorageKey(email));
  return stored?.trim() || fallbackIdentity(email, defaultName);
}

function emitIdentityUpdate(email?: string | null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IDENTITY_EVENT, { detail: { email: email ?? null } }));
}

export function setWorkspaceIdentity(value: string, email?: string | null) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(identityStorageKey(email), value);
  emitIdentityUpdate(email);
}

export function resetWorkspaceIdentity(email?: string | null) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(identityStorageKey(email));
  emitIdentityUpdate(email);
}

export function useWorkspaceIdentity(email?: string | null, defaultName?: string | null) {
  const [identity, setIdentity] = useState(() => getWorkspaceIdentity(email, defaultName));

  useEffect(() => {
    setIdentity(getWorkspaceIdentity(email, defaultName));
  }, [email, defaultName]);

  useEffect(() => {
    const syncIdentity = (event?: Event) => {
      const customEvent = event as CustomEvent<{ email?: string | null }> | undefined;
      const targetEmail = customEvent?.detail?.email;
      if (typeof targetEmail !== 'undefined' && targetEmail !== (email ?? null)) return;
      setIdentity(getWorkspaceIdentity(email, defaultName));
    };

    window.addEventListener(IDENTITY_EVENT, syncIdentity);
    window.addEventListener('storage', syncIdentity);
    return () => {
      window.removeEventListener(IDENTITY_EVENT, syncIdentity);
      window.removeEventListener('storage', syncIdentity);
    };
  }, [email, defaultName]);

  const saveIdentity = useCallback((value: string) => {
    setWorkspaceIdentity(value, email);
    setIdentity(getWorkspaceIdentity(email, defaultName));
  }, [defaultName, email]);

  const clearIdentity = useCallback(() => {
    resetWorkspaceIdentity(email);
    setIdentity(getWorkspaceIdentity(email, defaultName));
  }, [defaultName, email]);

  return {
    identity,
    saveIdentity,
    clearIdentity,
  };
}
