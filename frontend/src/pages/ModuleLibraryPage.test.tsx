import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams, useSearchParams } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ModuleLibraryPage } from './ModuleLibraryPage';
import * as client from '../api/client';
import type { EmailDocument, SavedEmailModule } from '../emailbuilder/types';
import { createResponsiveSettings } from '../emailbuilder/registryCore';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    listSavedModules: vi.fn(),
    deleteSavedModule: vi.fn(),
    createEmailDocument: vi.fn(),
    listEmailDocuments: vi.fn(),
  };
});

function BuilderProbe() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  return (
    <div>
      Builder for {id}, insertModuleType={searchParams.get('insertModuleType') ?? 'none'},
      insertSavedModuleId={searchParams.get('insertSavedModuleId') ?? 'none'}
    </div>
  );
}

function doc(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    id: 42, name: 'Untitled Email', platform: 'generic', width: 700,
    start_type: 'blank', status: 'draft', content: { version: 1, modules: [] },
    email_title: '', email_subject: '', favicon_url: '',
    reset_css_enabled: true, custom_css_enabled: false, custom_css: '',
    created_at: '2026-08-20T10:00:00Z', updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function savedModule(overrides: Partial<SavedEmailModule> = {}): SavedEmailModule {
  return {
    id: 5,
    name: 'My Header',
    module_type: 'header-logo-center',
    props: { logoSrc: '', logoAlt: 'Logo', logoWidth: 160 },
    settings: createResponsiveSettings({ paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 }),
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function renderPage(existingEmails: EmailDocument[] = [doc()]) {
  vi.mocked(client.listEmailDocuments).mockResolvedValue(existingEmails);
  return render(
    <MemoryRouter initialEntries={['/email-builder/modules']}>
      <Routes>
        <Route path="/email-builder/modules" element={<ModuleLibraryPage />} />
        <Route path="/email-builder/builder/:id" element={<BuilderProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

// The full catalog reveals only its first 24 results at a time — search
// for the exact module first (real user behavior anyway) so "Add Text"
// is reliably present regardless of catalog ordering/size.
async function searchForText(user: ReturnType<typeof userEvent.setup>) {
  const search = await screen.findByRole('searchbox', { name: 'Search all modules' });
  await user.type(search, 'Text');
}

describe('ModuleLibraryPage', () => {
  it('browses built-in modules with no email open', async () => {
    vi.mocked(client.listSavedModules).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Browse All Modules' })).toBeInTheDocument();
    await searchForText(user);
    expect(await screen.findByRole('button', { name: 'Add Text' })).toBeInTheDocument();
  });

  it('deletes a saved module without needing an open document', async () => {
    vi.mocked(client.listSavedModules).mockResolvedValue([savedModule()]);
    vi.mocked(client.deleteSavedModule).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Saved Modules' }));
    await user.click(screen.getByRole('button', { name: 'Delete saved module My Header' }));
    await waitFor(() => expect(client.deleteSavedModule).toHaveBeenCalledWith(5));
  });

  it('clicking a built-in module opens the choose-email handoff instead of silently no-opping', async () => {
    vi.mocked(client.listSavedModules).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await searchForText(user);
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    expect(await screen.findByRole('heading', { name: /Use Text in an email/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a blank email and insert here' })).toBeInTheDocument();
  });

  it('choosing an existing email inserts through the existing builder mutation path (deep link)', async () => {
    vi.mocked(client.listSavedModules).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage([doc()]);
    await searchForText(user);
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(await screen.findByRole('button', { name: 'Insert here' }));
    await waitFor(() => expect(
      screen.getByText('Builder for 42, insertModuleType=text, insertSavedModuleId=none'),
    ).toBeInTheDocument());
  });

  it('"Start a blank email" creates a document then deep-links the insertion', async () => {
    vi.mocked(client.listSavedModules).mockResolvedValue([]);
    vi.mocked(client.createEmailDocument).mockResolvedValue(doc({ id: 99 }));
    const user = userEvent.setup();
    renderPage([]);
    await searchForText(user);
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(await screen.findByRole('button', { name: 'Start a blank email and insert here' }));
    await waitFor(() => expect(
      screen.getByText('Builder for 99, insertModuleType=text, insertSavedModuleId=none'),
    ).toBeInTheDocument());
    expect(client.createEmailDocument).toHaveBeenCalledWith(expect.objectContaining({ start_type: 'blank' }));
  });

  it('cancelling the choose-email handoff returns to the library', async () => {
    vi.mocked(client.listSavedModules).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await searchForText(user);
    await user.click(await screen.findByRole('button', { name: 'Add Text' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Browse All Modules' })).toBeInTheDocument();
  });
});
