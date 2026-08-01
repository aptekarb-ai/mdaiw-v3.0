import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { useAuth } from '../hooks/useAuth';

vi.mock('../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

const REMEMBERED_USERNAME_KEY = 'mdaiw.rememberedUsername';

function renderLoginPage(authOverrides: Partial<ReturnType<typeof useAuth>> = {}) {
  const login = authOverrides.login ?? vi.fn().mockResolvedValue(undefined);
  const clearError = authOverrides.clearError ?? vi.fn();

  vi.mocked(useAuth).mockReturnValue({
    status: 'unauthenticated',
    user: null,
    error: null,
    login,
    logout: vi.fn(),
    clearError,
    setAuthenticatedUser: vi.fn(),
    ...authOverrides,
  });

  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>Dashboard content</div>} />
        <Route path="/face-login" element={<div>Face login page</div>} />
      </Routes>
    </MemoryRouter>,
  );

  return { login };
}

describe('LoginPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login form', () => {
    renderLoginPage();
    expect(screen.getByRole('heading', { name: 'Sign in to Digital AI Workspace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('shows a required error when username is empty', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(screen.getByRole('button', { name: /Sign In/ }));

    expect(await screen.findByText('Username is required.')).toBeInTheDocument();
  });

  it('shows a required error when password is empty', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText('Username'), 'jane.doe');
    await user.click(screen.getByRole('button', { name: /Sign In/ }));

    expect(await screen.findByText('Password is required.')).toBeInTheDocument();
  });

  it('toggles password visibility while preserving the value', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    await user.type(passwordInput, 'secret123');
    expect(passwordInput.type).toBe('password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput.type).toBe('text');
    expect(passwordInput.value).toBe('secret123');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput.type).toBe('password');
    expect(passwordInput.value).toBe('secret123');
  });

  it('prefills the remembered username from localStorage', () => {
    window.localStorage.setItem(REMEMBERED_USERNAME_KEY, 'remembered.user');
    renderLoginPage();
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('remembered.user');
    expect((screen.getByLabelText('Remember my username') as HTMLInputElement).checked).toBe(true);
  });

  it('removes the remembered username after a successful login with the box unchecked', async () => {
    window.localStorage.setItem(REMEMBERED_USERNAME_KEY, 'remembered.user');
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(undefined);
    renderLoginPage({ login });

    await user.click(screen.getByLabelText('Remember my username'));
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /Sign In/ }));

    await waitFor(() => expect(login).toHaveBeenCalled());
    await waitFor(() =>
      expect(window.localStorage.getItem(REMEMBERED_USERNAME_KEY)).toBeNull(),
    );
  });

  it('navigates to /dashboard after a successful login', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(undefined);
    renderLoginPage({ login });

    await user.type(screen.getByLabelText('Username'), 'jane.doe');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /Sign In/ }));

    expect(await screen.findByText('Dashboard content')).toBeInTheDocument();
  });

  it('navigates to /face-login when Sign in with Face Recognition is clicked', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.click(screen.getByRole('button', { name: /Sign in with Face Recognition/ }));

    expect(await screen.findByText('Face login page')).toBeInTheDocument();
  });

  it('shows the server error message on invalid credentials', () => {
    renderLoginPage({ error: 'Invalid username or password.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid username or password.');
  });

  it('prevents duplicate submission while a request is in flight', async () => {
    const user = userEvent.setup();
    let resolveLogin: () => void = () => {};
    const login = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    renderLoginPage({ login });

    await user.type(screen.getByLabelText('Username'), 'jane.doe');
    await user.type(screen.getByLabelText('Password'), 'secret123');

    const submitButton = screen.getByRole('button', { name: /Sign In/ });
    await user.click(submitButton);
    expect(submitButton).toBeDisabled();

    await user.click(submitButton);
    expect(login).toHaveBeenCalledTimes(1);

    resolveLogin();
    expect(await screen.findByText('Dashboard content')).toBeInTheDocument();
  });

  it('never stores the password in localStorage', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(undefined);
    renderLoginPage({ login });

    await user.type(screen.getByLabelText('Username'), 'jane.doe');
    await user.type(screen.getByLabelText('Password'), 'super-secret');
    await user.click(screen.getByRole('button', { name: /Sign In/ }));

    await waitFor(() => expect(login).toHaveBeenCalled());

    const storedValues = Object.values(window.localStorage).join(' ');
    expect(storedValues).not.toContain('super-secret');
  });
});
