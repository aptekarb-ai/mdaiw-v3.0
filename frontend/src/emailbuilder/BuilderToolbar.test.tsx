import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { BuilderToolbar } from './BuilderToolbar';

function renderToolbar(overrides: Partial<Parameters<typeof BuilderToolbar>[0]> = {}) {
  const onEditorModeChange = vi.fn();
  const onViewModeChange = vi.fn();
  const onOpenPlatformDialog = vi.fn();
  render(
    <MemoryRouter>
      <BuilderToolbar
        name="Test Email"
        platform="generic"
        width={700}
        dirty={false}
        saveStatus="idle"
        canUndo={false}
        canRedo={false}
        viewMode="desktop"
        editorMode="visual"
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onSave={vi.fn()}
        onViewModeChange={onViewModeChange}
        onEditorModeChange={onEditorModeChange}
        onOpenPlatformDialog={onOpenPlatformDialog}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return { onEditorModeChange, onViewModeChange, onOpenPlatformDialog };
}

describe('BuilderToolbar — Visual/Code toggle', () => {
  it('Visual is active by default', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Code' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking Code calls onEditorModeChange("code")', async () => {
    const user = userEvent.setup();
    const { onEditorModeChange } = renderToolbar();
    await user.click(screen.getByRole('button', { name: 'Code' }));
    expect(onEditorModeChange).toHaveBeenCalledWith('code');
  });

  it('reflects editorMode="code" as active', () => {
    renderToolbar({ editorMode: 'code' });
    expect(screen.getByRole('button', { name: 'Code' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Desktop/Mobile device buttons are disabled while in Code mode', () => {
    renderToolbar({ editorMode: 'code' });
    expect(screen.getByRole('button', { name: 'Desktop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeDisabled();
  });

  it('Desktop/Mobile device buttons are enabled in Visual mode', () => {
    renderToolbar({ editorMode: 'visual' });
    expect(screen.getByRole('button', { name: 'Desktop' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mobile' })).not.toBeDisabled();
  });
});

describe('BuilderToolbar — Platform Environment entry point (Feature 10)', () => {
  it('shows the current platform label as a clickable chip', () => {
    renderToolbar({ platform: 'sfmc' });
    expect(screen.getByRole('button', { name: /Salesforce Marketing Cloud/ })).toBeInTheDocument();
  });

  it('clicking the platform chip calls onOpenPlatformDialog', async () => {
    const user = userEvent.setup();
    const { onOpenPlatformDialog } = renderToolbar();
    await user.click(screen.getByRole('button', { name: /Generic/ }));
    expect(onOpenPlatformDialog).toHaveBeenCalledTimes(1);
  });
});
