import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentUser, initializeCsrf, loginWithPassword, logout } from './client';

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(body),
  });
}

describe('api client', () => {
  beforeEach(() => {
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializeCsrf calls the csrf endpoint with credentials included', async () => {
    const fetchMock = mockFetchOnce({ success: true, message: 'CSRF cookie set.' });
    vi.stubGlobal('fetch', fetchMock);

    await initializeCsrf();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/auth/csrf/'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sends X-CSRFToken header on login when csrftoken cookie is present', async () => {
    document.cookie = 'csrftoken=test-token-value';
    const fetchMock = mockFetchOnce({
      success: true,
      message: 'Signed in successfully.',
      user: { id: 1, username: 'jane', email: '', first_name: '', last_name: '' },
    });
    vi.stubGlobal('fetch', fetchMock);

    await loginWithPassword({ username: 'jane', password: 'secret' });

    const [, options] = fetchMock.mock.calls[0];
    const headers = options.headers as Headers;
    expect(headers.get('X-CSRFToken')).toBe('test-token-value');
  });

  it('throws an ApiError with the server message on failed login', async () => {
    const fetchMock = mockFetchOnce(
      { success: false, code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' },
      { ok: false, status: 401 },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(loginWithPassword({ username: 'jane', password: 'wrong' })).rejects.toMatchObject({
      message: 'Invalid username or password.',
      code: 'INVALID_CREDENTIALS',
      status: 401,
    });
  });

  it('getCurrentUser returns the parsed response', async () => {
    const fetchMock = mockFetchOnce({ authenticated: false, user: null });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCurrentUser();

    expect(result).toEqual({ authenticated: false, user: null });
  });

  it('logout posts to the logout endpoint', async () => {
    const fetchMock = mockFetchOnce({ success: true, message: 'Signed out successfully.' });
    vi.stubGlobal('fetch', fetchMock);

    await logout();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/auth/logout/');
    expect(options.method).toBe('POST');
  });
});
