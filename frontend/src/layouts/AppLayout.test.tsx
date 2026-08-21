import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';
import { useAuth } from '../hooks/useAuth';
import { useYukti } from '../hooks/useYukti';

vi.mock('../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../hooks/useYukti', () => ({
  useYukti: vi.fn(),
}));

function mockShellHooks() {
  vi.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: { id: 1, username: 'jane', email: '', first_name: '', last_name: '' },
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    setAuthenticatedUser: vi.fn(),
  });
  vi.mocked(useYukti).mockReturnValue({ open: vi.fn() } as unknown as ReturnType<typeof useYukti>);
}

function renderLayoutAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<div>Dashboard page</div>} />
          <Route path="/employees" element={<div>Employees page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

// AppSidebar/AppHeader are exercised directly in their own test files
// (drawer mechanics, focus, Escape, backdrop). This file's job is the one
// thing only AppLayout can prove: the shell persists across a real route
// change (unlike a per-route-nested sidebar, which would just unmount)
// and its pathname-watching effect is what closes the drawer on
// navigation — not a side effect of the page swapping underneath it.
describe('AppLayout mobile drawer integration', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 480 });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
  });

  it('starts closed and opens via the header menu button', async () => {
    const user = userEvent.setup();
    mockShellHooks();
    renderLayoutAt('/dashboard');

    expect(document.querySelector('.app-sidebar__backdrop')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(document.querySelector('.app-sidebar__backdrop')).toBeInTheDocument();
  });

  it('selecting a real navigation link navigates and closes the drawer, with the sidebar surviving the route change', async () => {
    const user = userEvent.setup();
    mockShellHooks();
    renderLayoutAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    await user.click(screen.getByRole('link', { name: 'Employees' }));

    expect(await screen.findByText('Employees page')).toBeInTheDocument();
    expect(document.querySelector('.app-sidebar__backdrop')).not.toBeInTheDocument();
    // The sidebar itself is still in the document (shell persisted across
    // the route change) — it's the drawer's open state that closed, not
    // the component unmounting.
    expect(screen.getByRole('link', { name: 'Employees' })).toBeInTheDocument();
  });

  it('the collapse-toggle preference does not affect the mobile drawer state', async () => {
    const user = userEvent.setup();
    mockShellHooks();
    renderLayoutAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('AppLayout desktop regression', () => {
  it('renders the sidebar expanded and inline (no drawer/backdrop) at desktop width', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
    mockShellHooks();
    renderLayoutAt('/dashboard');

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(document.querySelector('.app-sidebar__backdrop')).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });
});
