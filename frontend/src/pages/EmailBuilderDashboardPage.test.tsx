import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailBuilderDashboardPage } from './EmailBuilderDashboardPage';
import * as client from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, listEmailDocuments: vi.fn() };
});

function mockDocuments(documents: Awaited<ReturnType<typeof client.listEmailDocuments>>) {
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
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('EmailBuilderDashboardPage', () => {
  it('renders the dashboard title and supporting copy', async () => {
    mockDocuments([]);
    renderPage();
    expect(screen.getByRole('heading', { name: 'AI Email Builder', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Build compatible, responsive emails/)).toBeInTheDocument();
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });

  it('renders Create New Email as an enabled link to /email-builder/create', async () => {
    mockDocuments([]);
    renderPage();
    const createLink = screen.getByRole('link', { name: /Create New Email/ });
    expect(createLink).toHaveAttribute('href', '/email-builder/create');
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });

  it('navigates to the Create Email wizard when Create New Email is activated', async () => {
    mockDocuments([]);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: /Create New Email/ }));
    expect(await screen.findByText('Create Email page')).toBeInTheDocument();
  });

  it('keeps the not-yet-implemented entry actions disabled', async () => {
    mockDocuments([]);
    renderPage();
    expect(screen.getByRole('button', { name: /Choose Template/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Import HTML/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /AI Generate Email/ })).toBeDisabled();
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });

  it('shows a loading state while recent emails are being fetched', () => {
    vi.mocked(client.listEmailDocuments).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading recent emails…')).toBeInTheDocument();
  });

  it('shows the Recent Emails empty state when no emails exist', async () => {
    mockDocuments([]);
    renderPage();
    expect(screen.getByRole('heading', { name: 'Recent Emails' })).toBeInTheDocument();
    expect(await screen.findByText('You have not created any emails yet.')).toBeInTheDocument();
  });

  it('shows an error state when recent emails fail to load', async () => {
    mockDocumentsError();
    renderPage();
    expect(await screen.findByText(/We could not load your recent emails/)).toBeInTheDocument();
  });

  it('lists a created draft with its name, platform, width and status', async () => {
    mockDocuments([
      {
        id: 1,
        name: 'August Product Newsletter',
        platform: 'generic',
        width: 700,
        start_type: 'blank',
        status: 'draft',
        content: { version: 1, modules: [] },
        created_at: '2026-08-20T10:00:00Z',
        updated_at: '2026-08-20T10:00:00Z',
      },
    ]);
    renderPage();
    expect(await screen.findByText('August Product Newsletter')).toBeInTheDocument();
    expect(screen.getByText('generic')).toBeInTheDocument();
    expect(screen.getByText('700px')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
  });

  it('shows the six-step Getting Started workflow in order', async () => {
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
    await waitFor(() => expect(client.listEmailDocuments).toHaveBeenCalled());
  });
});
