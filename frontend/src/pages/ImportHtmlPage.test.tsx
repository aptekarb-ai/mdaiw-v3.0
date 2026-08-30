import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportHtmlPage } from './ImportHtmlPage';
import * as client from '../api/client';
import type { EmailDocument } from '../emailbuilder/types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    createEmailDocument: vi.fn(),
    updateEmailDocument: vi.fn(),
    deleteEmailDocument: vi.fn(),
  };
});

afterEach(() => {
  vi.resetAllMocks();
});

function BuilderProbe() {
  const { id } = useParams<{ id: string }>();
  return <div>Builder for {id}</div>;
}

function doc(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 42, name: 'Imported', platform: 'generic', width: 700, start_type: 'html', status: 'draft',
    content: { version: 1, modules: [] }, email_title: '', email_subject: '', favicon_url: '',
    reset_css_enabled: true, custom_css_enabled: false, custom_css: '', outlook_vml_enabled: false,
    created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/email-builder/import']}>
      <Routes>
        <Route path="/email-builder/import" element={<ImportHtmlPage />} />
        <Route path="/email-builder" element={<div>Email Dashboard</div>} />
        <Route path="/email-builder/builder/:id" element={<BuilderProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function pasteAndReview(user: ReturnType<typeof userEvent.setup>, html: string) {
  const textarea = screen.getByLabelText('Or paste HTML');
  fireEvent.change(textarea, { target: { value: html } });
  await user.click(screen.getByRole('button', { name: 'Review Import →' }));
}

describe('ImportHtmlPage', () => {
  it('parses pasted HTML and shows the Import Review with module count and no findings for clean input', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    expect(await screen.findByText(/1 module imported/)).toBeInTheDocument();
    expect(screen.getByText('No issues found — everything imported cleanly.')).toBeInTheDocument();
  });

  it('shows a finding for content that could not be imported (e.g. a script tag)', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><script>alert(1)</script><p>Safe</p></td></tr></table>');
    expect(await screen.findByText(/finding/)).toBeInTheDocument();
    expect(screen.getAllByText(/Removed for security/).length).toBeGreaterThan(0);
  });

  it('a parse-blocking error (oversized input represented via a huge paste) is shown without creating anything', async () => {
    const user = userEvent.setup();
    renderPage();
    const huge = `<p>${'x'.repeat(2 * 1024 * 1024 + 10)}</p>`;
    const textarea = screen.getByLabelText('Or paste HTML');
    fireEvent.change(textarea, { target: { value: huge } });
    // maxLength on the textarea itself would also cap this in a real
    // browser; fireEvent.change bypasses that, so this still exercises
    // the parser's own guard directly.
    await user.click(screen.getByRole('button', { name: 'Review Import →' }));
    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('prefills the name field from an imported <title>', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<html><head><title>My Imported Email</title></head><body><table><tr><td><p>Hi</p></td></tr></table></body></html>');
    expect(await screen.findByLabelText(/Email Name/)).toHaveValue('My Imported Email');
  });

  it('creates the document via create+PATCH and navigates to the builder on success', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 77 }));
    vi.mocked(client.updateEmailDocument).mockResolvedValue(doc({ id: 77 }));
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    const nameInput = await screen.findByLabelText(/Email Name/);
    fireEvent.change(nameInput, { target: { value: 'My New Email' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.createEmailDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My New Email', start_type: 'html' }),
    ));
    expect(client.updateEmailDocument).toHaveBeenCalledWith(77, expect.objectContaining({
      content: expect.objectContaining({ modules: expect.any(Array) }),
    }));
    expect(await screen.findByText('Builder for 77')).toBeInTheDocument();
  });

  it('duplicate-name failure surfaces as a field-level error, without navigating away', async () => {
    vi.mocked(client.createEmailDocument).mockRejectedValue({
      message: 'Please correct the highlighted fields.',
      errors: { name: ['An email with this name already exists. Choose a different name.'] },
    });
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    const nameInput = await screen.findByLabelText(/Email Name/);
    fireEvent.change(nameInput, { target: { value: 'Existing Name' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    expect(await screen.findByText('An email with this name already exists. Choose a different name.')).toBeInTheDocument();
    expect(screen.queryByText(/Builder for/)).not.toBeInTheDocument();
  });

  it('create/PATCH rollback: a content-patch failure deletes the just-created row, no orphan left behind', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 99 }));
    vi.mocked(client.updateEmailDocument).mockRejectedValue(new Error('patch failed'));
    vi.mocked(client.deleteEmailDocument).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    const nameInput = await screen.findByLabelText(/Email Name/);
    fireEvent.change(nameInput, { target: { value: 'My New Email' } });
    await user.click(screen.getByRole('button', { name: 'Create Email →' }));

    await waitFor(() => expect(client.deleteEmailDocument).toHaveBeenCalledWith(99));
    expect(screen.queryByText(/Builder for/)).not.toBeInTheDocument();
  });

  it('Start Over returns to the paste/upload step without creating anything', async () => {
    const user = userEvent.setup();
    renderPage();
    await pasteAndReview(user, '<table><tr><td><p>Hello</p></td></tr></table>');
    await screen.findByText(/module imported/);
    await user.click(screen.getByRole('button', { name: 'Start Over' }));
    expect(screen.getByRole('button', { name: 'Review Import →' })).toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('Back to Email Dashboard returns to the dashboard', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('link', { name: 'Back to Email Dashboard' }));
    expect(await screen.findByText('Email Dashboard')).toBeInTheDocument();
  });
});
