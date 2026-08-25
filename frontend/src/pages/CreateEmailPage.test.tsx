import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateEmailPage } from './CreateEmailPage';
import * as client from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, createEmailDocument: vi.fn() };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/email-builder/create']}>
      <Routes>
        <Route path="/email-builder/create" element={<CreateEmailPage />} />
        <Route path="/email-builder" element={<div>Email Builder dashboard</div>} />
        <Route path="/email-builder/builder/:id" element={<div>Builder pending page</div>} />
        <Route path="/email-builder/templates" element={<div>Templates page</div>} />
        <Route path="/email-builder/import" element={<div>Import HTML page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Email Name/), 'August Product Newsletter');
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('CreateEmailPage', () => {
  it('renders the setup heading and copy', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Create New Email', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Configure your email environment, width, and starting point/)).toBeInTheDocument();
  });

  it('defaults to the Generic platform', () => {
    renderPage();
    expect(screen.getByRole('radio', { name: /Generic/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Salesforce Marketing Cloud/ })).not.toBeChecked();
  });

  it('defaults to 700px width, marked recommended', () => {
    renderPage();
    const widthRadios = screen.getAllByRole('radio', { name: /^700/ });
    expect(widthRadios[0]).toBeChecked();
    expect(screen.getAllByText('Recommended').length).toBeGreaterThan(0);
  });

  it('defaults to Blank Email as the start type', () => {
    renderPage();
    expect(screen.getByRole('radio', { name: /Blank Email/ })).toBeChecked();
  });

  it('allows selecting a different platform', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: /Marketo/ }));
    expect(screen.getByRole('radio', { name: /Marketo/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Generic/ })).not.toBeChecked();
  });

  it('is keyboard-accessible: Space checks a focused platform radio', async () => {
    const user = userEvent.setup();
    renderPage();
    const hubspotRadio = screen.getByRole('radio', { name: /HubSpot/ });
    hubspotRadio.focus();
    await user.keyboard(' ');
    expect(hubspotRadio).toBeChecked();
  });

  it('allows selecting a different width preset', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: /^600/ }));
    expect(screen.getByRole('radio', { name: /^600/ })).toBeChecked();
    expect(screen.getAllByRole('radio', { name: /^700/ })[0]).not.toBeChecked();
  });

  it('reveals a custom width input when Custom is selected', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByLabelText(/Custom width/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    expect(screen.getByLabelText(/Custom width/i)).toBeInTheDocument();
  });

  it('rejects an empty custom width on submit', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    await user.click(screen.getByRole('button', { name: /Create Email/ }));
    expect(await screen.findByText('Enter a custom width.')).toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('rejects a custom width outside the safe range', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    await user.type(screen.getByLabelText(/Custom width/i), '50');
    await user.click(screen.getByRole('button', { name: /Create Email/ }));
    expect(await screen.findByText(/Width must be between 320 and 1200 pixels/)).toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('accepts a valid custom width', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue({
      id: 42, name: 'August Product Newsletter', platform: 'generic', width: 900,
      start_type: 'blank', status: 'draft', content: { version: 1, modules: [] },
      email_title: '', email_subject: '', favicon_url: '',
      reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
      created_at: '', updated_at: '',
    });
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    await user.type(screen.getByLabelText(/Custom width/i), '900');
    await user.click(screen.getByRole('button', { name: /Create Email/ }));
    await waitFor(() =>
      expect(client.createEmailDocument).toHaveBeenCalledWith(
        expect.objectContaining({ width: 900 }),
      ),
    );
  });

  it('requires an email name before submitting', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /Create Email/ }));
    expect(await screen.findByText('Email name is required.')).toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('submits the setup and navigates to the pending builder route on success', async () => {
    vi.mocked(client.createEmailDocument).mockResolvedValue({
      id: 7, name: 'August Product Newsletter', platform: 'generic', width: 700,
      start_type: 'blank', status: 'draft', content: { version: 1, modules: [] },
      email_title: '', email_subject: '', favicon_url: '',
      reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
      created_at: '', updated_at: '',
    });
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Create Email/ }));

    await waitFor(() =>
      expect(client.createEmailDocument).toHaveBeenCalledWith({
        name: 'August Product Newsletter',
        platform: 'generic',
        width: 700,
        start_type: 'blank',
      }),
    );
    expect(await screen.findByText('Builder pending page')).toBeInTheDocument();
  });

  it('shows a form-level error and stays on the page when submission fails', async () => {
    vi.mocked(client.createEmailDocument).mockRejectedValue({
      message: 'This email name is already in use.',
    });
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: /Create Email/ }));

    expect(await screen.findByText('This email name is already in use.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create New Email' })).toBeInTheDocument();
  });

  it('navigates back to the dashboard on Cancel', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Email Builder dashboard')).toBeInTheDocument();
  });

  it('renders every radio input visually hidden (card/chip is the visible control)', () => {
    renderPage();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveClass('create-email-page__radio-input');
    }
  });

  it('does not let a click select a disabled Start From card', async () => {
    const user = userEvent.setup();
    renderPage();
    const aiRadio = screen.getByRole('radio', { name: /AI Generate/ });
    expect(aiRadio).toBeDisabled();
    await user.click(aiRadio);
    expect(aiRadio).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Blank Email/ })).toBeChecked();
  });

  // Phase C (Import HTML) — Existing HTML is no longer disabled; it hands
  // off to the shared Import HTML page, same shape as Template.
  it('selecting Existing HTML and submitting hands off to the shared Import HTML page, without creating a document', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: /^Existing HTML/ }));
    expect(screen.getByRole('radio', { name: /^Existing HTML/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Import HTML →' }));
    expect(await screen.findByText('Import HTML page')).toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('selecting Template and submitting hands off to the shared Templates picker, without creating a document', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: /^Template/ }));
    expect(screen.getByRole('radio', { name: /^Template/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Choose Template →' }));
    expect(await screen.findByText('Templates page')).toBeInTheDocument();
    expect(client.createEmailDocument).not.toHaveBeenCalled();
  });

  it('prevents duplicate submission while a create request is in flight', async () => {
    let resolveCreate: (value: Awaited<ReturnType<typeof client.createEmailDocument>>) => void = () => {};
    vi.mocked(client.createEmailDocument).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillValidForm(user);

    const submitButton = screen.getByRole('button', { name: /Create/ });
    await user.click(submitButton);
    expect(screen.getByText('Creating…')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    await user.click(submitButton);
    expect(client.createEmailDocument).toHaveBeenCalledTimes(1);

    resolveCreate({
      id: 1, name: 'August Product Newsletter', platform: 'generic', width: 700,
      start_type: 'blank', status: 'draft', content: { version: 1, modules: [] },
      email_title: '', email_subject: '', favicon_url: '',
      reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
      created_at: '', updated_at: '',
    });
    expect(await screen.findByText('Builder pending page')).toBeInTheDocument();
  });
});
