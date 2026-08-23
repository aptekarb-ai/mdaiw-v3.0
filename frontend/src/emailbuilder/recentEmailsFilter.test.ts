import { describe, expect, it } from 'vitest';
import { filterAndSortEmails } from './recentEmailsFilter';
import type { EmailDocument } from './types';

function doc(overrides: Partial<EmailDocument>): EmailDocument {
  return {
    id: 1, name: 'Email', platform: 'generic', width: 700, start_type: 'blank', status: 'draft',
    content: { version: 1, modules: [] },
    email_title: '', email_subject: '', favicon_url: '',
    reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('filterAndSortEmails', () => {
  const emails = [
    doc({ id: 1, name: 'Spring Sale', platform: 'generic', updated_at: '2026-08-10T00:00:00Z' }),
    doc({ id: 2, name: 'Winter Recap', platform: 'sfmc', updated_at: '2026-08-20T00:00:00Z' }),
    doc({ id: 3, name: 'apple newsletter', platform: 'generic', updated_at: '2026-08-15T00:00:00Z' }),
  ];

  it('filters by case-insensitive name substring', () => {
    const result = filterAndSortEmails(emails, { search: 'winter', status: 'all', platform: 'all', sort: 'newest' });
    expect(result.map((e) => e.name)).toEqual(['Winter Recap']);
  });

  it('filters by platform substring match in search too', () => {
    const result = filterAndSortEmails(emails, { search: 'sfmc', status: 'all', platform: 'all', sort: 'newest' });
    expect(result.map((e) => e.name)).toEqual(['Winter Recap']);
  });

  it('empty search returns everything', () => {
    const result = filterAndSortEmails(emails, { search: '', status: 'all', platform: 'all', sort: 'newest' });
    expect(result).toHaveLength(3);
  });

  it('filters by platform', () => {
    const result = filterAndSortEmails(emails, { search: '', status: 'all', platform: 'sfmc', sort: 'newest' });
    expect(result.map((e) => e.name)).toEqual(['Winter Recap']);
  });

  it('filters by status', () => {
    const result = filterAndSortEmails(emails, { search: '', status: 'draft', platform: 'all', sort: 'newest' });
    expect(result).toHaveLength(3);
  });

  it('sorts newest first by default', () => {
    const result = filterAndSortEmails(emails, { search: '', status: 'all', platform: 'all', sort: 'newest' });
    expect(result.map((e) => e.name)).toEqual(['Winter Recap', 'apple newsletter', 'Spring Sale']);
  });

  it('sorts oldest first', () => {
    const result = filterAndSortEmails(emails, { search: '', status: 'all', platform: 'all', sort: 'oldest' });
    expect(result.map((e) => e.name)).toEqual(['Spring Sale', 'apple newsletter', 'Winter Recap']);
  });

  it('sorts name A-Z case-insensitively', () => {
    const result = filterAndSortEmails(emails, { search: '', status: 'all', platform: 'all', sort: 'name-asc' });
    expect(result.map((e) => e.name)).toEqual(['apple newsletter', 'Spring Sale', 'Winter Recap']);
  });

  it('sorts name Z-A', () => {
    const result = filterAndSortEmails(emails, { search: '', status: 'all', platform: 'all', sort: 'name-desc' });
    expect(result.map((e) => e.name)).toEqual(['Winter Recap', 'Spring Sale', 'apple newsletter']);
  });

  it('combines search and platform filter', () => {
    const result = filterAndSortEmails(
      emails, { search: 'newsletter', status: 'all', platform: 'generic', sort: 'newest' },
    );
    expect(result.map((e) => e.name)).toEqual(['apple newsletter']);
  });
});
