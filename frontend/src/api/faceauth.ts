import { apiRequest } from './client';
import type {
  ChallengeResponse,
  EnrollmentResumeResponse,
  EnrollResponse,
  FaceStatusResponse,
  VerifyResponse,
} from '../types/faceauth';

export async function createEnrollChallenge(enrollmentToken: string): Promise<ChallengeResponse> {
  return apiRequest<ChallengeResponse>('/api/v1/auth/face/challenge/', {
    method: 'POST',
    body: JSON.stringify({ purpose: 'ENROLL', enrollment_token: enrollmentToken }),
  });
}

export async function createLoginChallenge(username: string): Promise<ChallengeResponse> {
  return apiRequest<ChallengeResponse>('/api/v1/auth/face/challenge/', {
    method: 'POST',
    body: JSON.stringify({ purpose: 'LOGIN', username }),
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
): Promise<EnrollmentResumeResponse> {
  return apiRequest<EnrollmentResumeResponse>('/api/v1/auth/face/enrollment/resume/', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}
