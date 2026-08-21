import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { QUICK_ACTIONS, GETTING_STARTED_STEPS } from '../emailbuilder/dashboardData';
import { useRecentEmails } from '../emailbuilder/useRecentEmails';
import { deleteEmailDocument, updateEmailDocument } from '../api/client';
import { duplicateEmailDocument } from '../emailbuilder/duplicateEmailDocument';
import { getPlatformLabel, PLATFORM_OPTIONS } from '../emailbuilder/platformOptions';
import { formatUpdatedAtFull, formatUpdatedAtShort } from '../emailbuilder/dashboardFormat';
import {
  DEFAULT_QUERY, filterAndSortEmails, type PlatformFilter, type RecentEmailsSort, type StatusFilter,
} from '../emailbuilder/recentEmailsFilter';
import { RowActionsMenu } from '../emailbuilder/RowActionsMenu';
import { RenameEmailDialog } from '../emailbuilder/RenameEmailDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { ApiError } from '../types/auth';
import type { EmailDocument } from '../emailbuilder/types';
import './EmailBuilderDashboardPage.css';

// Only 'create' has a real, implemented next step (Feature 02). The other
// three quick actions stay disabled until their own starting-point flow
// exists — see startTypeOptions.ts for the same "available" gate used in
// the Create Email wizard's Start From cards.
const ACTION_ROUTES: Partial<Record<(typeof QUICK_ACTIONS)[number]['key'], string>> = {
  create: '/email-builder/create',
};

const PAGE_SIZE = 12;

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
];

const SORT_OPTIONS: { value: RecentEmailsSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
];

function apiErrorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiError;
  return apiError?.message || fallback;
}

export function EmailBuilderDashboardPage() {
  const { status, emails, refresh, replaceEmail, addEmail, removeEmail } = useRecentEmails();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_QUERY.status);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>(DEFAULT_QUERY.platform);
  const [sort, setSort] = useState<RecentEmailsSort>(DEFAULT_QUERY.sort);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [renameTarget, setRenameTarget] = useState<EmailDocument | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<EmailDocument | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const hasAnyFilterApplied = search.trim() !== '' || statusFilter !== 'all' || platformFilter !== 'all';

  const filtered = useMemo(
    () => filterAndSortEmails(emails, { search, status: statusFilter, platform: platformFilter, sort }),
    [emails, search, statusFilter, platformFilter, sort],
  );
  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visible.length;

  function resetPaging() {
    setVisibleCount(PAGE_SIZE);
  }

  function clearFilters() {
    setSearch('');
    setStatusFilter('all');
    setPlatformFilter('all');
    resetPaging();
  }

  function openEmail(id: number) {
    navigate(`/email-builder/builder/${id}`);
  }

  async function handleRename(name: string) {
    if (!renameTarget) return;
    setRenameSaving(true);
    setRenameError(null);
    try {
      const updated = await updateEmailDocument(renameTarget.id, { name });
      replaceEmail(updated);
      setRenameTarget(null);
    } catch (error) {
      setRenameError(apiErrorMessage(error, 'Could not rename this email. Please try again.'));
    } finally {
      setRenameSaving(false);
    }
  }

  async function handleDuplicate(email: EmailDocument) {
    setDuplicateError(null);
    setDuplicatingId(email.id);
    try {
      const created = await duplicateEmailDocument(email);
      addEmail(created);
    } catch {
      // Deliberately not error.message here — a duplicate failure's
      // underlying cause (e.g. the source document's own content no
      // longer passes validation) is a field-level serializer message
      // meant for a form, and reads as confusing/out-of-context in a
      // table row with no form to point at.
      setDuplicateError('Could not duplicate this email. Please try again.');
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await deleteEmailDocument(deleteTarget.id);
      removeEmail(deleteTarget.id);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(apiErrorMessage(error, 'Could not delete this email. Please try again.'));
    }
  }

  return (
    <section className="email-builder-dashboard">
      <header className="email-builder-dashboard__header">
        <div>
          <h1>AI Email Builder</h1>
          <p>Build, edit and manage responsive email campaigns.</p>
        </div>
        <Link to="/email-builder/create" className="button button--primary email-builder-dashboard__header-cta">
          <span className="mdaiw-icon mdaiw-icon--file" aria-hidden="true" />
          Create Email
        </Link>
      </header>

      <div className="email-builder-dashboard__actions" role="group" aria-label="Quick actions">
        {QUICK_ACTIONS.map((action) => {
          const route = ACTION_ROUTES[action.key];
          if (route) {
            return (
              <Link key={action.key} to={route} className="email-builder-dashboard__action email-builder-dashboard__action--primary">
                <span className={`mdaiw-icon mdaiw-icon--${action.icon}`} aria-hidden="true" />
                <span className="email-builder-dashboard__action-title">{action.title}</span>
                <span className="email-builder-dashboard__action-description">{action.description}</span>
                {/* Invisible same-size placeholder — the only real
                    difference from a "Coming soon" card, so every card
                    reserves identical vertical space at 1-column width
                    where each is its own grid row (desktop/tablet rows
                    hold multiple cards and stretch to match regardless). */}
                <span className="email-builder-dashboard__action-status" aria-hidden="true" style={{ visibility: 'hidden' }}>
                  Coming soon
                </span>
              </Link>
            );
          }

          return (
            <button
              key={action.key}
              type="button"
              className="email-builder-dashboard__action"
              disabled
              aria-disabled="true"
              aria-describedby={`email-builder-action-status-${action.key}`}
            >
              <span className={`mdaiw-icon mdaiw-icon--${action.icon}`} aria-hidden="true" />
              <span className="email-builder-dashboard__action-title">{action.title}</span>
              <span className="email-builder-dashboard__action-description">{action.description}</span>
              <span
                id={`email-builder-action-status-${action.key}`}
                className="email-builder-dashboard__action-status"
              >
                Coming soon
              </span>
            </button>
          );
        })}
      </div>

      <div className="email-builder-dashboard__body">
        <section aria-labelledby="email-builder-recent-heading" className="email-builder-dashboard__recent">
          <div className="email-builder-dashboard__recent-header">
            <h2 id="email-builder-recent-heading">Recent Emails</h2>
            <div className="email-builder-dashboard__toolbar">
              <label className="email-builder-dashboard__search">
                <span className="mdaiw-icon mdaiw-icon--search" aria-hidden="true" />
                <span className="visually-hidden">Search emails</span>
                <input
                  type="search"
                  placeholder="Search emails…"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    resetPaging();
                  }}
                />
              </label>
              <label className="email-builder-dashboard__filter">
                <span className="visually-hidden">Filter by status</span>
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter);
                    resetPaging();
                  }}
                >
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="email-builder-dashboard__filter">
                <span className="visually-hidden">Filter by platform</span>
                <select
                  value={platformFilter}
                  onChange={(event) => {
                    setPlatformFilter(event.target.value as PlatformFilter);
                    resetPaging();
                  }}
                >
                  <option value="all">All platforms</option>
                  {PLATFORM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="email-builder-dashboard__filter">
                <span className="visually-hidden">Sort by</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as RecentEmailsSort)}>
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {duplicateError && (
            <p role="alert" className="email-builder-dashboard__inline-error">
              {duplicateError}
              <button
                type="button"
                className="email-builder-dashboard__inline-error-dismiss"
                aria-label="Dismiss"
                onClick={() => setDuplicateError(null)}
              >
                <span className="mdaiw-icon mdaiw-icon--close" aria-hidden="true" />
              </button>
            </p>
          )}

          {status === 'loading' && (
            <ul className="email-builder-dashboard__skeleton" aria-hidden="true">
              {Array.from({ length: 5 }, (_, index) => <li key={index} />)}
            </ul>
          )}

          {status === 'error' && (
            <div className="email-builder-dashboard__state" role="alert">
              <p>Couldn&rsquo;t load recent emails.</p>
              <button type="button" className="button button--outline" onClick={refresh}>
                Try again
              </button>
            </div>
          )}

          {status === 'success' && emails.length === 0 && (
            <div className="email-builder-dashboard__empty">
              <span className="mdaiw-icon mdaiw-icon--email" aria-hidden="true" />
              <p>No emails yet</p>
              <p className="email-builder-dashboard__empty-hint">Create your first responsive email.</p>
              <Link to="/email-builder/create" className="button button--primary">Create Email</Link>
            </div>
          )}

          {status === 'success' && emails.length > 0 && filtered.length === 0 && (
            <div className="email-builder-dashboard__empty">
              <p>No emails match your search.</p>
              <button type="button" className="button button--outline" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}

          {status === 'success' && filtered.length > 0 && (
            <>
              <div className="email-builder-dashboard__table-wrap">
                <table className="email-builder-dashboard__table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Platform</th>
                      <th scope="col">Width</th>
                      <th scope="col">Status</th>
                      <th scope="col">Last updated</th>
                      <th scope="col"><span className="visually-hidden">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((email) => (
                      <tr
                        key={email.id}
                        className="email-builder-dashboard__row"
                        onClick={() => openEmail(email.id)}
                      >
                        <td data-label="Name">
                          <Link
                            to={`/email-builder/builder/${email.id}`}
                            className="email-builder-dashboard__row-name"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {email.name}
                          </Link>
                        </td>
                        <td data-label="Platform" className="email-builder-dashboard__muted">
                          {getPlatformLabel(email.platform)}
                        </td>
                        <td data-label="Width" className="email-builder-dashboard__muted">{email.width}px</td>
                        <td data-label="Status">
                          <span className="email-builder-dashboard__badge">{email.status}</span>
                        </td>
                        <td data-label="Last updated" className="email-builder-dashboard__muted">
                          <span title={formatUpdatedAtFull(email.updated_at)}>
                            {formatUpdatedAtShort(email.updated_at)}
                          </span>
                        </td>
                        <td data-label="Actions" className="email-builder-dashboard__actions-cell" onClick={(event) => event.stopPropagation()}>
                          <RowActionsMenu
                            label={`Actions for ${email.name}`}
                            items={[
                              { key: 'open', label: 'Open', onSelect: () => openEmail(email.id) },
                              {
                                key: 'duplicate',
                                label: duplicatingId === email.id ? 'Duplicating…' : 'Duplicate',
                                onSelect: () => handleDuplicate(email),
                              },
                              { key: 'rename', label: 'Rename', onSelect: () => { setRenameError(null); setRenameTarget(email); } },
                              {
                                key: 'delete', label: 'Delete', destructive: true,
                                onSelect: () => { setDeleteError(null); setDeleteTarget(email); },
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMore && (
                <div className="email-builder-dashboard__load-more">
                  <button type="button" className="button button--outline" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                    Load more
                  </button>
                </div>
              )}
              {!hasMore && hasAnyFilterApplied && filtered.length < emails.length && (
                <p className="email-builder-dashboard__result-count">
                  Showing {filtered.length} of {emails.length} emails.
                </p>
              )}
            </>
          )}
        </section>

        <section
          aria-labelledby="email-builder-getting-started-heading"
          className="email-builder-dashboard__getting-started"
        >
          <h2 id="email-builder-getting-started-heading">Getting Started</h2>
          <ol className="email-builder-dashboard__steps">
            {GETTING_STARTED_STEPS.map((step) => (
              <li key={step.step} className="email-builder-dashboard__step">
                <span className="email-builder-dashboard__step-number" aria-hidden="true">
                  {step.step}
                </span>
                {step.title}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {renameTarget && (
        <RenameEmailDialog
          currentName={renameTarget.name}
          saving={renameSaving}
          error={renameError}
          onRename={handleRename}
          onCancel={() => setRenameTarget(null)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        heading="Delete email?"
        body={deleteTarget ? `"${deleteTarget.name}" will be permanently deleted. This cannot be undone.` : ''}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
      />
      {deleteError && (
        <p role="alert" className="email-builder-dashboard__inline-error email-builder-dashboard__delete-error">
          {deleteError}
        </p>
      )}
    </section>
  );
}
