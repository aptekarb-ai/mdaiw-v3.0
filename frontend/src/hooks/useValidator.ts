import { useCallback, useRef, useState } from 'react';
import { getValidateStatus, startValidate } from '../api/landingpages';
import type { ApiError } from '../types/auth';
import type { ValidateOperationStatus, ValidateRequest, ValidationReport } from '../types/landingpages';

export type ValidatorStatus = 'idle' | 'validating' | 'success' | 'error';

// AI Validate Code Live Progress sprint — `validate()` keeps its original
// external contract (resolves once `report`/`status` are set) so every
// existing caller (initial load, post-fix revalidation, etc.) needs no
// changes; internally it now starts a trackable background operation and
// polls it (spec section 21-25), exposing live progress via `operation`
// for the right-panel progress UI. Strictly read-only exactly like the
// synchronous call it replaces — polling never mutates source.
export function useValidator() {
  const [status, setStatus] = useState<ValidatorStatus>('idle');
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [operation, setOperation] = useState<ValidateOperationStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const validate = useCallback(async (payload: ValidateRequest) => {
    abortRef.current?.abort();
    // `controller` is captured in THIS call's own closure — checking
    // `controller.signal.aborted` below (rather than some shared ref)
    // correctly tells an old, superseded call apart from the current
    // one even if a newer validate() call has since replaced
    // `abortRef.current` with its own controller.
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('validating');
    setError(null);
    setOperation(null);

    const operationId = crypto.randomUUID();
    try {
      await startValidate({ ...payload, operation_id: operationId }, controller.signal);

      // The FIRST status check happens immediately (no artificial delay
      // — spec section 23, "user must see activity within ~100-200ms");
      // only subsequent checks wait between polls. Never claims 100%
      // itself; that only ever comes from the backend's own final
      // update, made after the real ValidationReport exists.
      let currentOperation = await getValidateStatus(operationId, controller.signal);
      if (controller.signal.aborted) return;
      setOperation(currentOperation);
      while (currentOperation.status === 'running') {
        await new Promise((resolve) => { setTimeout(resolve, 500); });
        if (controller.signal.aborted) return;
        currentOperation = await getValidateStatus(operationId, controller.signal);
        if (controller.signal.aborted) return;
        setOperation(currentOperation);
      }

      if (currentOperation.status === 'completed' && currentOperation.response_body && 'issues' in currentOperation.response_body) {
        setReport(currentOperation.response_body);
        setStatus('success');
      } else {
        const failure = currentOperation.response_body as { message?: string; code?: string } | null;
        setError({
          message: failure?.message ?? currentOperation.failure_reason ?? 'Validation failed. Please try again.',
          code: failure?.code,
        } as ApiError);
        setStatus('error');
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        // A newer request superseded this one — its own handler owns the
        // final state, so this stale rejection must not overwrite it.
        return;
      }
      setError(caught as ApiError);
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
    setReport(null);
    setError(null);
    setOperation(null);
  }, []);

  // AI Fix Issues functional-completion sprint — the iterative fix
  // endpoint (POST /api/v1/lp/ai-fix/run/) already returns a complete,
  // freshly-authoritative ValidationReport in ONE round trip (it ran its
  // own internal revalidation passes server-side); calling `validate()`
  // again here would be a wasted, redundant network request for source
  // that already matches this report. This sets the SAME success state
  // `validate()` would, so the existing status==='success' effect in
  // LandingPageValidatorPage.tsx handles it identically either way.
  const applyExternalReport = useCallback((result: ValidationReport) => {
    abortRef.current?.abort();
    setError(null);
    setOperation(null);
    setReport(result);
    setStatus('success');
  }, []);

  return { status, report, error, operation, validate, reset, applyExternalReport };
}
