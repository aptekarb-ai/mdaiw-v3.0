import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams, useSearchParams } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { PreviewValidationEntryPage } from './PreviewValidationEntryPage';
import * as client from '../api/client';
import type { EmailDocument } from '../emailbuilder/types';

// A MemoryRouter's navigation never touches the real window.location, so
// the destination route's own params/search are read back here instead —
// the same "probe route" pattern used elsewhere in this suite for
// asserting where a navigate() call actually landed.
function BuilderProbe() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  return <div>Builder for {id}, tab={searchParams.get('tab') ?? 'none'}</div>;
}

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, listEmailDocuments: vi.fn() };
});

function doc(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 1, name: 'Summer Sale Campaign', platform: 'generic', width: 700,
    start_type: 'blank', status: 'draft', content: { version: 1, modules: [] },
    email_title: '', email_subject: '', favicon_url: '',
    reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
    created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/email-builder/validation']}>
      <Routes>
        <Route path="/email-builder/validation" element={<PreviewValidationEntryPage />} />
        <Route path="/email-builder/builder/:id" element={<BuilderProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PreviewValidationEntryPage', () => {
  it('shows the real email list, not a placeholder', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([doc()]);
    renderPage();
    expect(await screen.findByText('Summer Sale Campaign')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeInTheDocument();
  });

  it('Preview navigates to the builder with ?tab=preview', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([doc()]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(screen.getByText('Builder for 1, tab=preview')).toBeInTheDocument());
  });

  it('Validate navigates to the builder with ?tab=validate', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([doc()]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(screen.getByText('Builder for 1, tab=validate')).toBeInTheDocument());
  });

  it('shows an empty-state hint when there are no emails yet', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No emails yet')).toBeInTheDocument();
  });

  it('shows an error state with retry on load failure', async () => {
    vi.mocked(client.listEmailDocuments).mockRejectedValue({ message: 'Network error' });
    renderPage();
    expect(await screen.findByText("Couldn’t load your emails.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
