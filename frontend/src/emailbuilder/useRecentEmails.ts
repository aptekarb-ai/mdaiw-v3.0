import { useState } from 'react';
import type { RecentEmailSummary } from './types';

export type RecentEmailsStatus = 'loading' | 'success' | 'error';

export interface RecentEmailsState {
  status: RecentEmailsStatus;
  emails: RecentEmailSummary[];
}

// No email-record backend exists yet — this hook is the seam a future
// API-backed version will replace; callers already handle every status.
export function useRecentEmails(): RecentEmailsState {
  const [state] = useState<RecentEmailsState>({ status: 'success', emails: [] });
  return state;
}
