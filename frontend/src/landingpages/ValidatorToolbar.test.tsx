import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValidatorToolbar, type ValidatorToolbarProps } from './ValidatorToolbar';

function renderToolbar(overrides: Partial<ValidatorToolbarProps> = {}) {
  return render(
    <ValidatorToolbar
      onValidate={() => {}}
      validating={false}
      onCopy={() => {}}
      hasValidated={false}
      isStale={false}
      hasActionableIssues={false}
      {...overrides}
    />,
  );
}

describe('ValidatorToolbar', () => {
  it('calls onValidate when AI Validate Code is clicked', async () => {
    const user = userEvent.setup();
    const onValidate = vi.fn();
    renderToolbar({ onValidate });

    await user.click(screen.getByRole('button', { name: 'AI Validate Code' }));
    expect(onValidate).toHaveBeenCalled();
  });

  it('disables AI Validate Code and shows a busy label while validating', () => {
    renderToolbar({ validating: true });
    const button = screen.getByRole('button', { name: 'Validating…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('never uses the "AI - Validate Code" hyphenated form', () => {
    renderToolbar();
    expect(screen.queryByText('AI - Validate Code')).not.toBeInTheDocument();
  });

  it('calls onCopy when Copy is clicked', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    renderToolbar({ onCopy });

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalled();
  });

  it.each([
    'Save',
    'Download',
  ])('renders %s as disabled with an explanatory title and accessible label', (label) => {
    renderToolbar();
    const button = screen.getByRole('button', { name: `${label} — not available yet` });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title');
    expect(button.getAttribute('title')).toMatch(/later sprint/i);
  });

  it('explains that Complete LP validation is required for Save under a single-language scope', () => {
    renderToolbar({ scope: 'css' });
    const button = screen.getByRole('button', { name: 'Save — not available yet' });
    expect(button.getAttribute('title')).toBe('Complete LP validation is required to save a landing page.');
  });

  describe('Preview', () => {
    it('is disabled when the caller passes previewDisabled', () => {
      renderToolbar({ previewDisabled: true });
      expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    });

    it('is enabled when previewDisabled is false, regardless of scope', () => {
      renderToolbar({ scope: 'css', previewDisabled: false });
      expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
    });

    it('calls onPreview when clicked', async () => {
      const user = userEvent.setup();
      const onPreview = vi.fn();
      renderToolbar({ previewDisabled: false, onPreview });
      await user.click(screen.getByRole('button', { name: 'Preview' }));
      expect(onPreview).toHaveBeenCalled();
    });

    it('shows the caller-supplied disabled reason as its title', () => {
      renderToolbar({ previewDisabled: true, previewDisabledReason: 'Enter HTML content before previewing.' });
      expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute(
        'title', 'Enter HTML content before previewing.',
      );
    });

    it('shows a busy label while previewLoading is true', () => {
      renderToolbar({ previewDisabled: false, previewLoading: true });
      const button = screen.getByRole('button', { name: 'Preparing preview…' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('AI Fix Issues', () => {
    it('does not expose the old internal "Apply Safe Fixes" / "Review & Fix with AI" split', () => {
      renderToolbar();
      expect(screen.queryByText('Apply Safe Fixes')).not.toBeInTheDocument();
      expect(screen.queryByText('Review & Fix with AI')).not.toBeInTheDocument();
    });

    it('never uses the "AI - Fix Issues" hyphenated form', () => {
      renderToolbar();
      expect(screen.queryByText('AI - Fix Issues')).not.toBeInTheDocument();
    });

    it('is disabled before validation with "Validate the code first."', () => {
      renderToolbar({ hasValidated: false });
      const button = screen.getByRole('button', { name: 'AI Fix Issues' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Validate the code first.');
    });

    it('is disabled when stale with "Code changed. Validate again before fixing issues."', () => {
      renderToolbar({ hasValidated: true, isStale: true, hasActionableIssues: true });
      const button = screen.getByRole('button', { name: 'AI Fix Issues' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Code changed. Validate again before fixing issues.');
    });

    it('is disabled with zero actionable issues, "No actionable issues found."', () => {
      renderToolbar({ hasValidated: true, isStale: false, hasActionableIssues: false });
      const button = screen.getByRole('button', { name: 'AI Fix Issues' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'No actionable issues found.');
    });

    it('is enabled once validated, fresh, and actionable issues exist', async () => {
      const user = userEvent.setup();
      const onRunAIFixIssues = vi.fn();
      renderToolbar({ hasValidated: true, isStale: false, hasActionableIssues: true, onRunAIFixIssues });
      const button = screen.getByRole('button', { name: 'AI Fix Issues' });
      expect(button).toBeEnabled();
      await user.click(button);
      expect(onRunAIFixIssues).toHaveBeenCalled();
    });

    it('shows an in-flight label and disables the button while the autonomous repair runs — no review dialog first', () => {
      renderToolbar({ hasValidated: true, isStale: false, hasActionableIssues: true, fixIssuesRunning: true });
      const button = screen.getByRole('button', { name: 'AI Engineer is repairing your code…' });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
    });
  });
});
