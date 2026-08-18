import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getValidateStatus, startValidate, validateCode } from './landingpages';

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(body),
  });
}

describe('landingpages api', () => {
  beforeEach(() => {
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts to the validate endpoint with the provided payload', async () => {
    const report = {
      id: 1,
      project: null,
      version: null,
      duration_ms: 5,
      error_count: 0,
      warning_count: 0,
      info_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      issues: [],
    };
    const fetchMock = mockFetchOnce(report);
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateCode({ html: '<p>hi</p>', css: '', js: '', ampscript: '' });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/lp/validate/'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body as string)).toEqual({ html: '<p>hi</p>', css: '', js: '', ampscript: '' });
    expect(result).toEqual(report);
  });

  it('throws an ApiError with the envelope shape on a 400 validation error', async () => {
    const fetchMock = mockFetchOnce(
      { success: false, code: 'VALIDATION_ERROR', message: 'Please correct the highlighted fields.', errors: { html: ['This field is required.'] } },
      { ok: false, status: 400 },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateCode({ html: '' })).rejects.toMatchObject({
      message: 'Please correct the highlighted fields.',
      code: 'VALIDATION_ERROR',
      status: 400,
      errors: { html: ['This field is required.'] },
    });
  });

  it('throws a generic ApiError on network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateCode({ html: '<p>hi</p>' })).rejects.toMatchObject({
      message: 'We could not connect. Check your connection and try again.',
    });
  });

  it('throws a generic ApiError, not a crash, on a malformed non-JSON 500 response', async () => {
    // Regression test: an unhandled backend exception (e.g. an unmigrated
    // database) previously returned Django's raw HTML debug page here
    // instead of JSON — apiRequest must degrade to a safe generic message
    // rather than throwing while parsing or leaking the HTML body.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => '<!DOCTYPE html><html><body>OperationalError at /api/v1/lp/validate/</body></html>',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateCode({ html: '<p>hi</p>' })).rejects.toMatchObject({
      message: 'Something went wrong. Please try again.',
      status: 500,
    });
  });

  it('throws an ApiError with the envelope shape on a 401 authentication failure', async () => {
    const fetchMock = mockFetchOnce(
      { success: false, code: 'AUTHENTICATION_REQUIRED', message: 'Authentication credentials were not provided.' },
      { ok: false, status: 401 },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateCode({ html: '<p>hi</p>' })).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      status: 401,
    });
  });

  it('throws an ApiError with the envelope shape on a 403 permission failure', async () => {
    const fetchMock = mockFetchOnce(
      { success: false, code: 'PERMISSION_DENIED', message: 'You do not have permission to perform this action.' },
      { ok: false, status: 403 },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateCode({ html: '<p>hi</p>' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    });
  });

  it('throws an ApiError with the envelope shape on a 404 not-found response', async () => {
    const fetchMock = mockFetchOnce(
      { success: false, code: 'NOT_FOUND', message: 'Not found.' },
      { ok: false, status: 404 },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateCode({ html: '<p>hi</p>' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('throws an ApiError with the envelope shape on a structured 500 failure', async () => {
    const fetchMock = mockFetchOnce(
      { success: false, code: 'VALIDATION_FAILED', message: 'Validation could not be completed. Please try again.', request_id: 'abc123' },
      { ok: false, status: 500 },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateCode({ html: '<p>hi</p>' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 500,
      message: 'Validation could not be completed. Please try again.',
    });
  });

  describe('AI Validate Code Live Progress', () => {
    it('posts to the validate/start endpoint with the payload and operation_id', async () => {
      const fetchMock = mockFetchOnce({ operation_id: 'op-1', status: 'running' }, { status: 202 });
      vi.stubGlobal('fetch', fetchMock);

      const result = await startValidate({ html: '<p>hi</p>', css: '', js: '', ampscript: '', operation_id: 'op-1' });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/lp/validate/start/'),
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
      const [, options] = fetchMock.mock.calls[0];
      expect(JSON.parse(options.body as string)).toEqual({
        html: '<p>hi</p>', css: '', js: '', ampscript: '', operation_id: 'op-1',
      });
      expect(result).toEqual({ operation_id: 'op-1', status: 'running' });
    });

    it('gets the validate/status endpoint for the given operation_id', async () => {
      const operation = {
        operation_id: 'op-1', status: 'completed', stage: 'finalizing',
        stage_label: 'Finalizing validation report…', percent: 100,
        total_stages: 8, completed_stages: 8, stage_checklist: {},
        response_body: null, response_status: 201, failure_reason: null,
      };
      const fetchMock = mockFetchOnce(operation);
      vi.stubGlobal('fetch', fetchMock);

      const result = await getValidateStatus('op-1');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/lp/validate/status/op-1/'),
        expect.anything(),
      );
      expect(result).toEqual(operation);
    });

    it('URL-encodes the operation_id in the status request', async () => {
      const fetchMock = mockFetchOnce({ operation_id: 'a/b c', status: 'running' });
      vi.stubGlobal('fetch', fetchMock);

      await getValidateStatus('a/b c');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/lp/validate/status/a%2Fb%20c/'),
        expect.anything(),
      );
    });

    it('throws an ApiError with OPERATION_ID_REQUIRED shape when the backend rejects a missing id', async () => {
      const fetchMock = mockFetchOnce(
        { success: false, code: 'OPERATION_ID_REQUIRED', message: 'operation_id is required to start a trackable validation.' },
        { ok: false, status: 400 },
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(startValidate({ html: '<p>hi</p>', operation_id: '' })).rejects.toMatchObject({
        code: 'OPERATION_ID_REQUIRED', status: 400,
      });
    });
  });
});
