import { apiRequest } from './client';
import type { AIReviewApplyPayload, AIReviewApplyResponse, AIReviewRequestPayload, AIReviewRequestResponse } from '../types/landingpages';

export async function requestAIReview(
  payload: AIReviewRequestPayload,
  signal?: AbortSignal,
): Promise<AIReviewRequestResponse> {
  return apiRequest<AIReviewRequestResponse>('/api/v1/lp/ai-review/request/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function applyAIReview(
  payload: AIReviewApplyPayload,
  signal?: AbortSignal,
): Promise<AIReviewApplyResponse> {
  return apiRequest<AIReviewApplyResponse>('/api/v1/lp/ai-review/apply/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}
