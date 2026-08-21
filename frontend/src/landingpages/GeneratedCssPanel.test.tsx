import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratedCssPanel } from './GeneratedCssPanel';

describe('GeneratedCssPanel', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  // jsdom 30 defines `navigator.clipboard` as a real accessor that plain
  // assignment can't override, and userEvent.setup() itself touches
  // navigator.clipboard during initialization — installing the mock must
  // happen AFTER setup(), not in beforeEach, or setup() clobbers it.
  function mockClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
  }

  const props = { css: '.a { color: red; }', stale: false, engine: 'dart-sass', engineVersion: 'sass@1.102.0' };

  it('shows the generated CSS as read-only text, never as an editable field', () => {
    render(<GeneratedCssPanel {...props} />);
    expect(screen.getByText('.a { color: red; }')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the compiler name, version and a size', () => {
    render(<GeneratedCssPanel {...props} />);
    expect(screen.getByText(/Dart Sass sass@1\.102\.0/)).toBeInTheDocument();
  });

  it('Copy Generated CSS copies only the generated output and confirms', async () => {
    const user = userEvent.setup();
    const writeText = mockClipboard();
    render(<GeneratedCssPanel {...props} />);
    await user.click(screen.getByRole('button', { name: 'Copy Generated CSS' }));
    expect(writeText).toHaveBeenCalledWith('.a { color: red; }');
    expect(await screen.findByText('Generated CSS copied.')).toBeInTheDocument();
  });

  it('shows a clipboard-failure message when copying fails', async () => {
    const user = userEvent.setup();
    const writeText = mockClipboard();
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<GeneratedCssPanel {...props} />);
    await user.click(screen.getByRole('button', { name: 'Copy Generated CSS' }));
    expect(await screen.findByText('Could not copy generated CSS.')).toBeInTheDocument();
  });

  it('disables Copy and Download while stale', () => {
    render(<GeneratedCssPanel {...props} stale />);
    expect(screen.getByRole('button', { name: 'Copy Generated CSS' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download Generated CSS' })).toBeDisabled();
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('Hide Generated CSS collapses the panel behind a Show button', async () => {
    const user = userEvent.setup();
    render(<GeneratedCssPanel {...props} />);
    await user.click(screen.getByRole('button', { name: 'Hide Generated CSS' }));
    expect(screen.queryByText('.a { color: red; }')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Generated CSS' })).toBeInTheDocument();
  });
});
