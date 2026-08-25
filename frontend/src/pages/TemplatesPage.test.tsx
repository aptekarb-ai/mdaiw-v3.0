import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemplatesPage } from './TemplatesPage';
import * as client from '../api/client';
import type { EmailDocument } from '../emailbuilder/types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listEmailDocuments: vi.fn(),
    createEmailDocument: vi.fn(),
    updateEmailDocument: vi.fn(),
    deleteEmailDocument: vi.fn(),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

function BuilderProbe() {
  const { id } = useParams<{ id: string }>();
  return <div>Builder for {id}</div>;
}

function doc(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 1,
    name: 'Untitled Email',
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
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/email-builder/templates']}>
      <Routes>
        <Route path="/email-builder/templates" element={<TemplatesPage />} />
        <Route path="/email-builder" element={<div>Email Dashboard</div>} />
        <Route path="/email-builder/builder/:id" element={<BuilderProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TemplatesPage', () => {
  it('loads directly at /email-builder/templates and shows only start_type=template documents', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([
      doc({ id: 1, name: 'Regular Email', start_type: 'blank' }),
      doc({ id: 2, name: 'Newsletter Template', start_type: 'template' }),
      doc({ id: 3, name: 'Promo Template', start_type: 'template' }),
    ]);
    renderPage();
    expect(await screen.findByText('Newsletter Template')).toBeInTheDocument();
    expect(screen.getByText('Promo Template')).toBeInTheDocument();
    expect(screen.queryByText('Regular Email')).not.toBeInTheDocument();
  });

  it('shows a proper empty state when the user has no saved templates, even if they have regular emails', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([
      doc({ id: 1, name: 'Regular Email', start_type: 'blank' }),
    ]);
    renderPage();
    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
    expect(screen.getByText(/Save an email as a template/)).toBeInTheDocument();
    expect(screen.queryByText('Regular Email')).not.toBeInTheDocument();
  });

  it('shows a loading state while templates are being fetched', () => {
    vi.mocked(client.listEmailDocuments).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.email-builder-dashboard__skeleton')).toBeInTheDocument();
  });

  it('shows an error state with retry when the list fetch fails', async () => {
    vi.mocked(client.listEmailDocuments).mockRejectedValue(new Error('network down'));
    renderPage();
    expect(await screen.findByText("Couldn’t load your emails.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('search narrows the shared list to matching templates only, reusing the existing filter engine', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([
      doc({ id: 2, name: 'Newsletter Template', start_type: 'template' }),
      doc({ id: 3, name: 'Promo Template', start_type: 'template' }),
    ]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Newsletter Template');
    await user.type(screen.getByRole('searchbox', { name: /Search emails/ }), 'Promo');
    expect(screen.getByText('Promo Template')).toBeInTheDocument();
    expect(screen.queryByText('Newsletter Template')).not.toBeInTheDocument();
  });

  it('"Use this template" opens the naming dialog, creates a new blank-type document via create+patch, and navigates to the builder', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([
      doc({
        id: 5, name: 'Newsletter Template', start_type: 'template', platform: 'sfmc', width: 650,
        email_title: 'Title', email_subject: 'Subject', custom_css_enabled: true, custom_css: '.x{}',
      }),
    ]);
    const created = doc({ id: 99, name: 'My New Email', start_type: 'blank' });
    vi.mocked(client.createEmailDocument).mockResolvedValue(created);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(created);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Use this template' }));
    const dialog = await screen.findByRole('dialog', { name: 'Name your new email' });
    expect(within(dialog).getByText('Newsletter Template')).toBeInTheDocument();

    const input = within(dialog).getByLabelText('Email name');
    expect(input).toHaveValue('Copy of Newsletter Template');
    fireEvent.change(input, { target: { value: 'My New Email' } });
    await user.click(within(dialog).getByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.createEmailDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My New Email', platform: 'sfmc', width: 650, start_type: 'blank' }),
    ));
    expect(client.updateEmailDocument).toHaveBeenCalledWith(99, expect.objectContaining({
      email_title: 'Title', email_subject: 'Subject', custom_css_enabled: true, custom_css: '.x{}',
    }));
    expect(await screen.findByText('Builder for 99')).toBeInTheDocument();
  });

  it('surfaces a duplicate-name failure as a field-level error inside the dialog, without navigating away', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([
      doc({ id: 5, name: 'Newsletter Template', start_type: 'template' }),
    ]);
    vi.mocked(client.createEmailDocument).mockRejectedValue({
      message: 'Please correct the highlighted fields.',
      errors: { name: ['An email with this name already exists. Choose a different name.'] },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Use this template' }));
    await user.click(await screen.findByRole('button', { name: 'Create Email →' }));

    expect(await screen.findByText('An email with this name already exists. Choose a different name.'))
      .toBeInTheDocument();
    expect(screen.queryByText(/Builder for/)).not.toBeInTheDocument();
  });

  it('rolls back (deletes) the newly created document when the content/settings patch fails, leaving no orphan', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([
      doc({ id: 5, name: 'Newsletter Template', start_type: 'template' }),
    ]);
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 77, name: 'My New Email' }));
    vi.mocked(client.updateEmailDocument).mockRejectedValue(new Error('patch failed'));
    vi.mocked(client.deleteEmailDocument).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Use this template' }));
    await user.click(await screen.findByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.deleteEmailDocument).toHaveBeenCalledWith(77));
    expect(screen.queryByText(/Builder for/)).not.toBeInTheDocument();
  });

  it('the source template is never patched or deleted by the create-from-template flow', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([
      doc({ id: 5, name: 'Newsletter Template', start_type: 'template' }),
    ]);
    const created = doc({ id: 99, name: 'My New Email', start_type: 'blank' });
    vi.mocked(client.createEmailDocument).mockResolvedValue(created);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(created);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Use this template' }));
    await user.click(await screen.findByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.createEmailDocument).toHaveBeenCalled());
    expect(client.updateEmailDocument).not.toHaveBeenCalledWith(5, expect.anything());
    expect(client.deleteEmailDocument).not.toHaveBeenCalledWith(5);
  });

  it('Cancel closes the naming dialog without creating anything', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([
      doc({ id: 5, name: 'Newsletter Template', start_type: 'template' }),
    ]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Use this template' }));
    await screen.findByRole('dialog', { name: 'Name your new email' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('Back to Email Dashboard returns to the dashboard', async () => {
    vi.mocked(client.listEmailDocuments).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('link', { name: 'Back to Email Dashboard' }));
    expect(await screen.findByText('Email Dashboard')).toBeInTheDocument();
  });
});
