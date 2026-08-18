import { apiRequest } from './client';
import type {
  AIFixIssuesRunPayload, AIFixIssuesRunResponse, FixApplyResponse, FixPreviewResponse, FixRequest,
  RepairOperationStatus, StartAiFixResponse,
} from '../types/landingpages';

export async function previewFixes(payload: FixRequest, signal?: AbortSignal): Promise<FixPreviewResponse> {
  return apiRequest<FixPreviewResponse>('/api/v1/lp/fixes/preview/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function applyFixes(payload: FixRequest, signal?: AbortSignal): Promise<FixApplyResponse> {
  return apiRequest<FixApplyResponse>('/api/v1/lp/fixes/apply/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

// AI Engineer Autonomous Repair — runs the full detect-fix-revalidate
// loop server-side; see AIFixIssuesRunPayload's doc comment. Clicking
// "AI Fix Issues" calls this directly — no review dialog first.
export async function runAutonomousFix(
  payload: AIFixIssuesRunPayload, signal?: AbortSignal,
): Promise<AIFixIssuesRunResponse> {
  return apiRequest<AIFixIssuesRunResponse>('/api/v1/lp/ai-fix/run/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

// Real-Time Progress UX sprint — starts the SAME autonomous-repair loop
// on a background thread and returns immediately with an operation_id;
// see getAiFixStatus for polling it. `operation_id` is required (unlike
// runAutonomousFix's optional one above) — it is the only handle the
// caller has to find this operation again.
export async function startAiFix(
  payload: AIFixIssuesRunPayload & { operation_id: string }, signal?: AbortSignal,
): Promise<StartAiFixResponse> {
  return apiRequest<StartAiFixResponse>('/api/v1/lp/ai-fix/start/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function getAiFixStatus(operationId: string, signal?: AbortSignal): Promise<RepairOperationStatus> {
  return apiRequest<RepairOperationStatus>(`/api/v1/lp/ai-fix/status/${encodeURIComponent(operationId)}/`, { signal });
}
