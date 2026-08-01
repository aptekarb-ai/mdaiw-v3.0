import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { createLoginChallenge, submitVerification } from '../api/faceauth';
import { useAuth } from '../hooks/useAuth';
import { useCamera } from '../hooks/useCamera';
import { isActionComplete, useFaceLandmarker, type ChallengeAction } from '../hooks/useFaceLandmarker';
import { BiometricConsent } from '../face-recognition/BiometricConsent';
import { CameraPreview } from '../face-recognition/CameraPreview';
import { CaptureProgress } from '../face-recognition/CaptureProgress';
import { FaceAuthError } from '../face-recognition/FaceAuthError';
import { FaceProcessingState } from '../face-recognition/FaceProcessingState';
import { LivenessChallenge } from '../face-recognition/LivenessChallenge';
import { FormField } from '../forms/FormField';
import type { ApiError } from '../types/auth';
import type { VerifySuccessResponse } from '../types/faceauth';
import './FaceLoginPage.css';

type Stage = 'username' | 'camera' | 'liveness' | 'processing' | 'error';

interface LocationState {
  username?: string;
}

const DETECTION_INTERVAL_MS = 200;

export function FaceLoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setAuthenticatedUser } = useAuth();
  const { videoRef, status: cameraStatus, errorMessage: cameraError, start: startCamera, stop: stopCamera, captureFrame } =
    useCamera();
  const { status: landmarkerStatus, detect } = useFaceLandmarker();

  const initialState = (location.state as LocationState | null) ?? null;

  const [username, setUsername] = useState(initialState?.username ?? '');
  const [consentChecked, setConsentChecked] = useState(false);
  const [stage, setStage] = useState<Stage>('username');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [actions, setActions] = useState<ChallengeAction[]>([]);
  const [actionIndex, setActionIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const framesRef = useRef<Blob[]>([]);
  const capturingRef = useRef(false);

  function handleStartVerification(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || !consentChecked) {
      return;
    }
    setStage('camera');
    void startCamera();
  }

  // Once the camera and the face landmarker are both ready, request a
  // randomized login challenge and move into the liveness-guided capture.
  useEffect(() => {
    if (stage !== 'camera' || cameraStatus !== 'ready' || landmarkerStatus !== 'ready') {
      return;
    }

    let cancelled = false;
    async function begin() {
      try {
        const response = await createLoginChallenge(username.trim());
        if (cancelled) return;
        setChallengeToken(response.challenge.token);
        setActions(response.challenge.actions);
        setActionIndex(0);
        framesRef.current = [];
        setStage('liveness');
      } catch (caught) {
        if (cancelled) return;
        const apiError = caught as ApiError;
        setErrorMessage(apiError.message || 'Face sign-in could not be started. Please try again.');
        stopCamera();
        setStage('error');
      }
    }
    void begin();

    return () => {
      cancelled = true;
    };
  }, [stage, cameraStatus, landmarkerStatus, username, stopCamera]);

  // Liveness detection loop.
  useEffect(() => {
    if (stage !== 'liveness' || actionIndex >= actions.length) {
      return;
    }

    const interval = window.setInterval(() => {
      if (capturingRef.current || !videoRef.current) {
        return;
      }
      const result = detect(videoRef.current, performance.now());
      if (isActionComplete(result, actions[actionIndex])) {
        capturingRef.current = true;
        void captureFrame().then((blob) => {
          if (blob) {
            framesRef.current = [...framesRef.current, blob];
            setActionIndex((prev) => prev + 1);
          }
          capturingRef.current = false;
        });
      }
    }, DETECTION_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [stage, actionIndex, actions, videoRef, captureFrame, detect]);

  // All frames captured — submit for verification.
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
      formData.append('username', username.trim());
      formData.append('challenge_token', challengeToken ?? '');
      framesRef.current.forEach((frame, index) => {
        formData.append('frames', frame, `frame-${index}.jpg`);
      });

      try {
        const response = await submitVerification(formData);
        stopCamera();
        if (response.success) {
          setAuthenticatedUser((response as VerifySuccessResponse).user);
          navigate('/dashboard', { replace: true });
        } else {
          setErrorMessage(response.message);
          setStage('error');
        }
      } catch (caught) {
        stopCamera();
        const apiError = caught as ApiError;
        setErrorMessage(
          apiError.message || 'Face sign-in could not be completed. Use your password or try again.',
        );
        setStage('error');
      } finally {
        setIsSubmitting(false);
      }
    }

    void finish();
    // isSubmitting is intentionally omitted: it is a re-entrancy guard this
    // same effect sets synchronously, not a value that should retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, actionIndex, actions.length, username, challengeToken, stopCamera, navigate, setAuthenticatedUser]);

  function handleRetry() {
    setErrorMessage('');
    setActionIndex(0);
    framesRef.current = [];
    setChallengeToken(null);
    setStage('username');
  }

  function handleUsePassword() {
    stopCamera();
    navigate('/login');
  }

  function handleCancel() {
    stopCamera();
    navigate('/login');
  }

  return (
    <div className="face-login-page">
      <div className="face-login-page__card">
        <p className="face-login-page__eyebrow">Welcome back</p>
        <h1 className="face-login-page__heading">Sign in with Face Recognition</h1>
        <p className="face-login-page__supporting">Enter your username and verify with your face.</p>

        {stage === 'username' && (
          <form onSubmit={handleStartVerification} noValidate>
            <FormField
              id="face-login-username"
              label="Username"
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <BiometricConsent checked={consentChecked} onChange={setConsentChecked} />
            <div className="face-login-page__actions">
              <button type="button" className="button button--outline" onClick={handleUsePassword}>
                Cancel
              </button>
              <button type="submit" className="button button--primary" disabled={!username.trim() || !consentChecked}>
                Verify My Face →
              </button>
            </div>
          </form>
        )}

        {(stage === 'camera' || stage === 'liveness') && (
          <>
            <CameraPreview videoRef={videoRef} status={cameraStatus} />
            {cameraError && (
              <FaceAuthError message={cameraError} onRetry={handleRetry} onUsePassword={handleUsePassword} />
            )}
            {stage === 'liveness' && actions.length > 0 && (
              <>
                <LivenessChallenge action={actions[actionIndex] ?? actions[actions.length - 1]} isComplete={false} />
                <CaptureProgress actions={actions} completedCount={actionIndex} />
              </>
            )}
            <div className="face-login-page__actions">
              <button type="button" className="button button--outline" onClick={handleCancel}>
                Cancel
              </button>
              <span />
            </div>
          </>
        )}

        {stage === 'processing' && (
          <FaceProcessingState
            heading="Verifying your identity"
            steps={[
              { key: 'camera', label: 'Camera access granted', state: 'complete' },
              { key: 'face', label: 'Face detected', state: 'complete' },
              { key: 'liveness', label: 'Liveness check', state: 'active' },
              { key: 'identity', label: 'Verifying identity', state: 'pending' },
              { key: 'session', label: 'Creating secure session', state: 'pending' },
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
