import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AssetManagerPage } from './AssetManagerPage';
import * as client from '../api/client';
import type { EmailAsset } from '../emailbuilder/types';

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
    id: 3,
    name: 'Brand Logo',
    category: 'logo',
    source_type: 'upload',
    url: 'https://example.com/logo.png',
    alt_text: 'Brand logo',
    content_type: 'image/png',
    width: 200,
    height: 80,
    file_size: 2048,
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  } as EmailAsset;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/email-builder/assets']}>
      <Routes>
        <Route path="/email-builder/assets" element={<AssetManagerPage />} />
        <Route path="/email-builder" element={<div>Email Dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AssetManagerPage', () => {
  it('browses the existing global asset library with no email open', async () => {
    vi.mocked(client.listEmailAssets).mockResolvedValue([asset()]);
    renderPage();
    expect(await screen.findByText('Brand Logo')).toBeInTheDocument();
  });

  it('"Use this asset" copies the URL to the clipboard instead of pretending an insertion happened', async () => {
    vi.mocked(client.listEmailAssets).mockResolvedValue([asset()]);
    const user = userEvent.setup();
    // userEvent.setup() installs its own navigator.clipboard stub — spy on
    // it AFTER setup, not before (same pattern AssetManagerDialog.test.tsx
    // already uses for its own "Copy URL" test).
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Brand Logo/ }));
    await user.click(await screen.findByRole('button', { name: 'Use this asset' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.com/logo.png'));
    expect(await screen.findByText('Copied image URL to clipboard.')).toBeInTheDocument();
    // Does NOT silently navigate away claiming success against a
    // document that doesn't exist.
    expect(screen.queryByText('Email Dashboard')).not.toBeInTheDocument();
  });

  it('deleting an asset works without an open document', async () => {
    vi.mocked(client.listEmailAssets).mockResolvedValue([asset()]);
    vi.mocked(client.deleteEmailAsset).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Brand Logo/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const confirmDialog = await screen.findByRole('alertdialog');
    // ConfirmDialog auto-focuses this button the instant it opens (an
    // accessibility requirement); userEvent's realistic pointer-event
    // sequence intermittently misses an element that gains focus via a
    // React effect between renders, so a plain fireEvent.click is used
    // here instead — same outcome a real click produces.
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(client.deleteEmailAsset).toHaveBeenCalledWith(3));
  });

  it('Close (no selection made) returns to the Email Dashboard', async () => {
    vi.mocked(client.listEmailAssets).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Email Dashboard')).toBeInTheDocument();
  });
});
