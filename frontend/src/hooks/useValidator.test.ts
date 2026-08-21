import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useValidator } from './useValidator';
import { getValidateStatus, startValidate } from '../api/landingpages';
import type { ValidateOperationStatus, ValidationReport } from '../types/landingpages';

vi.mock('../api/landingpages', () => ({
  startValidate: vi.fn(),
  getValidateStatus: vi.fn(),
}));

function report(overrides: Partial<ValidationReport> = {}): ValidationReport {
  return {
    id: 1, project: null, version: null, duration_ms: 5,
    profile: 'standard', validation_scope: 'complete', css_source_type: 'css', engine_status: [],
    error_count: 0, warning_count: 0, info_count: 0,
    created_at: '2026-01-01T00:00:00Z', issues: [],
    ...overrides,
  };
}

function operation(overrides: Partial<ValidateOperationStatus> = {}): ValidateOperationStatus {
  return {
    operation_id: 'op-1', status: 'completed', stage: 'finalizing',
    stage_label: 'Finalizing validation report…', percent: 100,
    total_stages: 8, completed_stages: 8,
    stage_checklist: {
      preparing: 'done', validating_html: 'done', validating_css: 'done', validating_js: 'done',
      validating_ampscript: 'done', ai_analysis: 'done', normalizing: 'done', finalizing: 'done',
    },
    response_body: null, response_status: 201, failure_reason: null,
    ...overrides,
  };
}

describe('useValidator', () => {
  beforeEach(() => {
    vi.mocked(startValidate).mockReset();
    vi.mocked(getValidateStatus).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts idle', () => {
    const { result } = renderHook(() => useValidator());
    expect(result.current.status).toBe('idle');
    expect(result.current.report).toBeNull();
    expect(result.current.operation).toBeNull();
  });

  it('resolves to success with the completed operation response_body on the first poll', async () => {
    vi.mocked(startValidate).mockResolvedValue({ operation_id: 'op-1', status: 'running' });
    const finalReport = report({ error_count: 1 });
    vi.mocked(getValidateStatus).mockResolvedValue(operation({ response_body: finalReport }));

    const { result } = renderHook(() => useValidator());
    await act(async () => {
      await result.current.validate({ html: '<p>hi</p>', css: '', js: '', ampscript: '', validation_scope: 'complete', css_source_type: 'css' });
    });

    expect(result.current.status).toBe('success');
    expect(result.current.report).toEqual(finalReport);
    expect(startValidate).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<p>hi</p>', operation_id: expect.any(String) }),
      expect.anything(),
    );
  });

  it('exposes live operation status while running, before the final poll resolves', async () => {
    vi.mocked(startValidate).mockResolvedValue({ operation_id: 'op-1', status: 'running' });
    let resolveSecondPoll: (value: ValidateOperationStatus) => void = () => {};
    vi.mocked(getValidateStatus)
      .mockResolvedValueOnce(operation({ status: 'running', stage: 'validating_html', percent: 20 }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecondPoll = resolve; }));

    const { result } = renderHook(() => useValidator());
    let validatePromise!: Promise<void>;
    act(() => {
      validatePromise = result.current.validate({ html: '<p>hi</p>', css: '', js: '', ampscript: '', validation_scope: 'html', css_source_type: 'css' });
    });

    await waitFor(() => expect(result.current.operation?.percent).toBe(20));
    expect(result.current.status).toBe('validating');

    await act(async () => {
      resolveSecondPoll(operation({ response_body: report() }));
      await validatePromise;
    });
    expect(result.current.status).toBe('success');
  });

  it('sets an error state when the operation completes with status failed', async () => {
    vi.mocked(startValidate).mockResolvedValue({ operation_id: 'op-1', status: 'running' });
    vi.mocked(getValidateStatus).mockResolvedValue(operation({
      status: 'failed', failure_reason: 'Validation could not be completed.',
      response_body: { success: false, code: 'VALIDATION_FAILED', message: 'Validation could not be completed.' },
      response_status: 500,
    }));

    const { result } = renderHook(() => useValidator());
    await act(async () => {
      await result.current.validate({ html: '<p>hi</p>', css: '', js: '', ampscript: '', validation_scope: 'html', css_source_type: 'css' });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('Validation could not be completed.');
  });

  it('sets an error state when starting the operation itself rejects', async () => {
    vi.mocked(startValidate).mockRejectedValue({ message: 'We could not connect. Check your connection and try again.' });

    const { result } = renderHook(() => useValidator());
    await act(async () => {
      await result.current.validate({ html: '<p>hi</p>', css: '', js: '', ampscript: '', validation_scope: 'html', css_source_type: 'css' });
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('We could not connect. Check your connection and try again.');
  });

  it('reset() clears report, error, status, and operation back to idle', async () => {
    vi.mocked(startValidate).mockResolvedValue({ operation_id: 'op-1', status: 'running' });
    vi.mocked(getValidateStatus).mockResolvedValue(operation({ response_body: report() }));

    const { result } = renderHook(() => useValidator());
    await act(async () => {
      await result.current.validate({ html: '<p>hi</p>', css: '', js: '', ampscript: '', validation_scope: 'html', css_source_type: 'css' });
    });
    expect(result.current.status).toBe('success');

    act(() => { result.current.reset(); });

    expect(result.current.status).toBe('idle');
    expect(result.current.report).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.operation).toBeNull();
  });

  it('applyExternalReport sets success state directly without starting a new operation', () => {
    const { result } = renderHook(() => useValidator());
    const externalReport = report({ error_count: 2 });

    act(() => { result.current.applyExternalReport(externalReport); });

    expect(result.current.status).toBe('success');
    expect(result.current.report).toEqual(externalReport);
    expect(result.current.operation).toBeNull();
    expect(startValidate).not.toHaveBeenCalled();
  });

  it('a stale validate() call superseded by a newer one never overwrites the newer result', async () => {
    vi.mocked(startValidate).mockResolvedValue({ operation_id: 'op-stale', status: 'running' });
    let resolveStalePoll: (value: ValidateOperationStatus) => void = () => {};
    vi.mocked(getValidateStatus).mockImplementation((operationId: string) => {
      if (operationId === 'op-stale') {
        return new Promise((resolve) => { resolveStalePoll = resolve; });
      }
      return Promise.resolve(operation({ response_body: report({ id: 2 }) }));
    });
    // First call's operation_id is 'op-stale' via startValidate's mocked
    // resolved value above; give the SECOND call a different id so the
    // mock can distinguish them.
    vi.mocked(startValidate).mockResolvedValueOnce({ operation_id: 'op-stale', status: 'running' });
    vi.mocked(startValidate).mockResolvedValueOnce({ operation_id: 'op-fresh', status: 'running' });

    const { result } = renderHook(() => useValidator());
    let stalePromise!: Promise<void>;
    act(() => {
      stalePromise = result.current.validate({ html: 'stale', css: '', js: '', ampscript: '', validation_scope: 'html', css_source_type: 'css' });
    });
    await act(async () => {
      await result.current.validate({ html: 'fresh', css: '', js: '', ampscript: '', validation_scope: 'html', css_source_type: 'css' });
    });

    expect(result.current.status).toBe('success');
    expect(result.current.report).toEqual(report({ id: 2 }));

    // The stale call's own poll can resolve later — it must not clobber
    // the fresh result.
    await act(async () => {
      resolveStalePoll(operation({ response_body: report({ id: 999 }) }));
      await stalePromise;
    });
    expect(result.current.report).toEqual(report({ id: 2 }));
  });
});
