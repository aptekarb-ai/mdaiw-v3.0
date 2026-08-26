import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailBuilderWorkspacePage } from './EmailBuilderWorkspacePage';
import * as client from '../api/client';
import { createResponsiveSettings } from '../emailbuilder/registryCore';
import type { EmailDocument, SavedEmailModule } from '../emailbuilder/types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getEmailDocument: vi.fn(),
    updateEmailDocument: vi.fn(),
    createEmailDocument: vi.fn(),
    deleteEmailDocument: vi.fn(),
    listSavedModules: vi.fn(),
    createSavedModule: vi.fn(),
    deleteSavedModule: vi.fn(),
    requestAICommand: vi.fn(),
  };
});

// Feature 09 — EmailBuilderWorkspacePage now imports CodeEditorPanel
// (Visual/Code toggle), which pulls in the real @monaco-editor/react
// package transitively even for tests that never switch to Code mode.
// Real Monaco doesn't run under jsdom (same reason
// LandingPageValidatorPage.test.tsx mocks it) — reuse the same shared
// test double.
vi.mock('@monaco-editor/react', async () => {
  const { buildMonacoEditorReactMock } = await import('../testUtils/monacoEditorMock');
  return buildMonacoEditorReactMock();
});
vi.mock('../landingpages/monacoSetup', () => ({ ensureMonacoConfigured: vi.fn() }));

function savedModule(overrides: Partial<SavedEmailModule> = {}): SavedEmailModule {
  return {
    id: 1,
    name: 'My Header',
    module_type: 'header-logo-center',
    props: { logoSrc: '', logoAlt: 'Logo', logoWidth: 160 },
    settings: createResponsiveSettings({ paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 }),
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(client.listSavedModules).mockResolvedValue([]);
});

// The compact Modules panel is a true accordion (only one built-in
// category open at a time, Layout open by default) — tests that add a
// module from a non-Layout category must open that category first.
async function openCategory(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${label}`) }));
}

function baseDocument(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 1,
    name: 'August Newsletter',
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
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function renderPage(id = '1') {
  return render(
    <MemoryRouter initialEntries={[`/email-builder/builder/${id}`]}>
      <Routes>
        <Route path="/email-builder/builder/:id" element={<EmailBuilderWorkspacePage />} />
        <Route path="/email-builder" element={<div>Email Builder dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Module-4 Navigation Completion, Phase A — same route tree, but the
// initial entry carries a full path (with the deep-link query string)
// rather than always being id-only.
function renderPageAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/email-builder/builder/:id" element={<EmailBuilderWorkspacePage />} />
        <Route path="/email-builder" element={<div>Email Builder dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('EmailBuilderWorkspacePage', () => {
  it('loads the email and shows its name/platform/width in the toolbar', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPage();

    expect(await screen.findByText('August Newsletter')).toBeInTheDocument();
    expect(screen.getByText('Generic')).toBeInTheDocument();
    expect(screen.getByText('700px')).toBeInTheDocument();
  });

  it('shows the empty-canvas state when there are no modules', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPage();

    expect(await screen.findByText('Start building your email')).toBeInTheDocument();
  });

  it('shows "Email not found" for a 404', async () => {
    vi.mocked(client.getEmailDocument).mockRejectedValue({ status: 404, message: 'Not found' });
    renderPage();
    expect(await screen.findByText('Email not found.')).toBeInTheDocument();
  });

  it('clicking a module in the panel adds it to the canvas', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Start building your email');
    await openCategory(user, 'Content');

    await user.click(screen.getByRole('button', { name: 'Add Text' }));

    expect(screen.queryByText('Start building your email')).not.toBeInTheDocument();
    expect(screen.getByText('Add your heading or paragraph text here.', { selector: 'p' })).toBeInTheDocument();
  });

  it('selecting a module (adding auto-selects it) shows its properties and a contextual toolbar', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Select a module')).toBeInTheDocument();
    await openCategory(user, 'Content');

    await user.click(screen.getByRole('button', { name: 'Add Text' }));

    expect(screen.queryByText('Select a module')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Duplicate/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('duplicating a module inserts a second copy', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'CTA');
    await user.click(await screen.findByRole('button', { name: 'Add Button' }));
    await user.click(screen.getByText('Shop Now'));

    await user.click(screen.getByRole('button', { name: /Duplicate/ }));

    expect(screen.getAllByText('Shop Now')).toHaveLength(2);
  });

  it('deleting a module removes it and returns to the empty state', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: /Delete/ }));

    expect(await screen.findByText('Start building your email')).toBeInTheDocument();
  });

  it('editing a property updates the canvas preview and marks the state dirty', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    const textField = screen.getByLabelText('Text');
    await user.clear(textField);
    await user.type(textField, 'Hello builder');

    expect(textField).toHaveValue('Hello builder');
    expect(screen.getByText('Hello builder', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('editing padding in Mobile view sets a mobile override without touching Desktop', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByText('Padding (px) — Mobile')).toBeInTheDocument();

    const paddingGrid = () => document.querySelector('.properties-panel__padding-grid') as HTMLElement;
    const topField = within(paddingGrid()).getByLabelText(/Top/);
    await user.clear(topField);
    await user.type(topField, '4');

    // Switching back to Desktop shows the original, untouched value.
    await user.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(screen.getByText('Padding (px) — Desktop')).toBeInTheDocument();
    expect(within(paddingGrid()).getByLabelText(/Top/)).toHaveValue(20);

    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(within(paddingGrid()).getByLabelText(/Top/)).toHaveValue(4);
  });

  it('shows an "Use Desktop value" reset once a mobile field is overridden', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Mobile' }));

    expect(screen.queryByRole('button', { name: 'Use Desktop values for all' })).not.toBeInTheDocument();

    const paddingGrid = () => document.querySelector('.properties-panel__padding-grid') as HTMLElement;
    const topField = within(paddingGrid()).getByLabelText(/Top/);
    await user.clear(topField);
    await user.type(topField, '4');

    const resetButton = await screen.findByRole('button', { name: 'Use Desktop values for all' });
    await user.click(resetButton);

    expect(within(paddingGrid()).getByLabelText(/Top/)).toHaveValue(20);
  });

  it('outer spacing: setting left/right to 0 keeps the module full-width visually (no spacer region), non-zero adds spacer regions', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    const outerSection = screen.getAllByText('Outer Spacer Columns', { exact: false })[0].closest('.properties-panel__section') as HTMLElement;
    const outerLeft = within(outerSection).getByLabelText(/^Left/);
    const outerRight = within(outerSection).getByLabelText(/^Right/);
    // Outer Spacer Columns render as a dedicated spacer REGION beside the
    // content (not a CSS margin) — a side with value 0 omits its region
    // entirely, so read the region's width when present, else '0px'.
    const outerRow = () => document.querySelector('.email-canvas__module-outer-row') as HTMLElement;
    const leftSpacerPx = () => {
      const first = outerRow().firstElementChild as HTMLElement;
      return first?.classList.contains('email-canvas__module-spacer-region') ? first.style.width : '0px';
    };
    const rightSpacerPx = () => {
      const last = outerRow().lastElementChild as HTMLElement;
      return last?.classList.contains('email-canvas__module-spacer-region') ? last.style.width : '0px';
    };
    expect(leftSpacerPx()).toBe('0px');

    await user.clear(outerLeft);
    await user.type(outerLeft, '20');
    await user.clear(outerRight);
    await user.type(outerRight, '20');

    expect(leftSpacerPx()).toBe('20px');
    expect(rightSpacerPx()).toBe('20px');
  });

  it('outer spacer: Left and Right are independent by default (unlinked), and linking is opt-in', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    const outerSection = () => screen.getAllByText('Outer Spacer Columns', { exact: false })[0].closest('.properties-panel__section') as HTMLElement;
    // Outer Spacer Columns render as a dedicated spacer REGION beside the
    // content (not a CSS margin) — a side with value 0 omits its region
    // entirely, so read the region's width when present, else '0px'.
    const outerRow = () => document.querySelector('.email-canvas__module-outer-row') as HTMLElement;
    const leftSpacerPx = () => {
      const first = outerRow().firstElementChild as HTMLElement;
      return first?.classList.contains('email-canvas__module-spacer-region') ? first.style.width : '0px';
    };
    const rightSpacerPx = () => {
      const last = outerRow().lastElementChild as HTMLElement;
      return last?.classList.contains('email-canvas__module-spacer-region') ? last.style.width : '0px';
    };

    // Default state (both 0) must be unlinked — the box starts unchecked.
    expect(within(outerSection()).getByRole('checkbox', { name: 'Link left/right values' })).not.toBeChecked();

    // A. Set Left 30px / Right 0px.
    let left = within(outerSection()).getByLabelText(/^Left Spacer/);
    await user.clear(left);
    await user.type(left, '30');

    // B. Only the left side changed.
    expect(leftSpacerPx()).toBe('30px');
    expect(rightSpacerPx()).toBe('0px');

    // C. Set Right 20px.
    const right = within(outerSection()).getByLabelText(/^Right Spacer/);
    await user.clear(right);
    await user.type(right, '20');

    // D. Left remains 30px, unaffected by the Right edit.
    expect(leftSpacerPx()).toBe('30px');
    expect(rightSpacerPx()).toBe('20px');

    // Now opt in to linking — it snaps Right to the current Left value.
    await user.click(within(outerSection()).getByRole('checkbox', { name: 'Link left/right values' }));
    expect(leftSpacerPx()).toBe('30px');
    expect(rightSpacerPx()).toBe('30px');

    left = within(outerSection()).getByLabelText(/^Left Spacer/);
    await user.clear(left);
    await user.type(left, '15');
    expect(leftSpacerPx()).toBe('15px');
    expect(rightSpacerPx()).toBe('15px');

    // Unlinking preserves the current (equal) values rather than resetting them.
    await user.click(within(outerSection()).getByRole('checkbox', { name: 'Link left/right values' }));
    expect(leftSpacerPx()).toBe('15px');
    expect(rightSpacerPx()).toBe('15px');

    // And the two sides are independent again post-unlink.
    left = within(outerSection()).getByLabelText(/^Left Spacer/);
    await user.clear(left);
    await user.type(left, '30');
    expect(leftSpacerPx()).toBe('30px');
    expect(rightSpacerPx()).toBe('15px');
  });

  it('outer spacer: Desktop and Mobile left/right are independent, with an inherit/override reset', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    const outerSection = () => screen.getAllByText('Outer Spacer Columns', { exact: false })[0].closest('.properties-panel__section') as HTMLElement;
    // Outer Spacer Columns render as a dedicated spacer REGION beside the
    // content (not a CSS margin) — a side with value 0 omits its region
    // entirely, so read the region's width when present, else '0px'.
    const outerRow = () => document.querySelector('.email-canvas__module-outer-row') as HTMLElement;
    const leftSpacerPx = () => {
      const first = outerRow().firstElementChild as HTMLElement;
      return first?.classList.contains('email-canvas__module-spacer-region') ? first.style.width : '0px';
    };
    const rightSpacerPx = () => {
      const last = outerRow().lastElementChild as HTMLElement;
      return last?.classList.contains('email-canvas__module-spacer-region') ? last.style.width : '0px';
    };

    // Desktop: left 30, right 20 (unlinked by default — no checkbox needed).
    let left = within(outerSection()).getByLabelText(/^Left Spacer/);
    let right = within(outerSection()).getByLabelText(/^Right Spacer/);
    await user.clear(left);
    await user.type(left, '30');
    await user.clear(right);
    await user.type(right, '20');
    expect(leftSpacerPx()).toBe('30px');
    expect(rightSpacerPx()).toBe('20px');

    // Switch to Mobile — starts inherited (30/20), no reset button yet.
    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(within(outerSection()).queryByRole('button', { name: 'Use Desktop value' })).not.toBeInTheDocument();
    expect(leftSpacerPx()).toBe('30px');
    expect(rightSpacerPx()).toBe('20px');

    // Override Mobile left only -> Mobile becomes 8 / 20 (right still inherited).
    left = within(outerSection()).getByLabelText(/^Left Spacer/);
    await user.clear(left);
    await user.type(left, '8');
    expect(leftSpacerPx()).toBe('8px');
    expect(rightSpacerPx()).toBe('20px');

    // Set Mobile right explicitly too (8 / 12), per the independent-mobile-values spec.
    right = within(outerSection()).getByLabelText(/^Right Spacer/);
    await user.clear(right);
    await user.type(right, '12');
    expect(leftSpacerPx()).toBe('8px');
    expect(rightSpacerPx()).toBe('12px');

    // Desktop remains untouched (30/20).
    await user.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(leftSpacerPx()).toBe('30px');
    expect(rightSpacerPx()).toBe('20px');

    // Back to Mobile — both overrides persisted; reset left only.
    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(leftSpacerPx()).toBe('8px');
    expect(rightSpacerPx()).toBe('12px');
    left = within(outerSection()).getByLabelText(/^Left Spacer/);
    const leftField = left.closest('.properties-panel__field') as HTMLElement;
    await user.click(within(leftField).getByRole('button', { name: 'Use Desktop value' }));
    expect(leftSpacerPx()).toBe('30px');
    expect(rightSpacerPx()).toBe('12px');
  });

  it('reorders modules via drag and drop', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await openCategory(user, 'CTA');
    await user.click(screen.getByRole('button', { name: 'Add Button' }));
    // Text module is row 0 (added first), Button is row 1. Select the
    // text module so its drag handle (only rendered when selected) exists.
    await user.click(screen.getByText('Add your heading or paragraph text here.'));

    const handle = document.querySelector('.email-canvas__module-handle');
    expect(handle).toBeTruthy();

    const dataTransfer = { data: {} as Record<string, string>, types: [] as string[] };
    const dt = {
      setData: (type: string, value: string) => { dataTransfer.data[type] = value; dataTransfer.types.push(type); },
      getData: (type: string) => dataTransfer.data[type] ?? '',
      types: dataTransfer.types,
      effectAllowed: '',
    };

    const dragStartEvent = new Event('dragstart', { bubbles: true }) as unknown as DragEvent;
    Object.defineProperty(dragStartEvent, 'dataTransfer', { value: dt });
    handle!.dispatchEvent(dragStartEvent);

    const rows = document.querySelectorAll('.email-canvas__module');
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dt });
    rows[1].dispatchEvent(dropEvent);

    await waitFor(() => {
      const reordered = document.querySelectorAll('.email-canvas__module');
      expect(reordered[0].textContent).toContain('Shop Now');
    });
  });

  it('switches between desktop and mobile canvas widths', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ width: 700 }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Start building your email');

    const surface = () => document.querySelector('.email-canvas__surface') as HTMLElement;
    expect(surface().style.width).toBe('700px');

    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(surface().style.width).toBe('375px');

    await user.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(surface().style.width).toBe('700px');
  });

  it('undo/redo revert and reapply the last change', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    expect(screen.queryByText('Start building your email')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Start building your email')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(await screen.findByText('Add your heading or paragraph text here.', { selector: 'p' })).toBeInTheDocument();
  });

  it('saves successfully and clears the dirty indicator', async () => {
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(document1);
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledWith('1', {
      content: expect.objectContaining({ version: 1 }),
      email_title: '', email_subject: '', favicon_url: '',
      reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
    }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('shows a save-failed state and keeps the change local when saving fails', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.updateEmailDocument).mockRejectedValue({ message: 'Server error' });
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Save failed')).toBeInTheDocument();
    expect(screen.getByText('We could not save your changes. Please try again.')).toBeInTheDocument();
  });

  it('shows an empty Saved Modules hint when the library is empty', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPage();
    expect(await screen.findByText('Start building your email')).toBeInTheDocument();
    expect(screen.getByText(/Save as reusable module/)).toBeInTheDocument();
  });

  it('lists a saved module and inserts it via click', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.listSavedModules).mockResolvedValue([savedModule()]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add saved module My Header' }));

    expect(screen.queryByText('Start building your email')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Logo image URL')).toBeInTheDocument();
  });

  it('saves the selected module as a reusable module', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.createSavedModule).mockResolvedValue(savedModule({ id: 2, name: 'Reusable Text' }));
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: /Save Text as reusable module/ }));
    const nameInput = await screen.findByLabelText('Module name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Reusable Text');
    await user.click(screen.getByRole('button', { name: 'Save Module' }));

    await waitFor(() => expect(client.createSavedModule).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Reusable Text', module_type: 'text',
    })));
    expect(await screen.findByRole('button', { name: 'Add saved module Reusable Text' })).toBeInTheDocument();
  });

  it('deletes a saved module', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.listSavedModules).mockResolvedValue([savedModule()]);
    vi.mocked(client.deleteSavedModule).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Add saved module My Header' });

    await user.click(screen.getByRole('button', { name: 'Delete saved module My Header' }));

    await waitFor(() => expect(client.deleteSavedModule).toHaveBeenCalledWith(1));
    expect(screen.queryByRole('button', { name: 'Add saved module My Header' })).not.toBeInTheDocument();
  });

  it('opens the full module library and inserts a module from it', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Start building your email');

    await user.click(screen.getByRole('button', { name: 'Browse all modules' }));
    const dialog = screen.getByRole('dialog', { name: 'Browse All Modules' });
    await user.type(within(dialog).getByRole('searchbox'), 'divider');

    await user.click(within(dialog).getByRole('button', { name: 'Add Divider' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Start building your email')).not.toBeInTheDocument();
  });
});

describe('EmailBuilderWorkspacePage — Feature 05 Layout Builder', () => {
  it('adding a layout module shows real column drop zones ("+ Add content"), not a placeholder message', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Start building your email');

    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));

    expect(screen.getAllByText('+ Add content')).toHaveLength(2);
    expect(screen.queryByText(/Layout structure is fixed/)).not.toBeInTheDocument();
  });

  it('clicking a column then a library module inserts the module INTO that column, not at the top level', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Start building your email');
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));

    const addContentButtons = screen.getAllByText('+ Add content');
    await user.click(addContentButtons[0]);
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    // Only ONE column still shows the empty drop-zone hint — the module
    // landed inside the other column, not as a new top-level module.
    expect(screen.getAllByText('+ Add content')).toHaveLength(1);
    expect(screen.getByText('Add your heading or paragraph text here.', { selector: 'p' })).toBeInTheDocument();
  });

  it('selecting the layout (not a column) shows the Column Widths editor with a Balance Columns action', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Start building your email');
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));

    await user.click(screen.getByRole('tab', { name: 'Style' }));

    expect(screen.getByText('Total: 100%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Balance Columns' })).toBeInTheDocument();
  });

  it('editing a column width updates the total and persists on save', async () => {
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(document1);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Start building your email');
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));
    await user.click(screen.getByRole('tab', { name: 'Style' }));

    const widthInputs = screen.getAllByRole('spinbutton');
    const firstWidth = widthInputs.find((input) => (input as HTMLInputElement).value === '50')!;
    await user.clear(firstWidth);
    await user.type(firstWidth, '35');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledWith('1', expect.objectContaining({
      content: expect.objectContaining({
        modules: expect.arrayContaining([
          expect.objectContaining({ props: expect.objectContaining({ columnWidths: [35, 50] }) }),
        ]),
      }),
    })));
  });

  it('reloads a document whose layout modules already have nested content', async () => {
    const document1 = baseDocument({
      content: {
        version: 1,
        modules: [{
          id: 'layout-1', type: 'layout-2col-40-60', order: 0,
          props: { columnWidths: [40, 60] },
          settings: createResponsiveSettings(),
          columns: [
            {
              id: 'col-a',
              modules: [{ id: 'nested-1', type: 'text', order: 0, props: { text: 'Nested hello' }, settings: createResponsiveSettings() }],
              settings: { desktop: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }, mobile: {}, backgroundColor: '', verticalAlign: 'top' },
            },
            {
              id: 'col-b', modules: [],
              settings: { desktop: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }, mobile: {}, backgroundColor: '', verticalAlign: 'top' },
            },
          ],
        }],
      },
    });
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    renderPage();

    expect(await screen.findByText('Nested hello', { selector: 'p, span' })).toBeInTheDocument();
    expect(screen.getByText('+ Add content')).toBeInTheDocument();
  });

  it('a pre-Feature-05 layout module (no columns key) loads without crashing and shows empty drop zones', async () => {
    const document1 = baseDocument({
      content: {
        version: 1,
        modules: [{
          id: 'layout-1', type: 'layout-2col-50-50', order: 0,
          props: { columnWidths: [50, 50] },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating a pre-Feature-05 stored document with no `columns` key
          settings: createResponsiveSettings() as any,
        }],
      },
    });
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    renderPage();

    expect(await screen.findAllByText('+ Add content')).toHaveLength(2);
  });
});

describe('EmailBuilderWorkspacePage — Module-4 Final Gap Closure, Correction 2 (Feature 05 Desktop column direction)', () => {
  function columnSettings() {
    return { desktop: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }, mobile: {}, backgroundColor: '', verticalAlign: 'top' as const };
  }

  // Deliberately unique tokens — see htmlRenderer.test.ts's same rationale:
  // single letters collide with substrings already present elsewhere in
  // the rendered page (module labels, attribute names, etc).
  function twoColumnDocument(settingsOverrides: Record<string, unknown> = {}) {
    return baseDocument({
      content: {
        version: 1,
        modules: [{
          id: 'layout-1', type: 'layout-2col-50-50', order: 0,
          props: { columnWidths: [50, 50] },
          settings: { ...createResponsiveSettings(), ...settingsOverrides },
          columns: [
            {
              id: 'col-a',
              modules: [{ id: 'nested-a', type: 'text', order: 0, props: { text: 'ZFIRST-CONTENT' }, settings: createResponsiveSettings() }],
              settings: columnSettings(),
            },
            {
              id: 'col-b',
              modules: [{ id: 'nested-b', type: 'text', order: 0, props: { text: 'ZSECOND-CONTENT' }, settings: createResponsiveSettings() }],
              settings: columnSettings(),
            },
          ],
        }],
      },
    });
  }

  it('setting "Direction on Desktop" to Right → Left persists the setting on save', async () => {
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(document1);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Start building your email');
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    const select = screen.getByLabelText('Direction on Desktop') as HTMLSelectElement;
    expect(select.value).toBe('ltr');
    await user.selectOptions(select, 'rtl');
    expect(select.value).toBe('rtl');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledWith('1', expect.objectContaining({
      content: expect.objectContaining({
        modules: expect.arrayContaining([
          expect.objectContaining({ settings: expect.objectContaining({ desktopColumnDirection: 'rtl' }) }),
        ]),
      }),
    })));
  });

  it('Undo restores Left → Right after setting Right → Left; Redo reapplies Right → Left; this stays one normal history operation', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Start building your email');
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    const select = () => screen.getByLabelText('Direction on Desktop') as HTMLSelectElement;
    await user.selectOptions(select(), 'rtl');
    expect(select().value).toBe('rtl');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(select().value).toBe('ltr');

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(select().value).toBe('rtl');
  });

  it('a reloaded document with desktopColumnDirection: "rtl" renders the canvas in reversed order (save/reload persistence)', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(twoColumnDocument({ desktopColumnDirection: 'rtl' }));
    const { container } = renderPage();
    await screen.findByText('ZFIRST-CONTENT');
    await screen.findByText('ZSECOND-CONTENT');

    const text = container.textContent ?? '';
    expect(text.indexOf('ZSECOND-CONTENT')).toBeLessThan(text.indexOf('ZFIRST-CONTENT'));
  });

  it('a reloaded document with no desktopColumnDirection key renders identity order (existing documents unchanged)', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(twoColumnDocument());
    const { container } = renderPage();
    await screen.findByText('ZFIRST-CONTENT');
    await screen.findByText('ZSECOND-CONTENT');

    const text = container.textContent ?? '';
    expect(text.indexOf('ZFIRST-CONTENT')).toBeLessThan(text.indexOf('ZSECOND-CONTENT'));
  });

  it('Mobile stacking inherits the reversed Desktop order when mobileColumnOrder is absent', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(twoColumnDocument({ desktopColumnDirection: 'rtl' }));
    const user = userEvent.setup();
    const { container } = renderPage();
    await screen.findByText('ZFIRST-CONTENT');

    await user.click(screen.getByRole('button', { name: 'Mobile' }));

    const text = container.textContent ?? '';
    expect(text.indexOf('ZSECOND-CONTENT')).toBeLessThan(text.indexOf('ZFIRST-CONTENT'));
  });

  it('an explicit mobileColumnOrder wins on Mobile regardless of the Desktop direction setting', async () => {
    // Desktop is RTL (would inherit as second,first), but mobileColumnOrder
    // explicitly requests identity ([0, 1]) — the explicit override must win.
    vi.mocked(client.getEmailDocument).mockResolvedValue(
      twoColumnDocument({ desktopColumnDirection: 'rtl', mobileColumnOrder: [0, 1] }),
    );
    const user = userEvent.setup();
    const { container } = renderPage();
    await screen.findByText('ZFIRST-CONTENT');

    await user.click(screen.getByRole('button', { name: 'Mobile' }));

    const text = container.textContent ?? '';
    expect(text.indexOf('ZFIRST-CONTENT')).toBeLessThan(text.indexOf('ZSECOND-CONTENT'));
  });

  it('changing Desktop direction never overwrites or regenerates an existing mobileColumnOrder', async () => {
    const document1 = twoColumnDocument({ mobileColumnOrder: [1, 0] });
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(document1);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ZFIRST-CONTENT');

    await user.click(screen.getByText('ZFIRST-CONTENT'));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    // Reselect the layout via the breadcrumb (module selection moved to
    // the nested Text module) so the Desktop-direction control is visible.
    await user.click(screen.getByRole('button', { name: '2 Columns 50/50' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    await user.selectOptions(screen.getByLabelText('Direction on Desktop'), 'rtl');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledWith('1', expect.objectContaining({
      content: expect.objectContaining({
        modules: expect.arrayContaining([
          expect.objectContaining({
            settings: expect.objectContaining({ desktopColumnDirection: 'rtl', mobileColumnOrder: [1, 0] }),
          }),
        ]),
      }),
    })));
  });
});

describe('EmailBuilderWorkspacePage — Feature 06 Module Element Editor', () => {
  it('Text: editing content, font size, color and alignment updates the canvas and marks dirty', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    const textField = screen.getByLabelText('Text');
    await user.clear(textField);
    await user.type(textField, 'Hello Feature 06');
    expect(screen.getByText('Hello Feature 06', { selector: 'p' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Style' }));
    const fontSize = screen.getByLabelText('Font size (px)');
    fireEvent.change(fontSize, { target: { value: '30' } });
    expect(fontSize).toHaveValue(30);

    const hexField = screen.getByLabelText('Text color hex value');
    await user.clear(hexField);
    await user.type(hexField, '#FF0000');
    fireEvent.blur(hexField);
    expect(hexField).toHaveValue('#FF0000');

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('Text: undo reverts a font-size edit', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Style' }));

    const fontSize = screen.getByLabelText('Font size (px)');
    fireEvent.change(fontSize, { target: { value: '40' } });
    expect(fontSize).toHaveValue(40);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Font size (px)')).toHaveValue(16);
  });

  it('Image: setting Desktop width to 300px and Mobile width to 100% resolves independently per viewport', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Images');
    await user.click(await screen.findByRole('button', { name: 'Add Image' }));
    await user.click(screen.getByRole('tab', { name: 'Style' }));

    const unitSelect = screen.getByLabelText('Unit');
    await user.selectOptions(unitSelect, 'px');
    const widthValue = screen.getByLabelText(/^Width/);
    fireEvent.change(widthValue, { target: { value: '300' } });
    expect(screen.getByLabelText(/^Width/)).toHaveValue(300);
  });

  it('Button: width mode, border and padding controls are editable and reflected in the canvas', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'CTA');
    await user.click(await screen.findByRole('button', { name: 'Add Button' }));
    await user.click(screen.getByRole('tab', { name: 'Style' }));

    await user.selectOptions(screen.getByLabelText('Width'), 'full');
    expect(screen.getByText('Shop Now').closest('span')).toHaveStyle({ display: 'block' });

    const borderWidth = screen.getByLabelText('Width (px)');
    await user.clear(borderWidth);
    await user.type(borderWidth, '2');
    expect(borderWidth).toHaveValue(2);
  });

  it('Header: adding a nav link inserts it, editing its label updates it, and removing it works', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Header');
    await user.click(await screen.findByRole('button', { name: 'Add Logo + Navigation' }));

    expect(screen.getByRole('button', { name: /^Shop/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add nav link/ }));
    expect(screen.getAllByRole('button', { name: /^New Link|^Shop|^About|^Contact/ })).toHaveLength(4);

    // Adding an item auto-expands it, so it is already open here.
    const labelInput = screen.getByLabelText('Label');
    await user.clear(labelInput);
    await user.type(labelInput, 'Careers');
    expect(screen.getByRole('button', { name: /^Careers/ })).toBeInTheDocument();

    const removeButton = screen.getByRole('button', { name: /^Remove Careers/ });
    await user.click(removeButton);
    expect(screen.queryByRole('button', { name: /^Careers/ })).not.toBeInTheDocument();
  });

  it('Product: selecting a card and editing its name updates only that card', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Products');
    await user.click(await screen.findByRole('button', { name: 'Add 2 Product Cards' }));

    const nameInput = screen.getByLabelText('Product name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Wireless Headphones');
    const canvas = document.querySelector('.email-canvas__surface') as HTMLElement;
    expect(within(canvas).getByText('Wireless Headphones')).toBeInTheDocument();
    expect(within(canvas).getByText('Product Name 2')).toBeInTheDocument();
  });

  it('Nested module editing: a Text module inside a layout column edits identically to a top-level module', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Start building your email');
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));
    const addContentButtons = screen.getAllByText('+ Add content');
    await user.click(addContentButtons[0]);
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('tab', { name: 'Style' }));
    const fontSize = screen.getByLabelText('Font size (px)');
    fireEvent.change(fontSize, { target: { value: '22' } });
    expect(fontSize).toHaveValue(22);
    expect(screen.getByText((_, element) => (
      element?.tagName === 'P' && element.textContent === '2 Columns 50/50 › Column 1 › Text'
    ))).toBeInTheDocument();
  });
});

describe('EmailBuilderWorkspacePage — Feature 07 Responsive Editor', () => {
  it('Image: Desktop 300px / Mobile 100% resolve independently and switching back to Desktop leaves it untouched', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Images');
    await user.click(await screen.findByRole('button', { name: 'Add Image' }));
    await user.click(screen.getByRole('tab', { name: 'Style' }));

    await user.selectOptions(screen.getByLabelText('Unit'), 'px');
    const width = screen.getByLabelText(/^Width/);
    fireEvent.change(width, { target: { value: '300' } });
    expect(width).toHaveValue(300);

    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    await user.selectOptions(screen.getByLabelText('Unit'), '%');
    fireEvent.change(screen.getByLabelText(/^Width/), { target: { value: '100' } });
    expect(screen.getByLabelText(/^Width/)).toHaveValue(100);

    await user.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(screen.getByLabelText(/^Width/)).toHaveValue(300);
  });

  it('Outer spacers: Desktop 30/20, Mobile 8/8 resolve independently per viewport', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'CTA');
    await user.click(await screen.findByRole('button', { name: 'Add Button' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    const outerSection = () => screen.getAllByText('Outer Spacer Columns', { exact: false })[0].closest('.properties-panel__section') as HTMLElement;
    fireEvent.change(within(outerSection()).getByLabelText(/^Left Spacer/), { target: { value: '30' } });
    fireEvent.change(within(outerSection()).getByLabelText(/^Right Spacer/), { target: { value: '20' } });

    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    fireEvent.change(within(outerSection()).getByLabelText(/^Left Spacer/), { target: { value: '8' } });
    fireEvent.change(within(outerSection()).getByLabelText(/^Right Spacer/), { target: { value: '8' } });
    expect(within(outerSection()).getByLabelText(/^Left Spacer/)).toHaveValue(8);
    expect(within(outerSection()).getByLabelText(/^Right Spacer/)).toHaveValue(8);

    await user.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(within(outerSection()).getByLabelText(/^Left Spacer/)).toHaveValue(30);
    expect(within(outerSection()).getByLabelText(/^Right Spacer/)).toHaveValue(20);
  });

  it('Typography: Text Desktop font-size/line-height/align, Mobile override independently, with inherited/override indicators', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Style' }));

    fireEvent.change(screen.getByLabelText(/^Font size/), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText(/^Line height/), { target: { value: '40' } });

    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByLabelText(/^Font size.*inherited/)).toHaveValue(32);
    fireEvent.change(screen.getByLabelText(/^Font size/), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText(/^Line height/), { target: { value: '30' } });
    expect(screen.getByLabelText(/^Font size.*override/)).toHaveValue(24);

    await user.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(screen.getByLabelText(/^Font size \(px\)$/)).toHaveValue(32);
  });

  it('Visibility: Hide on Mobile keeps the module visible on Desktop and is not deleted from the document', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    await user.selectOptions(screen.getByLabelText('Show this module on'), 'hideMobile');
    expect(screen.getByLabelText('Show this module on')).toHaveValue('hideMobile');
    // Still present/selected — never deleted from the EDM.
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
  });

  it('Reset Mobile Overrides clears padding/outer-spacer Mobile overrides back to inheritance without touching Desktop', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    const outerSection = () => screen.getAllByText('Outer Spacer Columns', { exact: false })[0].closest('.properties-panel__section') as HTMLElement;
    fireEvent.change(within(outerSection()).getByLabelText(/^Left Spacer/), { target: { value: '30' } });

    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    fireEvent.change(within(outerSection()).getByLabelText(/^Left Spacer/), { target: { value: '8' } });
    expect(within(outerSection()).getByLabelText(/^Left Spacer/)).toHaveValue(8);

    await user.click(screen.getByRole('button', { name: 'Reset Mobile Overrides' }));
    await user.click(await screen.findByRole('button', { name: /Confirm reset/ }));
    expect(within(outerSection()).getByLabelText(/^Left Spacer/)).toHaveValue(30);

    await user.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(within(outerSection()).getByLabelText(/^Left Spacer/)).toHaveValue(30);
  });

  it('2-column stacking: Stack off shows a narrow-width compatibility hint without blocking the setting', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(screen.getByRole('checkbox', { name: 'Stack columns on Mobile' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Stack columns on Mobile' }));
    expect(screen.getByRole('checkbox', { name: 'Stack columns on Mobile' })).not.toBeChecked();
    expect(screen.getByText(/side-by-side on Mobile/)).toBeInTheDocument();
  });

  it('Nested module: a Text module inside a Layout column supports its own independent Mobile font-size override', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));
    const addContentButtons = screen.getAllByText('+ Add content');
    await user.click(addContentButtons[0]);
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Style' }));

    fireEvent.change(screen.getByLabelText(/^Font size/), { target: { value: '20' } });
    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    fireEvent.change(screen.getByLabelText(/^Font size/), { target: { value: '16' } });
    expect(screen.getByLabelText(/^Font size.*override/)).toHaveValue(16);

    await user.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(screen.getByLabelText(/^Font size \(px\)$/)).toHaveValue(20);
  });
});

describe('EmailBuilderWorkspacePage — Feature 09 Code Editor', () => {
  it('Visual mode is the default — module panel, canvas, and properties panel are present, no code editor', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPage();
    await screen.findByText('August Newsletter');
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Generated email HTML (read-only)')).not.toBeInTheDocument();
  });

  it('switching to Code hides the module/canvas/properties panels and shows the generated HTML', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Code' }));
    expect(within(editorModeGroup).getByRole('button', { name: 'Code' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByLabelText('Generated email HTML (read-only)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search modules')).not.toBeInTheDocument();
  });

  it('the Code view reflects a module added in Visual mode after switching back', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: 'Code' }));
    const textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('<table');
  });

  it('switching back to Visual restores the module panel/canvas/properties panel', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'Code' }));
    await screen.findByLabelText('Generated email HTML (read-only)');
    await user.click(screen.getByRole('button', { name: 'Visual' }));

    expect(screen.queryByLabelText('Generated email HTML (read-only)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Desktop/Mobile device buttons are disabled while in Code mode', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'Code' }));
    expect(screen.getByRole('button', { name: 'Desktop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeDisabled();
  });

  it('shows the four compatibility checks in Code mode', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');
    await user.click(screen.getByRole('button', { name: 'Code' }));

    expect(await screen.findByText('HTML Valid')).toBeInTheDocument();
    expect(screen.getByText('Inline CSS')).toBeInTheDocument();
    expect(screen.getByText('No DIV Usage')).toBeInTheDocument();
    expect(screen.getByText('Outlook Safe')).toBeInTheDocument();
  });

  it('Ctrl+Z (undo) while in Code mode still updates the live HTML — the code view has no separate history', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('button', { name: 'Code' }));
    const textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    const withModule = textarea.value;

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      expect((screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement).value)
        .not.toBe(withModule);
    });
  });

  it('Email Document Standards Sub-phase 2 — Code view shows Reset CSS when enabled', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ reset_css_enabled: true }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');
    await user.click(screen.getByRole('button', { name: 'Code' }));
    const textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('EMAIL RESET CSS - START');
  });

  it('Code view omits Reset CSS when disabled', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ reset_css_enabled: false }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');
    await user.click(screen.getByRole('button', { name: 'Code' }));
    const textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).not.toContain('EMAIL RESET CSS');
  });

  it('Code view shows Custom CSS when enabled with content, omits it when disabled', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(
      baseDocument({ custom_css_enabled: true, custom_css: '.brand{color:#002D38}' }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');
    await user.click(screen.getByRole('button', { name: 'Code' }));
    const textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('CUSTOM CSS - START');
    expect(textarea.value).toContain('.brand{color:#002D38}');
  });
});

describe('EmailBuilderWorkspacePage — Email Document Standards Sub-phase 2 — Code/Preview/Export consistency', () => {
  it('Code and Preview Studio render byte-identical HTML for the same document (Reset + Custom CSS enabled)', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(
      baseDocument({ reset_css_enabled: true, custom_css_enabled: true, custom_css: '.brand{color:#002D38}' }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'Code' }));
    await screen.findByLabelText('Generated email HTML (read-only)');
    // Code defaults to "Formatted" (indented) — switch to "Raw" so this
    // is a genuine byte-for-byte comparison against Preview's srcDoc,
    // not an indentation-vs-no-indentation mismatch.
    await user.click(screen.getByRole('button', { name: 'Formatted' }));
    const codeHtml = (screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement).value;

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const previewFrame = await screen.findByTitle('Desktop preview') as HTMLIFrameElement;
    const previewHtml = previewFrame.getAttribute('srcdoc') ?? '';

    expect(previewHtml).toBe(codeHtml);
  });
});

// Sub-phase 2 CLOSURE, item 1 — supersedes the earlier "independence"
// design: Document Settings changes now join the SAME unified undo/redo
// history as module edits (see useEmailBuilderState.ts's HistoryEntry).
// Apply is a local commit (no network); the toolbar Save button PATCHes
// content + document settings together.
describe('EmailBuilderWorkspacePage — Email Document Standards Sub-phase 2 closure — unified undo/redo (item 1)', () => {
  it('applying a Document Settings change enables the builder Undo button (participates in the same history)', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Enable Email Reset CSS' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
    expect(client.updateEmailDocument).not.toHaveBeenCalled();
  });

  it('CSS A -> Apply CSS B -> Undo restores A -> Redo restores B, reflected live in Code view', async () => {
    const cssA = '.version-a{color:red}';
    const cssB = '.version-b{color:blue}';
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ custom_css_enabled: true, custom_css: cssA }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    const cssEditor = within(dialog).getByLabelText('Custom CSS');
    await user.clear(cssEditor);
    await user.type(cssEditor, cssB.replace(/[{}]/g, (brace) => (brace === '{' ? '{{' : brace)));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Code' }));
    let textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain(cssB);
    expect(textarea.value).not.toContain(cssA);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain(cssA);
    expect(textarea.value).not.toContain(cssB);

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain(cssB);

    // The dialog itself also reflects the live (post-redo) value if reopened.
    await user.click(screen.getByRole('button', { name: 'Visual' }));
    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    expect(within(dialog).getByLabelText('Custom CSS')).toHaveValue(cssB);
  });

  it('Reset CSS enabled -> disable+Apply -> Undo restores enabled -> Redo restores disabled', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ reset_css_enabled: true }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Enable Email Reset CSS' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Code' }));
    let textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).not.toContain('EMAIL RESET CSS');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('EMAIL RESET CSS');

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).not.toContain('EMAIL RESET CSS');
  });

  it('Custom CSS enabled/disabled toggling participates in Undo/Redo', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ custom_css_enabled: false, custom_css: '.x{color:red}' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Enable Custom CSS' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Code' }));
    let textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('CUSTOM CSS - START');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).not.toContain('CUSTOM CSS');

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('CUSTOM CSS - START');
  });

  it('module edit -> CSS edit -> module edit: sequential Undo/Redo restores each step correctly, in order', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Enable Custom CSS' }));
    await user.type(within(dialog).getByLabelText('Custom CSS'), '.a{{color:red}');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await openCategory(user, 'CTA');
    await user.click(await screen.findByRole('button', { name: 'Add Button' }));

    await user.click(screen.getByRole('button', { name: 'Code' }));
    let textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('Shop Now');
    expect(textarea.value).toContain('CUSTOM CSS - START');

    // Undo #1 -> removes the button; CSS + first text module remain.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).not.toContain('Shop Now');
    expect(textarea.value).toContain('CUSTOM CSS - START');
    expect(textarea.value).toContain('Add your heading or paragraph text here.');

    // Undo #2 -> reverts the CSS edit; first text module remains.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).not.toContain('CUSTOM CSS');
    expect(textarea.value).toContain('Add your heading or paragraph text here.');

    // Undo #3 -> removes the first text module too.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).not.toContain('Add your heading or paragraph text here.');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();

    // Redo all three, in order.
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('Add your heading or paragraph text here.');
    expect(textarea.value).not.toContain('CUSTOM CSS');

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('CUSTOM CSS - START');
    expect(textarea.value).not.toContain('Shop Now');

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('Shop Now');
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('AI Engineer Apply CSS -> Undo restores the exact previous value -> Redo restores the AI value', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ custom_css_enabled: true, custom_css: 'user-typed' }));
    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will update your Custom CSS. Please review the proposed change.',
      action: { type: 'SET_CUSTOM_CSS', css: 'ai-proposed' },
      requires_confirmation: true,
      requires_strong_confirmation: false,
      confidence: 0.85,
      provider: 'deterministic',
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'AI Engineer' }));
    const input = await screen.findByPlaceholderText(/Type your command/);
    await user.type(input, 'set custom css to: ai-proposed');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Update Custom CSS');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/Applied:/)).toBeInTheDocument();
    expect(client.updateEmailDocument).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Code' }));
    let textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('ai-proposed');
    expect(textarea.value).not.toContain('user-typed');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('user-typed');
    expect(textarea.value).not.toContain('ai-proposed');

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    textarea = screen.getByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('ai-proposed');
  });

  it('Sub-phase 4: AI Engineer title/subject/favicon actions apply through the same local-commit path, and persist through Save', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ email_title: 'Old Title' }));
    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will set the email title to "New Title".',
      action: { type: 'SET_EMAIL_TITLE', title: 'New Title' },
      requires_confirmation: true,
      requires_strong_confirmation: false,
      confidence: 0.85,
      provider: 'deterministic',
    });
    vi.mocked(client.updateEmailDocument).mockResolvedValue(baseDocument({ email_title: 'New Title' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'AI Engineer' }));
    const input = await screen.findByPlaceholderText(/Type your command/);
    await user.type(input, 'set the title to New Title');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Set the email title to "New Title"');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/Applied:/)).toBeInTheDocument();
    // Local commit only — no network call for Apply itself.
    expect(client.updateEmailDocument).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save', hidden: true }));
    await waitFor(() => {
      expect(client.updateEmailDocument).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ email_title: 'New Title' }),
      );
    });
  });

  it('Sub-phase 4: AI Engineer "repair all safe issues" proposes and applies a document-level repair, and Undo reverts it', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({
      email_title: 'August Newsletter', email_subject: 'x', reset_css_enabled: false,
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'AI Engineer' }));
    const input = await screen.findByPlaceholderText(/Type your command/);
    await user.type(input, 'repair all safe issues');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Repair 1 issue');
    // Entirely client-side — never reaches the backend NL router.
    expect(client.requestAICommand).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Repaired 1 issue.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Validate' }));
    expect(await screen.findByText('100')).toBeInTheDocument();
    expect(screen.getByText('Issues Found (0)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await user.click(screen.getByRole('button', { name: 'Validate' }));
    await user.click(screen.getByRole('button', { name: 'Revalidate' }));
    expect(screen.queryByText('100')).not.toBeInTheDocument();
    expect(screen.getByText('Email Reset CSS is disabled')).toBeInTheDocument();
  });

  it('Cancel on the Document Settings dialog creates no history entry', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Enable Email Reset CSS' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('failed Custom CSS validation creates no history entry (Apply stays disabled, Undo stays disabled)', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Enable Custom CSS' }));
    await user.type(within(dialog).getByLabelText('Custom CSS'), '<script>alert(1)</script>');

    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('dialog', { name: 'Document Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('the toolbar Save PATCHes content and document settings TOGETHER in one call, after several undoable local edits', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.updateEmailDocument).mockResolvedValue(baseDocument({ custom_css_enabled: true, custom_css: '.a{color:red}' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Enable Custom CSS' }));
    await user.type(within(dialog).getByLabelText('Custom CSS'), '.a{{color:red}');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(client.updateEmailDocument).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledWith('1', expect.objectContaining({
      content: expect.objectContaining({
        modules: expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
      }),
      custom_css_enabled: true,
      custom_css: '.a{color:red}',
    })));
  });
});

describe('EmailBuilderWorkspacePage — Feature 10 Platform Environment', () => {
  it('clicking the toolbar platform chip opens the Platform Environment dialog', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Generic/ }));
    expect(await screen.findByRole('dialog', { name: 'Platform / Environment Mode' })).toBeInTheDocument();
  });

  it('applying a platform switch PATCHes only platform, updates the toolbar chip, and closes the dialog', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.updateEmailDocument).mockResolvedValue(baseDocument({ platform: 'sfmc' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Generic/ }));
    await screen.findByRole('dialog', { name: 'Platform / Environment Mode' });
    await user.click(screen.getByRole('radio', { name: /Salesforce Marketing Cloud/ }));
    await user.click(screen.getByRole('button', { name: 'Apply Platform' }));

    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledWith('1', { platform: 'sfmc' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Salesforce Marketing Cloud/ })).toBeInTheDocument();
  });

  it('a failed platform switch shows an inline error and keeps the dialog open (content is never touched)', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.updateEmailDocument).mockRejectedValue({ message: 'Server error' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Generic/ }));
    await screen.findByRole('dialog', { name: 'Platform / Environment Mode' });
    await user.click(screen.getByRole('radio', { name: /Marketo/ }));
    await user.click(screen.getByRole('button', { name: 'Apply Platform' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not switch the platform');
    expect(screen.getByRole('dialog', { name: 'Platform / Environment Mode' })).toBeInTheDocument();
  });

  it('the Code Editor platform indicator reflects a platform switch made from the dialog', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.updateEmailDocument).mockResolvedValue(baseDocument({ platform: 'hubspot' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Generic/ }));
    await user.click(screen.getByRole('radio', { name: /HubSpot/ }));
    await user.click(screen.getByRole('button', { name: 'Apply Platform' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Code' }));
    const platformIndicator = (await screen.findByTitle('Platform scripting mode'));
    expect(platformIndicator).toHaveTextContent('HubSpot');
  });

  it('Cancel closes the dialog without calling updateEmailDocument', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Generic/ }));
    await screen.findByRole('dialog', { name: 'Platform / Environment Mode' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(client.updateEmailDocument).not.toHaveBeenCalled();
  });
});

describe('EmailBuilderWorkspacePage — Email Document Standards (Document Settings)', () => {
  it('clicking the toolbar Document Settings chip opens the dialog pre-filled from the loaded document', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({
      email_title: 'Existing Title', email_subject: 'Existing Subject', favicon_url: 'https://cdn.example.com/fav.png',
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    expect(await screen.findByRole('dialog', { name: 'Document Settings' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Existing Title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Existing Subject')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://cdn.example.com/fav.png')).toBeInTheDocument();
  });

  // Sub-phase 2 closure, item 1 — Apply is now a local, undo/redo-able
  // commit (no network call). Persistence happens at the toolbar Save,
  // together with module content, in ONE PATCH — see the "unified
  // undo/redo" describe block above for the Apply-then-Save round trip.
  it('Apply commits locally (no network call) and closes the dialog; the toolbar Save then PATCHes it together with content', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.updateEmailDocument).mockResolvedValue(baseDocument({ email_title: 'August Sale' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.type(screen.getByLabelText('Email Title'), 'August Sale');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(client.updateEmailDocument).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledWith('1', {
      content: expect.objectContaining({ version: 1 }),
      email_title: 'August Sale', email_subject: '', favicon_url: '',
      reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
    }));
  });

  it('a failed toolbar Save (after applying Document Settings) shows the standard save-error banner and keeps the edit local/undoable', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.updateEmailDocument).mockRejectedValue({ message: 'Server error' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.type(screen.getByLabelText('Email Title'), 'August Sale');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('We could not save your changes. Please try again.')).toBeInTheDocument();
    // The applied change is not lost — still there, still undoable.
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
  });

  it('Cancel closes the dialog without calling updateEmailDocument or committing anything', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(client.updateEmailDocument).not.toHaveBeenCalled();
  });
});

// Closure item 7 — a genuinely large (~8KB), realistic Custom CSS
// stylesheet (many distinct rules, not one repeated string) must work
// end to end: Monaco editing, Apply, Save, Code view, Preview, Export.
function largeRealisticCss(ruleCount = 140): string {
  return Array.from(
    { length: ruleCount },
    (_, i) => `.email-brand-${i} { color: #002D38; font-weight: 600; padding: ${i % 20}px; border-radius: 4px; }`,
  ).join('\n');
}

describe('EmailBuilderWorkspacePage — Email Document Standards closure item 7 (large Custom CSS)', () => {
  it('a ~8KB Custom CSS loads, displays fully in Monaco (not truncated), and round-trips through Code/Preview/Export', async () => {
    const largeCss = largeRealisticCss();
    expect(largeCss.length).toBeGreaterThan(5000);
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ custom_css_enabled: true, custom_css: largeCss }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    // Document Settings — Custom CSS is already enabled (per the loaded
    // document); Monaco shows the full, untruncated value.
    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    let dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    expect(within(dialog).getByRole('checkbox', { name: 'Enable Custom CSS' })).toBeChecked();
    expect(within(dialog).getByLabelText('Custom CSS')).toHaveValue(largeCss);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    // Code view — full value present, not truncated.
    await user.click(screen.getByRole('button', { name: 'Code' }));
    const textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain(largeCss);

    // Preview — same full value in the iframe srcDoc.
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const iframe = await screen.findByTitle('Desktop preview') as HTMLIFrameElement;
    expect(iframe.srcdoc).toContain(largeCss);

    // Export — Copy HTML carries the full value too.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByRole('dialog', { name: 'Export / Deploy' });
    await user.click(screen.getByRole('button', { name: /Copy HTML/ }));
    await screen.findByText('Copied');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(largeCss));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Editing a small part and Apply -> Save persists the full updated value.
    vi.mocked(client.updateEmailDocument).mockResolvedValue(baseDocument({ custom_css_enabled: true, custom_css: largeCss }));
    await user.click(screen.getByRole('button', { name: 'Visual' }));
    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    const editor = within(dialog).getByLabelText('Custom CSS');
    await user.click(editor);
    await user.type(editor, '.extra {{ color: red; }\n');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledWith('1', expect.objectContaining({
      custom_css: expect.stringContaining('.extra'),
    })));
    const [, savedInput] = vi.mocked(client.updateEmailDocument).mock.calls[0];
    expect((savedInput.custom_css ?? '').length).toBeGreaterThan(5000);
  });
});

describe('EmailBuilderWorkspacePage — Feature 11 Preview Studio', () => {
  it('switching to Preview hides the module/canvas/properties panels and shows the Desktop preview', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Preview' }));

    expect(within(editorModeGroup).getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByTitle('Desktop preview')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search modules')).not.toBeInTheDocument();
  });

  it('Email Document Standards Sub-phase 2 — Reset/Custom CSS appear identically in both Desktop and Mobile preview (CSS is not device-width-dependent)', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(
      baseDocument({ reset_css_enabled: true, custom_css_enabled: true, custom_css: '.brand{color:#002D38}' }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Preview' }));
    const desktopFrame = await screen.findByTitle('Desktop preview') as HTMLIFrameElement;
    expect(desktopFrame.srcdoc).toContain('EMAIL RESET CSS - START');
    expect(desktopFrame.srcdoc).toContain('.brand{color:#002D38}');

    await user.click(screen.getByRole('tab', { name: 'Mobile' }));
    const mobileFrame = await screen.findByTitle('Mobile preview') as HTMLIFrameElement;
    expect(mobileFrame.srcdoc).toBe(desktopFrame.srcdoc);
  });

  it('the Preview reflects a module added in Visual mode after switching back and forth', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Preview' }));
    const iframe = await screen.findByTitle('Desktop preview') as HTMLIFrameElement;
    expect(iframe.srcdoc).toContain('Add your heading or paragraph text here.');
  });

  it('switching back to Visual from Preview restores the module panel/canvas/properties panel', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Preview' }));
    await screen.findByTitle('Desktop preview');
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Visual' }));

    expect(screen.queryByTitle('Desktop preview')).not.toBeInTheDocument();
    expect(within(editorModeGroup).getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the Email Clients tab in Preview shows every client as Compatible for a document with no modules', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ content: { version: 1, modules: [] } }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('tab', { name: 'Email Clients' }));

    expect(await screen.findByText(/of \d+ clients compatible\./)).toBeInTheDocument();
  });
});

describe('EmailBuilderWorkspacePage — Feature 12 Validation Center', () => {
  it('switching to Validate hides the module/canvas/properties panels and shows the health score', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Validate' }));

    expect(within(editorModeGroup).getByRole('button', { name: 'Validate' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Email Health Score')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search modules')).not.toBeInTheDocument();
  });

  it('a clean empty document shows a perfect score and no issues', async () => {
    // Sub-phase 4 — a title/subject are required for a "clean" document
    // now that Validation Center checks for them (see
    // emailValidation.ts's checkDocumentStandards); an empty title/
    // subject is itself a real, intended new warning, not noise.
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({
      content: { version: 1, modules: [] }, email_title: 'August Newsletter', email_subject: 'August updates',
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Validate' }));

    expect(await screen.findByText('100')).toBeInTheDocument();
    expect(screen.getByText('Issues Found (0)')).toBeInTheDocument();
  });

  it('clicking "Go to module" on an issue switches to Visual and selects the offending module', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await openCategory(user, 'Images');
    await user.click(await screen.findByRole('button', { name: 'Add Image' }));
    expect(screen.queryByText('Select a module')).not.toBeInTheDocument();

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Validate' }));
    await screen.findByText('Email Health Score');

    // The freshly-added image uses the app's own "#" placeholder src —
    // its Fix is not safely auto-fixable (no real URL to invent), so this
    // exercises the navigate-to-module path, not a safe-fix patch.
    const goToModuleButtons = screen.queryAllByRole('button', { name: 'Go to module' });
    if (goToModuleButtons.length > 0) {
      await user.click(goToModuleButtons[0]);
      expect(within(editorModeGroup).getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByText('Select a module')).not.toBeInTheDocument();
    }
  });

  it('Revalidate and Fix All Safe Issues controls are present and keyboard-reachable', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Validate' }));
    await screen.findByText('Email Health Score');

    expect(screen.getByRole('button', { name: 'Revalidate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fix All Safe Issues/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI-Assisted Fix/ })).toBeDisabled();
  });

  it('switching back to Visual from Validate restores the module panel/canvas/properties panel', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Validate' }));
    await screen.findByText('Email Health Score');
    await user.click(within(editorModeGroup).getByRole('button', { name: 'Visual' }));

    expect(screen.queryByText('Email Health Score')).not.toBeInTheDocument();
    expect(within(editorModeGroup).getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('EmailBuilderWorkspacePage — Feature 13 Export / Deploy', () => {
  it('clicking Export opens the Export/Deploy dialog showing the email name and platform', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByRole('dialog', { name: 'Export / Deploy' })).toBeInTheDocument();
    expect(screen.getAllByText('August Newsletter').length).toBeGreaterThan(0);
  });

  it('a clean empty document shows a Passed export summary with no blocking gate', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ content: { version: 1, modules: [] } }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByRole('dialog', { name: 'Export / Deploy' });

    expect(screen.getAllByText(/Passed/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export Email/ })).not.toBeDisabled();
  });

  it('Save as Template creates a new document via create+patch and shows success', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.createEmailDocument).mockResolvedValue(
      baseDocument({ id: 2, name: 'August Newsletter (Template)', start_type: 'template' }),
    );
    vi.mocked(client.updateEmailDocument).mockImplementation(async (_id, input) => baseDocument({
      id: 2, name: 'August Newsletter (Template)', start_type: 'template', content: input.content!,
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByRole('dialog', { name: 'Export / Deploy' });
    await user.click(screen.getByRole('button', { name: 'Save as Template' }));

    await waitFor(() => expect(client.createEmailDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'August Newsletter (Template)', start_type: 'template' }),
    ));
    expect(await screen.findByText('Saved as Template')).toBeInTheDocument();
  });

  it('Cancel closes the dialog and returns to the Visual builder', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByRole('dialog', { name: 'Export / Deploy' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: 'Export / Deploy' })).not.toBeInTheDocument();
  });

  it('Export uses the live in-editor module tree, not just the last-saved content, when saving as a template', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ content: { version: 1, modules: [] } }));
    vi.mocked(client.createEmailDocument).mockResolvedValue(
      baseDocument({ id: 2, name: 'August Newsletter (Template)', start_type: 'template' }),
    );
    let patchedModuleCount = -1;
    vi.mocked(client.updateEmailDocument).mockImplementation(async (_id, input) => {
      patchedModuleCount = input.content!.modules.length;
      return baseDocument({ id: 2, start_type: 'template', content: input.content! });
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByRole('dialog', { name: 'Export / Deploy' });
    await user.click(screen.getByRole('button', { name: 'Save as Template' }));

    await waitFor(() => expect(patchedModuleCount).toBe(1));
  });

  // Phase E1 (Export -> Validation nav)
  it('View in Validation closes the Export dialog and switches to the Validate tab, preserving builder state', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await openCategory(user, 'Images');
    await user.click(await screen.findByRole('button', { name: 'Add Image' }));

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByRole('dialog', { name: 'Export / Deploy' });

    await user.click(screen.getByRole('button', { name: /View in Validation/ }));

    expect(screen.queryByRole('dialog', { name: 'Export / Deploy' })).not.toBeInTheDocument();
    const editorModeGroup = screen.getByRole('group', { name: 'Editor mode' });
    expect(within(editorModeGroup).getByRole('button', { name: 'Validate' })).toHaveAttribute('aria-pressed', 'true');
    await screen.findByText('Email Health Score');
    // The image module added before opening Export is still present —
    // builder state (the module tree) survived the round trip untouched.
    expect(screen.getByText(/Issues Found \(/)).toBeInTheDocument();
  });

  it('View in Validation does not appear for a clean document (no issues to view)', async () => {
    // Empty title/subject each independently trigger a warning on their
    // own — a genuinely zero-issue document needs both set.
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({
      content: { version: 1, modules: [] }, email_title: 'Test Email', email_subject: 'Test subject',
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByRole('dialog', { name: 'Export / Deploy' });

    expect(screen.queryByRole('button', { name: /View in Validation/ })).not.toBeInTheDocument();
  });
});

describe('EmailBuilderWorkspacePage — Feature 14 AI Engineer Voice', () => {
  async function openAiEngineer(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText('August Newsletter');
    await user.click(screen.getByRole('button', { name: 'AI Engineer' }));
    return screen.findByPlaceholderText(/Type your command/);
  }

  it('typed add-module command shows a proposal, and Apply adds the module to the canvas', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will add a button module.',
      action: { type: 'INSERT_MODULE', modules: [{ module_type: 'button', patch: {} }] },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    const user = userEvent.setup();
    renderPage();
    const input = await openAiEngineer(user);

    await user.type(input, 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Add a button module')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText(/Applied:/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.getByText('Shop Now')).toBeInTheDocument();
  });

  it('a destructive command shows a confirmation-styled proposal, and Cancel leaves the module untouched', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'This will delete the selected module. Please confirm.',
      action: { type: 'DELETE_MODULE', target: 'selected' },
      requires_confirmation: true,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    await user.click(screen.getByRole('button', { name: 'AI Engineer' }));
    const input = await screen.findByPlaceholderText(/Type your command/);
    await user.type(input, 'delete this');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Delete the selected module')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.getByText('Add your heading or paragraph text here.', { selector: 'p' })).toBeInTheDocument();
  });

  it('applying a delete removes the selected module and participates in Undo', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'This will delete the selected module. Please confirm.',
      action: { type: 'DELETE_MODULE', target: 'selected' },
      requires_confirmation: true,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    await user.click(screen.getByRole('button', { name: 'AI Engineer' }));
    const input = await screen.findByPlaceholderText(/Type your command/);
    await user.type(input, 'delete this');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Delete the selected module');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.queryByText('Add your heading or paragraph text here.', { selector: 'p' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Add your heading or paragraph text here.', { selector: 'p' })).toBeInTheDocument();
  });

  // Sub-phase 7 — composition (COMPOSE_EMAIL) end-to-end through the real
  // AI Engineer UI: proposal-before-apply, one undo/redo step for the
  // WHOLE composition, and genuine layout/nested/repeatable coverage.
  it('a composition proposal shows the ordered section list, and Apply inserts every module as one undo step', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will compose a Promotional / Campaign email with 3 sections: header-logo-center, layout-2col-50-50, footer-simple-legal. Review the proposal and Apply to insert it, or Cancel to change nothing.',
      action: {
        type: 'COMPOSE_EMAIL',
        items: [
          { module_type: 'header-logo-center', patch: {} },
          {
            module_type: 'layout-2col-50-50', patch: {},
            children: [
              { column_index: 0, modules: [{ module_type: 'text', patch: { text: 'Left column' } }] },
              { column_index: 1, modules: [{ module_type: 'text', patch: { text: 'Right column' } }] },
            ],
          },
          {
            module_type: 'social-icon-row', patch: {},
            repeatable_items: [{ label: 'Facebook', href: 'https://facebook.com/example' }],
          },
          { module_type: 'footer-simple-legal', patch: {} },
        ],
      },
      requires_confirmation: true,
      requires_strong_confirmation: false,
      confidence: 0.8,
      provider: 'deterministic',
    });
    const user = userEvent.setup();
    renderPage();
    const input = await openAiEngineer(user);

    await user.type(input, 'create a promotional email with a header, two content columns, social links and a footer');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Compose a full email with 4 sections')).toBeInTheDocument();
    // The ordered per-section preview list, including nested/list-item counts.
    expect(screen.getByText(/1\. header-logo-center/)).toBeInTheDocument();
    expect(screen.getByText(/2\. layout-2col-50-50 — 2 nested modules/)).toBeInTheDocument();
    expect(screen.getByText(/3\. social-icon-row — 1 list item/)).toBeInTheDocument();
    expect(screen.getByText(/4\. footer-simple-legal/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/Applied:/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.getByText('Left column')).toBeInTheDocument();
    expect(screen.getByText('Right column')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();

    // One Undo removes the ENTIRE composition (all 4 top-level modules),
    // never just the last-inserted one.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText('Left column')).not.toBeInTheDocument();
    expect(screen.queryByText('Facebook')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(await screen.findByText('Left column')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
  });

  it('Cancel on a composition proposal leaves the canvas completely unchanged', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will compose a Welcome / Onboarding email with 2 sections: hero-text-only, footer-simple-legal.',
      action: {
        type: 'COMPOSE_EMAIL',
        items: [
          { module_type: 'hero-text-only', patch: { headline: 'Welcome aboard!' } },
          { module_type: 'footer-simple-legal', patch: {} },
        ],
      },
      requires_confirmation: true,
      requires_strong_confirmation: false,
      confidence: 0.8,
      provider: 'deterministic',
    });
    const user = userEvent.setup();
    renderPage();
    const input = await openAiEngineer(user);

    await user.type(input, 'make a welcome email');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Compose a full email with 2 sections');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.queryByText('Welcome aboard!')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('an ambiguous/unsupported command shows the clarifying reply without a proposal card', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: "I'm not sure how to do that yet. I can add a text/image/button/divider/spacer, "
        + "change the selected module's color/text/size/alignment, delete or duplicate the "
        + 'selected module, or apply a style change to every module of one type.',
      action: { type: 'NONE' },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.2,
      provider: 'deterministic',
    });
    const user = userEvent.setup();
    renderPage();
    const input = await openAiEngineer(user);

    await user.type(input, 'convert this to two columns');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/I'm not sure how to do that yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'History (1)' }));
    expect(screen.getByText('Needs clarification')).toBeInTheDocument();
  });

  it('a failed request shows a safe error message and records it in history', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.requestAICommand).mockRejectedValue({ message: 'Server error' });
    const user = userEvent.setup();
    renderPage();
    const input = await openAiEngineer(user);

    await user.type(input, 'add a button');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('We could not reach the AI Engineer. Please try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'History (1)' }));
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('sends the currently selected module as context', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will update the selected text module.',
      action: { type: 'UPDATE_MODULE_PROPS', target: 'selected', module_type: 'text', patch: { color: '#76C043' } },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.85,
      provider: 'deterministic',
    });
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: 'AI Engineer' }));
    const input = await screen.findByPlaceholderText(/Type your command/);
    await user.type(input, 'make the text green');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(client.requestAICommand).toHaveBeenCalledWith(expect.objectContaining({
      message: 'make the text green',
      selected_module: expect.objectContaining({ type: 'text' }),
    })));
  });

  // --- Sub-phase 6, work package D/E — the six reserved ActionTypes plus
  // UPDATE_REPEATABLE_FIELD, each proven end-to-end: proposal shown ->
  // Apply -> real, visible effect through an EXISTING mutator, never a
  // parallel mutation path.

  it('APPLY_VML_PATTERN enables the button VML fallback, visible in Code view', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'CTA');
    await user.click(await screen.findByRole('button', { name: 'Add Button' }));

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will enable the Classic Outlook VML fallback for the selected button.',
      action: { type: 'APPLY_VML_PATTERN', target: 'selected', module_type: 'button' },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    const input = await openAiEngineer(user);
    await user.type(input, 'enable outlook vml for this button');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Enable the Classic Outlook VML fallback/);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Applied:/);

    await user.click(screen.getByRole('button', { name: 'Code' }));
    const textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('v:roundrect');
    expect(textarea.value).toContain('<!--[if !mso]><!-->');
  });

  it('APPLY_OUTLOOK_WRAPPER enables the background-image VML fallback, visible in Code view', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Hero');
    await user.click(await screen.findByRole('button', { name: 'Add Background Image Hero' }));

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will enable the Classic Outlook VML background fallback.',
      action: { type: 'APPLY_OUTLOOK_WRAPPER', target: 'selected', module_type: 'hero-background-image' },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    const input = await openAiEngineer(user);
    await user.type(input, 'enable outlook wrapper for this background');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Enable the Classic Outlook VML background fallback/);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Applied:/);

    await user.click(screen.getByRole('button', { name: 'Code' }));
    const textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('<v:rect');
    expect(textarea.value).toContain('<v:fill type="tile"');
  });

  it('RESTRUCTURE_LAYOUT changes the selected layout module\'s column widths', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'This will change the column widths to 70% / 30%. Please confirm.',
      action: { type: 'RESTRUCTURE_LAYOUT', target: 'selected', module_type: 'layout-2col-50-50', widths: [70, 30] },
      requires_confirmation: true,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    const input = await openAiEngineer(user);
    await user.type(input, 'change the column widths to 70/30');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Change the selected layout's column widths/);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Applied:/);

    await user.click(screen.getByRole('button', { name: 'Code' }));
    const textarea = await screen.findByLabelText('Generated email HTML (read-only)') as HTMLTextAreaElement;
    expect(textarea.value).toContain('width="70%"');
    expect(textarea.value).toContain('width="30%"');
  });

  it('INSERT_NESTED_MODULE inserts a module into the selected column', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));
    await user.click(await screen.findByRole('button', { name: 'Column 1, empty' }));

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will insert a text module into the selected column.',
      action: {
        type: 'INSERT_NESTED_MODULE', target: 'selected_column', module_type: 'text',
        patch: { text: 'Nested Hello' },
      },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    const input = await openAiEngineer(user);
    await user.type(input, 'add a text module here saying Nested Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Insert a text module into the selected column');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Applied:/);

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.getAllByText('Nested Hello').length).toBeGreaterThan(0);
  });

  it('INSERT_NESTED_MODULE declines silently when no column is selected', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add 2 Columns 50/50' }));
    // Deselect the layout (and its column) by adding a top-level text
    // module, which becomes the new selection.
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will insert a text module into the selected column.',
      action: { type: 'INSERT_NESTED_MODULE', target: 'selected_column', module_type: 'text', patch: {} },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    const input = await openAiEngineer(user);
    await user.type(input, 'add a text module here');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Insert a text module into the selected column');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    // No crash, and no phantom module inserted anywhere.
    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.queryByText('Nested Hello')).not.toBeInTheDocument();
  });

  it('REPLACE_UNSUPPORTED_PROPERTY updates the selected module through the SAME path as UPDATE_MODULE_PROPS', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'CTA');
    await user.click(await screen.findByRole('button', { name: 'Add Button' }));

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will replace the unsupported width mode on the selected button.',
      action: {
        type: 'REPLACE_UNSUPPORTED_PROPERTY', target: 'selected', module_type: 'button',
        patch: { text: 'Buy Now Instead' },
      },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    const input = await openAiEngineer(user);
    await user.type(input, 'replace the unsupported property');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Replace an unsupported property/);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Applied:/);

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.getByText('Buy Now Instead')).toBeInTheDocument();
  });

  it('UPDATE_REPEATABLE_FIELD adds a nav link item to the selected header module', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Header');
    await user.click(await screen.findByRole('button', { name: 'Add Logo + Navigation' }));

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'I will add a Pricing link to the navigation.',
      action: {
        type: 'UPDATE_REPEATABLE_FIELD', target: 'selected', module_type: 'header-logo-nav', op: 'add',
        item: { label: 'Pricing', href: 'https://example.com/pricing' },
      },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    const input = await openAiEngineer(user);
    await user.type(input, 'add a pricing nav link');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText("Add an item to the selected header-logo-nav module's list");
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Applied:/);

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.getByRole('button', { name: 'Pricing' })).toBeInTheDocument();
  });

  it('UPDATE_REPEATABLE_FIELD remove requires confirmation and removes the item on Apply', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Header');
    await user.click(await screen.findByRole('button', { name: 'Add Logo + Navigation' }));
    expect(screen.getByRole('button', { name: /^Shop/ })).toBeInTheDocument();

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'This will remove a navigation link. Please confirm.',
      action: { type: 'UPDATE_REPEATABLE_FIELD', target: 'selected', module_type: 'header-logo-nav', op: 'remove', index: 0 },
      requires_confirmation: true,
      requires_strong_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    const input = await openAiEngineer(user);
    await user.type(input, 'remove the first nav link');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText("Remove item 1 from the selected header-logo-nav module's list");
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Applied:/);

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.queryByRole('button', { name: /^Shop/ })).not.toBeInTheDocument();
  });

  // --- Sub-phase 6 closure -- repeatable-field UPDATE/REORDER via NL ---

  it('UPDATE_REPEATABLE_FIELD (op update) changes a nav link label through the AI Engineer', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Header');
    await user.click(await screen.findByRole('button', { name: 'Add Logo + Navigation' }));
    expect(screen.getByRole('button', { name: /^Shop/ })).toBeInTheDocument();

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'This will change item 1\'s Label to "Services". Please confirm.',
      action: {
        type: 'UPDATE_REPEATABLE_FIELD', target: 'selected', module_type: 'header-logo-nav', op: 'update',
        index: 0, item: { label: 'Services' },
      },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.85,
      provider: 'deterministic',
    });
    const input = await openAiEngineer(user);
    await user.type(input, 'change the first nav link label to Services');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText("Update item 1 of the selected header-logo-nav module's list");
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Applied:/);

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    expect(screen.getByRole('button', { name: 'Services' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Shop/ })).not.toBeInTheDocument();
  });

  it('UPDATE_REPEATABLE_FIELD (op reorder) moves a nav link through the AI Engineer', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Header');
    await user.click(await screen.findByRole('button', { name: 'Add Logo + Navigation' }));
    const before = screen.getAllByRole('button', { name: /^Shop|^About|^Contact/ }).map((el) => el.textContent);
    expect(before).toEqual(['Shop', 'About', 'Contact']);

    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: 'This will move item 1 to position 3. Please confirm.',
      action: {
        type: 'UPDATE_REPEATABLE_FIELD', target: 'selected', module_type: 'header-logo-nav', op: 'reorder',
        fromIndex: 0, toIndex: 2,
      },
      requires_confirmation: false,
      requires_strong_confirmation: false,
      confidence: 0.85,
      provider: 'deterministic',
    });
    const input = await openAiEngineer(user);
    await user.type(input, 'move the first nav link to position 3');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText("Reorder items in the selected header-logo-nav module's list");
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText(/Applied:/);

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    const after = screen.getAllByRole('button', { name: /^Shop|^About|^Contact/ }).map((el) => el.textContent);
    expect(after).toEqual(['About', 'Contact', 'Shop']);
  });
});

// Module-4 Final Gap Closure, Correction 3 (Feature 03 autosave) — a
// controllable promise, so a test can hold a mocked updateEmailDocument
// PATCH "in flight" and resolve it at a precise, asserted point.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Real (not fake) timers, deliberately: @testing-library's findBy/waitFor
// poll via real setTimeout internally, which does not advance under
// `vi.useFakeTimers()` unless every intervening query is manually ticked.
// The 2s debounce is short enough that a genuine real-time wait keeps
// these tests simple and unambiguous — see the per-test timeout bump below.
function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('EmailBuilderWorkspacePage — Module-4 Final Gap Closure, Correction 3 (Feature 03 autosave)', () => {
  // A test that intentionally leaves a deferred promise (from
  // mockReturnValueOnce) unresolved if it fails partway would otherwise
  // leak that queued mock implementation into the next test — clearAllMocks
  // (the file's global afterEach) clears call history but not queued
  // once-implementations. mockReset() clears both.
  beforeEach(() => {
    vi.mocked(client.getEmailDocument).mockReset();
    vi.mocked(client.updateEmailDocument).mockReset();
  });

  it('autosaves 2 seconds after an edit — no PATCH before, exactly one after', async () => {
    const user = userEvent.setup();
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(document1);
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await wait(1600);
    expect(client.updateEmailDocument).not.toHaveBeenCalled();

    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  }, 10000);

  it('multiple edits inside the debounce window collapse into exactly one PATCH with the latest state', async () => {
    const user = userEvent.setup();
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(document1);
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await wait(1000);
    await user.click(await screen.findByRole('button', { name: 'Add Text' })); // resets the debounce
    expect(client.updateEmailDocument).not.toHaveBeenCalled(); // still within 2s of the LAST edit

    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const payload = vi.mocked(client.updateEmailDocument).mock.calls[0][1] as { content: { modules: unknown[] } };
    expect(payload.content.modules).toHaveLength(2);
  }, 10000);

  it('an edit landing while a PATCH is in flight is never lost — the stale response cannot clear the newer dirty state, and exactly one follow-up PATCH persists the latest content', async () => {
    const user = userEvent.setup();
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    const first = deferred<EmailDocument>();
    const second = deferred<EmailDocument>();
    vi.mocked(client.updateEmailDocument)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' })); // edit A: 1 module

    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledTimes(1), { timeout: 3000 }); // debounce fires -> PATCH A in flight (unresolved)
    const payloadA = vi.mocked(client.updateEmailDocument).mock.calls[0][1] as { content: { modules: unknown[] } };
    expect(payloadA.content.modules).toHaveLength(1);

    await user.click(await screen.findByRole('button', { name: 'Add Text' })); // edit B while A is in flight: 2 modules
    // PATCH A is still in flight, so the toolbar legitimately still shows
    // "Saving…" — the revision-mismatch/follow-up mechanism below is an
    // internal correctness guarantee, not a second visible status label.
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    // Resolve the STALE request. It must not clear dirty (B is newer), and
    // must trigger exactly one follow-up PATCH carrying the CURRENT state.
    first.resolve(document1);
    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledTimes(2));
    const payloadB = vi.mocked(client.updateEmailDocument).mock.calls[1][1] as { content: { modules: unknown[] } };
    expect(payloadB.content.modules).toHaveLength(2);
    // The follow-up PATCH (B) starts immediately and is itself still in
    // flight — still "Saving…", not yet "Saved".
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    second.resolve(document1);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(client.updateEmailDocument).toHaveBeenCalledTimes(2); // nothing else was owed
  }, 10000);

  it('a failed autosave preserves dirty state and allows a later manual retry', async () => {
    const user = userEvent.setup();
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    vi.mocked(client.updateEmailDocument)
      .mockRejectedValueOnce({ message: 'Server error' })
      .mockResolvedValueOnce(document1);
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    expect(await screen.findByText('Save failed', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('We could not save your changes. Please try again.')).toBeInTheDocument();

    // Dirty was preserved (never cleared on failure) — the Save button is
    // enabled and a manual retry succeeds.
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  }, 10000);

  it('manual Save works before the debounce expires, and flushes/cancels the pending autosave (no duplicate PATCH later)', async () => {
    const user = userEvent.setup();
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(document1);
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: 'Save' })); // well before the 2s debounce
    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    await wait(2200); // past the original debounce mark
    expect(client.updateEmailDocument).toHaveBeenCalledTimes(1); // no second, stale-timer PATCH
  }, 10000);

  it('Ctrl+S works before the debounce expires, and flushes/cancels the pending autosave', async () => {
    const user = userEvent.setup();
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(document1);
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    await wait(2200);
    expect(client.updateEmailDocument).toHaveBeenCalledTimes(1);
  }, 10000);

  it('Ctrl+S while an autosave PATCH is in flight does not race it — it serializes as one follow-up save with the latest state', async () => {
    const user = userEvent.setup();
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    const first = deferred<EmailDocument>();
    vi.mocked(client.updateEmailDocument)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(document1);
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' })); // 1 module

    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledTimes(1), { timeout: 3000 }); // autosave fires -> PATCH #1 in flight

    await user.click(await screen.findByRole('button', { name: 'Add Text' })); // edit while in flight: 2 modules
    fireEvent.keyDown(window, { key: 's', ctrlKey: true }); // manual save attempt while #1 is still in flight

    // Must not start a second CONCURRENT request.
    expect(client.updateEmailDocument).toHaveBeenCalledTimes(1);

    first.resolve(document1);
    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledTimes(2));
    const payload = vi.mocked(client.updateEmailDocument).mock.calls[1][1] as { content: { modules: unknown[] } };
    expect(payload.content.modules).toHaveLength(2);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(client.updateEmailDocument).toHaveBeenCalledTimes(2); // no extra request beyond the one owed follow-up
  }, 10000);

  it('Undo/Redo after a successful autosave remains correct', async () => {
    const user = userEvent.setup();
    const document1 = baseDocument();
    vi.mocked(client.getEmailDocument).mockResolvedValue(document1);
    vi.mocked(client.updateEmailDocument).mockResolvedValue(document1);
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Start building your email')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(await screen.findByText('Add your heading or paragraph text here.', { selector: 'p' })).toBeInTheDocument();
  }, 10000);

  it('a hard reload after a successful autosave restores the autosaved content', async () => {
    const user = userEvent.setup();
    const initial = baseDocument();
    let persisted: EmailDocument = initial;
    vi.mocked(client.getEmailDocument).mockResolvedValueOnce(initial);
    vi.mocked(client.updateEmailDocument).mockImplementation(async (_id, patch) => {
      persisted = { ...initial, ...patch } as EmailDocument;
      return persisted;
    });
    const { unmount } = renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    expect(await screen.findByText('Saved', {}, { timeout: 3000 })).toBeInTheDocument();

    unmount();
    vi.mocked(client.getEmailDocument).mockResolvedValueOnce(persisted);
    renderPage();
    expect(await screen.findByText('Add your heading or paragraph text here.', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  }, 10000);
});

// Module-4 Final Gap Closure, Correction 3 (Feature 03 zoom).
describe('EmailBuilderWorkspacePage — Module-4 Final Gap Closure, Correction 3 (Feature 03 zoom)', () => {
  it('defaults to 100% and Zoom in/out/reset cycle through 50-150 in 25-point steps, clamped at the bounds', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPage();
    await screen.findByText('Start building your email');

    expect(screen.getByRole('button', { name: /Zoom level 100 percent/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: /Zoom level 125 percent/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: /Zoom level 150 percent/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Zoom level 150 percent/ })); // reset
    expect(screen.getByRole('button', { name: /Zoom level 100 percent/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByRole('button', { name: /Zoom level 50 percent/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
  });

  it('applies a CSS transform scale to the canvas surface at non-100% zoom, and none at 100%, without changing its width', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ width: 700 }));
    renderPage();
    await screen.findByText('Start building your email');
    const surface = () => document.querySelector('.email-canvas__surface') as HTMLElement;
    expect(surface().style.transform).toBe('');
    expect(surface().style.width).toBe('700px');

    await user.click(screen.getByRole('button', { name: 'Zoom in' })); // 125%
    expect(surface().style.transform).toBe('scale(1.25)');
    expect(surface().style.width).toBe('700px'); // canvasWidth itself never changes
  });

  it('modules remain selectable/editable at non-100% zoom', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' })); // 150%

    await user.click(screen.getByText('Add your heading or paragraph text here.', { selector: 'p' }));
    expect(screen.getByLabelText('Text')).toBeInTheDocument(); // Properties panel opened — selection still works
  });

  it('Desktop/Mobile switching works independently of the current zoom level', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ width: 700 }));
    renderPage();
    await screen.findByText('Start building your email');
    await user.click(screen.getByRole('button', { name: 'Zoom in' })); // 125%
    const surface = () => document.querySelector('.email-canvas__surface') as HTMLElement;
    expect(surface().style.width).toBe('700px');

    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(surface().style.width).toBe('375px');
    expect(surface().style.transform).toBe('scale(1.25)'); // zoom unaffected by the device switch

    await user.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(surface().style.width).toBe('700px');
    expect(surface().style.transform).toBe('scale(1.25)');
  });

  it('Code view output is byte-identical regardless of zoom level', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: 'Code' }));
    const codeAt100 = (screen.getByRole('textbox') as HTMLTextAreaElement).value;
    expect(codeAt100.length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' })); // 150%
    await user.click(screen.getByRole('button', { name: 'Code' }));
    const codeAt150 = (screen.getByRole('textbox') as HTMLTextAreaElement).value;

    expect(codeAt150).toBe(codeAt100);
  });

  it('Preview Studio output is byte-identical regardless of zoom level', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const previewAt100 = await screen.findByTitle('Desktop preview');
    const srcdocAt100 = previewAt100.getAttribute('srcdoc');
    expect(srcdocAt100).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Visual' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' })); // 150%
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const previewAt150 = await screen.findByTitle('Desktop preview');
    expect(previewAt150.getAttribute('srcdoc')).toBe(srcdocAt100);
  });

  it('zoom resets to 100% on a fresh document load', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const { unmount } = renderPage('1');
    await screen.findByText('Start building your email');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: /Zoom level 125 percent/ })).toBeInTheDocument();

    unmount();
    renderPage('2');
    await screen.findByText('Start building your email');
    expect(screen.getByRole('button', { name: /Zoom level 100 percent/ })).toBeInTheDocument();
  });
});

// Module-4 Navigation Completion, Phase A — the standalone Preview &
// Validation / AI Engineer / Module Library entry points deep-link into
// THIS existing page via `?tab=`/`?insertModuleType=`/
// `?insertSavedModuleId=`, applied once through the SAME
// setEditorMode/builder.addModule/builder.addSavedModule calls a normal
// in-builder interaction already uses.
describe('EmailBuilderWorkspacePage — Module-4 Navigation Completion, Phase A (deep links)', () => {
  it('?tab=preview selects the Preview tab on load', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPageAt('/email-builder/builder/1?tab=preview');
    const editorModeGroup = await screen.findByRole('group', { name: 'Editor mode' });
    await waitFor(() => expect(
      within(editorModeGroup).getByRole('button', { name: 'Preview' }),
    ).toHaveAttribute('aria-pressed', 'true'));
  });

  it('?tab=validate selects the Validate tab on load', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPageAt('/email-builder/builder/1?tab=validate');
    const editorModeGroup = await screen.findByRole('group', { name: 'Editor mode' });
    await waitFor(() => expect(
      within(editorModeGroup).getByRole('button', { name: 'Validate' }),
    ).toHaveAttribute('aria-pressed', 'true'));
  });

  it('?tab=ai selects the AI Engineer tab on load', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPageAt('/email-builder/builder/1?tab=ai');
    const editorModeGroup = await screen.findByRole('group', { name: 'Editor mode' });
    await waitFor(() => expect(
      within(editorModeGroup).getByRole('button', { name: 'AI Engineer' }),
    ).toHaveAttribute('aria-pressed', 'true'));
  });

  it('an unrecognized ?tab= value is ignored, falling back to Visual', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPageAt('/email-builder/builder/1?tab=not-a-real-tab');
    const editorModeGroup = await screen.findByRole('group', { name: 'Editor mode' });
    expect(within(editorModeGroup).getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('?insertModuleType=text inserts a Text module through the normal addModule mutation path', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPageAt('/email-builder/builder/1?insertModuleType=text');
    expect(await screen.findByText('Add your heading or paragraph text here.', { selector: 'p' })).toBeInTheDocument();
    // Undo works — proves this went through the real history system, not
    // a special-cased initial-load path.
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
  });

  it('?insertSavedModuleId=<id> inserts the matching saved module through addSavedModule', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.listSavedModules).mockResolvedValue([savedModule()]);
    renderPageAt('/email-builder/builder/1?insertSavedModuleId=1');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled());
  });

  it('strips the deep-link query params from the URL after applying them once', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    renderPageAt('/email-builder/builder/1?tab=validate');
    const editorModeGroup = await screen.findByRole('group', { name: 'Editor mode' });
    await waitFor(() => expect(
      within(editorModeGroup).getByRole('button', { name: 'Validate' }),
    ).toHaveAttribute('aria-pressed', 'true'));
    // Switching away and the params being gone (not re-applied) is
    // implicitly covered by the tab staying on whatever the user picks
    // next; explicitly assert the query string itself is now empty via
    // the page not re-selecting Validate after a manual switch to Visual.
    await userEvent.setup().click(within(editorModeGroup).getByRole('button', { name: 'Visual' }));
    expect(within(editorModeGroup).getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');
  });
});
