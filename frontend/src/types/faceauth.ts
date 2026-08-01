import type { User } from './auth';

export type ChallengeActionName = 'LOOK_CENTER' | 'TURN_LEFT' | 'TURN_RIGHT' | 'BLINK';

export interface ChallengeResponse {
  success: true;
  challenge: {
    token: string;
    actions: ChallengeActionName[];
    expires_in: number;
  };
}

export interface FaceApiFailure {
  success: false;
  code: string;
  message: string;
}

export interface EnrollSuccessResponse {
  success: true;
  message: string;
  account_status: string;
  face_enrolled: true;
}

export type EnrollResponse = EnrollSuccessResponse | FaceApiFailure;

export interface VerifySuccessResponse {
  success: true;
  message: string;
  user: User;
}

export type VerifyResponse = VerifySuccessResponse | FaceApiFailure;

export interface FaceStatusResponse {
  success: true;
  enrolled: boolean;
  active: boolean;
  model_name: string | null;
  enrolled_at: string | null;
  last_verified_at: string | null;
}

export interface EnrollmentResumeResponse {
  success: true;
  enrollment_token: string;
}
