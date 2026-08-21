import { useCallback, useEffect, useState } from 'react';
import { listEmailDocuments } from '../api/client';
import type { EmailDocument } from './types';

export type RecentEmailsStatus = 'loading' | 'success' | 'error';

export interface RecentEmailsState {
  status: RecentEmailsStatus;
  emails: EmailDocument[];
  // Re-run the list fetch (e.g. after a Delete/Duplicate call the caller
  // doesn't want to hand-patch into local state).
  refresh: () => void;
  // Optimistic local patch — Rename applies immediately without a full
  // refetch (the PATCH response already has the authoritative row).
  replaceEmail: (updated: EmailDocument) => void;
  // Prepend a freshly created/duplicated row without a full refetch.
  addEmail: (created: EmailDocument) => void;
  removeEmail: (id: number) => void;
}

export function useRecentEmails(): RecentEmailsState {
  const [status, setStatus] = useState<RecentEmailsStatus>('loading');
  const [emails, setEmails] = useState<EmailDocument[]>([]);
  // Bumping this re-runs the load effect — a plain counter is enough,
  // there is no request payload that changes between refreshes.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    listEmailDocuments()
      .then((documents) => {
        if (cancelled) return;
        setEmails(documents);
        setStatus('success');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

  const replaceEmail = useCallback((updated: EmailDocument) => {
    setEmails((current) => current.map((email) => (email.id === updated.id ? updated : email)));
  }, []);

  const addEmail = useCallback((created: EmailDocument) => {
    setEmails((current) => [created, ...current]);
  }, []);

  const removeEmail = useCallback((id: number) => {
    setEmails((current) => current.filter((email) => email.id !== id));
  }, []);

  return { status, emails, refresh, replaceEmail, addEmail, removeEmail };
}
