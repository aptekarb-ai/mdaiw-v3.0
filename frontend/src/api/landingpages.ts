import { apiRequest } from './client';
import type {
  LoadVersionResponse,
  SaveVersionRequest,
  SaveVersionResponse,
  ValidateOperationStatus,
  ValidateRequest,
  ValidationReport,
  StartValidateResponse,
} from '../types/landingpages';

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

// AI Validate Code Live Progress sprint — starts the SAME read-only
// validation persist_validation_report() call on a background thread and
// returns immediately with an operation_id; see getValidateStatus for
// polling it. `operation_id` is required — it is the only handle the
// caller has to find this operation again.
export async function startValidate(
  payload: ValidateRequest & { operation_id: string },
  signal?: AbortSignal,
): Promise<StartValidateResponse> {
  return apiRequest<StartValidateResponse>('/api/v1/lp/validate/start/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function getValidateStatus(operationId: string, signal?: AbortSignal): Promise<ValidateOperationStatus> {
  return apiRequest<ValidateOperationStatus>(`/api/v1/lp/validate/status/${encodeURIComponent(operationId)}/`, { signal });
}

// Save/Download closure sprint — persists the exact current editor
// sources as a new LandingPageVersion (never reformats, never runs AI,
// never compiles a preprocessor source). See SaveLandingPageVersionView.
export async function saveVersion(payload: SaveVersionRequest, signal?: AbortSignal): Promise<SaveVersionResponse> {
  return apiRequest<SaveVersionResponse>('/api/v1/lp/projects/save/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

// The read-back half of Save — reconstructs the exact saved sources for
// "refresh/reopen saved LP". See LoadLandingPageVersionView.
export async function loadLatestVersion(projectId: number, signal?: AbortSignal): Promise<LoadVersionResponse> {
  return apiRequest<LoadVersionResponse>(`/api/v1/lp/projects/${encodeURIComponent(String(projectId))}/latest-version/`, { signal });
}
