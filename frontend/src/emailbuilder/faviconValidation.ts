// Sub-phase 4, item 7 — the ONE canonical favicon-URL validator, shared by
// DocumentSettingsDialog.tsx (immediate Apply-time feedback) and
// emailValidation.ts's new Validation Center document check (defense-in-
// depth re-scan of whatever is currently stored, in case it arrived
// through a path other than the dialog). Mirrors
// backend/emailbuilder/serializers.py's validate_favicon_url exactly
// (same schemes, same messages) — the backend PATCH remains the
// authoritative gate; this is client-side only, for fast feedback.
export const UNSAFE_FAVICON_URL_PREFIXES = ['javascript:', 'data:', 'vbscript:'];

export function validateFaviconUrl(value: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();
  for (const scheme of UNSAFE_FAVICON_URL_PREFIXES) {
    if (lowered.startsWith(scheme)) return `Favicon URL must not use an unsafe scheme ("${scheme}").`;
  }
  if (!(lowered.startsWith('http://') || lowered.startsWith('https://'))) {
    return 'Favicon URL must start with http:// or https://.';
  }
  return null;
}
