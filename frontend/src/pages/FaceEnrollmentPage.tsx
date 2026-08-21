import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { createEnrollChallenge, resumeEnrollment, submitEnrollment } from '../api/faceauth';
import { getCurrentUser } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useCamera } from '../hooks/useCamera';
import { useFaceReadiness } from '../hooks/useFaceReadiness';
import { useFaceLandmarker, type ChallengeAction, type LivenessDiagnosticsSnapshot } from '../hooks/useFaceLandmarker';
import { useLivenessActionDetector } from '../hooks/useLivenessCapture';
import { BiometricConsent } from '../face-recognition/BiometricConsent';
import { CameraPreview } from '../face-recognition/CameraPreview';
import { CaptureProgress } from '../face-recognition/CaptureProgress';
import { FaceAuthError } from '../face-recognition/FaceAuthError';
import { FaceProcessingState } from '../face-recognition/FaceProcessingState';
import { LivenessChallenge } from '../face-recognition/LivenessChallenge';
import { LivenessDiagnosticsPanel } from '../face-recognition/LivenessDiagnosticsPanel';
import { FormField } from '../forms/FormField';
import type { ApiError } from '../types/auth';
import './FaceEnrollmentPage.css';

type Stage = 'resume' | 'consent' | 'camera' | 'liveness' | 'processing' | 'success' | 'error';

interface LocationState {
  enrollmentToken?: string;
  username?: string;
}

export function FaceEnrollmentPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setAuthenticatedUser } = useAuth();
  const { videoRef, status: cameraStatus, errorMessage: cameraError, start: startCamera, stop: stopCamera, captureFrame } = useCamera();
  const { status: landmarkerStatus, detect } = useFaceLandmarker();
  const { status: readinessStatus, retry: retryReadiness } = useFaceReadiness();

  const initialState = (location.state as LocationState | null) ?? null;

  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(initialState?.enrollmentToken ?? null);
  const [stage, setStage] = useState<Stage>(initialState?.enrollmentToken ? 'consent' : 'resume');
  const [consentChecked, setConsentChecked] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [actions, setActions] = useState<ChallengeAction[]>([]);
  const [actionIndex, setActionIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LivenessDiagnosticsSnapshot | null>(null);

  const [resumeUsername, setResumeUsername] = useState(initialState?.username ?? '');
  const [resumePassword, setResumePassword] = useState('');
  const [resumeError, setResumeError] = useState('');
  const [isSkippingResume, setIsSkippingResume] = useState(false);

  const framesRef = useRef<Blob[]>([]);

  async function handleResumeSubmit(event: React.FormEvent) {
    event.preventDefault();
    setResumeError('');
    try {
      const response = await resumeEnrollment(resumeUsername.trim(), resumePassword, 'enroll');
      setEnrollmentToken(response.enrollment_token ?? null);
      setStage('consent');
    } catch (caught) {
      const apiError = caught as ApiError;
      setResumeError(apiError.message || 'We could not resume Face Enrollment with the details provided.');
    }
  }

  // Face Login is optional (Section J of the optional-enrollment fix) — an
  // account left PENDING_FACE_ENROLLMENT by the previous mandatory flow can
  // finish activating with password login alone, once ownership is proven
  // with username/password exactly as the enroll path above requires. Never
  // auto-signs the user in, matching the password-only registration path's
  // own behaviour (a fresh signup does not get logged in automatically
  // either) — they land on the login page and sign in themselves.
  async function handleResumeSkip() {
    setResumeError('');
    setIsSkippingResume(true);
    try {
      await resumeEnrollment(resumeUsername.trim(), resumePassword, 'skip');
      navigate('/login', { state: { activated: true } });
    } catch (caught) {
      const apiError = caught as ApiError;
      setResumeError(apiError.message || 'We could not resume Face Enrollment with the details provided.');
    } finally {
      setIsSkippingResume(false);
    }
  }

  function handleOpenCamera() {
    if (readinessStatus !== 'READY') {
      return;
    }
    setStage('camera');
    void startCamera();
  }

  // Once the camera and the face landmarker are both ready, request a
  // randomized enrollment challenge from the backend and move into the
  // liveness-guided capture stage.
  useEffect(() => {
    if (stage !== 'camera' || cameraStatus !== 'ready' || landmarkerStatus !== 'ready' || !enrollmentToken) {
      return;
    }

    let cancelled = false;
    async function begin() {
      try {
        const response = await createEnrollChallenge(enrollmentToken as string);
        if (cancelled) return;
        setChallengeToken(response.challenge.token);
        setActions(response.challenge.actions);
        setActionIndex(0);
        framesRef.current = [];
        setStage('liveness');
      } catch (caught) {
        if (cancelled) return;
        const apiError = caught as ApiError;
        setErrorMessage(apiError.message || 'Could not start Face Enrollment. Please try again.');
        stopCamera();
        setStage('error');
      }
    }
    void begin();

    return () => {
      cancelled = true;
    };
  }, [stage, cameraStatus, landmarkerStatus, enrollmentToken, stopCamera]);

  // Liveness detection loop — shared with FaceEnrollmentStep.tsx/
  // FaceLoginPage.tsx via useLivenessCapture.ts.
  useLivenessActionDetector({
    active: stage === 'liveness' && actionIndex < actions.length,
    videoRef,
    detect,
    action: actions[actionIndex],
    onDiagnostics: setDiagnostics,
    onReady: async () => {
      const blob = await captureFrame();
      if (!blob) {
        return false;
      }
      framesRef.current = [...framesRef.current, blob];
      setActionIndex((prev) => prev + 1);
      return true;
    },
  });

  // All frames captured — submit for backend verification.
  useEffect(() => {
    if (stage !== 'liveness' || actions.length === 0 || actionIndex < actions.length) {
      return;
    }
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setStage('processing');

    async function finish() {
      const formData = new FormData();
      formData.append('enrollment_token', enrollmentToken ?? '');
      formData.append('challenge_token', challengeToken ?? '');
      formData.append('consent', 'true');
      framesRef.current.forEach((frame, index) => {
        formData.append('frames', frame, `frame-${index}.jpg`);
      });

      try {
        await submitEnrollment(formData);
        stopCamera();
        const current = await getCurrentUser();
        if (current.authenticated && current.user) {
          setAuthenticatedUser(current.user);
        }
        setStage('success');
        navigate('/dashboard', { replace: true });
      } catch (caught) {
        stopCamera();
        const apiError = caught as ApiError;
        setErrorMessage(apiError.message || 'Face Enrollment could not be completed. Please try again.');
        setStage('error');
      } finally {
        setIsSubmitting(false);
      }
    }

    void finish();
    // isSubmitting is intentionally omitted: it is a re-entrancy guard this
    // same effect sets synchronously, not a value that should retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, actionIndex, actions.length, enrollmentToken, challengeToken, stopCamera, navigate, setAuthenticatedUser]);

  function handleRetry() {
    setErrorMessage('');
    setActionIndex(0);
    framesRef.current = [];
    setChallengeToken(null);
    setDiagnostics(null);
    setStage('consent');
  }

  function handleUsePassword() {
    stopCamera();
    navigate('/login');
  }

  function handleCancel() {
    stopCamera();
    navigate('/login');
  }

  if (stage === 'resume') {
    return (
      <div className="face-enrollment-page">
        <div className="face-enrollment-page__card">
          <h1 className="face-enrollment-page__heading">Resume Face Enrollment</h1>
          <p className="face-enrollment-page__supporting">
            Enter your username and password to continue Face Enrollment for your pending account.
          </p>
          <form className="face-enrollment-page__resume-form" onSubmit={handleResumeSubmit} noValidate>
            {resumeError && (
              <div role="alert" className="face-auth-error__message">
                {resumeError}
              </div>
            )}
            <FormField
              id="resume-username"
              label="Username"
              required
              value={resumeUsername}
              onChange={(event) => setResumeUsername(event.target.value)}
            />
            <FormField
              id="resume-password"
              label="Password"
              type="password"
              required
              value={resumePassword}
              onChange={(event) => setResumePassword(event.target.value)}
            />
            <button type="submit" className="button button--primary" disabled={isSkippingResume}>
              Continue →
            </button>
            <button
              type="button"
              className="button button--outline"
              disabled={!resumeUsername.trim() || !resumePassword || isSkippingResume}
              onClick={handleResumeSkip}
            >
              {isSkippingResume ? 'Activating account...' : 'Skip Face Login and finish setting up my account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="face-enrollment-page">
      <div className="face-enrollment-page__card">
        <h1 className="face-enrollment-page__heading">Face Recognition Enrollment</h1>
        <p className="face-enrollment-page__supporting">
          Use your camera to enroll your face for secure login.
        </p>

        {stage === 'consent' && (
          <>
            <BiometricConsent checked={consentChecked} onChange={setConsentChecked} />
            {readinessStatus === 'LOADING' && (
              <p className="face-enrollment-page__readiness-notice" role="status">
                Preparing secure Face Recognition. This may take a moment.
              </p>
            )}
            {readinessStatus === 'UNAVAILABLE' && (
              <div className="face-enrollment-page__readiness-notice face-enrollment-page__readiness-notice--error">
                <p role="alert">Face Recognition is temporarily unavailable. Please try again in a moment.</p>
                <button type="button" className="button button--outline" onClick={retryReadiness}>
                  Check Again
                </button>
              </div>
            )}
            <div className="face-enrollment-page__actions">
              <button
                type="button"
                className="button button--primary"
                disabled={!consentChecked || readinessStatus !== 'READY'}
                onClick={handleOpenCamera}
              >
                Open Camera
              </button>
            </div>
          </>
        )}

        {(stage === 'camera' || stage === 'liveness') && (
          <>
            <CameraPreview videoRef={videoRef} status={cameraStatus} />
            {cameraError && (
              <FaceAuthError message={cameraError} onRetry={handleRetry} onUsePassword={handleUsePassword} />
            )}
            {stage === 'liveness' && actions.length > 0 && (
              <>
                <LivenessChallenge
                  action={actions[actionIndex] ?? actions[actions.length - 1]}
                  diagnostics={diagnostics}
                />
                <CaptureProgress actions={actions} completedCount={actionIndex} />
                <LivenessDiagnosticsPanel diagnostics={diagnostics} />
              </>
            )}
            <div className="face-enrollment-page__actions">
              <button type="button" className="button button--outline" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {stage === 'processing' && (
          <FaceProcessingState
            heading="Creating your secure face credential"
            steps={[
              { key: 'frames', label: 'Frames captured', state: 'complete' },
              { key: 'liveness', label: 'Checking liveness', state: 'active' },
              { key: 'identity', label: 'Verifying identity consistency', state: 'pending' },
              { key: 'credential', label: 'Creating encrypted credential', state: 'pending' },
            ]}
          />
        )}

        {stage === 'error' && (
          <FaceAuthError message={errorMessage} onRetry={handleRetry} onUsePassword={handleUsePassword} />
        )}
      </div>
    </div>
  );
}
