// Small, shared, non-sensitive local preferences for Yukti's voice
// behavior. Kept in one place so the voice settings panel and the welcome-
// message logic (see YuktiProvider.tsx's public/dashboard welcome effects)
// read and write the exact same key.

const WELCOME_ENABLED_STORAGE_KEY = 'yukti_welcome_enabled';

export function isWelcomeEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(WELCOME_ENABLED_STORAGE_KEY);
  // Default on — absence of a stored preference means "never explicitly
  // disabled", not "disabled".
  return stored === null ? true : stored === 'true';
}

export function setWelcomeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(WELCOME_ENABLED_STORAGE_KEY, String(enabled));
}

const PUBLIC_WELCOME_SESSION_KEY = 'yukti_public_welcome_played';
const DASHBOARD_WELCOME_SESSION_KEY = 'yukti_dashboard_welcome_played';

// sessionStorage (not localStorage): must survive a page refresh within the
// same tab/session but never carry over to a brand new browser session.
export function hasPublicWelcomePlayed(): boolean {
  if (typeof window === 'undefined') return true;
  return window.sessionStorage.getItem(PUBLIC_WELCOME_SESSION_KEY) === 'true';
}

export function markPublicWelcomePlayed(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(PUBLIC_WELCOME_SESSION_KEY, 'true');
}

export function hasDashboardWelcomePlayed(): boolean {
  if (typeof window === 'undefined') return true;
  return window.sessionStorage.getItem(DASHBOARD_WELCOME_SESSION_KEY) === 'true';
}

export function markDashboardWelcomePlayed(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(DASHBOARD_WELCOME_SESSION_KEY, 'true');
}

export function resetDashboardWelcome(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(DASHBOARD_WELCOME_SESSION_KEY);
}

export const SUPPORTED_SPEECH_LANGUAGES = [
  { value: 'en-IN', label: 'English (India)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'ar-SA', label: 'Arabic' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
] as const;
