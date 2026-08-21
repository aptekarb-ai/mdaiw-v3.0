import { apiRequest } from './client';
import type { PreviewRequestPayload, PreviewRequestResponse } from '../types/landingpages';

export async function createPreview(
  payload: PreviewRequestPayload,
  signal?: AbortSignal,
): Promise<PreviewRequestResponse> {
  return apiRequest<PreviewRequestResponse>('/api/v1/lp/preview/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}
