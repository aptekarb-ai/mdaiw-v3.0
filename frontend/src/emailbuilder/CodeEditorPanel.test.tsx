import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CodeEditorPanel } from './CodeEditorPanel';
import { createModule } from './moduleFactory';
import type { EmailDocumentContent, EmailModule, TextModuleProps } from './edm';

vi.mock('@monaco-editor/react', async () => {
  const { buildMonacoEditorReactMock } = await import('../testUtils/monacoEditorMock');
  return buildMonacoEditorReactMock();
});
vi.mock('../landingpages/monacoSetup', () => ({ ensureMonacoConfigured: vi.fn() }));

function textModuleWith(text: string): EmailModule<TextModuleProps> {
  const module = createModule('text', 0) as unknown as EmailModule<TextModuleProps>;
  return { ...module, props: { ...module.props, text } };
}

function content(overrides: Partial<EmailDocumentContent> = {}): EmailDocumentContent {
  return {
    version: 1,
    modules: [textModuleWith('Hello world')],
    ...overrides,
  };
}

function renderPanel(overrides: Partial<{ documentName: string; width: number; platform: 'generic' | 'sfmc' }> = {}) {
  return render(
    <CodeEditorPanel
      documentName={overrides.documentName ?? 'My Test Email'}
      width={overrides.width ?? 700}
      content={content()}
      platform={overrides.platform ?? 'generic'}
    />,
  );
}

describe('CodeEditorPanel', () => {
  it('shows the generated HTML in the read-only code editor', () => {
    renderPanel();
    const textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea).toHaveAttribute('readonly');
    expect(textarea.value).toContain('Hello world');
    expect(textarea.value).toContain('<table');
  });

  it('formats the HTML by default (multi-line, indented)', () => {
    renderPanel();
    const textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value.split('\n').length).toBeGreaterThan(1);
  });

  it('toggling Formatted/Raw switches to the unformatted renderer output (fewer lines, no added indentation)', async () => {
    const user = userEvent.setup();
    renderPanel();
    const textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    const formattedLineCount = textarea.value.split('\n').length;
    expect(textarea.value).toMatch(/\n {2,}\S/); // formatted output has indented lines

    await user.click(screen.getByRole('button', { name: 'Formatted' }));
    expect(screen.getByRole('button', { name: 'Raw' })).toBeInTheDocument();
    const rawLineCount = textarea.value.split('\n').length;
    expect(rawLineCount).toBeLessThan(formattedLineCount);
  });

  it('shows all four compatibility checks, passing for clean generated HTML', () => {
    renderPanel();
    expect(screen.getByText('HTML Valid')).toBeInTheDocument();
    expect(screen.getByText('Inline CSS')).toBeInTheDocument();
    expect(screen.getByText('No DIV Usage')).toBeInTheDocument();
    expect(screen.getByText('Outlook Safe')).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status.querySelectorAll('.code-editor-panel__check--fail')).toHaveLength(0);
  });

  it('the platform indicator shows Generic with no scripting note', () => {
    renderPanel({ platform: 'generic' });
    expect(screen.getByTitle('Platform scripting mode')).toHaveTextContent('Generic');
    expect(screen.queryByText(/scripting not yet implemented/)).not.toBeInTheDocument();
  });

  it('a non-generic platform shows a scripting-not-implemented note', () => {
    renderPanel({ platform: 'sfmc' });
    expect(screen.getByText(/scripting not yet implemented/)).toBeInTheDocument();
  });

  it('copies the raw HTML to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderPanel();
    await user.click(screen.getByRole('button', { name: /Copy HTML/ }));
    expect(writeText).toHaveBeenCalled();
    expect(writeText.mock.calls[0][0]).toContain('Hello world');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('the Rendered tab shows a sandboxed iframe with the generated HTML as srcDoc', async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Rendered' }));
    const iframe = container.querySelector('iframe.code-editor-panel__preview-frame') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.srcdoc).toContain('Hello world');
    expect(screen.queryByLabelText('Generated email HTML (read-only)')).not.toBeInTheDocument();
  });

  it('Format/Find are disabled while viewing the Rendered tab', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Rendered' }));
    expect(screen.getByRole('button', { name: 'Formatted' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Find/ })).toBeDisabled();
  });

  it('stays in sync when the content prop changes (live preview)', () => {
    const { rerender } = render(
      <CodeEditorPanel documentName="Doc" width={700} content={content()} platform="generic" />,
    );
    expect((screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement).value).toContain('Hello world');

    const updated = content({ modules: [textModuleWith('Updated text')] });
    rerender(<CodeEditorPanel documentName="Doc" width={700} content={updated} platform="generic" />);
    expect((screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement).value).toContain('Updated text');
  });
});
