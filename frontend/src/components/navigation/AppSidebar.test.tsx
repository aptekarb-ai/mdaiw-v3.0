import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSidebar } from './AppSidebar';
import { useAuth } from '../../hooks/useAuth';
import { useYukti } from '../../hooks/useYukti';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../hooks/useYukti', () => ({
  useYukti: vi.fn(),
}));

beforeEach(() => {
  window.localStorage.clear();
});

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
      'Personal Finance', 'AI Assistants', 'Reports', 'Administration', 'Settings',
    ];
    for (const label of existingLabels) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }

    expect(screen.getByRole('button', { name: 'Landing Pages Builder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI Email Builder' })).toBeInTheDocument();
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

describe('AppSidebar AI Email Builder navigation', () => {
  it('does not show the Email Dashboard child until the group is expanded', () => {
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    expect(screen.queryByRole('link', { name: 'Email Dashboard' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'AI Email Builder' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands the group on click and shows Email Dashboard with the correct route', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'AI Email Builder' }));

    expect(screen.getByRole('button', { name: 'AI Email Builder' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Email Dashboard' })).toHaveAttribute('href', '/email-builder');
  });

  it('collapses the group again on a second click', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    const toggle = screen.getByRole('button', { name: 'AI Email Builder' });
    await user.click(toggle);
    expect(screen.getByRole('link', { name: 'Email Dashboard' })).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByRole('link', { name: 'Email Dashboard' })).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays expanded and marks both the parent and Email Dashboard active when /email-builder is current', () => {
    mockAuthenticated();
    renderSidebarAt('/email-builder');

    const toggle = screen.getByRole('button', { name: 'AI Email Builder' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.className).toContain('app-sidebar__link--active');
    expect(screen.getByRole('link', { name: 'Email Dashboard' }).className).toContain(
      'app-sidebar__link--active',
    );
  });

  it('is keyboard-operable via Enter/Space on the toggle button', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    const toggle = screen.getByRole('button', { name: 'AI Email Builder' });
    toggle.focus();
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Email Dashboard' })).toBeInTheDocument();
  });

  it('renders the not-yet-implemented children as disabled, non-navigable entries', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'AI Email Builder' }));

    const futureLabels = [
      'Create Email', 'My Emails', 'Templates', 'Module Library',
      'Assets / Brand Kit', 'Preview & Validation', 'AI Engineer',
    ];
    for (const label of futureLabels) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
      const entry = screen.getByText(label).closest('span');
      expect(entry).toHaveAttribute('aria-disabled', 'true');
      expect(entry).toHaveAttribute('title', 'Coming soon');
    }
  });
});

describe('AppSidebar module group accordion', () => {
  it('opening AI Email Builder collapses an already-open Landing Pages Builder', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Landing Pages Builder' }));
    expect(screen.getByRole('link', { name: 'LP Builder' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'AI Email Builder' }));
    expect(screen.getByRole('button', { name: 'AI Email Builder' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Landing Pages Builder' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'LP Builder' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Email Dashboard' })).toBeInTheDocument();
  });

  it('opening Landing Pages Builder collapses an already-open AI Email Builder', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'AI Email Builder' }));
    expect(screen.getByRole('link', { name: 'Email Dashboard' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Landing Pages Builder' }));
    expect(screen.getByRole('button', { name: 'Landing Pages Builder' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'AI Email Builder' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Email Dashboard' })).not.toBeInTheDocument();
  });

  it('auto-expands AI Email Builder (and keeps Landing Pages Builder closed) when /email-builder is current', () => {
    mockAuthenticated();
    renderSidebarAt('/email-builder');

    expect(screen.getByRole('button', { name: 'AI Email Builder' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Landing Pages Builder' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'Email Dashboard' })).toBeInTheDocument();
  });

  it('auto-expands Landing Pages Builder (and keeps AI Email Builder closed) when a Module-3 route is current', () => {
    mockAuthenticated();
    renderSidebarAt('/module-3/validator');

    expect(screen.getByRole('button', { name: 'Landing Pages Builder' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'AI Email Builder' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'LP Validator & AI Fixer' })).toBeInTheDocument();
  });
});

describe('AppSidebar collapsed icon-only rail', () => {
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });
  });

  it('collapses the rail on toggle click and marks the control pressed', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    const toggle = screen.getByRole('button', { name: 'Collapse navigation' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('persists the collapsed preference and restores it on remount', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    const { unmount } = renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(window.localStorage.getItem('mdaiw.sidebar.collapsed')).toBe('true');

    unmount();
    renderSidebarAt('/dashboard');
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens a flyout with the module children when a group icon is clicked while collapsed', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    const trigger = screen.getByRole('button', { name: 'AI Email Builder' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Email Dashboard' })).toHaveAttribute('href', '/email-builder');
  });

  it('marks the active child inside the flyout when its route is current', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/email-builder');

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    await user.click(screen.getByRole('button', { name: 'AI Email Builder' }));

    expect(screen.getByRole('link', { name: 'Email Dashboard' }).className).toContain(
      'app-sidebar__link--active',
    );
  });

  it('renders disabled future children inside the flyout as non-navigable', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    await user.click(screen.getByRole('button', { name: 'AI Email Builder' }));

    expect(screen.queryByRole('link', { name: 'Create Email' })).not.toBeInTheDocument();
    const entry = screen.getByText('Create Email').closest('span');
    expect(entry).toHaveAttribute('aria-disabled', 'true');
    expect(entry).toHaveAttribute('title', 'Coming soon');
  });

  it('closes the flyout on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    const trigger = screen.getByRole('button', { name: 'AI Email Builder' });
    await user.click(trigger);
    expect(screen.getByRole('link', { name: 'Email Dashboard' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('link', { name: 'Email Dashboard' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes the flyout when clicking outside it', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    await user.click(screen.getByRole('button', { name: 'AI Email Builder' }));
    expect(screen.getByRole('link', { name: 'Email Dashboard' })).toBeInTheDocument();

    await user.click(document.body);
    expect(screen.queryByRole('link', { name: 'Email Dashboard' })).not.toBeInTheDocument();
  });

  it('keeps Logout reachable and keyboard-operable while collapsed', async () => {
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    const logoutButton = screen.getByRole('button', { name: 'Logout' });
    logoutButton.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Log out of MDAIW?')).toBeInTheDocument();
  });

  it('ignores a persisted collapsed preference on narrow (mobile/tablet) viewports', async () => {
    window.localStorage.setItem('mdaiw.sidebar.collapsed', 'true');
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 480 });
    const user = userEvent.setup();
    mockAuthenticated();
    renderSidebarAt('/dashboard');

    await user.click(screen.getByRole('button', { name: 'AI Email Builder' }));
    expect(screen.getByRole('link', { name: 'Email Dashboard' })).toBeInTheDocument();
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
