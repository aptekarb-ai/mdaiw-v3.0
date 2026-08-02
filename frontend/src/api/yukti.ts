import { apiRequest } from './client';
import type { YuktiIntentResponse, YuktiRequestContext } from '../types/yukti';

export async function requestIntent(
  message: string,
  context: YuktiRequestContext,
  signal?: AbortSignal,
): Promise<YuktiIntentResponse> {
  return apiRequest<YuktiIntentResponse>('/api/v1/yukti/intent/', {
    method: 'POST',
    body: JSON.stringify({ message, context }),
    signal,
  });
}
