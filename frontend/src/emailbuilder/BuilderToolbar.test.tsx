import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { BuilderToolbar } from './BuilderToolbar';

function renderToolbar(overrides: Partial<Parameters<typeof BuilderToolbar>[0]> = {}) {
  const onEditorModeChange = vi.fn();
  const onViewModeChange = vi.fn();
  const onOpenPlatformDialog = vi.fn();
  const onOpenExportDialog = vi.fn();
  const onOpenDocumentSettingsDialog = vi.fn();
  const onZoomIn = vi.fn();
  const onZoomOut = vi.fn();
  const onZoomReset = vi.fn();
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
        zoomLevel={100}
        zoomMin={50}
        zoomMax={150}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onSave={vi.fn()}
        onViewModeChange={onViewModeChange}
        onEditorModeChange={onEditorModeChange}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        onOpenPlatformDialog={onOpenPlatformDialog}
        onOpenExportDialog={onOpenExportDialog}
        onOpenDocumentSettingsDialog={onOpenDocumentSettingsDialog}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return {
    onEditorModeChange, onViewModeChange, onOpenPlatformDialog, onOpenExportDialog, onOpenDocumentSettingsDialog,
    onZoomIn, onZoomOut, onZoomReset,
  };
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

describe('BuilderToolbar — Document Settings entry point (Email Document Standards)', () => {
  it('clicking the Document Settings chip calls onOpenDocumentSettingsDialog', async () => {
    const user = userEvent.setup();
    const { onOpenDocumentSettingsDialog } = renderToolbar();
    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    expect(onOpenDocumentSettingsDialog).toHaveBeenCalledTimes(1);
  });
});

describe('BuilderToolbar — Preview Studio entry point (Feature 11)', () => {
  it('clicking Preview calls onEditorModeChange("preview")', async () => {
    const user = userEvent.setup();
    const { onEditorModeChange } = renderToolbar();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onEditorModeChange).toHaveBeenCalledWith('preview');
  });

  it('reflects editorMode="preview" as active', () => {
    renderToolbar({ editorMode: 'preview' });
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Desktop/Mobile device buttons are disabled in Preview mode, same as Code mode', () => {
    renderToolbar({ editorMode: 'preview' });
    expect(screen.getByRole('button', { name: 'Desktop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeDisabled();
  });
});

describe('BuilderToolbar — Validation Center entry point (Feature 12)', () => {
  it('clicking Validate calls onEditorModeChange("validate")', async () => {
    const user = userEvent.setup();
    const { onEditorModeChange } = renderToolbar();
    await user.click(screen.getByRole('button', { name: 'Validate' }));
    expect(onEditorModeChange).toHaveBeenCalledWith('validate');
  });

  it('reflects editorMode="validate" as active', () => {
    renderToolbar({ editorMode: 'validate' });
    expect(screen.getByRole('button', { name: 'Validate' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Desktop/Mobile device buttons are disabled in Validate mode', () => {
    renderToolbar({ editorMode: 'validate' });
    expect(screen.getByRole('button', { name: 'Desktop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeDisabled();
  });

  it('no disabled "Coming soon" Validate placeholder remains — the real toggle replaced it', () => {
    renderToolbar();
    expect(screen.queryByTitle('Coming soon')).not.toBeInTheDocument();
  });
});

describe('BuilderToolbar — AI Engineer entry point (Feature 14)', () => {
  it('clicking AI Engineer calls onEditorModeChange("ai")', async () => {
    const user = userEvent.setup();
    const { onEditorModeChange } = renderToolbar();
    await user.click(screen.getByRole('button', { name: 'AI Engineer' }));
    expect(onEditorModeChange).toHaveBeenCalledWith('ai');
  });

  it('reflects editorMode="ai" as active', () => {
    renderToolbar({ editorMode: 'ai' });
    expect(screen.getByRole('button', { name: 'AI Engineer' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Desktop/Mobile device buttons are disabled in AI Engineer mode', () => {
    renderToolbar({ editorMode: 'ai' });
    expect(screen.getByRole('button', { name: 'Desktop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeDisabled();
  });
});

// Module-4 Final Gap Closure, Correction 3 (Feature 03 zoom) — the zoom
// control group beside Desktop/Mobile: minus/percentage-reset/plus, same
// disabled-in-non-Visual-mode and disabled-at-bounds pattern as every
// other visual-canvas-only control in this toolbar.
describe('BuilderToolbar — Canvas zoom (Feature 03)', () => {
  it('shows the current zoom percentage', () => {
    renderToolbar({ zoomLevel: 75 });
    expect(screen.getByRole('button', { name: /Zoom level 75 percent/ })).toHaveTextContent('75%');
  });

  it('clicking Zoom in calls onZoomIn', async () => {
    const user = userEvent.setup();
    const { onZoomIn } = renderToolbar({ zoomLevel: 100 });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('clicking Zoom out calls onZoomOut', async () => {
    const user = userEvent.setup();
    const { onZoomOut } = renderToolbar({ zoomLevel: 100 });
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('clicking the percentage display calls onZoomReset', async () => {
    const user = userEvent.setup();
    const { onZoomReset } = renderToolbar({ zoomLevel: 150 });
    await user.click(screen.getByRole('button', { name: /Zoom level 150 percent/ }));
    expect(onZoomReset).toHaveBeenCalledTimes(1);
  });

  it('Zoom out is disabled at the minimum bound', () => {
    renderToolbar({ zoomLevel: 50, zoomMin: 50, zoomMax: 150 });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).not.toBeDisabled();
  });

  it('Zoom in is disabled at the maximum bound', () => {
    renderToolbar({ zoomLevel: 150, zoomMin: 50, zoomMax: 150 });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).not.toBeDisabled();
  });

  it('all zoom controls are disabled outside Visual mode', () => {
    renderToolbar({ editorMode: 'code', zoomLevel: 100 });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Zoom level 100 percent/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  });

  it('zoom controls are enabled in Visual mode at a mid-range level', () => {
    renderToolbar({ editorMode: 'visual', zoomLevel: 100 });
    expect(screen.getByRole('button', { name: 'Zoom out' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).not.toBeDisabled();
  });
});

describe('BuilderToolbar — Export / Deploy entry point (Feature 13)', () => {
  it('clicking Export calls onOpenExportDialog', async () => {
    const user = userEvent.setup();
    const { onOpenExportDialog } = renderToolbar();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(onOpenExportDialog).toHaveBeenCalledTimes(1);
  });

  it('Export is available regardless of editor mode (not gated like Desktop/Mobile)', () => {
    renderToolbar({ editorMode: 'validate' });
    expect(screen.getByRole('button', { name: 'Export' })).not.toBeDisabled();
  });
});
