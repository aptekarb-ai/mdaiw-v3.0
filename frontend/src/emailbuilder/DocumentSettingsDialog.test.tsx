import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSettingsDialog } from './DocumentSettingsDialog';
import * as client from '../api/client';
import type { EmailAsset, EmailDocument } from './types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listEmailAssets: vi.fn(),
  };
});

function baseDocument(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 1,
    name: 'August Newsletter',
    platform: 'generic',
    width: 700,
    start_type: 'blank',
    status: 'draft',
    content: { version: 1, modules: [] },
    email_title: '',
    email_subject: '',
    favicon_url: '',
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function asset(overrides: Partial<EmailAsset> = {}): EmailAsset {
  return {
    id: 1,
    name: 'Company mark',
    category: 'icon',
    source_type: 'upload',
    url: 'http://localhost:8001/media/email_assets/mark.png',
    external_url: '',
    alt_text: 'Company mark',
    content_type: 'image/png',
    file_size: 4200,
    width: 64,
    height: 64,
    created_at: '2026-08-22T10:00:00Z',
    updated_at: '2026-08-22T10:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('DocumentSettingsDialog', () => {
  it('pre-fills the current title, subject, and favicon URL', () => {
    render(
      <DocumentSettingsDialog
        document={baseDocument({ email_title: 'Hi there', email_subject: 'Big Sale', favicon_url: 'https://cdn.example.com/fav.png' })}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Hi there')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Big Sale')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://cdn.example.com/fav.png')).toBeInTheDocument();
  });

  it('Cancel calls onClose without calling onApply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<DocumentSettingsDialog document={baseDocument()} onApply={onApply} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Escape calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DocumentSettingsDialog document={baseDocument()} onApply={vi.fn()} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Save with no changes closes without calling onApply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<DocumentSettingsDialog document={baseDocument()} onApply={onApply} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('editing the title and saving calls onApply with the trimmed values, then closes', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<DocumentSettingsDialog document={baseDocument()} onApply={onApply} onClose={onClose} />);

    await user.type(screen.getByLabelText('Email Title'), '  New Title  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith({
      email_title: 'New Title', email_subject: '', favicon_url: '',
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the server-provided error and keeps the dialog open when onApply rejects', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockRejectedValue({
      message: 'Validation failed', errors: { favicon_url: ['Favicon URL must start with http:// or https://.'] },
    });
    const onClose = vi.fn();
    render(<DocumentSettingsDialog document={baseDocument()} onApply={onApply} onClose={onClose} />);

    await user.type(screen.getByLabelText('Email Title'), 'Something');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Favicon URL must start with http:// or https://.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Remove clears an existing favicon URL', async () => {
    const user = userEvent.setup();
    render(
      <DocumentSettingsDialog
        document={baseDocument({ favicon_url: 'https://cdn.example.com/fav.png' })}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByLabelText('Favicon URL')).toHaveValue('');
  });

  it('Browse opens the Asset Manager and selecting an asset fills the favicon field', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listEmailAssets).mockResolvedValue([asset()]);
    render(<DocumentSettingsDialog document={baseDocument()} onApply={vi.fn()} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Browse' }));
    await user.click(await screen.findByText('Company mark'));
    await user.click(screen.getByRole('button', { name: /Use this/i }));

    expect(screen.getByLabelText('Favicon URL')).toHaveValue('http://localhost:8001/media/email_assets/mark.png');
  });
});
