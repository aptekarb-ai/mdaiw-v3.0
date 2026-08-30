import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSettingsDialog } from './DocumentSettingsDialog';
import * as client from '../api/client';
import type { EmailDocumentSettingsSnapshot } from './useEmailBuilderState';
import type { EmailAsset } from './types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listEmailAssets: vi.fn(),
  };
});

vi.mock('@monaco-editor/react', async () => {
  const { buildMonacoEditorReactMock } = await import('../testUtils/monacoEditorMock');
  return buildMonacoEditorReactMock();
});
vi.mock('../landingpages/monacoSetup', () => ({ ensureMonacoConfigured: vi.fn() }));

function settings(overrides: Partial<EmailDocumentSettingsSnapshot> = {}): EmailDocumentSettingsSnapshot {
  return {
    email_title: '',
    email_subject: '',
    favicon_url: '',
    reset_css_enabled: true,
    custom_css_enabled: false,
    custom_css: '',
    outlook_vml_enabled: false,
    ...overrides,
  };
}

function asset(overrides: Partial<EmailAsset> = {}): EmailAsset {
  return {
    id: 1,
    name: 'Company mark',
    category: 'icon',
    source_type: 'upload',
    url: 'http://localhost:8001/media/email_assets/mark.png',
    external_url: '',
    alt_text: 'Company mark',
    content_type: 'image/png',
    file_size: 4200,
    width: 64,
    height: 64,
    created_at: '2026-08-22T10:00:00Z',
    updated_at: '2026-08-22T10:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

// Sub-phase 2 closure, item 1 — Apply is now a SYNCHRONOUS local commit
// (builder.updateDocumentSettings), not an async network PATCH. There is
// no more saving/error state owned by this dialog — persistence happens
// later, at the toolbar's Save button, together with module content. See
// DocumentSettingsDialog.tsx's module docstring.
describe('DocumentSettingsDialog', () => {
  it('pre-fills the current title, subject, and favicon URL', () => {
    render(
      <DocumentSettingsDialog
        documentSettings={settings({ email_title: 'Hi there', email_subject: 'Big Sale', favicon_url: 'https://cdn.example.com/fav.png' })}
        documentName="August Newsletter"
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Hi there')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Big Sale')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://cdn.example.com/fav.png')).toBeInTheDocument();
  });

  // Visual QA — the six fields previously ran together as one flat list
  // with no hierarchy. Grouped into named sections so the dialog reads as
  // "Email Metadata" / "CSS & Rendering" / "Email Client Compatibility"
  // rather than an undifferentiated form.
  it('groups fields under Email Metadata, CSS & Rendering, and Email Client Compatibility headings', () => {
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Email Metadata', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CSS & Rendering', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Email Client Compatibility', level: 3 })).toBeInTheDocument();
  });

  it('Cancel calls onClose without calling onApply (item 1 — Cancel creates no history entry)', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Escape calls onClose without calling onApply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Apply with no changes closes without calling onApply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('editing the title and clicking Apply calls onApply synchronously with the trimmed values, then closes', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={onClose} />);

    await user.type(screen.getByLabelText('Email Title'), '  New Title  ');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith({
      email_title: 'New Title', email_subject: '', favicon_url: '',
      reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
      outlook_vml_enabled: false,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Module-4 E4 — Outlook Compatibility toggle.
  it('the Outlook Compatibility checkbox reflects the current document setting and toggling it calls onApply with the new value', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(
      <DocumentSettingsDialog
        documentSettings={settings({ outlook_vml_enabled: false })}
        documentName="August Newsletter"
        onApply={onApply}
        onClose={onClose}
      />,
    );
    const checkbox = screen.getByRole('checkbox', { name: /Outlook Compatibility/ });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ outlook_vml_enabled: true }));
  });

  it('the Outlook Compatibility checkbox starts checked when the document already has it enabled', () => {
    render(
      <DocumentSettingsDialog
        documentSettings={settings({ outlook_vml_enabled: true })}
        documentName="August Newsletter"
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /Outlook Compatibility/ })).toBeChecked();
  });

  it('an invalid favicon URL shows an inline error and blocks Apply (item 1 — failed validation creates no history entry)', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Favicon URL'), 'javascript:alert(1)');

    expect(await screen.findByText(/unsafe scheme/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('a favicon URL missing http(s):// shows an inline error and blocks Apply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Favicon URL'), 'ftp://example.com/fav.png');

    expect(await screen.findByText(/must start with http/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('Remove clears an existing favicon URL', async () => {
    const user = userEvent.setup();
    render(
      <DocumentSettingsDialog
        documentSettings={settings({ favicon_url: 'https://cdn.example.com/fav.png' })}
        documentName="August Newsletter"
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByLabelText('Favicon URL')).toHaveValue('');
  });

  it('Browse opens the Asset Manager and selecting an asset fills the favicon field', async () => {
    const user = userEvent.setup();
    vi.mocked(client.listEmailAssets).mockResolvedValue([asset()]);
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={vi.fn()} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Browse' }));
    await user.click(await screen.findByText('Company mark'));
    await user.click(screen.getByRole('button', { name: /Use this/i }));

    expect(screen.getByLabelText('Favicon URL')).toHaveValue('http://localhost:8001/media/email_assets/mark.png');
  });
});

describe('DocumentSettingsDialog — Reset CSS', () => {
  it('reflects the current document settings (enabled)', () => {
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Enable Email Reset CSS' })).toBeChecked();
  });

  it('disabling and clicking Apply calls onApply with reset_css_enabled: false', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: 'Enable Email Reset CSS' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ reset_css_enabled: false }));
  });

  it('Cancel discards an uncommitted toggle', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={onClose} />);

    await user.click(screen.getByRole('checkbox', { name: 'Enable Email Reset CSS' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DocumentSettingsDialog — Custom CSS', () => {
  it('the Monaco editor is hidden until Custom CSS is enabled', () => {
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Custom CSS')).not.toBeInTheDocument();
  });

  it('enabling reveals the editor pre-filled with the current Custom CSS', async () => {
    const user = userEvent.setup();
    render(
      <DocumentSettingsDialog
        documentSettings={settings({ custom_css_enabled: false, custom_css: '.brand { color: #002D38; }' })}
        documentName="August Newsletter"
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Enable Custom CSS' }));
    expect(screen.getByLabelText('Custom CSS')).toHaveValue('.brand { color: #002D38; }');
  });

  it('typing safe CSS and clicking Apply calls onApply synchronously, enabled', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: 'Enable Custom CSS' }));
    await user.type(screen.getByLabelText('Custom CSS'), '.brand{{color:red}');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      custom_css_enabled: true, custom_css: '.brand{color:red}',
    }));
  });

  it('unsafe CSS shows an inline error and blocks Apply (item 1 — failed validation creates no history entry)', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: 'Enable Custom CSS' }));
    await user.type(screen.getByLabelText('Custom CSS'), '</style><script>alert(1)</script>');

    expect(screen.getByText(/must not contain a "<\/style" tag/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('a structural-selector warning is shown but does NOT block Apply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<DocumentSettingsDialog documentSettings={settings()} documentName="August Newsletter" onApply={onApply} onClose={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: 'Enable Custom CSS' }));
    await user.type(screen.getByLabelText('Custom CSS'), 'table {{ display: none; }');

    expect(await screen.findByText(/sets "display" on every <table>/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ custom_css_enabled: true }));
  });

  it('disabling Custom CSS and applying keeps the CSS text but sends custom_css_enabled: false', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <DocumentSettingsDialog
        documentSettings={settings({ custom_css_enabled: true, custom_css: '.x{color:blue}' })}
        documentName="August Newsletter"
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Enable Custom CSS' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      custom_css_enabled: false, custom_css: '.x{color:blue}',
    }));
  });
});
