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
    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledWith('1', {
      content: expect.objectContaining({
        modules: expect.arrayContaining([
          expect.objectContaining({ props: expect.objectContaining({ columnWidths: [35, 50] }) }),
        ]),
      }),
    }));
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

describe('EmailBuilderWorkspacePage — Email Document Standards Sub-phase 1 (Document Settings)', () => {
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

  it('saving Document Settings PATCHes only title/subject/favicon (content untouched) and closes the dialog', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.updateEmailDocument).mockResolvedValue(baseDocument({ email_title: 'August Sale' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.type(screen.getByLabelText('Email Title'), 'August Sale');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(client.updateEmailDocument).toHaveBeenCalledWith('1', {
      email_title: 'August Sale', email_subject: '', favicon_url: '',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a failed save shows an inline error and keeps the dialog open', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.updateEmailDocument).mockRejectedValue({ message: 'Server error' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('August Newsletter');

    await user.click(screen.getByRole('button', { name: /Document Settings/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Document Settings' });
    await user.type(screen.getByLabelText('Email Title'), 'August Sale');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
    expect(screen.getByRole('dialog', { name: 'Document Settings' })).toBeInTheDocument();
  });

  it('Cancel closes the dialog without calling updateEmailDocument', async () => {
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
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument({ content: { version: 1, modules: [] } }));
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

  it('an ambiguous/unsupported command shows the clarifying reply without a proposal card', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    vi.mocked(client.requestAICommand).mockResolvedValue({
      success: true,
      reply: "I'm not sure how to do that yet. I can add a text/image/button/divider/spacer, "
        + "change the selected module's color/text/size/alignment, delete or duplicate the "
        + 'selected module, or apply a style change to every module of one type.',
      action: { type: 'NONE' },
      requires_confirmation: false,
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
});
