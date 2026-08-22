import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetManagerDialog } from './AssetManagerDialog';
import * as client from '../api/client';
import type { EmailAsset } from './types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listEmailAssets: vi.fn(),
    createEmailAssetUpload: vi.fn(),
    createEmailAssetExternal: vi.fn(),
    updateEmailAsset: vi.fn(),
    deleteEmailAsset: vi.fn(),
  };
});

function asset(overrides: Partial<EmailAsset> = {}): EmailAsset {
  return {
    id: 1,
    name: 'Hero banner',
    category: 'image',
    source_type: 'upload',
    url: 'http://localhost:8001/media/email_assets/hero.jpg',
    external_url: '',
    alt_text: 'Hero image',
    content_type: 'image/jpeg',
    file_size: 245000,
    width: 1200,
    height: 800,
    created_at: '2026-08-22T10:00:00Z',
    updated_at: '2026-08-22T10:00:00Z',
    ...overrides,
  };
}

function mockAssets(list: EmailAsset[]) {
  vi.mocked(client.listEmailAssets).mockResolvedValue(list);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AssetManagerDialog — browse', () => {
  it('lists the user\'s own assets and the built-in placeholders', async () => {
    mockAssets([asset()]);
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText('Hero banner')).toBeInTheDocument();
    expect(screen.getByText('Placeholder image')).toBeInTheDocument();
    expect(screen.getByText('Placeholder logo')).toBeInTheDocument();
    expect(screen.getByText('Placeholder icon')).toBeInTheDocument();
  });

  it('shows an error state when the list fails to load', async () => {
    vi.mocked(client.listEmailAssets).mockRejectedValue({ message: 'Network error' });
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/Couldn.t load your assets/)).toBeInTheDocument();
  });

  it('search filters the grid by name', async () => {
    mockAssets([asset({ id: 1, name: 'Summer sale hero' }), asset({ id: 2, name: 'Winter banner' })]);
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Summer sale hero');
    await user.type(screen.getByLabelText('Search assets'), 'summer');
    expect(screen.getByText('Summer sale hero')).toBeInTheDocument();
    expect(screen.queryByText('Winter banner')).not.toBeInTheDocument();
  });

  it('category chips filter the grid', async () => {
    mockAssets([asset({ id: 1, name: 'A logo', category: 'logo' }), asset({ id: 2, name: 'An image', category: 'image' })]);
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('A logo');
    await user.click(screen.getByRole('button', { name: 'Logos' }));
    expect(screen.getByText('A logo')).toBeInTheDocument();
    expect(screen.queryByText('An image')).not.toBeInTheDocument();
  });

  it('clicking a card shows the Selected Asset detail panel with dimensions and size', async () => {
    mockAssets([asset()]);
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Hero banner/ }));
    expect(screen.getByText(/1200 × 800/)).toBeInTheDocument();
    expect(screen.getByText(/239 KB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use this asset' })).toBeInTheDocument();
  });

  it('"Use this asset" calls onSelect with the url and alt text, and closes', async () => {
    mockAssets([asset()]);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={onSelect} onClose={onClose} />);

    await user.click(await screen.findByRole('button', { name: /Hero banner/ }));
    await user.click(screen.getByRole('button', { name: 'Use this asset' }));

    expect(onSelect).toHaveBeenCalledWith({ url: asset().url, alt_text: 'Hero image' });
    expect(onClose).toHaveBeenCalled();
  });

  it('double-clicking a card selects and uses it immediately', async () => {
    mockAssets([asset()]);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={onSelect} onClose={onClose} />);

    await user.dblClick(await screen.findByRole('button', { name: /Hero banner/ }));
    expect(onSelect).toHaveBeenCalledWith({ url: asset().url, alt_text: 'Hero image' });
    expect(onClose).toHaveBeenCalled();
  });

  it('a placeholder can be selected and used the same way as a real asset', async () => {
    mockAssets([]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={onSelect} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Placeholder image/ }));
    await user.click(screen.getByRole('button', { name: 'Use this asset' }));
    expect(onSelect).toHaveBeenCalledWith({
      url: '/assets/mdaiw/images/email-image-placeholder.svg',
      alt_text: 'Placeholder image',
    });
  });

  it('copies the asset URL to the clipboard', async () => {
    mockAssets([asset()]);
    const user = userEvent.setup();
    // userEvent.setup() installs its own navigator.clipboard stub (for
    // copy/paste simulation) — spy on the method it already provides
    // rather than replacing the object, so it isn't clobbered again on
    // the next interaction.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Hero banner/ }));
    await user.click(screen.getByRole('button', { name: 'Copy URL' }));
    expect(writeText).toHaveBeenCalledWith(asset().url);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('editing alt text saves on blur', async () => {
    mockAssets([asset()]);
    vi.mocked(client.updateEmailAsset).mockResolvedValue(asset({ alt_text: 'Updated alt text' }));
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Hero banner/ }));
    const altInput = screen.getByPlaceholderText('Alt text');
    await user.clear(altInput);
    await user.type(altInput, 'Updated alt text');
    await user.tab();

    await waitFor(() => expect(client.updateEmailAsset).toHaveBeenCalledWith(1, { alt_text: 'Updated alt text' }));
  });

  it('Replace is only offered for uploaded assets, not external ones', async () => {
    mockAssets([asset({ id: 2, source_type: 'external', external_url: 'https://cdn.example.com/logo.png', url: 'https://cdn.example.com/logo.png' })]);
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Hero banner/ }));
    expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument();
  });

  it('Delete requires confirmation and calls the real API', async () => {
    mockAssets([asset()]);
    vi.mocked(client.deleteEmailAsset).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Hero banner/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/"Hero banner" will be permanently deleted/)).toBeInTheDocument();
    const confirmDialog = screen.getByRole('alertdialog');
    await user.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(client.deleteEmailAsset).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByText('Hero banner')).not.toBeInTheDocument());
  });

  it('Delete with Cancel keeps the asset', async () => {
    mockAssets([asset()]);
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Hero banner/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(client.deleteEmailAsset).not.toHaveBeenCalled();
    expect(screen.getAllByText('Hero banner').length).toBeGreaterThan(0);
  });
});

describe('AssetManagerDialog — upload tab', () => {
  it('uploads a file and switches back to My Assets with it selected', async () => {
    mockAssets([]);
    const created = asset({ id: 9, name: 'New upload' });
    vi.mocked(client.createEmailAssetUpload).mockResolvedValue(created);
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Placeholder image');
    await user.click(screen.getByRole('tab', { name: 'Upload' }));

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInputEl = document.querySelector('.asset-manager-dialog__dropzone input[type="file"]') as HTMLInputElement;
    await user.upload(fileInputEl, file);
    await user.click(screen.getByRole('button', { name: 'Upload asset' }));

    await waitFor(() => expect(client.createEmailAssetUpload).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('New upload').length).toBeGreaterThan(0));
    expect(screen.getByRole('tab', { name: 'My Assets' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows an error and does not switch tabs when no file is chosen', async () => {
    mockAssets([]);
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Placeholder image');
    await user.click(screen.getByRole('tab', { name: 'Upload' }));
    await user.click(screen.getByRole('button', { name: 'Upload asset' }));

    expect(await screen.findByText('Choose a file to upload.')).toBeInTheDocument();
    expect(client.createEmailAssetUpload).not.toHaveBeenCalled();
  });
});

describe('AssetManagerDialog — external URL tab', () => {
  it('adds an external URL asset', async () => {
    mockAssets([]);
    const created = asset({ id: 10, name: 'CDN logo', source_type: 'external', url: 'https://cdn.example.com/logo.png' });
    vi.mocked(client.createEmailAssetExternal).mockResolvedValue(created);
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Placeholder image');
    await user.click(screen.getByRole('tab', { name: 'External URL' }));
    await user.type(screen.getByPlaceholderText('https://'), 'https://cdn.example.com/logo.png');
    await user.type(screen.getByPlaceholderText('Asset name'), 'CDN logo');
    await user.click(screen.getByRole('button', { name: 'Add external URL' }));

    await waitFor(() => expect(client.createEmailAssetExternal).toHaveBeenCalledWith({
      name: 'CDN logo', category: 'image', alt_text: '', external_url: 'https://cdn.example.com/logo.png',
    }));
    await waitFor(() => expect(screen.getAllByText('CDN logo').length).toBeGreaterThan(0));
  });

  it('requires a URL before submitting', async () => {
    mockAssets([]);
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Placeholder image');
    await user.click(screen.getByRole('tab', { name: 'External URL' }));
    await user.click(screen.getByRole('button', { name: 'Add external URL' }));

    expect(await screen.findByText('Enter an image URL.')).toBeInTheDocument();
    expect(client.createEmailAssetExternal).not.toHaveBeenCalled();
  });
});

describe('AssetManagerDialog — accessibility', () => {
  it('Escape closes the dialog', async () => {
    mockAssets([]);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={onClose} />);

    await screen.findByText('Placeholder image');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('the backdrop click closes the dialog', async () => {
    mockAssets([]);
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<AssetManagerDialog onSelect={vi.fn()} onClose={onClose} />);

    await screen.findByText('Placeholder image');
    const backdrop = container.querySelector('.asset-manager-dialog__backdrop') as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('focus starts inside the dialog and Tab wraps within it', async () => {
    mockAssets([]);
    render(<AssetManagerDialog onSelect={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Placeholder image');
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
