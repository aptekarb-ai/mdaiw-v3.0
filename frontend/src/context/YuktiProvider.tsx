import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { requestIntent } from '../api/yukti';
import { useAuth } from '../hooks/useAuth';
import { useYuktiVoice } from '../hooks/useYuktiVoice';
import type { YuktiAction, YuktiMessage } from '../types/yukti';
import { YuktiContext, type YuktiActionHandlers, type YuktiPendingConfirmation } from './YuktiContext';
import {
  hasDashboardWelcomePlayed,
  hasPublicWelcomePlayed,
  isWelcomeEnabled,
  markDashboardWelcomePlayed,
  markPublicWelcomePlayed,
  resetDashboardWelcome,
} from '../yukti/voicePreferences';

const PUBLIC_WELCOME_TEXT =
  "Welcome to Digital AI Workspace. I'm Yukti, your AI assistant. I can help you sign in, register, or answer questions about MDAIW.";

// Mirrors backend/yukti/intents.py::ALLOWED_NAVIGATION_TARGETS — a second,
// independent allow-list gate on the frontend. The backend already
// validates every action it returns; this validates again before anything
// is actually executed, so a compromised or buggy backend response still
// cannot make the app navigate or fill an unapproved field.
const ALLOWED_NAVIGATION_TARGETS = new Set([
  '/login',
  '/register',
  '/face-login',
  '/dashboard',
  '/profile',
  '/settings',
  '/employees',
  '/performance',
  '/recognition',
  '/landing-pages',
  '/email-builder',
  '/personal-finance',
  '/ai-assistants',
  '/reports',
  '/administration',
]);

const FILLABLE_FIELDS = new Set([
  'username',
  'work_email',
  'employee_id',
  'first_name',
  'last_name',
  'designation',
  'department',
  'location',
  'manager_name',
  'date_of_joining',
  'phone',
  'date_of_birth',
]);

// If a request hangs (dropped connection, unresponsive backend), abort it so
// the UI never gets stuck showing a processing state indefinitely.
const REQUEST_TIMEOUT_MS = 10000;

export function YuktiProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const voice = useYuktiVoice();
  const { status: authStatus, user } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<YuktiMessage[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<YuktiPendingConfirmation | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);

  const idCounterRef = useRef(0);
  const handlersRef = useRef<YuktiActionHandlers>({});
  const registrationStepRef = useRef<number | null>(null);
  // Set right before a Yukti-initiated navigate() call so the route-change
  // speech-cancellation effect below can tell "Yukti just navigated" (let
  // the spoken confirmation finish) apart from "the user clicked a sidebar
  // link" (cancel any stale in-flight speech from a previous page).
  const yuktiInitiatedNavigationRef = useRef(false);
  const awaitingPublicWelcomeRef = useRef(false);
  const awaitingDashboardWelcomeRef = useRef(false);
  const previousAuthStatusRef = useRef(authStatus);

  const nextId = useCallback(() => {
    idCounterRef.current += 1;
    return `yukti-${idCounterRef.current}`;
  }, []);

  const pushMessage = useCallback(
    (role: YuktiMessage['role'], text: string) => {
      setMessages((prev) => [...prev, { id: nextId(), role, text, createdAt: idCounterRef.current }]);
    },
    [nextId],
  );

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    voice.stopAll();
  }, [voice]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setPendingConfirmation(null);
  }, []);

  const registerActionHandlers = useCallback((handlers: YuktiActionHandlers) => {
    handlersRef.current = handlers;
    return () => {
      handlersRef.current = {};
    };
  }, []);

  const setRegistrationStep = useCallback((step: number | null) => {
    registrationStepRef.current = step;
  }, []);

  const executeAction = useCallback(
    (action: YuktiAction) => {
      switch (action.type) {
        case 'NAVIGATE': {
          if (ALLOWED_NAVIGATION_TARGETS.has(action.target)) {
            yuktiInitiatedNavigationRef.current = true;
            navigate(action.target);
            // Closing here (not just hiding the drawer, but stopping any
            // in-flight speech via close()) is an explicit product
            // requirement: after a successful navigation the drawer must
            // not remain open over the new page.
            close();
          }
          return;
        }
        case 'START_FACE_LOGIN': {
          yuktiInitiatedNavigationRef.current = true;
          navigate('/face-login');
          return;
        }
        case 'FOCUS_FIELD': {
          handlersRef.current.onFocusField?.(action.field);
          return;
        }
        case 'FILL_FIELD': {
          if (FILLABLE_FIELDS.has(action.field)) {
            handlersRef.current.onFillField?.(action.field, action.value);
          }
          return;
        }
        case 'GO_TO_STEP': {
          handlersRef.current.onGoToStep?.(action.step);
          return;
        }
        case 'READ_ERRORS': {
          const errors = handlersRef.current.onReadErrors?.() ?? [];
          if (errors.length === 0) {
            pushMessage('assistant', 'No validation errors are currently shown on this page.');
          } else {
            pushMessage('assistant', errors.join(' '));
          }
          return;
        }
        case 'CANCEL': {
          setPendingConfirmation(null);
          voice.stopAll();
          return;
        }
        case 'OPEN_YUKTI': {
          open();
          return;
        }
        case 'CLOSE_YUKTI': {
          close();
          return;
        }
        case 'SUGGEST_FIELD_VALUE': {
          if (FILLABLE_FIELDS.has(action.field)) {
            handlersRef.current.onFillField?.(action.field, action.value);
          }
          return;
        }
        default:
          return;
      }
    },
    [close, navigate, open, pushMessage, voice],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      // isProcessingRef (not the isProcessing state) guards this because
      // state updates are not synchronous — two calls arriving in the same
      // tick (e.g. a fast double Enter) must not both pass the check.
      if (!trimmed || isProcessingRef.current) {
        return;
      }

      isProcessingRef.current = true;
      setIsProcessing(true);

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        pushMessage('user', trimmed);

        const visibleErrors = handlersRef.current.onReadErrors?.() ?? [];
        const response = await requestIntent(
          trimmed,
          {
            route: location.pathname,
            registration_step: registrationStepRef.current,
            authenticated: authStatus === 'authenticated',
            visible_error_codes: visibleErrors,
          },
          controller.signal,
        );

        // Everything past this point acts on an already-successful HTTP
        // response. It is wrapped in its own try/catch so that a failure in
        // action execution or speech synthesis (e.g. a browser rejecting
        // speechSynthesis.speak(), or a page-specific field handler
        // throwing) is never mistaken for "could not reach the assistant
        // service" — and, critically, so the action (like navigating to
        // /login) still runs even if speaking the response fails.
        try {
          pushMessage('assistant', response.spoken_response);

          if (response.action) {
            // SUGGEST_FIELD_VALUE is always confirmed client-side too,
            // regardless of what the provider set requires_confirmation to
            // — a lower-trust AI suggestion never writes to a form field
            // without the user seeing and approving the exact value first.
            const mustConfirm =
              response.requires_confirmation || response.action.type === 'SUGGEST_FIELD_VALUE';
            if (mustConfirm) {
              setPendingConfirmation({ action: response.action, spokenResponse: response.spoken_response });
            } else {
              executeAction(response.action);
            }
          }
        } finally {
          try {
            voice.speak(response.spoken_response, response.language ? { language: response.language } : undefined);
          } catch {
            // Speech is best-effort; never block or mis-report on its failure.
          }
        }
      } catch {
        const fallback = 'I could not reach the assistant service. Please try again.';
        pushMessage('assistant', fallback);
        try {
          voice.speak(fallback);
        } catch {
          // Speech is best-effort here too.
        }
      } finally {
        // Always runs, on every exit path (success, request failure, or
        // timeout abort) — this is what stops the mic status (and therefore
        // the "Processing your request..." indicator) from getting stuck
        // forever after a voice-submitted message.
        window.clearTimeout(timeoutId);
        isProcessingRef.current = false;
        setIsProcessing(false);
        voice.resetMic();
      }
    },
    [authStatus, executeAction, location.pathname, pushMessage, voice],
  );

  const confirmPendingAction = useCallback(() => {
    if (!pendingConfirmation) {
      return;
    }
    executeAction(pendingConfirmation.action);
    pushMessage('assistant', 'Done.');
    setPendingConfirmation(null);
  }, [executeAction, pendingConfirmation, pushMessage]);

  const cancelPendingAction = useCallback(() => {
    setPendingConfirmation(null);
    pushMessage('assistant', "Okay, I won't enter that.");
  }, [pushMessage]);

  const startListening = useCallback(() => {
    voice.startListening((finalText) => void sendMessage(finalText));
  }, [voice, sendMessage]);

  // Cancel stale speech when the route changes for a reason other than
  // Yukti's own NAVIGATE/START_FACE_LOGIN action (e.g. the user clicking a
  // sidebar link while Yukti is still mid-sentence about something else).
  // Yukti-initiated navigation is exempted so its own spoken confirmation
  // is allowed to finish playing on the new page.
  useEffect(() => {
    if (yuktiInitiatedNavigationRef.current) {
      yuktiInitiatedNavigationRef.current = false;
      return;
    }
    voice.stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Public, voice-only welcome — once per browser session, only while
  // signed out. Attempted immediately; if the browser's autoplay policy
  // silently blocks it (no `speechStatus` transition to "speaking"
  // follows), the same attempt is retried once on the user's first
  // click/keypress/touch, which browsers reliably treat as a real gesture.
  useEffect(() => {
    if (authStatus !== 'unauthenticated') return;
    if (!isWelcomeEnabled() || voice.muted || hasPublicWelcomePlayed()) return;

    function attempt() {
      if (hasPublicWelcomePlayed()) return;
      awaitingPublicWelcomeRef.current = true;
      voice.speak(PUBLIC_WELCOME_TEXT);
    }

    attempt();
    window.addEventListener('click', attempt, { once: true });
    window.addEventListener('keydown', attempt, { once: true });
    window.addEventListener('touchstart', attempt, { once: true });
    return () => {
      window.removeEventListener('click', attempt);
      window.removeEventListener('keydown', attempt);
      window.removeEventListener('touchstart', attempt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // Confirms the *just-attempted* welcome actually started (as opposed to
  // any other unrelated Yukti speech), so it is marked "played" only once
  // real audible playback began.
  useEffect(() => {
    if (awaitingPublicWelcomeRef.current && voice.speechStatus === 'speaking') {
      awaitingPublicWelcomeRef.current = false;
      markPublicWelcomePlayed();
    }
    if (awaitingDashboardWelcomeRef.current && voice.speechStatus === 'speaking') {
      awaitingDashboardWelcomeRef.current = false;
      markDashboardWelcomePlayed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.speechStatus]);

  // Dashboard welcome — once per authenticated session, spoken with the
  // user's first name only (never email, employee ID, or role). By the
  // time someone reaches the dashboard they have already typed and
  // submitted a form, so — unlike the public welcome — no autoplay-block
  // retry is needed here.
  useEffect(() => {
    if (authStatus !== 'authenticated' || location.pathname !== '/dashboard') return;
    if (!isWelcomeEnabled() || voice.muted || hasDashboardWelcomePlayed()) return;
    if (voice.speechStatus === 'speaking' || voice.micStatus === 'listening') return;

    const text = user?.first_name
      ? `Welcome back, ${user.first_name}. I'm Yukti — let me know if you need anything.`
      : "Welcome to your dashboard. I'm Yukti — let me know if you need anything.";
    awaitingDashboardWelcomeRef.current = true;
    voice.speak(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, location.pathname]);

  // A new login must get a fresh welcome next time the dashboard loads, so
  // the marker is cleared the moment an authenticated session ends. Logout
  // must also stop the microphone and any speech immediately — nothing
  // Yukti is saying or listening for should survive into a signed-out
  // session.
  useEffect(() => {
    if (previousAuthStatusRef.current === 'authenticated' && authStatus === 'unauthenticated') {
      resetDashboardWelcome();
      voice.stopAll();
    }
    previousAuthStatusRef.current = authStatus;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  return (
    <YuktiContext.Provider
      value={{
        isOpen,
        open,
        close,
        messages,
        sendMessage,
        isProcessing,
        clearMessages,
        pendingConfirmation,
        confirmPendingAction,
        cancelPendingAction,
        registerActionHandlers,
        setRegistrationStep,
        micStatus: voice.micStatus,
        transcript: voice.transcript,
        micError: voice.micError,
        startListening,
        stopListening: voice.stopListening,
        speechStatus: voice.speechStatus,
        muted: voice.muted,
        toggleMuted: voice.toggleMuted,
        stopSpeaking: voice.stopSpeaking,
        voiceSupported: voice.voiceSupported,
        speechOutputSupported: voice.speechOutputSupported,
        voices: voice.voices,
        selectedVoiceURI: voice.selectedVoiceURI,
        setVoiceURI: voice.setVoiceURI,
        language: voice.language,
        setLanguage: voice.setLanguage,
        rate: voice.rate,
        setRate: voice.setRate,
        previewVoice: voice.previewVoice,
      }}
    >
      {children}
    </YuktiContext.Provider>
  );
}
