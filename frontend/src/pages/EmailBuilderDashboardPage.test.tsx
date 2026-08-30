import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailBuilderDashboardPage } from './EmailBuilderDashboardPage';
import * as client from '../api/client';
import * as duplicateModule from '../emailbuilder/duplicateEmailDocument';
import type { EmailDocument } from '../emailbuilder/types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listEmailDocuments: vi.fn(),
    updateEmailDocument: vi.fn(),
    deleteEmailDocument: vi.fn(),
  };
});

vi.mock('../emailbuilder/duplicateEmailDocument', () => ({
  duplicateEmailDocument: vi.fn(),
}));

function doc(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 1,
    name: 'August Product Newsletter',
    platform: 'generic',
    width: 700,
    start_type: 'blank',
    status: 'draft',
    content: { version: 1, modules: [] },
    email_title: '',
    email_subject: '',
    favicon_url: '',
    reset_css_enabled: true,
    custom_css_enabled: false,
    custom_css: '',
    outlook_vml_enabled: false,
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function mockDocuments(documents: EmailDocument[]) {
  vi.mocked(client.listEmailDocuments).mockResolvedValue(documents);
}

function mockDocumentsError() {
  vi.mocked(client.listEmailDocuments).mockRejectedValue({ message: 'Network error' });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/email-builder']}>
      <Routes>
        <Route path="/email-builder" element={<EmailBuilderDashboardPage />} />
        <Route path="/email-builder/create" element={<div>Create Email page</div>} />
        <Route path="/email-builder/builder/:id" element={<BuilderStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

function BuilderStub() {
  return <div>Builder page</div>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('EmailBuilderDashboardPage — header and quick actions', () => {
  it('renders the compact header title, description and primary CTA', async () => {
    mockDocuments([]);
    renderPage();
    expect(screen.getByRole('heading', { name: 'AI Email Builder', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Build, edit and manage responsive email campaigns.')).toBeInTheDocument();
    const headerLinks = screen.getAllByRole('link', { name: /Create Email/ });
    expect(headerLinks.some((link) => link.getAttribute('href') === '/email-builder/create')).toBe(true);
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });

  it('renders Create New Email as an enabled link to /email-builder/create', async () => {
    mockDocuments([]);
    renderPage();
    const createLink = screen.getByRole('link', { name: /Create New Email/ });
    expect(createLink).toHaveAttribute('href', '/email-builder/create');
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });

  it('header CTA and quick-action card both navigate to the same Create Email route', async () => {
    mockDocuments([]);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: /^Create New Email/ }));
    expect(await screen.findByText('Create Email page')).toBeInTheDocument();
  });

  // Phase D (AI Generate Email) — every quick action is now enabled;
  // there is no remaining disabled entry. (Every card — including the
  // enabled ones — still carries a visually-hidden same-size "Coming
  // soon" placeholder span for layout purposes, so this checks for
  // disabled BUTTONS specifically, not the text.)
  it('has no remaining disabled quick-action entries', async () => {
    mockDocuments([]);
    renderPage();
    const disabledActionButtons = screen.queryAllByRole('button', { name: /Choose Template|Import HTML|AI Generate Email/ })
      .filter((button) => button.hasAttribute('disabled'));
    expect(disabledActionButtons).toHaveLength(0);
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });

  // Phase D (AI Generate Email) — AI Generate Email is no longer
  // "Coming soon"; it routes to the shared AI Generate page.
  it('renders AI Generate Email as an enabled link to /email-builder/ai-generate', async () => {
    mockDocuments([]);
    renderPage();
    const aiLink = screen.getByRole('link', { name: /AI Generate Email/ });
    expect(aiLink).toHaveAttribute('href', '/email-builder/ai-generate');
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });

  // Phase B (Template Experience) — Choose Template is no longer
  // "Coming soon"; it routes to the shared Templates picker.
  it('renders Choose Template as an enabled link to /email-builder/templates', async () => {
    mockDocuments([]);
    renderPage();
    const templateLink = screen.getByRole('link', { name: /Choose Template/ });
    expect(templateLink).toHaveAttribute('href', '/email-builder/templates');
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });

  // Phase C (Import HTML) — Import HTML is no longer "Coming soon"; it
  // routes to the shared Import HTML page.
  it('renders Import HTML as an enabled link to /email-builder/import', async () => {
    mockDocuments([]);
    renderPage();
    const importLink = screen.getByRole('link', { name: /Import HTML/ });
    expect(importLink).toHaveAttribute('href', '/email-builder/import');
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });
});

describe('EmailBuilderDashboardPage — states', () => {
  it('shows row skeletons while recent emails are being fetched', () => {
    vi.mocked(client.listEmailDocuments).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.email-builder-dashboard__skeleton')).toBeInTheDocument();
  });

  it('shows the first-time empty state when no emails exist', async () => {
    mockDocuments([]);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Recent Emails' })).toBeInTheDocument();
    expect(await screen.findByText('No emails yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first responsive email.')).toBeInTheDocument();
  });

  it('shows a Try again error state (not a raw API error) when recent emails fail to load', async () => {
    mockDocumentsError();
    renderPage();
    expect(await screen.findByText("Couldn’t load recent emails.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Network error')).not.toBeInTheDocument();
  });

  it('Try again re-issues the list request', async () => {
    mockDocumentsError();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Couldn’t load recent emails.");
    mockDocuments([doc()]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('August Product Newsletter')).toBeInTheDocument();
  });
});

describe('EmailBuilderDashboardPage — Recent Emails table', () => {
  it('lists a draft with normalized platform label, width, status and formatted date', async () => {
    mockDocuments([doc({ platform: 'sfmc', updated_at: '2026-08-21T22:27:16Z' })]);
    renderPage();
    expect(await screen.findByText('August Product Newsletter')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Salesforce Marketing Cloud')).toBeInTheDocument();
    expect(within(table).getByText('700px')).toBeInTheDocument();
    expect(within(table).getByText('draft')).toBeInTheDocument();
    // Short display date must not be the raw ISO/locale-default string.
    expect(screen.queryByText('2026-08-21T22:27:16Z')).not.toBeInTheDocument();
  });

  it('uses real table markup with semantic column headers', async () => {
    mockDocuments([doc()]);
    renderPage();
    await screen.findByText('August Product Newsletter');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Platform' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Width' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Last updated' })).toBeInTheDocument();
  });

  it('the email name is a real link to the builder route', async () => {
    mockDocuments([doc({ id: 42 })]);
    renderPage();
    const nameLink = await screen.findByRole('link', { name: 'August Product Newsletter' });
    expect(nameLink).toHaveAttribute('href', '/email-builder/builder/42');
  });

  it('opens the correct email when its name is clicked', async () => {
    mockDocuments([doc({ id: 7, name: 'Specific Draft' })]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('link', { name: 'Specific Draft' }));
    expect(await screen.findByText('Builder page')).toBeInTheDocument();
  });

  it('sorts newest-first by default', async () => {
    mockDocuments([
      doc({ id: 1, name: 'Older', updated_at: '2026-08-01T00:00:00Z' }),
      doc({ id: 2, name: 'Newer', updated_at: '2026-08-20T00:00:00Z' }),
    ]);
    renderPage();
    await screen.findByText('Newer');
    const names = screen.getAllByRole('link').map((link) => link.textContent).filter((text) => text === 'Older' || text === 'Newer');
    expect(names).toEqual(['Newer', 'Older']);
  });
});

describe('EmailBuilderDashboardPage — search, filter, sort', () => {
  it('filters by name as the user types', async () => {
    mockDocuments([doc({ id: 1, name: 'Spring Sale' }), doc({ id: 2, name: 'Winter Recap' })]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Spring Sale');
    await user.type(screen.getByPlaceholderText('Search emails…'), 'winter');
    expect(screen.queryByText('Spring Sale')).not.toBeInTheDocument();
    expect(screen.getByText('Winter Recap')).toBeInTheDocument();
  });

  it('clearing the search restores the full list', async () => {
    mockDocuments([doc({ id: 1, name: 'Spring Sale' }), doc({ id: 2, name: 'Winter Recap' })]);
    const user = userEvent.setup();
    renderPage();
    const search = screen.getByPlaceholderText('Search emails…');
    await user.type(search, 'winter');
    await screen.findByText('Winter Recap');
    await user.clear(search);
    expect(await screen.findByText('Spring Sale')).toBeInTheDocument();
  });

  it('shows the no-match empty state (not the first-time empty state) when search has no results', async () => {
    mockDocuments([doc({ name: 'Spring Sale' })]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Spring Sale');
    await user.type(screen.getByPlaceholderText('Search emails…'), 'zzz-no-match');
    expect(await screen.findByText('No emails match your search.')).toBeInTheDocument();
    expect(screen.queryByText('No emails yet')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Spring Sale')).toBeInTheDocument();
  });

  it('status filter narrows the list', async () => {
    mockDocuments([doc({ id: 1, name: 'Only Draft' })]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Only Draft');
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'draft');
    expect(screen.getByText('Only Draft')).toBeInTheDocument();
  });

  it('sort dropdown reorders by name A–Z', async () => {
    mockDocuments([doc({ id: 1, name: 'Zebra' }), doc({ id: 2, name: 'Apple' })]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Zebra');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'name-asc');
    const names = screen.getAllByRole('link').map((link) => link.textContent).filter((text) => text === 'Zebra' || text === 'Apple');
    expect(names).toEqual(['Apple', 'Zebra']);
  });
});

describe('EmailBuilderDashboardPage — row actions', () => {
  it('the kebab menu opens with Open/Duplicate/Rename/Delete', async () => {
    mockDocuments([doc()]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Product Newsletter');
    await user.click(screen.getByRole('button', { name: /Actions for August Product Newsletter/ }));
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('Escape closes the row action menu', async () => {
    mockDocuments([doc()]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Product Newsletter');
    await user.click(screen.getByRole('button', { name: /Actions for/ }));
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('Open from the menu navigates to the builder', async () => {
    mockDocuments([doc({ id: 9 })]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Product Newsletter');
    await user.click(screen.getByRole('button', { name: /Actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(await screen.findByText('Builder page')).toBeInTheDocument();
  });

  it('Rename opens a dialog, saves through the API, and updates the row without a reload', async () => {
    mockDocuments([doc({ id: 3, name: 'Old Name' })]);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(doc({ id: 3, name: 'New Name' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Old Name');
    await user.click(screen.getByRole('button', { name: /Actions for Old Name/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText('Email name');
    await user.clear(input);
    await user.type(input, 'New Name');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(client.updateEmailDocument).toHaveBeenCalledWith(3, { name: 'New Name' });
    expect(await screen.findByText('New Name')).toBeInTheDocument();
    expect(screen.queryByText('Old Name')).not.toBeInTheDocument();
  });

  it('Rename trims whitespace and rejects an empty name client-side', async () => {
    mockDocuments([doc({ name: 'Old Name' })]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Old Name');
    await user.click(screen.getByRole('button', { name: /Actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText('Email name');
    await user.clear(input);
    await user.type(input, '   ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('Duplicate creates an independent copy and shows it in the list', async () => {
    mockDocuments([doc({ id: 1, name: 'Original' })]);
    vi.mocked(duplicateModule.duplicateEmailDocument).mockResolvedValue(
      doc({ id: 2, name: 'Copy of Original' }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Original');
    await user.click(screen.getByRole('button', { name: /Actions for Original/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(await screen.findByText('Copy of Original')).toBeInTheDocument();
    expect(screen.getByText('Original')).toBeInTheDocument();
  });

  it('Delete requires confirmation, identifies the email by name, and calls the real API', async () => {
    mockDocuments([doc({ id: 5, name: 'Doomed Draft' })]);
    vi.mocked(client.deleteEmailDocument).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Doomed Draft');
    await user.click(screen.getByRole('button', { name: /Actions for Doomed Draft/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText(/"Doomed Draft" will be permanently deleted/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(client.deleteEmailDocument).toHaveBeenCalledWith(5);
    await waitFor(() => expect(screen.queryByText('Doomed Draft')).not.toBeInTheDocument());
  });

  it('Delete with Cancel does not call the API and keeps the row', async () => {
    mockDocuments([doc({ name: 'Keep Me' })]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Keep Me');
    await user.click(screen.getByRole('button', { name: /Actions for Keep Me/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(client.deleteEmailDocument).not.toHaveBeenCalled();
    expect(screen.getByText('Keep Me')).toBeInTheDocument();
  });

  // Regression: the menuitem that opens a dialog unmounts (menu closes) in
  // the same commit that mounts the dialog. Without RowActionsMenu
  // explicitly refocusing its trigger first, the browser drops focus to
  // <body> before the dialog captures "previously focused element",
  // so closing the dialog left focus on <body> instead of the trigger.
  it('Escape from the Rename dialog returns focus to the row actions trigger', async () => {
    mockDocuments([doc({ name: 'Focus Check' })]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Focus Check');
    const trigger = screen.getByRole('button', { name: /Actions for Focus Check/ });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getByLabelText('Email name')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Escape from the Delete confirmation returns focus to the row actions trigger', async () => {
    mockDocuments([doc({ name: 'Focus Check Two' })]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Focus Check Two');
    const trigger = screen.getByRole('button', { name: /Actions for Focus Check Two/ });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('EmailBuilderDashboardPage — pagination', () => {
  it('shows Load more when there are more than a page of results, and reveals more on click', async () => {
    mockDocuments(Array.from({ length: 14 }, (_, index) => doc({ id: index + 1, name: `Email ${index + 1}` })));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Email 1');
    const loadMore = screen.getByRole('button', { name: 'Load more' });
    expect(screen.queryByText('Email 13')).not.toBeInTheDocument();
    await user.click(loadMore);
    expect(await screen.findByText('Email 13')).toBeInTheDocument();
  });

  it('does not show Load more when the list fits on one page', async () => {
    mockDocuments([doc()]);
    renderPage();
    await screen.findByText('August Product Newsletter');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});

describe('EmailBuilderDashboardPage — Getting Started', () => {
  it('shows the six-step Getting Started workflow in order without fake progress', async () => {
    mockDocuments([]);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Getting Started' })).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(steps).toEqual([
      '1Create or import an email',
      '2Add modules',
      '3Edit content and design',
      '4Preview across devices and clients',
      '5Validate compatibility',
      '6Export and deploy',
    ]);
    expect(screen.queryByText(/\d\/6/)).not.toBeInTheDocument();
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });
});
