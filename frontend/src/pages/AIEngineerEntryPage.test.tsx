import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams, useSearchParams } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AIEngineerEntryPage } from './AIEngineerEntryPage';
import * as client from '../api/client';
import type { EmailDocument } from '../emailbuilder/types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, listEmailDocuments: vi.fn() };
});

function BuilderProbe() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  return <div>Builder for {id}, tab={searchParams.get('tab') ?? 'none'}</div>;
}

function doc(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 7, name: 'Welcome Email Series', platform: 'generic', width: 700,
    start_type: 'blank', status: 'draft', content: { version: 1, modules: [] },
    email_title: '', email_subject: '', favicon_url: '',
    reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
    created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/email-builder/ai-engineer']}>
      <Routes>
        <Route path="/email-builder/ai-engineer" element={<AIEngineerEntryPage />} />
        <Route path="/email-builder/builder/:id" element={<BuilderProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AIEngineerEntryPage', () => {
  it('shows the real email list', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([doc()]);
    renderPage();
    expect(await screen.findByText('Welcome Email Series')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in AI Engineer' })).toBeInTheDocument();
  });

  it('navigates to the builder with ?tab=ai', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([doc()]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Open in AI Engineer' }));
    await waitFor(() => expect(screen.getByText('Builder for 7, tab=ai')).toBeInTheDocument());
  });

  it('shows an empty-state hint when there are no emails yet', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No emails yet')).toBeInTheDocument();
  });
});
