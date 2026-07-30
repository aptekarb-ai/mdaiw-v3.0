import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthProvider';
import { useAuth } from '../hooks/useAuth';
import * as apiClient from '../api/client';

vi.mock('../api/client', () => ({
  initializeCsrf: vi.fn(),
  getCurrentUser: vi.fn(),
  loginWithPassword: vi.fn(),
  logout: vi.fn(),
}));

function Probe() {
  const { status, user, error, login, logout: doLogout } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="username">{user?.username ?? ''}</span>
      <span data-testid="error">{error ?? ''}</span>
      <button onClick={() => login({ username: 'jane', password: 'secret' }).catch(() => {})}>
        login
      </button>
      <button onClick={() => doLogout()}>logout</button>
    </div>
  );
}

describe('AuthProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts in loading state, then resolves to unauthenticated', async () => {
    vi.mocked(apiClient.initializeCsrf).mockResolvedValue(undefined);
    vi.mocked(apiClient.getCurrentUser).mockResolvedValue({ authenticated: false, user: null });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('status').textContent).toBe('loading');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
  });

  it('restores an authenticated session on startup', async () => {
    vi.mocked(apiClient.initializeCsrf).mockResolvedValue(undefined);
    vi.mocked(apiClient.getCurrentUser).mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: 'jane', email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe' },
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
    expect(screen.getByTestId('username').textContent).toBe('jane');
  });

  it('sets an error message on failed login', async () => {
    vi.mocked(apiClient.initializeCsrf).mockResolvedValue(undefined);
    vi.mocked(apiClient.getCurrentUser).mockResolvedValue({ authenticated: false, user: null });
    vi.mocked(apiClient.loginWithPassword).mockRejectedValue({
      message: 'Invalid username or password.',
      code: 'INVALID_CREDENTIALS',
      status: 401,
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));

    await act(async () => {
      screen.getByText('login').click();
    });

    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toBe('Invalid username or password.'),
    );
  });

  it('clears user state on logout', async () => {
    vi.mocked(apiClient.initializeCsrf).mockResolvedValue(undefined);
    vi.mocked(apiClient.getCurrentUser).mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: 'jane', email: '', first_name: '', last_name: '' },
    });
    vi.mocked(apiClient.logout).mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    await act(async () => {
      screen.getByText('logout').click();
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(screen.getByTestId('username').textContent).toBe('');
  });
});
