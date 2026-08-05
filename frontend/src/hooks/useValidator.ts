import { useCallback, useRef, useState } from 'react';
import { validateCode } from '../api/landingpages';
import type { ApiError } from '../types/auth';
import type { ValidateRequest, ValidationReport } from '../types/landingpages';

export type ValidatorStatus = 'idle' | 'validating' | 'success' | 'error';

export function useValidator() {
  const [status, setStatus] = useState<ValidatorStatus>('idle');
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const validate = useCallback(async (payload: ValidateRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('validating');
    setError(null);

    try {
      const result = await validateCode(payload, controller.signal);
      setReport(result);
      setStatus('success');
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
  }, []);

  return { status, report, error, validate, reset };
}
