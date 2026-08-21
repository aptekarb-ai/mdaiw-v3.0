import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModuleLibraryModal } from './ModuleLibraryModal';
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

function renderModal(overrides: Partial<Parameters<typeof ModuleLibraryModal>[0]> = {}) {
  const onAddModule = vi.fn();
  const onAddSavedModule = vi.fn();
  const onDeleteSavedModule = vi.fn();
  const onClose = vi.fn();
  render(
    <ModuleLibraryModal
      savedModules={[]}
      onAddModule={onAddModule}
      onAddSavedModule={onAddSavedModule}
      onDeleteSavedModule={onDeleteSavedModule}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onAddModule, onAddSavedModule, onDeleteSavedModule, onClose };
}

describe('ModuleLibraryModal', () => {
  it('focuses the search input on open', () => {
    renderModal();
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('filters results as the user types', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('searchbox'), 'footer');

    expect(screen.queryByRole('button', { name: 'Add 1 Column' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Simple Legal Footer' })).toBeInTheDocument();
  });

  it('filters by category tab', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('tab', { name: 'Footer' }));

    expect(screen.queryByRole('button', { name: 'Add 1 Column' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Simple Legal Footer' })).toBeInTheDocument();
  });

  it('filters by column count', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('tab', { name: 'Layout' }));
    await user.selectOptions(screen.getByLabelText('Filter by column count'), '3');

    expect(screen.getByRole('button', { name: 'Add 3 Columns' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add 4 Columns' })).not.toBeInTheDocument();
  });

  it('shows a zero-results empty state and a working clear-filters action', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('searchbox'), 'this matches nothing at all');

    expect(screen.getByText('No modules match your search or filters.')).toBeInTheDocument();
    const clearButtons = screen.getAllByRole('button', { name: 'Clear filters' });
    await user.click(clearButtons[clearButtons.length - 1]);

    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add 1 Column' })).toBeInTheDocument();
  });

  it('clicking a module card adds it and closes the modal', async () => {
    const user = userEvent.setup();
    const { onAddModule, onClose } = renderModal();
    await user.type(screen.getByRole('searchbox'), 'divider');

    await user.click(screen.getByRole('button', { name: 'Add Divider' }));

    expect(onAddModule).toHaveBeenCalledWith('divider');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows saved modules under the Saved Modules tab and can delete one', async () => {
    const user = userEvent.setup();
    const { onDeleteSavedModule } = renderModal({ savedModules: [savedModule()] });
    await user.click(screen.getByRole('tab', { name: 'Saved Modules' }));

    const card = screen.getByRole('button', { name: 'Add saved module My Header' });
    expect(card).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete saved module My Header' }));
    expect(onDeleteSavedModule).toHaveBeenCalledWith(1);
  });

  it('Escape closes the modal', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('returns focus to the previously focused element on close (unmount)', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Browse all modules';
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { unmount } = render(
      <ModuleLibraryModal
        savedModules={[]}
        onAddModule={vi.fn()}
        onAddSavedModule={vi.fn()}
        onDeleteSavedModule={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(opener).not.toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('Tab wraps focus from the last to the first focusable element', async () => {
    const user = userEvent.setup();
    renderModal();
    const dialog = screen.getByRole('dialog');
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])'),
    );
    expect(focusable.length).toBeGreaterThan(1);

    // Move focus to the last focusable element, then Tab once more.
    focusable[focusable.length - 1].focus();
    await user.tab();

    expect(document.activeElement).toBe(focusable[0]);
  });
});
