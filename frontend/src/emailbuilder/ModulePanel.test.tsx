import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModulePanel } from './ModulePanel';
import { createResponsiveSettings } from './registryCore';
import type { SavedEmailModule } from './types';

function savedModule(overrides: Partial<SavedEmailModule> = {}): SavedEmailModule {
  return {
    id: 1,
    name: 'My Header',
    module_type: 'header-logo-center',
    props: { logoSrc: '', logoAlt: 'Logo', logoWidth: 160 },
    settings: createResponsiveSettings({ paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 }),
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof ModulePanel>[0]> = {}) {
  const onAddModule = vi.fn();
  const onAddSavedModule = vi.fn();
  const onDeleteSavedModule = vi.fn();
  const onToggleCollapsed = vi.fn();
  render(
    <ModulePanel
      onAddModule={onAddModule}
      savedModules={[]}
      onAddSavedModule={onAddSavedModule}
      onDeleteSavedModule={onDeleteSavedModule}
      collapsed={false}
      onToggleCollapsed={onToggleCollapsed}
      {...overrides}
    />,
  );
  return { onAddModule, onAddSavedModule, onDeleteSavedModule };
}

describe('ModulePanel — compact accordion browsing', () => {
  it('expands Layout by default and keeps other built-in categories collapsed', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /^Layout/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Header/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^Content/ })).toHaveAttribute('aria-expanded', 'false');
    // Layout's own cards are visible...
    expect(screen.getByRole('button', { name: 'Add 1 Column' })).toBeInTheDocument();
    // ...but a collapsed category's cards are not rendered at all (not
    // just visually hidden) — this is what keeps the DOM bounded no
    // matter how large the catalog gets.
    expect(screen.queryByRole('button', { name: 'Add Text' })).not.toBeInTheDocument();
  });

  it('opening a category collapses the previously open one (only one open at a time)', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /^Header/ }));
    expect(screen.getByRole('button', { name: /^Header/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Layout/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Add 1 Column' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Hero/ }));
    expect(screen.getByRole('button', { name: /^Hero/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Header/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('clicking the open category again collapses it (toggle, not radio-only)', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: /^Layout/ }));
    expect(screen.getByRole('button', { name: /^Layout/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('search replaces the accordion with a flat result list', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByRole('searchbox', { name: 'Search modules' }), 'image left');

    // No category accordion controls while searching.
    expect(screen.queryByRole('button', { name: /^Layout/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Image Left Hero' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Image Left + Content' })).toBeInTheDocument();
  });

  it('clearing the search restores the accordion at its previous category', async () => {
    const user = userEvent.setup();
    renderPanel();
    const search = screen.getByRole('searchbox', { name: 'Search modules' });

    await user.type(search, 'hero');
    expect(screen.queryByRole('button', { name: /^Layout/ })).not.toBeInTheDocument();

    await user.clear(search);
    expect(screen.getByRole('button', { name: /^Layout/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Add 1 Column' })).toBeInTheDocument();
  });

  it('caps compact search results and offers "View all N results"', async () => {
    const user = userEvent.setup();
    renderPanel();

    // A broad single-letter query matches far more than 16 definitions
    // (nearly every description contains "a").
    await user.type(screen.getByRole('searchbox', { name: 'Search modules' }), 'a');

    const cards = screen.getAllByRole('button', { name: /^Add / });
    expect(cards.length).toBeLessThanOrEqual(16);
    expect(screen.getByText(/View all \d+ results/)).toBeInTheDocument();
  });

  it('a narrow query under the cap shows no "View all" button', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole('searchbox', { name: 'Search modules' }), 'zzz-no-such-module');
    expect(screen.queryByText(/View all \d+ results/)).not.toBeInTheDocument();
  });

  it('Browse All Modules button is always available, independent of accordion/search state', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByRole('button', { name: 'Browse all modules' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Header/ }));
    expect(screen.getByRole('button', { name: 'Browse all modules' })).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search modules' }), 'hero');
    expect(screen.getByRole('button', { name: 'Browse all modules' })).toBeInTheDocument();
  });

  it('Saved Modules is reachable without opening any built-in category', () => {
    renderPanel({ savedModules: [savedModule()] });
    expect(screen.getByRole('button', { name: /^Saved Modules/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Add saved module My Header' })).toBeInTheDocument();
  });

  it('clicking a flat search result adds that module', async () => {
    const user = userEvent.setup();
    const { onAddModule } = renderPanel();
    await user.type(screen.getByRole('searchbox', { name: 'Search modules' }), 'divider');

    await user.click(screen.getByRole('button', { name: 'Add Divider' }));
    expect(onAddModule).toHaveBeenCalledWith('divider');
  });

  it('"View all N results" opens Browse All Modules with the current query pre-applied', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole('searchbox', { name: 'Search modules' }), 'a');

    await user.click(screen.getByText(/View all \d+ results/));

    const dialog = screen.getByRole('dialog', { name: 'Browse All Modules' });
    expect(within(dialog).getByRole('searchbox')).toHaveValue('a');
  });

  it('every built-in category header renders with the same structure (chevron + label + count)', () => {
    renderPanel();
    for (const name of ['Layout', 'Header', 'Hero', 'Content', 'Images', 'Products', 'CTA', 'Social', 'Footer']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect(button.querySelector('.mdaiw-icon')).toBeTruthy();
    }
  });
});
