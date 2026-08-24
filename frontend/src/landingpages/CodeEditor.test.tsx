import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';

vi.mock('@monaco-editor/react', async () => {
  const { buildMonacoEditorReactMock } = await import('../testUtils/monacoEditorMock');
  return buildMonacoEditorReactMock();
});
vi.mock('./monacoSetup', () => ({ ensureMonacoConfigured: vi.fn() }));

describe('CodeEditor', () => {
  it('renders the current value and reports changes via onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CodeEditor language="html" value="<p>hi</p>" onChange={onChange} ariaLabel="HTML code" />);

    const textbox = await screen.findByLabelText('HTML code');
    expect(textbox).toHaveValue('<p>hi</p>');

    await user.type(textbox, '!');
    expect(onChange).toHaveBeenCalled();
  });

  it('exposes focusLine via ref that reveals, positions, and focuses the editor', async () => {
    const ref = createRef<CodeEditorHandle>();
    render(
      <CodeEditor ref={ref} language="html" value={'line1\nline2\nline3'} onChange={() => {}} ariaLabel="HTML code" />,
    );
    await screen.findByLabelText('HTML code');

    act(() => {
      ref.current?.focusLine(2, 1);
    });

    // Behaviour is verified through the mocked module's own recorded
    // editor instance — Monaco itself doesn't render meaningfully under
    // jsdom, so this is the actual editor CodeEditor mounted, not a
    // disconnected fresh mock.
    const monacoReactMock = (await import('@monaco-editor/react')) as unknown as {
      __testHooks: { editorInstances: { revealLineInCenter: ReturnType<typeof vi.fn>; setPosition: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }[] };
    };
    const editor = monacoReactMock.__testHooks.editorInstances.at(-1)!;
    expect(editor.revealLineInCenter).toHaveBeenCalledWith(2);
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 1 });
    expect(editor.focus).toHaveBeenCalled();
  });

  // Correction 1 (Feature 09, Module-4) — the shared wrapper's own new
  // capability: openFind() must call Monaco's real find action
  // (actions.find), never a second, hand-built search implementation.
  it('exposes openFind via ref that runs Monaco\'s built-in find action', async () => {
    const ref = createRef<CodeEditorHandle>();
    render(
      <CodeEditor ref={ref} language="html" value={'line1\nline2'} onChange={() => {}} ariaLabel="HTML code" />,
    );
    await screen.findByLabelText('HTML code');

    act(() => {
      ref.current?.openFind();
    });

    const monacoReactMock = (await import('@monaco-editor/react')) as unknown as {
      __testHooks: { getAction: ReturnType<typeof vi.fn>; findActionRun: ReturnType<typeof vi.fn> };
    };
    expect(monacoReactMock.__testHooks.getAction).toHaveBeenCalledWith('actions.find');
    expect(monacoReactMock.__testHooks.findActionRun).toHaveBeenCalledTimes(1);
  });

  it('clamps focusLine to the document range instead of throwing', async () => {
    const ref = createRef<CodeEditorHandle>();
    render(<CodeEditor ref={ref} language="css" value={'a\nb'} onChange={() => {}} ariaLabel="CSS code" />);
    await screen.findByLabelText('CSS code');

    expect(() => {
      act(() => {
        ref.current?.focusLine(999, 999);
      });
    }).not.toThrow();
  });

  it('disables the field when disabled is set', async () => {
    render(<CodeEditor language="html" value="" onChange={() => {}} ariaLabel="HTML code" disabled />);
    expect(await screen.findByLabelText('HTML code')).toHaveAttribute('readonly');
  });

  it('shows a safe error state when Monaco fails to load', async () => {
    const monacoMock = await import('@monaco-editor/react');
    vi.mocked(monacoMock.loader.init).mockRejectedValueOnce(new Error('network error'));

    render(<CodeEditor language="html" value="" onChange={() => {}} ariaLabel="HTML code" />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByLabelText('HTML code')).not.toBeInTheDocument();
  });
});
