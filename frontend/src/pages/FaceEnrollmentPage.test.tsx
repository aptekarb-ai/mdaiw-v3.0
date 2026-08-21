import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FaceEnrollmentPage } from './FaceEnrollmentPage';
import { useCamera } from '../hooks/useCamera';
import { isActionComplete, useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { useFaceReadiness } from '../hooks/useFaceReadiness';
import { useAuth } from '../hooks/useAuth';
import { createEnrollChallenge, resumeEnrollment, submitEnrollment } from '../api/faceauth';
import { getCurrentUser } from '../api/client';

vi.mock('../hooks/useCamera', () => ({ useCamera: vi.fn(), isFrameQualityAcceptable: vi.fn(() => true) }));
vi.mock('../hooks/useFaceLandmarker', () => ({
  useFaceLandmarker: vi.fn(),
  isActionComplete: vi.fn(),
  isFramePositionAcceptable: vi.fn(() => true),
  createBlinkCycleTracker: vi.fn(() => ({ update: vi.fn(() => false), reset: vi.fn() })),
  buildLivenessDiagnostics: vi.fn(() => null),
}));
vi.mock('../hooks/useFaceReadiness', () => ({ useFaceReadiness: vi.fn() }));
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../api/faceauth', () => ({
  createEnrollChallenge: vi.fn(),
  resumeEnrollment: vi.fn(),
  submitEnrollment: vi.fn(),
}));
vi.mock('../api/client', () => ({ getCurrentUser: vi.fn() }));

const ACTIONS = ['LOOK_CENTER', 'TURN_LEFT', 'TURN_RIGHT'] as const;

function mockCamera(overrides: Partial<ReturnType<typeof useCamera>> = {}) {
  const startCamera = vi.fn();
  const stopCamera = vi.fn();
  const captureFrame = vi.fn().mockResolvedValue(new Blob(['frame'], { type: 'image/jpeg' }));
  const videoRef = { current: document.createElement('video') };

  vi.mocked(useCamera).mockReturnValue({
    videoRef,
    status: 'idle',
    errorMessage: null,
    start: startCamera,
    stop: stopCamera,
    captureFrame,
    ...overrides,
  });

  return { startCamera, stopCamera, captureFrame };
}

function mockLandmarker(status: 'idle' | 'loading' | 'ready' | 'unsupported' | 'error' = 'ready') {
  vi.mocked(useFaceLandmarker).mockReturnValue({ status, detect: vi.fn().mockReturnValue({}) });
  vi.mocked(isActionComplete).mockReturnValue(true);
}

function renderPage(state: Record<string, unknown> | undefined) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/face-enrollment', state }]}>
      <Routes>
        <Route path="/face-enrollment" element={<FaceEnrollmentPage />} />
        <Route path="/dashboard" element={<div>Dashboard content</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('FaceEnrollmentPage', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'unauthenticated',
      user: null,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      clearError: vi.fn(),
      setAuthenticatedUser: vi.fn(),
    });
    vi.mocked(useFaceReadiness).mockReturnValue({ status: 'READY', retry: vi.fn() });
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requires consent before the Open Camera button is enabled', async () => {
    mockCamera();
    mockLandmarker();
    const user = userEvent.setup();
    renderPage({ enrollmentToken: 'tok-1', username: 'new.employee' });

    const openCameraButton = screen.getByRole('button', { name: 'Open Camera' });
    expect(openCameraButton).toBeDisabled();

    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    expect(openCameraButton).toBeEnabled();
  });

  it('does not request the camera before the user clicks Open Camera', async () => {
    const { startCamera } = mockCamera();
    mockLandmarker();
    const user = userEvent.setup();
    renderPage({ enrollmentToken: 'tok-1' });

    expect(startCamera).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Open Camera' }));
    expect(startCamera).toHaveBeenCalledTimes(1);
  });

  it('shows a resume form when no enrollment token is available', () => {
    mockCamera();
    mockLandmarker();
    renderPage(undefined);

    expect(screen.getByRole('heading', { name: 'Resume Face Enrollment' })).toBeInTheDocument();
  });

  it('resumes enrollment with a new token after entering credentials', async () => {
    mockCamera();
    mockLandmarker();
    vi.mocked(resumeEnrollment).mockResolvedValue({ success: true, enrollment_token: 'fresh-token' });
    const user = userEvent.setup();
    renderPage(undefined);

    await user.type(screen.getByLabelText(/^Username/), 'pending.user');
    await user.type(screen.getByLabelText(/^Password/), 'StrongPass123');
    await user.click(screen.getByRole('button', { name: 'Continue →' }));

    expect(await screen.findByRole('button', { name: 'Open Camera' })).toBeInTheDocument();
    expect(resumeEnrollment).toHaveBeenCalledWith('pending.user', 'StrongPass123', 'enroll');
  });

  it('offers a Skip option that activates the account without opening the camera', async () => {
    vi.mocked(resumeEnrollment).mockResolvedValue({ success: true, activated: true, face_enrolled: false });
    const user = userEvent.setup();
    renderPage(undefined);

    await user.type(screen.getByLabelText(/^Username/), 'pending.user');
    await user.type(screen.getByLabelText(/^Password/), 'StrongPass123');
    await user.click(screen.getByRole('button', { name: /Skip Face Login/ }));

    await waitFor(() =>
      expect(resumeEnrollment).toHaveBeenCalledWith('pending.user', 'StrongPass123', 'skip'),
    );
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('shows the camera permission error state', async () => {
    mockCamera({ status: 'denied', errorMessage: 'Camera permission was denied.' });
    mockLandmarker();
    const user = userEvent.setup();
    renderPage({ enrollmentToken: 'tok-1' });

    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Open Camera' }));

    expect(await screen.findByText('Camera permission was denied.')).toBeInTheDocument();
  });

  it('captures exactly one frame per challenge action, then submits and reaches the dashboard', async () => {
    mockCamera({ status: 'ready' });
    const { captureFrame } = mockCamera({ status: 'ready' });
    mockLandmarker('ready');
    vi.mocked(createEnrollChallenge).mockResolvedValue({
      success: true,
      challenge: { token: 'chal-1', actions: [...ACTIONS], expires_in: 120 },
    });
    vi.mocked(submitEnrollment).mockResolvedValue({
      success: true,
      message: 'Face Enrollment completed successfully.',
      account_status: 'ACTIVE',
      face_enrolled: true,
    });
    vi.mocked(getCurrentUser).mockResolvedValue({
      authenticated: true,
      user: { id: 1, username: 'new.employee', email: 'a@example.com', first_name: 'New', last_name: 'Employee' },
    });
    const setAuthenticatedUser = vi.fn();
    vi.mocked(useAuth).mockReturnValue({
      status: 'unauthenticated',
      user: null,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      clearError: vi.fn(),
      setAuthenticatedUser,
    });

    const user = userEvent.setup();
    renderPage({ enrollmentToken: 'tok-1' });
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Open Camera' }));

    await waitFor(() => expect(submitEnrollment).toHaveBeenCalled(), { timeout: 5000 });
    expect(captureFrame).toHaveBeenCalledTimes(ACTIONS.length);

    expect(await screen.findByText('Dashboard content')).toBeInTheDocument();
    expect(setAuthenticatedUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'new.employee' }),
    );
  }, 10000);

  it('shows an error and stops the camera when enrollment submission fails', async () => {
    const { stopCamera } = mockCamera({ status: 'ready' });
    mockLandmarker('ready');
    vi.mocked(createEnrollChallenge).mockResolvedValue({
      success: true,
      challenge: { token: 'chal-1', actions: [...ACTIONS], expires_in: 120 },
    });
    vi.mocked(submitEnrollment).mockRejectedValue({
      message: 'Keep your complete face visible inside the guide.',
      code: 'NO_FACE_DETECTED',
      status: 400,
    });

    const user = userEvent.setup();
    renderPage({ enrollmentToken: 'tok-1' });
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Open Camera' }));

    expect(
      await screen.findByText('Keep your complete face visible inside the guide.', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(stopCamera).toHaveBeenCalled();
  }, 10000);

  it('stops the camera and returns to login when the user cancels', async () => {
    const { stopCamera } = mockCamera({ status: 'ready' });
    mockLandmarker('loading');
    const user = userEvent.setup();
    renderPage({ enrollmentToken: 'tok-1' });
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Open Camera' }));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(stopCamera).toHaveBeenCalled();
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('never writes captured frames or tokens to localStorage or sessionStorage', async () => {
    mockCamera({ status: 'ready' });
    mockLandmarker('ready');
    vi.mocked(createEnrollChallenge).mockResolvedValue({
      success: true,
      challenge: { token: 'chal-1', actions: [...ACTIONS], expires_in: 120 },
    });
    vi.mocked(submitEnrollment).mockResolvedValue({
      success: true,
      message: 'Face Enrollment completed successfully.',
      account_status: 'ACTIVE',
      face_enrolled: true,
    });
    vi.mocked(getCurrentUser).mockResolvedValue({ authenticated: false, user: null });

    const user = userEvent.setup();
    renderPage({ enrollmentToken: 'tok-1' });
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Open Camera' }));

    await waitFor(() => expect(submitEnrollment).toHaveBeenCalled(), { timeout: 5000 });

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  }, 10000);
});
