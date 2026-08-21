import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YuktiProvider } from '../context/YuktiProvider';
import { YuktiDrawer } from './YuktiDrawer';
import { LoginPage } from '../pages/LoginPage';
import { RegistrationWizard } from '../registration/RegistrationWizard';
import { useAuth } from '../hooks/useAuth';
import { useYukti } from '../hooks/useYukti';
import { requestIntent } from '../api/yukti';

vi.mock('../api/yukti', () => ({ requestIntent: vi.fn() }));
vi.mock('../api/client', () => ({ registerEmployee: vi.fn() }));
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }));

function TestTrigger() {
  const { open } = useYukti();
  return (
    <button type="button" onClick={open}>
      Open Yukti For Test
    </button>
  );
}

function renderLoginWithYukti() {
  vi.mocked(useAuth).mockReturnValue({
    status: 'unauthenticated',
    user: null,
    error: null,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    clearError: vi.fn(),
    setAuthenticatedUser: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={['/login']}>
      <YuktiProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/face-login" element={<div>Face login page</div>} />
          <Route path="/dashboard" element={<div>Dashboard content</div>} />
        </Routes>
        <TestTrigger />
        <YuktiDrawer />
      </YuktiProvider>
    </MemoryRouter>,
  );
}

function renderRegistrationThenLoginWithYukti() {
  vi.mocked(useAuth).mockReturnValue({
    status: 'unauthenticated',
    user: null,
    error: null,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    clearError: vi.fn(),
    setAuthenticatedUser: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={['/register']}>
      <YuktiProvider>
        <Routes>
          <Route path="/register" element={<RegistrationWizard />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
        <TestTrigger />
        <YuktiDrawer />
      </YuktiProvider>
    </MemoryRouter>,
  );
}

function renderRegistrationWithYukti() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <YuktiProvider>
        <Routes>
          <Route path="/register" element={<RegistrationWizard />} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
        <TestTrigger />
        <YuktiDrawer />
      </YuktiProvider>
    </MemoryRouter>,
  );
}

async function openAndSend(user: ReturnType<typeof userEvent.setup>, message: string) {
  await user.click(screen.getByRole('button', { name: 'Open Yukti For Test' }));
  await user.type(screen.getByLabelText('Message to Yukti'), `${message}{Enter}`);
}

describe('Yukti login integration', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fills the login username field after a non-sensitive intent, without touching the password field', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'FILL_REGISTRATION_FIELD',
      confidence: 0.9,
      requires_confirmation: false,
      spoken_response: 'Setting your username to brahmesh.aptekar.',
      action: { type: 'FILL_FIELD', field: 'username', value: 'brahmesh.aptekar' },
    });

    const user = userEvent.setup();
    renderLoginWithYukti();
    await openAndSend(user, 'My username is brahmesh.aptekar');

    expect(await screen.findByLabelText('Username')).toHaveValue('brahmesh.aptekar');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('never places a password value into the password field, even if asked', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'EXPLAIN_PASSWORD_LOGIN',
      confidence: 0.95,
      requires_confirmation: false,
      spoken_response: 'For your security, please type your password manually. I can focus the password field, but I cannot read, fill, or hear it.',
      action: null,
    });

    const user = userEvent.setup();
    renderLoginWithYukti();
    await openAndSend(user, 'my password is hunter2');

    expect(
      await screen.findByText(/please type your password manually/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.queryByText('hunter2')).not.toBeInTheDocument();
  });

  it('opens the existing Face Recognition login flow on guidance intent', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'START_FACE_LOGIN',
      confidence: 0.9,
      requires_confirmation: false,
      spoken_response: 'Opening Face Recognition sign-in. Please look at the camera when it starts.',
      action: { type: 'START_FACE_LOGIN' },
    });

    const user = userEvent.setup();
    renderLoginWithYukti();
    await openAndSend(user, 'sign in with my face');

    expect(await screen.findByText('Face login page')).toBeInTheDocument();
  });

  it('navigates from /register to /login on an explicit login request without touching the login API, authentication, or the password field', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'OPEN_LOGIN',
      confidence: 0.9,
      requires_confirmation: false,
      spoken_response: 'Opening the sign-in page.',
      action: { type: 'NAVIGATE', target: '/login' },
    });
    const login = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({
      status: 'unauthenticated',
      user: null,
      error: null,
      login,
      logout: vi.fn(),
      clearError: vi.fn(),
      setAuthenticatedUser: vi.fn(),
    });

    const user = userEvent.setup();
    renderRegistrationThenLoginWithYukti();
    await openAndSend(user, 'Can you help me to login');

    expect(await screen.findByRole('heading', { name: 'Sign in to Digital AI Workspace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(login).not.toHaveBeenCalled();
  });
});

describe('Yukti registration integration', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requires confirmation before applying a sensitive registration field, and validation still applies', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'FILL_REGISTRATION_FIELD',
      confidence: 0.9,
      requires_confirmation: true,
      spoken_response: 'I heard MDAIW-1042 for your Employee ID. Should I enter that?',
      action: { type: 'FILL_FIELD', field: 'employee_id', value: 'MDAIW-1042' },
    });

    const user = userEvent.setup();
    renderRegistrationWithYukti();
    await openAndSend(user, 'My employee ID is MDAIW 1042');

    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    await user.click(confirmButton);

    // Field-fill jumps the wizard to Step 2 (Employee Details) and applies the value.
    expect(await screen.findByLabelText(/^Employee ID/)).toHaveValue('MDAIW-1042');

    // Manual validation still runs independently of how the value was entered.
    await user.click(screen.getByRole('button', { name: 'Next →' }));
    expect(await screen.findByText('First name is required.')).toBeInTheDocument();
  });

  it('applies a non-sensitive field without requiring confirmation', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'FILL_REGISTRATION_FIELD',
      confidence: 0.9,
      requires_confirmation: false,
      spoken_response: 'Setting your first name to Brahmesh.',
      action: { type: 'FILL_FIELD', field: 'first_name', value: 'Brahmesh' },
    });

    const user = userEvent.setup();
    renderRegistrationWithYukti();
    await openAndSend(user, 'My first name is Brahmesh');

    expect(await screen.findByLabelText(/^First Name/)).toHaveValue('Brahmesh');
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });
});
