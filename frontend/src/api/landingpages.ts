import { apiRequest } from './client';
import type { ValidateRequest, ValidationReport } from '../types/landingpages';

export async function validateCode(
  payload: ValidateRequest,
  signal?: AbortSignal,
): Promise<ValidationReport> {
  return apiRequest<ValidationReport>('/api/v1/lp/validate/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}
