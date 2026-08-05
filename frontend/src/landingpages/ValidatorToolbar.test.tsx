import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ValidatorToolbar } from './ValidatorToolbar';

describe('ValidatorToolbar', () => {
  it('calls onValidate when Validate Code is clicked', async () => {
    const user = userEvent.setup();
    const onValidate = vi.fn();
    render(<ValidatorToolbar onValidate={onValidate} validating={false} onCopy={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Validate Code' }));
    expect(onValidate).toHaveBeenCalled();
  });

  it('disables Validate Code and shows a busy label while validating', () => {
    render(<ValidatorToolbar onValidate={() => {}} validating onCopy={() => {}} />);
    const button = screen.getByRole('button', { name: 'Validating…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('calls onCopy when Copy is clicked', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(<ValidatorToolbar onValidate={() => {}} validating={false} onCopy={onCopy} />);

    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalled();
  });

  it.each([
    'Fix These Errors',
    'Ask AI to Review and Fix',
    'Preview',
    'Save',
    'Download',
  ])('renders %s as disabled with an explanatory title and accessible label', (label) => {
    render(<ValidatorToolbar onValidate={() => {}} validating={false} onCopy={() => {}} />);
    const button = screen.getByRole('button', { name: `${label} — not available yet` });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title');
    expect(button.getAttribute('title')).toMatch(/later sprint/i);
  });

  it.each(['Preview', 'Save'])(
    'explains that Complete LP validation is required for %s under a single-language scope',
    (label) => {
      render(<ValidatorToolbar onValidate={() => {}} validating={false} onCopy={() => {}} scope="css" />);
      const button = screen.getByRole('button', { name: `${label} — not available yet` });
      expect(button.getAttribute('title')).toBe('Complete LP validation is required to preview or save a landing page.');
    },
  );
});
