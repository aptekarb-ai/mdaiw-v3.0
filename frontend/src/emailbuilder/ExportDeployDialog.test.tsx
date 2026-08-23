import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportDeployDialog } from './ExportDeployDialog';
import { createModule } from './moduleFactory';
import type { EmailDocument } from './types';
import type { EmailDocumentSettingsSnapshot } from './useEmailBuilderState';
import type { EmailDocumentContent, EmailModule } from './edm';

function documentSettingsOf(document: EmailDocument): EmailDocumentSettingsSnapshot {
  const {
    email_title, email_subject, favicon_url, reset_css_enabled, custom_css_enabled, custom_css,
  } = document;
  return { email_title, email_subject, favicon_url, reset_css_enabled, custom_css_enabled, custom_css };
}

function baseDocument(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 1,
    name: 'Summer Sale Campaign',
    platform: 'generic',
    width: 700,
    start_type: 'blank',
    status: 'draft',
    content: { version: 1, modules: [] },
    email_title: '',
    email_subject: '',
    favicon_url: '',
    reset_css_enabled: true,
    custom_css_enabled: false,
    custom_css: '',
    created_at: '2026-08-22T10:00:00Z',
    updated_at: '2026-08-22T10:00:00Z',
    ...overrides,
  };
}

function renderDialog(overrides: {
  document?: EmailDocument;
  documentSettings?: EmailDocumentSettingsSnapshot;
  content?: EmailDocumentContent;
  onSaveAsTemplate?: (name: string) => Promise<EmailDocument>;
} = {}) {
  const onSaveAsTemplate = overrides.onSaveAsTemplate ?? vi.fn().mockResolvedValue(baseDocument({ id: 2, start_type: 'template' }));
  const onClose = vi.fn();
  const document = overrides.document ?? baseDocument();
  const documentSettings = overrides.documentSettings ?? documentSettingsOf(document);
  const content = overrides.content ?? document.content;
  render(
    <ExportDeployDialog
      document={document} documentSettings={documentSettings} content={content}
      onSaveAsTemplate={onSaveAsTemplate} onClose={onClose}
    />,
  );
  return { onSaveAsTemplate, onClose };
}

describe('ExportDeployDialog', () => {
  it('shows every export-as platform option except "Other", with the document platform pre-selected', () => {
    renderDialog();
    expect(screen.getByRole('radio', { name: /Generic/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Salesforce Marketing Cloud/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Marketo/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /HubSpot/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Pardot/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^Other/ })).not.toBeInTheDocument();
  });

  it('shows a Passed summary and no blocking gate for a clean document', () => {
    renderDialog();
    expect(screen.getByText('Summer Sale Campaign')).toBeInTheDocument();
    expect(screen.getByText('700px')).toBeInTheDocument();
    expect(screen.getAllByText(/Passed/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export Email/ })).not.toBeDisabled();
  });

  it('blocks Export Email and shows the validation gate when the document has an error-severity issue', () => {
    const image = createModule('image', 0);
    const document = baseDocument({ content: { version: 1, modules: [image] } });
    renderDialog({ document });

    expect(screen.getByRole('alert')).toHaveTextContent(/validation error/);
    expect(screen.getByRole('button', { name: /Export Email/ })).toBeDisabled();
  });

  it('enables Export Email once the acknowledgement checkbox is checked', async () => {
    const user = userEvent.setup();
    const image = createModule('image', 0);
    const document = baseDocument({ content: { version: 1, modules: [image] } });
    renderDialog({ document });

    await user.click(screen.getByRole('checkbox', { name: /understand the risks/ }));
    expect(screen.getByRole('button', { name: /Export Email/ })).not.toBeDisabled();
  });

  it('acknowledgement persists across an export-platform switch when the same error-severity issues still apply (errors are platform-invariant — only warnings vary by platform)', async () => {
    const user = userEvent.setup();
    const image = createModule('image', 0);
    const document = baseDocument({ content: { version: 1, modules: [image] } });
    renderDialog({ document });

    await user.click(screen.getByRole('checkbox', { name: /understand the risks/ }));
    expect(screen.getByRole('button', { name: /Export Email/ })).not.toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Marketo/ }));
    expect(screen.getByRole('checkbox', { name: /understand the risks/ })).toBeChecked();
    expect(screen.getByRole('button', { name: /Export Email/ })).not.toBeDisabled();
  });

  it('re-validates against the newly selected export platform (platform token warning changes with platform)', async () => {
    const user = userEvent.setup();
    const text = createModule('text', 0) as unknown as EmailModule<{ text: string }>;
    const withToken = { ...text, props: { ...text.props, text: 'Hi %%FirstName%%' } };
    const document = baseDocument({ platform: 'generic', content: { version: 1, modules: [withToken as unknown as EmailModule] } });
    renderDialog({ document });

    const environmentRow = () => screen.getByText('Environment').closest('.export-deploy-dialog__summary-row')!;
    expect(environmentRow()).toHaveTextContent('Generic');
    await user.click(screen.getByRole('radio', { name: /Salesforce Marketing Cloud/ }));
    expect(environmentRow()).toHaveTextContent('Salesforce Marketing Cloud');
  });

  it('Copy HTML copies the rendered HTML to the clipboard and shows a confirmation', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderDialog();

    await user.click(screen.getByRole('button', { name: /Copy HTML/ }));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('<!doctype html>'));
  });

  it('Email Document Standards Sub-phase 2 — Export includes Reset CSS and Custom CSS when both are enabled', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderDialog({
      document: baseDocument({ reset_css_enabled: true, custom_css_enabled: true, custom_css: '.brand{color:#002D38}' }),
    });

    await user.click(screen.getByRole('button', { name: /Copy HTML/ }));
    await screen.findByText('Copied');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('EMAIL RESET CSS - START'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('CUSTOM CSS - START'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('.brand{color:#002D38}'));
  });

  it('Export omits both CSS blocks when Reset CSS and Custom CSS are disabled', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderDialog({
      document: baseDocument({ reset_css_enabled: false, custom_css_enabled: false, custom_css: '.brand{color:#002D38}' }),
    });

    await user.click(screen.getByRole('button', { name: /Copy HTML/ }));
    await screen.findByText('Copied');
    const [[copiedHtml]] = writeText.mock.calls;
    expect(copiedHtml).not.toContain('EMAIL RESET CSS');
    expect(copiedHtml).not.toContain('CUSTOM CSS');
  });

  it('Download HTML triggers a client-side download without throwing', async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Download HTML' }));
    expect(await screen.findByText('Downloaded')).toBeInTheDocument();
  });

  it('Save as Template calls onSaveAsTemplate with "<name> (Template)" and shows success', async () => {
    const user = userEvent.setup();
    const onSaveAsTemplate = vi.fn().mockResolvedValue(baseDocument({ id: 2, start_type: 'template' }));
    renderDialog({ onSaveAsTemplate });

    await user.click(screen.getByRole('button', { name: 'Save as Template' }));
    await waitFor(() => expect(onSaveAsTemplate).toHaveBeenCalledWith('Summer Sale Campaign (Template)'));
    expect(await screen.findByText('Saved as Template')).toBeInTheDocument();
  });

  it('shows an inline error when Save as Template fails', async () => {
    const user = userEvent.setup();
    const onSaveAsTemplate = vi.fn().mockRejectedValue(new Error('network'));
    renderDialog({ onSaveAsTemplate });

    await user.click(screen.getByRole('button', { name: 'Save as Template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not save this as a template');
  });

  it('Export Email is disabled after a successful export (single-shot, no duplicate downloads)', async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    renderDialog();

    const exportButton = screen.getByRole('button', { name: /Export Email/ });
    await user.click(exportButton);
    expect(await screen.findByRole('button', { name: 'Exported' })).toBeDisabled();
  });

  it('Cancel closes without calling onSaveAsTemplate', async () => {
    const user = userEvent.setup();
    const { onSaveAsTemplate, onClose } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSaveAsTemplate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes the dialog', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
