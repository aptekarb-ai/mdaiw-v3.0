import { useMemo, useState, type ReactNode } from 'react';
import { useRecentEmails } from './useRecentEmails';
import { DEFAULT_QUERY, filterAndSortEmails } from './recentEmailsFilter';
import { getPlatformLabel } from './platformOptions';
import { formatUpdatedAtFull, formatUpdatedAtShort } from './dashboardFormat';
import type { EmailDocument, EmailStartType } from './types';
import '../pages/EmailBuilderDashboardPage.css';
import './EmailListPicker.css';

// Module-4 Navigation Completion, Phase A — the ONE reusable email-list
// UI, sharing the SAME data-access hook (useRecentEmails) and the SAME
// filter function (filterAndSortEmails) EmailBuilderDashboardPage/"My
// Emails" already uses. Every standalone entry point that needs "pick an
// email" (Preview & Validation, AI Engineer, Module Library's "insert
// into email" flow) renders THIS, with per-row actions supplied by the
// caller — never a second list-fetch/filter implementation.
//
// Phase B — `startTypeFilter` narrows the underlying list to one
// start_type (e.g. 'template' for the Templates experience) BEFORE search/
// sort runs; this is a plain array filter layered in front of
// filterAndSortEmails, not a second engine, and is what makes the empty
// states below correctly say "no templates" rather than "no emails" when
// the user has ordinary emails but no saved templates.
interface EmailListPickerProps {
  heading: string;
  description?: string;
  emptyHint?: string;
  emptyStateLabel?: string;
  startTypeFilter?: EmailStartType;
  renderRowActions: (email: EmailDocument) => ReactNode;
}

export function EmailListPicker({
  heading, description, emptyHint, emptyStateLabel, startTypeFilter, renderRowActions,
}: EmailListPickerProps) {
  const { status, emails, refresh } = useRecentEmails();
  const [search, setSearch] = useState('');

  const scopedEmails = useMemo(
    () => (startTypeFilter ? emails.filter((email) => email.start_type === startTypeFilter) : emails),
    [emails, startTypeFilter],
  );

  const filtered = useMemo(
    () => filterAndSortEmails(scopedEmails, { ...DEFAULT_QUERY, search }),
    [scopedEmails, search],
  );

  return (
    <section className="email-builder-dashboard__recent" aria-labelledby="email-list-picker-heading">
      <div className="email-builder-dashboard__recent-header">
        <div>
          <h2 id="email-list-picker-heading">{heading}</h2>
          {description && <p>{description}</p>}
        </div>
        <div className="email-builder-dashboard__toolbar">
          <label className="email-builder-dashboard__search">
            <span className="mdaiw-icon mdaiw-icon--search" aria-hidden="true" />
            <span className="visually-hidden">Search emails</span>
            <input
              type="search"
              placeholder="Search emails…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
      </div>

      {status === 'loading' && (
        <ul className="email-builder-dashboard__skeleton" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => <li key={index} />)}
        </ul>
      )}

      {status === 'error' && (
        <div className="email-builder-dashboard__state" role="alert">
          <p>Couldn&rsquo;t load your emails.</p>
          <button type="button" className="button button--outline" onClick={refresh}>
            Try again
          </button>
        </div>
      )}

      {status === 'success' && scopedEmails.length === 0 && (
        <div className="email-builder-dashboard__empty">
          <span className="mdaiw-icon mdaiw-icon--email" aria-hidden="true" />
          <p>{emptyStateLabel ?? 'No emails yet'}</p>
          <p className="email-builder-dashboard__empty-hint">{emptyHint ?? 'Create an email first.'}</p>
        </div>
      )}

      {status === 'success' && scopedEmails.length > 0 && filtered.length === 0 && (
        <div className="email-builder-dashboard__empty">
          <p>No emails match your search.</p>
          <button type="button" className="button button--outline" onClick={() => setSearch('')}>
            Clear search
          </button>
        </div>
      )}

      {status === 'success' && filtered.length > 0 && (
        <div className="email-builder-dashboard__table-wrap">
          <table className="email-builder-dashboard__table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Platform</th>
                <th scope="col">Last updated</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((email) => (
                <tr key={email.id} className="email-builder-dashboard__row">
                  <td data-label="Name">
                    <span className="email-builder-dashboard__row-name">{email.name}</span>
                  </td>
                  <td data-label="Platform" className="email-builder-dashboard__muted">
                    {getPlatformLabel(email.platform)}
                  </td>
                  <td data-label="Last updated" className="email-builder-dashboard__muted">
                    <span title={formatUpdatedAtFull(email.updated_at)}>
                      {formatUpdatedAtShort(email.updated_at)}
                    </span>
                  </td>
                  <td data-label="Actions" className="email-list-picker__actions">
                    {renderRowActions(email)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
