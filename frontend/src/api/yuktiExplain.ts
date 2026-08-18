import { apiRequest } from './client';
import type { YuktiExplainRequestPayload, YuktiExplainResponse } from '../types/landingpages';

export async function requestYuktiExplanation(
  payload: YuktiExplainRequestPayload,
  signal?: AbortSignal,
): Promise<YuktiExplainResponse> {
  return apiRequest<YuktiExplainResponse>('/api/v1/lp/yukti/explain/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}
