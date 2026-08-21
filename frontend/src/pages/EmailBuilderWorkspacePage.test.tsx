import { render, screen, waitFor, within } from '@testing-library/react';
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
    listSavedModules: vi.fn(),
    createSavedModule: vi.fn(),
    deleteSavedModule: vi.fn(),
  };
});

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

  it('outer spacing: setting left/right to 0 keeps the module full-width visually, non-zero applies a margin', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    const outerSection = screen.getAllByText('Outer Spacer Columns', { exact: false })[0].closest('.properties-panel__section') as HTMLElement;
    const outerLeft = within(outerSection).getByLabelText(/^Left/);
    const outerRight = within(outerSection).getByLabelText(/^Right/);
    const wrapper = () => document.querySelector('.email-canvas__module-outer-spacing') as HTMLElement;
    expect(wrapper().style.marginLeft).toBe('0px');

    await user.clear(outerLeft);
    await user.type(outerLeft, '20');
    await user.clear(outerRight);
    await user.type(outerRight, '20');

    expect(wrapper().style.marginLeft).toBe('20px');
    expect(wrapper().style.marginRight).toBe('20px');
  });

  it('outer spacer: Desktop and Mobile left/right are independent, with an inherit/override reset', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await openCategory(user, 'Content');
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    const outerSection = () => screen.getAllByText('Outer Spacer Columns', { exact: false })[0].closest('.properties-panel__section') as HTMLElement;
    const wrapper = () => document.querySelector('.email-canvas__module-outer-spacing') as HTMLElement;

    // Left/right start linked (both 0) — uncheck so 30/20 can differ.
    await user.click(within(outerSection()).getByRole('checkbox', { name: 'Link left/right values' }));

    // Desktop: left 30, right 20.
    let left = within(outerSection()).getByLabelText(/^Left Spacer/);
    let right = within(outerSection()).getByLabelText(/^Right Spacer/);
    await user.clear(left);
    await user.type(left, '30');
    await user.clear(right);
    await user.type(right, '20');
    expect(wrapper().style.marginLeft).toBe('30px');
    expect(wrapper().style.marginRight).toBe('20px');

    // Switch to Mobile — starts inherited (30/20), no reset button yet.
    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(within(outerSection()).queryByRole('button', { name: 'Use Desktop value' })).not.toBeInTheDocument();
    expect(wrapper().style.marginLeft).toBe('30px');
    expect(wrapper().style.marginRight).toBe('20px');

    // Override Mobile left only -> Mobile becomes 8 / 20 (right still inherited).
    left = within(outerSection()).getByLabelText(/^Left Spacer/);
    await user.clear(left);
    await user.type(left, '8');
    expect(wrapper().style.marginLeft).toBe('8px');
    expect(wrapper().style.marginRight).toBe('20px');

    // Desktop remains untouched.
    await user.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(wrapper().style.marginLeft).toBe('30px');
    expect(wrapper().style.marginRight).toBe('20px');

    // Back to Mobile — override persisted; reset it.
    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(wrapper().style.marginLeft).toBe('8px');
    const resetButton = within(outerSection()).getByRole('button', { name: 'Use Desktop value' });
    await user.click(resetButton);
    expect(wrapper().style.marginLeft).toBe('30px');
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
