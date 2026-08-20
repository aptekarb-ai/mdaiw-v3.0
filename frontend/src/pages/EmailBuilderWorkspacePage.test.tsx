import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailBuilderWorkspacePage } from './EmailBuilderWorkspacePage';
import * as client from '../api/client';
import type { EmailDocument } from '../emailbuilder/types';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, getEmailDocument: vi.fn(), updateEmailDocument: vi.fn() };
});

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

    await user.click(screen.getByRole('button', { name: 'Add Text' }));

    expect(screen.queryByText('Start building your email')).not.toBeInTheDocument();
    expect(screen.getByText('Add your heading or paragraph text here.', { selector: 'p' })).toBeInTheDocument();
  });

  it('selecting a module (adding auto-selects it) shows its properties and a contextual toolbar', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText('Select a module')).toBeInTheDocument();

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
    await user.click(await screen.findByRole('button', { name: 'Add Button' }));
    await user.click(screen.getByText('Shop Now'));

    await user.click(screen.getByRole('button', { name: /Duplicate/ }));

    expect(screen.getAllByText('Shop Now')).toHaveLength(2);
  });

  it('deleting a module removes it and returns to the empty state', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: /Delete/ }));

    expect(await screen.findByText('Start building your email')).toBeInTheDocument();
  });

  it('editing a property updates the canvas preview and marks the state dirty', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    const textField = screen.getByLabelText('Text');
    await user.clear(textField);
    await user.type(textField, 'Hello builder');

    expect(textField).toHaveValue('Hello builder');
    expect(screen.getByText('Hello builder', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('reorders modules via drag and drop', async () => {
    vi.mocked(client.getEmailDocument).mockResolvedValue(baseDocument());
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
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
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Save failed')).toBeInTheDocument();
    expect(screen.getByText('We could not save your changes. Please try again.')).toBeInTheDocument();
  });
});
