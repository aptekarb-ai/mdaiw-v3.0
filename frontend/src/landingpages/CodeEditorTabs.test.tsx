import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CodeEditorTabs, type CodeEditorTabsHandle } from './CodeEditorTabs';

vi.mock('@monaco-editor/react', async () => {
  const { buildMonacoEditorReactMock } = await import('../testUtils/monacoEditorMock');
  return buildMonacoEditorReactMock();
});
vi.mock('./monacoSetup', () => ({ ensureMonacoConfigured: vi.fn() }));

const EMPTY_VALUES = { html: '<p>html</p>', css: '.x{}', js: 'const x=1;', ampscript: '%%[ VAR @x ]%%' };

describe('CodeEditorTabs', () => {
  it('shows the HTML tab by default and retains separate content per tab', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CodeEditorTabs values={EMPTY_VALUES} onChange={onChange} onClear={() => {}} />);

    expect(await screen.findByLabelText('HTML code')).toHaveValue('<p>html</p>');

    await user.click(screen.getByRole('tab', { name: 'CSS' }));
    expect(screen.getByRole('tab', { name: 'CSS' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('CSS code')).toHaveValue('.x{}');

    await user.click(screen.getByRole('tab', { name: 'JavaScript' }));
    expect(screen.getByLabelText('JavaScript code')).toHaveValue('const x=1;');
  });

  it('supports arrow-key navigation between tabs', async () => {
    const user = userEvent.setup();
    render(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={() => {}} />);
    await screen.findByLabelText('HTML code');

    screen.getByRole('tab', { name: 'HTML' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'CSS' })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'CSS' }));
  });

  it('reports per-language changes via onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CodeEditorTabs values={EMPTY_VALUES} onChange={onChange} onClear={() => {}} />);

    await user.type(await screen.findByLabelText('HTML code'), '!');
    expect(onChange).toHaveBeenCalledWith('html', expect.stringContaining('<p>html</p>'));
  });

  it('focusLine switches to the target language tab and focuses the editor', async () => {
    const ref = createRef<CodeEditorTabsHandle>();
    render(<CodeEditorTabs ref={ref} values={{ ...EMPTY_VALUES, css: 'a\nb\nc' }} onChange={() => {}} onClear={() => {}} />);
    await screen.findByLabelText('HTML code');

    act(() => {
      ref.current?.focusLine('css', 2);
    });

    expect(screen.getByRole('tab', { name: 'CSS' })).toHaveAttribute('aria-selected', 'true');
  });

  it('getActiveLanguage reflects the current tab', async () => {
    const user = userEvent.setup();
    const ref = createRef<CodeEditorTabsHandle>();
    render(<CodeEditorTabs ref={ref} values={EMPTY_VALUES} onChange={() => {}} onClear={() => {}} />);
    await screen.findByLabelText('HTML code');

    expect(ref.current?.getActiveLanguage()).toBe('html');
    await user.click(screen.getByRole('tab', { name: 'CSS' }));
    expect(ref.current?.getActiveLanguage()).toBe('css');
  });

  describe('Clear Active Tab', () => {
    it('labels the Clear button for the active language and updates when the tab changes', async () => {
      const user = userEvent.setup();
      render(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={() => {}} />);
      await screen.findByLabelText('HTML code');

      expect(screen.getByRole('button', { name: 'Clear HTML' })).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'CSS' }));
      expect(screen.getByRole('button', { name: 'Clear CSS' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Clear HTML' })).not.toBeInTheDocument();
    });

    it('disables Clear when the active tab is empty', async () => {
      render(<CodeEditorTabs values={{ ...EMPTY_VALUES, html: '   ' }} onChange={() => {}} onClear={() => {}} />);
      await screen.findByLabelText('HTML code');
      expect(screen.getByRole('button', { name: 'Clear HTML' })).toBeDisabled();
    });

    it('shows a confirmation dialog before clearing', async () => {
      const user = userEvent.setup();
      const onClear = vi.fn();
      render(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={onClear} />);
      await screen.findByLabelText('HTML code');

      await user.click(screen.getByRole('button', { name: 'Clear HTML' }));
      expect(screen.getByText('Clear HTML code?')).toBeInTheDocument();
      expect(onClear).not.toHaveBeenCalled();
    });

    it('cancel preserves source and returns focus to the Clear button', async () => {
      const user = userEvent.setup();
      const onClear = vi.fn();
      render(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={onClear} />);
      await screen.findByLabelText('HTML code');

      const clearButton = screen.getByRole('button', { name: 'Clear HTML' });
      await user.click(clearButton);
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onClear).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(clearButton);
    });

    it('escape cancels the confirmation without clearing', async () => {
      const user = userEvent.setup();
      const onClear = vi.fn();
      render(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={onClear} />);
      await screen.findByLabelText('HTML code');

      await user.click(screen.getByRole('button', { name: 'Clear HTML' }));
      await user.keyboard('{Escape}');

      expect(onClear).not.toHaveBeenCalled();
      expect(screen.queryByText('Clear HTML code?')).not.toBeInTheDocument();
    });

    it('confirm clears only the active language and keeps it active', async () => {
      const user = userEvent.setup();
      const onClear = vi.fn();
      render(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={onClear} />);
      await screen.findByLabelText('HTML code');

      await user.click(screen.getByRole('tab', { name: 'CSS' }));
      await user.click(screen.getByRole('button', { name: 'Clear CSS' }));
      await user.click(screen.getByRole('button', { name: 'Clear Code' }));

      expect(onClear).toHaveBeenCalledWith('css');
      expect(onClear).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('tab', { name: 'CSS' })).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('scope-gated tab visibility', () => {
    it('shows all four tabs when scope is complete (default)', async () => {
      render(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={() => {}} scope="complete" />);
      await screen.findByLabelText('HTML code');

      expect(screen.getAllByRole('tab')).toHaveLength(4);
    });

    it('shows only the CSS tab when scope is css, and auto-activates it', async () => {
      render(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={() => {}} scope="css" />);

      const tabs = await screen.findAllByRole('tab');
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toHaveAccessibleName('CSS');
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByLabelText('CSS code')).toBeInTheDocument();
      expect(screen.queryByLabelText('HTML code')).not.toBeInTheDocument();
    });

    it('does not delete hidden-language source when scope narrows', async () => {
      const { rerender } = render(
        <CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={() => {}} scope="complete" />,
      );
      await screen.findByLabelText('HTML code');

      rerender(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={() => {}} scope="css" />);
      await screen.findByLabelText('CSS code');

      rerender(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={() => {}} scope="complete" />);
      expect(await screen.findByLabelText('HTML code')).toHaveValue('<p>html</p>');
    });

    it('widening back to complete keeps the previously active tab selected', async () => {
      const { rerender } = render(
        <CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={() => {}} scope="css" />,
      );
      await screen.findByLabelText('CSS code');

      rerender(<CodeEditorTabs values={EMPTY_VALUES} onChange={() => {}} onClear={() => {}} scope="complete" />);
      expect(await screen.findByRole('tab', { name: 'CSS' })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
