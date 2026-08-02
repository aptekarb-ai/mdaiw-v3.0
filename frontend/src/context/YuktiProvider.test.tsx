import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YuktiProvider } from './YuktiProvider';
import { YuktiDrawer } from '../yukti/YuktiDrawer';
import { useAuth } from '../hooks/useAuth';
import { useYukti } from '../hooks/useYukti';
import { requestIntent } from '../api/yukti';
import type { AuthContextValue } from '../types/auth';

vi.mock('../api/yukti', () => ({
  requestIntent: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

function SendHarness() {
  const { sendMessage } = useYukti();
  return (
    <button type="button" onClick={() => void sendMessage('help')}>
      Send Directly
    </button>
  );
}

function TriggerButton() {
  const { open } = useYukti();
  return (
    <button type="button" onClick={open}>
      Open Yukti
    </button>
  );
}

// Simulates the user navigating by an ordinary means (a sidebar link) that
// has nothing to do with Yukti, so the route-change speech-coordination
// effect can be exercised independently of executeAction's NAVIGATE case.
function NavHarness() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/register')}>
      Go To Register Directly
    </button>
  );
}

function appTree(initialPath: string) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <YuktiProvider>
        <Routes>
          <Route path="/login" element={<div>Login page content</div>} />
          <Route path="/register" element={<div>Register page content</div>} />
          <Route path="/dashboard" element={<div>Dashboard content</div>} />
        </Routes>
        <TriggerButton />
        <SendHarness />
        <NavHarness />
        <YuktiDrawer />
      </YuktiProvider>
    </MemoryRouter>
  );
}

function renderApp(initialPath = '/login') {
  return render(appTree(initialPath));
}

function authState(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'unauthenticated',
    user: null,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
    setAuthenticatedUser: vi.fn(),
    ...overrides,
  };
}

const JANE_USER = { id: 1, username: 'jane', email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe' };

describe('YuktiProvider + YuktiDrawer', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.mocked(useAuth).mockReturnValue({
      status: 'unauthenticated',
      user: null,
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      clearError: vi.fn(),
      setAuthenticatedUser: vi.fn(),
    });
  });

  afterEach(() => {
    // Guarantees fake timers never leak into the next test, even if a test
    // using them fails partway through.
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens and closes the drawer', async () => {
    const user = userEvent.setup();
    renderApp();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    expect(screen.getByRole('dialog', { name: 'Yukti assistant' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close Yukti' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('submits a typed message and displays the assistant response', async () => {
    // Uses a non-navigating response so the drawer stays open and the
    // rendered chat bubble can be asserted directly. Navigation's effect on
    // the drawer (it closes) is covered separately below.
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'GENERAL_HELP',
      confidence: 0.95,
      requires_confirmation: false,
      spoken_response: 'I can help you complete your employee registration.',
      action: null,
    });

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));

    await user.type(screen.getByLabelText('Message to Yukti'), 'Help me register as a new employee');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('I can help you complete your employee registration.')).toBeInTheDocument();
  });

  it('navigates and closes the drawer when a NAVIGATE action is returned', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'OPEN_REGISTRATION',
      confidence: 0.95,
      requires_confirmation: false,
      spoken_response: 'I can help you complete your employee registration.',
      action: { type: 'NAVIGATE', target: '/register' },
    });

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));

    await user.type(screen.getByLabelText('Message to Yukti'), 'Help me register as a new employee');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Register page content')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('submits a message with Enter', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'GENERAL_HELP',
      confidence: 0.7,
      requires_confirmation: false,
      spoken_response: 'I can help you navigate MDAIW, sign in, or register. What would you like to do?',
      action: null,
    });

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));

    const input = screen.getByLabelText('Message to Yukti');
    await user.type(input, 'help{Enter}');

    expect(await screen.findByText('help')).toBeInTheDocument();
    expect(requestIntent).toHaveBeenCalledWith(
      'help',
      expect.objectContaining({ route: '/login' }),
      expect.anything(),
    );
  });

  it('shows a safe fallback response for an unknown request', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'UNKNOWN',
      confidence: 0.3,
      requires_confirmation: false,
      spoken_response: "I'm not sure how to help with that yet. You can ask me to open login, open registration, or help fill a registration field.",
      action: null,
    });

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'purple monkey dishwasher{Enter}');

    expect(
      await screen.findByText(/I'm not sure how to help with that yet/),
    ).toBeInTheDocument();
  });

  it('requires confirmation before applying a sensitive field fill', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'FILL_REGISTRATION_FIELD',
      confidence: 0.9,
      requires_confirmation: true,
      spoken_response: 'I heard MDAIW-1042 for your Employee ID. Should I enter that?',
      action: { type: 'FILL_FIELD', field: 'employee_id', value: 'MDAIW-1042' },
    });

    const user = userEvent.setup();
    renderApp('/register');
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'My employee ID is MDAIW 1042{Enter}');

    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('never writes conversation transcripts to localStorage or sessionStorage', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'GENERAL_HELP',
      confidence: 0.7,
      requires_confirmation: false,
      spoken_response: 'I can help you navigate MDAIW, sign in, or register. What would you like to do?',
      action: null,
    });

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'help{Enter}');
    await waitFor(() => expect(requestIntent).toHaveBeenCalled());

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('navigates from /register to /login on an explicit login request, and closes the drawer', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'OPEN_LOGIN',
      confidence: 0.9,
      requires_confirmation: false,
      spoken_response: 'Opening the sign-in page.',
      action: { type: 'NAVIGATE', target: '/login' },
    });

    const user = userEvent.setup();
    renderApp('/register');
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'Can you help me to login{Enter}');

    expect(await screen.findByText('Login page content')).toBeInTheDocument();
    // The drawer must close after a successful navigation, not remain open
    // over the new page.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the drawer after any successful NAVIGATE action, not just OPEN_LOGIN', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'OPEN_REGISTRATION',
      confidence: 0.9,
      requires_confirmation: false,
      spoken_response: 'Opening registration.',
      action: { type: 'NAVIGATE', target: '/register' },
    });

    const user = userEvent.setup();
    renderApp('/login');
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'open registration{Enter}');

    expect(await screen.findByText('Register page content')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears the processing state after a successful request', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'GENERAL_HELP',
      confidence: 0.7,
      requires_confirmation: false,
      spoken_response: 'Some response',
      action: null,
    });

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'help{Enter}');

    expect(await screen.findByText('Some response')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('clears the processing state after a failed request and shows a safe retry message', async () => {
    vi.mocked(requestIntent).mockRejectedValue({ message: 'network down' });

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'help{Enter}');

    expect(
      await screen.findByText('I could not reach the assistant service. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('clears the processing state after a timeout (never stays stuck)', async () => {
    // Drives sendMessage() directly through a minimal harness rather than
    // typing through the composer, so fake timers don't have to be
    // interleaved with userEvent's own internal delay scheduling.
    vi.useFakeTimers();
    vi.mocked(requestIntent).mockImplementation(
      (_message, _context, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );

    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Open Yukti' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Directly' }));

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10001);
    });
    // Switch back to real timers before querying: Testing Library's
    // findBy*/waitFor polling uses its own internal setTimeout, which would
    // otherwise also be fake and never fire without further manual advances.
    // Still use findBy* (not a bare getBy*) — the abort's rejection needs a
    // further real microtask/render flush to reach the DOM.
    vi.useRealTimers();

    expect(
      await screen.findByText('I could not reach the assistant service. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('blocks a duplicate submission while a request is already in flight', async () => {
    let resolveRequest: (value: Awaited<ReturnType<typeof requestIntent>>) => void = () => {};
    vi.mocked(requestIntent).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    const input = screen.getByLabelText('Message to Yukti');
    await user.type(input, 'help{Enter}');

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(requestIntent).toHaveBeenCalledTimes(1);

    resolveRequest({
      success: true,
      intent: 'GENERAL_HELP',
      confidence: 0.7,
      requires_confirmation: false,
      spoken_response: 'done',
      action: null,
    });
    await screen.findByText('done');
    expect(requestIntent).toHaveBeenCalledTimes(1);
  });

  it('rejects a navigation target the frontend allow-list does not recognize', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'OPEN_LOGIN',
      confidence: 0.9,
      requires_confirmation: false,
      spoken_response: 'Opening a suspicious page.',
      action: { type: 'NAVIGATE', target: '/some-unlisted-route' },
    });

    const user = userEvent.setup();
    renderApp('/register');
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'go somewhere{Enter}');

    expect(await screen.findByText('Opening a suspicious page.')).toBeInTheDocument();
    // Never navigates: the target was not in ALLOWED_NAVIGATION_TARGETS.
    expect(screen.getByText('Register page content')).toBeInTheDocument();
    // Never closes either — closing is tied to a navigation actually happening.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clears messages on explicit request', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'GENERAL_HELP',
      confidence: 0.7,
      requires_confirmation: false,
      spoken_response: 'Some response',
      action: null,
    });

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'help{Enter}');
    expect(await screen.findByText('Some response')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear conversation' }));
    expect(screen.queryByText('Some response')).not.toBeInTheDocument();
  });

  it('sends current authentication status and visible validation errors as context', async () => {
    vi.mocked(useAuth).mockReturnValue({
      status: 'authenticated',
      user: { id: 1, username: 'jane', email: 'jane@example.com', first_name: 'Jane', last_name: 'Doe' },
      error: null,
      login: vi.fn(),
      logout: vi.fn(),
      clearError: vi.fn(),
      setAuthenticatedUser: vi.fn(),
    });
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'GENERAL_HELP',
      confidence: 0.7,
      requires_confirmation: false,
      spoken_response: 'ok',
      action: null,
    });

    const user = userEvent.setup();
    renderApp('/dashboard');
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'help{Enter}');

    await waitFor(() => expect(requestIntent).toHaveBeenCalled());
    expect(requestIntent).toHaveBeenCalledWith(
      'help',
      expect.objectContaining({ route: '/dashboard', authenticated: true, visible_error_codes: [] }),
      expect.anything(),
    );
  });

  it('CLOSE_YUKTI action closes the drawer', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'GENERAL_HELP',
      confidence: 0.9,
      requires_confirmation: false,
      spoken_response: 'Closing this for you.',
      action: { type: 'CLOSE_YUKTI' },
    });

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'close this{Enter}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('SUGGEST_FIELD_VALUE always requires confirmation, even if the provider says otherwise', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'FILL_REGISTRATION_FIELD',
      confidence: 0.6,
      requires_confirmation: false,
      spoken_response: 'I think your first name might be Jane.',
      action: { type: 'SUGGEST_FIELD_VALUE', field: 'first_name', value: 'Jane' },
    });

    const user = userEvent.setup();
    renderApp('/register');
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'my first name{Enter}');

    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByText('Enter "Jane" for this field?')).toBeInTheDocument();
  });

  it('rejects an unrecognized action type — no execution, text-only response', async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'UNKNOWN',
      confidence: 0.3,
      requires_confirmation: false,
      spoken_response: 'Here is some text.',
      // Simulates a malformed/unsafe backend payload slipping past — the
      // frontend allow-list (a switch with no matching case) must still
      // execute nothing rather than throw or silently do something unsafe.
      action: { type: 'DELETE_ACCOUNT' } as never,
    });

    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    await user.type(screen.getByLabelText('Message to Yukti'), 'hello{Enter}');

    expect(await screen.findByText('Here is some text.')).toBeInTheDocument();
    expect(screen.getByText('Login page content')).toBeInTheDocument();
  });
});

describe('Yukti welcome messages and speech coordination', () => {
  class FakeUtterance {
    text: string;
    lang = '';
    rate = 1;
    voice: SpeechSynthesisVoice | null = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }

  let cancelMock: ReturnType<typeof vi.fn>;
  let speakMock: ReturnType<typeof vi.fn>;
  let autoplayAllowed: boolean;

  function welcomeCalls(fragment: string) {
    return (speakMock.mock.calls as [FakeUtterance][]).filter(([utterance]) => utterance.text.includes(fragment));
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    autoplayAllowed = true;
    cancelMock = vi.fn();
    speakMock = vi.fn((utterance: FakeUtterance) => {
      if (autoplayAllowed) utterance.onstart?.();
    });
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel: cancelMock,
      speak: speakMock,
      getVoices: vi.fn().mockReturnValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;
    vi.mocked(useAuth).mockReturnValue(authState());
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'GENERAL_HELP',
      confidence: 0.7,
      requires_confirmation: false,
      spoken_response: 'ok',
      action: null,
    });
  });

  afterEach(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    vi.clearAllMocks();
  });

  it('speaks the public welcome once when the page loads signed out', () => {
    renderApp('/login');
    expect(welcomeCalls('Welcome to Digital AI Workspace')).toHaveLength(1);
    expect(window.sessionStorage.getItem('yukti_public_welcome_played')).toBe('true');
  });

  it('does not repeat the public welcome on a later mount in the same session', () => {
    const first = renderApp('/login');
    expect(welcomeCalls('Welcome to Digital AI Workspace')).toHaveLength(1);
    first.unmount();

    renderApp('/register');
    expect(welcomeCalls('Welcome to Digital AI Workspace')).toHaveLength(1);
  });

  it('does not attempt the public welcome while authenticated', () => {
    vi.mocked(useAuth).mockReturnValue(authState({ status: 'authenticated', user: JANE_USER }));
    renderApp('/dashboard');
    expect(welcomeCalls('Welcome to Digital AI Workspace')).toHaveLength(0);
  });

  it('does not attempt the public welcome when the user has muted Yukti', () => {
    window.localStorage.setItem('yukti_speech_muted', 'true');
    renderApp('/login');
    expect(welcomeCalls('Welcome to Digital AI Workspace')).toHaveLength(0);
    expect(window.sessionStorage.getItem('yukti_public_welcome_played')).toBeNull();
  });

  it('does not speak the welcome when the user has disabled it in settings', () => {
    window.localStorage.setItem('yukti_welcome_enabled', 'false');
    renderApp('/login');
    expect(welcomeCalls('Welcome to Digital AI Workspace')).toHaveLength(0);
  });

  it('retries the public welcome once on the first user interaction after an autoplay block', () => {
    autoplayAllowed = false;
    renderApp('/login');
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('yukti_public_welcome_played')).toBeNull();

    autoplayAllowed = true;
    fireEvent.click(document.body);

    // Two speak() attempts total: the initial blocked one plus this one
    // retry — never more than one retry.
    expect(welcomeCalls('Welcome to Digital AI Workspace')).toHaveLength(2);
    expect(window.sessionStorage.getItem('yukti_public_welcome_played')).toBe('true');

    // A further click must not trigger a third attempt.
    fireEvent.click(document.body);
    expect(speakMock).toHaveBeenCalledTimes(2);
  });

  it('speaks the dashboard welcome once after login, using the first name only', () => {
    vi.mocked(useAuth).mockReturnValue(authState({ status: 'authenticated', user: JANE_USER }));
    renderApp('/dashboard');

    const dashboardCalls = welcomeCalls('Jane');
    expect(dashboardCalls).toHaveLength(1);
    expect(dashboardCalls[0][0].text).not.toMatch(/jane@example\.com|Employee|Doe/);
    expect(window.sessionStorage.getItem('yukti_dashboard_welcome_played')).toBe('true');
  });

  it('does not repeat the dashboard welcome on a later mount in the same authenticated session', () => {
    vi.mocked(useAuth).mockReturnValue(authState({ status: 'authenticated', user: JANE_USER }));
    const first = renderApp('/dashboard');
    expect(welcomeCalls('Jane')).toHaveLength(1);
    first.unmount();

    renderApp('/dashboard');
    expect(welcomeCalls('Jane')).toHaveLength(1);
  });

  it('clears the dashboard welcome marker on logout so the next login gets a fresh welcome', () => {
    const authMock = vi.mocked(useAuth);
    authMock.mockReturnValue(authState({ status: 'authenticated', user: JANE_USER }));
    const { rerender } = render(appTree('/dashboard'));
    expect(window.sessionStorage.getItem('yukti_dashboard_welcome_played')).toBe('true');

    authMock.mockReturnValue(authState({ status: 'unauthenticated' }));
    rerender(appTree('/dashboard'));

    expect(window.sessionStorage.getItem('yukti_dashboard_welcome_played')).toBeNull();
  });

  it('stops speech immediately on logout', () => {
    const authMock = vi.mocked(useAuth);
    authMock.mockReturnValue(authState({ status: 'authenticated', user: JANE_USER }));
    const { rerender } = render(appTree('/dashboard'));
    cancelMock.mockClear();

    authMock.mockReturnValue(authState({ status: 'unauthenticated' }));
    rerender(appTree('/dashboard'));

    expect(cancelMock).toHaveBeenCalled();
  });

  it('cancels stale speech when the route changes for a reason other than a Yukti action', () => {
    renderApp('/login');
    cancelMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Go To Register Directly' }));

    expect(cancelMock).toHaveBeenCalled();
  });

  it("does not cut off Yukti's own confirmation speech after a Yukti-driven navigation", async () => {
    vi.mocked(requestIntent).mockResolvedValue({
      success: true,
      intent: 'OPEN_REGISTRATION',
      confidence: 0.9,
      requires_confirmation: false,
      spoken_response: 'Opening registration.',
      action: { type: 'NAVIGATE', target: '/register' },
    });

    const user = userEvent.setup();
    renderApp('/login');
    await user.click(screen.getByRole('button', { name: 'Open Yukti' }));
    cancelMock.mockClear();
    speakMock.mockClear();

    await user.type(screen.getByLabelText('Message to Yukti'), 'open registration{Enter}');

    await screen.findByText('Register page content');
    await waitFor(() => expect(speakMock).toHaveBeenCalledTimes(1));
    // Two legitimate cancels: close()'s own stopAll() and speak()'s
    // cancel-before-speak. The route-change effect recognized this as
    // Yukti's own navigation and did not add a third, stray cancellation
    // that would otherwise cut the confirmation off.
    expect(cancelMock).toHaveBeenCalledTimes(2);
  });
});
