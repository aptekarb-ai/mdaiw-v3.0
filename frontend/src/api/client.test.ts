import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentUser, initializeCsrf, loginWithPassword, logout, requestAICommand, requestConstructionPlan,
  requestEmailBrief, requestLocalAIDiagnostics,
} from './client';

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

  it('requestAICommand posts to the AI Engineer endpoint and returns the parsed response', async () => {
    const fetchMock = mockFetchOnce({
      success: true,
      reply: 'I will add a button module.',
      action: { type: 'INSERT_MODULE', modules: [{ module_type: 'button', patch: {} }] },
      requires_confirmation: false,
      confidence: 0.9,
      provider: 'deterministic',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestAICommand({ message: 'add a button', selected_module: null });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/email-builder/ai-command/');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ message: 'add a button', selected_module: null });
    expect(result.action).toEqual({ type: 'INSERT_MODULE', modules: [{ module_type: 'button', patch: {} }] });
  });

  // D4-C
  it('requestEmailBrief posts document/message/attachment_ids to the brief endpoint', async () => {
    const fetchMock = mockFetchOnce({
      success: true,
      brief: {
        version: 1, platform: 'generic', purpose: null, audience: null,
        subject_suggestions: [], preheader_suggestions: [], sections: [], ctas: [], images: [],
        footer: null, personalization: [], conflicts: [], clarifications: [], warnings: [],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestEmailBrief({ document: 97, message: 'Create a promotional email.', attachmentIds: [1, 2] });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/email-builder/brief/');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      document: 97, message: 'Create a promotional email.', attachment_ids: [1, 2],
    });
    expect(result.brief.platform).toBe('generic');
  });

  it('requestEmailBrief defaults message and attachmentIds when omitted', async () => {
    const fetchMock = mockFetchOnce({
      success: true,
      brief: {
        version: 1, platform: 'generic', purpose: null, audience: null,
        subject_suggestions: [], preheader_suggestions: [], sections: [], ctas: [], images: [],
        footer: null, personalization: [], conflicts: [], clarifications: [], warnings: [],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestEmailBrief({ document: 5 });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ document: 5, message: '', attachment_ids: [] });
  });

  // D4-D
  it('requestConstructionPlan posts to the construction-plan endpoint and returns the ready-to-apply action', async () => {
    const fetchMock = mockFetchOnce({
      success: true,
      reply: 'I found 3 sections...',
      brief: {
        version: 1, platform: 'generic', purpose: null, audience: null, subject_suggestions: [], preheader_suggestions: [],
        sections: [], ctas: [], images: [], footer: null, personalization: [], conflicts: [], clarifications: [], warnings: [],
      },
      plan: { platform: 'generic', sections: [], platform_notes: [], warnings: [] },
      action: { type: 'COMPOSE_EMAIL', items: [{ module_type: 'header-logo-center', patch: {} }] },
      requires_confirmation: true,
      requires_strong_confirmation: false,
      provider: 'deterministic',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestConstructionPlan({
      document: 97, message: 'Create a promotional email for our sale.', attachmentIds: [1, 2],
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/email-builder/construction-plan/');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      document: 97, message: 'Create a promotional email for our sale.', attachment_ids: [1, 2],
    });
    expect(result.action.type).toBe('COMPOSE_EMAIL');
    expect(result.requires_confirmation).toBe(true);
  });

  it('requestConstructionPlan defaults message and attachmentIds when omitted', async () => {
    const fetchMock = mockFetchOnce({
      success: true, reply: '', brief: {
        version: 1, platform: 'generic', purpose: null, audience: null, subject_suggestions: [], preheader_suggestions: [],
        sections: [], ctas: [], images: [], footer: null, personalization: [], conflicts: [], clarifications: [], warnings: [],
      },
      plan: { platform: 'generic', sections: [], platform_notes: [], warnings: [] },
      action: { type: 'NONE' }, requires_confirmation: false, requires_strong_confirmation: false, provider: 'deterministic',
    });
    vi.stubGlobal('fetch', fetchMock);

    await requestConstructionPlan({ document: 5 });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ document: 5, message: '', attachment_ids: [] });
  });

  it('requestLocalAIDiagnostics gets the local-ai-diagnostics endpoint', async () => {
    const fetchMock = mockFetchOnce({
      success: true,
      diagnostics: {
        configured: false, reachable: false, runtime: null, model: null, configured_model_available: null,
        available_models: [], api_key_configured: false, capabilities: null, error: null,
        deterministic_fallback_ready: true,
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestLocalAIDiagnostics();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/email-builder/local-ai-diagnostics/');
    expect(options.method ?? 'GET').toBe('GET');
    expect(result.diagnostics.deterministic_fallback_ready).toBe(true);
  });
});
