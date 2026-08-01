import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FaceLoginPage } from './FaceLoginPage';
import { useCamera } from '../hooks/useCamera';
import { isActionComplete, useFaceLandmarker } from '../hooks/useFaceLandmarker';
import { useAuth } from '../hooks/useAuth';
import { createLoginChallenge, submitVerification } from '../api/faceauth';

vi.mock('../hooks/useCamera', () => ({ useCamera: vi.fn() }));
vi.mock('../hooks/useFaceLandmarker', () => ({
  useFaceLandmarker: vi.fn(),
  isActionComplete: vi.fn(),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../api/faceauth', () => ({
  createLoginChallenge: vi.fn(),
  submitVerification: vi.fn(),
}));

const ACTIONS = ['LOOK_CENTER', 'TURN_LEFT'] as const;

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

function mockLandmarker() {
  vi.mocked(useFaceLandmarker).mockReturnValue({ status: 'ready', detect: vi.fn().mockReturnValue({}) });
  vi.mocked(isActionComplete).mockReturnValue(true);
}

function renderPage(state: Record<string, unknown> | undefined = undefined) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/face-login', state }]}>
      <Routes>
        <Route path="/face-login" element={<FaceLoginPage />} />
        <Route path="/dashboard" element={<div>Dashboard content</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('FaceLoginPage', () => {
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
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requires a username and consent before Verify My Face is enabled', async () => {
    mockCamera();
    mockLandmarker();
    const user = userEvent.setup();
    renderPage();

    const verifyButton = screen.getByRole('button', { name: 'Verify My Face →' });
    expect(verifyButton).toBeDisabled();

    await user.type(screen.getByLabelText(/^Username/), 'employee.username');
    expect(verifyButton).toBeDisabled();

    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    expect(verifyButton).toBeEnabled();
  });

  it('does not request the camera before the user submits the username step', async () => {
    const { startCamera } = mockCamera();
    mockLandmarker();
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Username/), 'employee.username');
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    expect(startCamera).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Verify My Face →' }));
    expect(startCamera).toHaveBeenCalledTimes(1);
  });

  it('shows the camera permission error state', async () => {
    mockCamera({ status: 'denied', errorMessage: 'Camera permission was denied.' });
    mockLandmarker();
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/^Username/), 'employee.username');
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Verify My Face →' }));

    expect(await screen.findByText('Camera permission was denied.')).toBeInTheDocument();
  });

  it('signs in successfully, updates AuthContext, and navigates to the dashboard', async () => {
    const { stopCamera } = mockCamera({ status: 'ready' });
    mockLandmarker();
    vi.mocked(createLoginChallenge).mockResolvedValue({
      success: true,
      challenge: { token: 'chal-1', actions: [...ACTIONS], expires_in: 120 },
    });
    vi.mocked(submitVerification).mockResolvedValue({
      success: true,
      message: 'Signed in successfully.',
      user: { id: 7, username: 'employee.username', email: 'e@example.com', first_name: 'E', last_name: 'N' },
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
    renderPage();
    await user.type(screen.getByLabelText(/^Username/), 'employee.username');
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Verify My Face →' }));

    await waitFor(() => expect(submitVerification).toHaveBeenCalled(), { timeout: 5000 });
    expect(await screen.findByText('Dashboard content')).toBeInTheDocument();
    expect(setAuthenticatedUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'employee.username' }),
    );
    expect(stopCamera).toHaveBeenCalled();
  }, 10000);

  it('shows a generic error and offers password fallback on failed verification', async () => {
    const { stopCamera } = mockCamera({ status: 'ready' });
    mockLandmarker();
    vi.mocked(createLoginChallenge).mockResolvedValue({
      success: true,
      challenge: { token: 'chal-1', actions: [...ACTIONS], expires_in: 120 },
    });
    vi.mocked(submitVerification).mockResolvedValue({
      success: false,
      code: 'FACE_AUTHENTICATION_FAILED',
      message: 'Face sign-in could not be completed. Use your password or try again.',
    });

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/^Username/), 'employee.username');
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Verify My Face →' }));

    expect(
      await screen.findByText(
        'Face sign-in could not be completed. Use your password or try again.',
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(stopCamera).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Use Password Login' }));
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  }, 10000);

  it('stops the camera and returns to login when the user cancels', async () => {
    const { stopCamera } = mockCamera({ status: 'ready' });
    vi.mocked(useFaceLandmarker).mockReturnValue({ status: 'loading', detect: vi.fn() });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/^Username/), 'employee.username');
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Verify My Face →' }));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(stopCamera).toHaveBeenCalled();
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('prefills the username passed via router state from LoginPage', () => {
    mockCamera();
    mockLandmarker();
    renderPage({ username: 'prefilled.user' });

    expect(screen.getByLabelText(/^Username/)).toHaveValue('prefilled.user');
  });

  it('never writes credentials or frames to localStorage or sessionStorage', async () => {
    mockCamera({ status: 'ready' });
    mockLandmarker();
    vi.mocked(createLoginChallenge).mockResolvedValue({
      success: true,
      challenge: { token: 'chal-1', actions: [...ACTIONS], expires_in: 120 },
    });
    vi.mocked(submitVerification).mockResolvedValue({
      success: true,
      message: 'Signed in successfully.',
      user: { id: 7, username: 'employee.username', email: 'e@example.com', first_name: 'E', last_name: 'N' },
    });

    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/^Username/), 'employee.username');
    await user.click(screen.getByLabelText(/I consent to the processing of my facial data/));
    await user.click(screen.getByRole('button', { name: 'Verify My Face →' }));

    await waitFor(() => expect(submitVerification).toHaveBeenCalled(), { timeout: 5000 });

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  }, 10000);
});
