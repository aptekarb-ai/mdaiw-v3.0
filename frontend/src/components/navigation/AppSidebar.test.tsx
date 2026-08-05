import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppSidebar } from './AppSidebar';
import { useAuth } from '../../hooks/useAuth';
import { useYukti } from '../../hooks/useYukti';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../hooks/useYukti', () => ({
  useYukti: vi.fn(),
}));

function mockAuthenticated() {
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

function renderSidebarAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<AppSidebar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppSidebar navigation', () => {
  it('renders every top-level entry, including the Landing Pages Builder group toggle', () => {
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    const existingLabels = [
      'Dashboard', 'Employees', 'Performance', 'Recognition',
      'Email Builder', 'Personal Finance',
      'AI Assistants', 'Reports', 'Administration', 'Settings',
    ];
    for (const label of existingLabels) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }

    expect(screen.getByRole('button', { name: 'Landing Pages Builder' })).toBeInTheDocument();
  });

  it('does not show the three Landing Pages Builder children until the group is expanded', () => {
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    expect(screen.queryByRole('link', { name: 'LP Validator & AI Fixer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'LP Builder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AI LP Generator' })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Landing Pages Builder' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands the group on click and shows all three children with correct routes', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Landing Pages Builder' }));

    expect(screen.getByRole('button', { name: 'Landing Pages Builder' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'LP Validator & AI Fixer' })).toHaveAttribute(
      'href', '/module-3/validator',
    );
    expect(screen.getByRole('link', { name: 'LP Builder' })).toHaveAttribute('href', '/module-3/builder');
    expect(screen.getByRole('link', { name: 'AI LP Generator' })).toHaveAttribute('href', '/module-3/generator');
  });

  it('collapses the group again on a second click', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    const toggle = screen.getByRole('button', { name: 'Landing Pages Builder' });
    await user.click(toggle);
    expect(screen.getByRole('link', { name: 'LP Builder' })).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByRole('link', { name: 'LP Builder' })).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays expanded and marks both the parent and the child active when a child route is current', () => {
    mockAuthenticated();
    renderSidebarAt('/module-3/validator');

    const toggle = screen.getByRole('button', { name: 'Landing Pages Builder' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.className).toContain('app-sidebar__link--active');
    expect(screen.getByRole('link', { name: 'LP Validator & AI Fixer' }).className).toContain(
      'app-sidebar__link--active',
    );
  });

  it('is keyboard-operable via Enter/Space on the toggle button', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    const toggle = screen.getByRole('button', { name: 'Landing Pages Builder' });
    toggle.focus();
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'LP Builder' })).toBeInTheDocument();
  });
});

describe('AppSidebar logout', () => {
  it('confirms and logs the user out, navigating to /login', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { id: 1, username: 'jane', email: '', first_name: '', last_name: '' },
      error: null,
      login: vi.fn(),
      logout,
      clearError: vi.fn(),
      setAuthenticatedUser: vi.fn(),
    });
    vi.mocked(useYukti).mockReturnValue({ open: vi.fn() } as unknown as ReturnType<typeof useYukti>);

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<AppSidebar />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(screen.getByText('Log out of MDAIW?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Log Out' }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});
