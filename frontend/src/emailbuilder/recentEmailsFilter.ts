import type { EmailDocument, EmailDocumentStatus, EmailPlatform } from './types';

export type StatusFilter = 'all' | EmailDocumentStatus;
export type PlatformFilter = 'all' | EmailPlatform;
export type RecentEmailsSort = 'newest' | 'oldest' | 'name-asc' | 'name-desc';

export const DEFAULT_SORT: RecentEmailsSort = 'newest';

export interface RecentEmailsQuery {
  search: string;
  status: StatusFilter;
  platform: PlatformFilter;
  sort: RecentEmailsSort;
}

export const DEFAULT_QUERY: RecentEmailsQuery = {
  search: '', status: 'all', platform: 'all', sort: DEFAULT_SORT,
};

// Pure, synchronous, in-memory — the dashboard already has the full list
// from one listEmailDocuments() call (no backend pagination exists yet),
// so filtering/sorting here needs no debounce and no extra request per
// keystroke; see EmailBuilderDashboardPage's own comment for why this
// stays client-side instead of a server-side search endpoint.
export function filterAndSortEmails(emails: EmailDocument[], query: RecentEmailsQuery): EmailDocument[] {
  const search = query.search.trim().toLowerCase();

  const filtered = emails.filter((email) => {
    if (query.status !== 'all' && email.status !== query.status) return false;
    if (query.platform !== 'all' && email.platform !== query.platform) return false;
    if (!search) return true;
    return email.name.toLowerCase().includes(search) || email.platform.toLowerCase().includes(search);
  });

  const sorted = filtered.slice().sort((a, b) => {
    switch (query.sort) {
      case 'oldest':
        return a.updated_at.localeCompare(b.updated_at);
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'newest':
      default:
        return b.updated_at.localeCompare(a.updated_at);
    }
  });

  return sorted;
}
