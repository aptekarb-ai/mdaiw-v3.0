import { apiRequest } from './client';
import type {
  ChallengeResponse,
  EnrollmentProofResponse,
  EnrollmentResumeResponse,
  EnrollResponse,
  FaceReadinessResponse,
  FaceStatusResponse,
  VerifyResponse,
} from '../types/faceauth';
import type { ApiError } from '../types/auth';

export async function getFaceReadiness(): Promise<FaceReadinessResponse> {
  try {
    return await apiRequest<FaceReadinessResponse>('/api/v1/auth/face/readiness/');
  } catch (caught) {
    // A 503/MODEL_UNAVAILABLE response is a normal, expected readiness
    // state (not a network failure) — normalize it into the same
    // FaceReadinessResponse shape as the LOADING/READY paths, so callers
    // never need a separate try/catch just to poll readiness.
    const apiError = caught as ApiError;
    if (apiError.code === 'MODEL_UNAVAILABLE') {
      return { success: false, status: 'UNAVAILABLE', code: apiError.code };
    }
    throw caught;
  }
}

export async function createEnrollChallenge(enrollmentToken?: string): Promise<ChallengeResponse> {
  return apiRequest<ChallengeResponse>('/api/v1/auth/face/challenge/', {
    method: 'POST',
    body: JSON.stringify({
      purpose: 'ENROLL',
      ...(enrollmentToken ? { enrollment_token: enrollmentToken } : {}),
    }),
  });
}

export async function createLoginChallenge(username: string): Promise<ChallengeResponse> {
  return apiRequest<ChallengeResponse>('/api/v1/auth/face/challenge/', {
    method: 'POST',
    body: JSON.stringify({ purpose: 'LOGIN', username }),
  });
}

export async function submitEnrollmentProof(
  formData: FormData,
  signal?: AbortSignal,
): Promise<EnrollmentProofResponse> {
  return apiRequest<EnrollmentProofResponse>('/api/v1/auth/face/enrollment-proof/', {
    method: 'POST',
    body: formData,
    signal,
  });
}

export async function submitEnrollment(formData: FormData): Promise<EnrollResponse> {
  return apiRequest<EnrollResponse>('/api/v1/auth/face/enroll/', {
    method: 'POST',
    body: formData,
  });
}

export async function submitVerification(formData: FormData): Promise<VerifyResponse> {
  return apiRequest<VerifyResponse>('/api/v1/auth/face/verify/', {
    method: 'POST',
    body: formData,
  });
}

export async function getFaceStatus(): Promise<FaceStatusResponse> {
  return apiRequest<FaceStatusResponse>('/api/v1/auth/face/status/');
}

export async function deleteFaceEnrollment(password: string): Promise<{ success: boolean; message: string }> {
  return apiRequest('/api/v1/auth/face/enrollment/', {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  });
}

export async function resumeEnrollment(
  username: string,
  password: string,
  action: 'enroll' | 'skip' = 'enroll',
): Promise<EnrollmentResumeResponse> {
  return apiRequest<EnrollmentResumeResponse>('/api/v1/auth/face/enrollment/resume/', {
    method: 'POST',
    body: JSON.stringify({ username, password, action }),
  });
}
