import { useEffect, useState } from 'react';
import { listEmailDocuments } from '../api/client';
import type { RecentEmailSummary } from './types';

export type RecentEmailsStatus = 'loading' | 'success' | 'error';

export interface RecentEmailsState {
  status: RecentEmailsStatus;
  emails: RecentEmailSummary[];
}

export function useRecentEmails(): RecentEmailsState {
  const [state, setState] = useState<RecentEmailsState>({ status: 'loading', emails: [] });

  useEffect(() => {
    let cancelled = false;

    listEmailDocuments()
      .then((documents) => {
        if (cancelled) return;
        const emails: RecentEmailSummary[] = documents.map((document) => ({
          id: document.id,
          name: document.name,
          platform: document.platform,
          width: document.width,
          status: document.status,
          updatedAt: document.updated_at,
        }));
        setState({ status: 'success', emails });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error', emails: [] });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
