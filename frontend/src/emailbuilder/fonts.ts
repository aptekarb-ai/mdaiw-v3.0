// Feature 06 — email-safe font whitelist. A module stores only the stable
// internal `id` below (never raw CSS) — instruction 41: "Do not permit
// arbitrary font-family: <user-controlled raw CSS>. Store a stable
// internal font ID if useful." The renderer looks up the full,
// multi-fallback CSS stack from `id` at render time via
// fontStackFor()/isValidFontId(), so no user input ever reaches a
// `font-family` declaration directly.
export interface EmailSafeFont {
  id: string;
  label: string;
  stack: string;
  // Sub-phase 3 — whether Classic Outlook's Word rendering engine can
  // reasonably render this font natively (true for every font actually
  // pre-installed on Windows, which is what Word's font substitution
  // resolves against). All 7 fonts below are genuine Windows-native
  // fonts, so this is `true` for every one of them TODAY — there is no
  // web-font option in this registry. The flag exists so a FUTURE
  // web-font addition (e.g. a Google Font loaded via @font-face, which
  // Word cannot render at all) can be marked `false` and automatically
  // get an MSO-only fallback (see outlookCompatibility.ts's
  // renderOutlookFontFallbackCss) WITHOUT forcing every other module's
  // deliberately-chosen, already-Outlook-safe typography to change —
  // see msoFallbackStackFor()'s docstring for why this is never a
  // blanket override.
  msoSafe: boolean;
}

export const EMAIL_SAFE_FONTS: EmailSafeFont[] = [
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif', msoSafe: true },
  { id: 'helvetica', label: 'Helvetica', stack: 'Helvetica, Arial, sans-serif', msoSafe: true },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif', msoSafe: true },
  { id: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif", msoSafe: true },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif', msoSafe: true },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: "'Trebuchet MS', Tahoma, sans-serif", msoSafe: true },
  { id: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif", msoSafe: true },
];

export const DEFAULT_FONT_ID = 'arial';

// The generic, universally-Word-renderable stack an MSO-only override
// substitutes in for a (currently hypothetical) non-mso-safe font — a
// plain sans-serif fallback, not a claim that it matches the original
// font's appearance, just that Outlook will render SOMETHING legible
// instead of silently falling back to Times New Roman.
const MSO_GENERIC_FALLBACK_STACK = 'Arial, Helvetica, sans-serif';

const FONT_BY_ID = new Map(EMAIL_SAFE_FONTS.map((f) => [f.id, f]));

export function isValidFontId(id: unknown): id is string {
  return typeof id === 'string' && FONT_BY_ID.has(id);
}

// Never throws / never returns anything but a whitelisted stack — an
// unrecognized id (a stale value from before a font was renamed/removed,
// or a tampered payload) silently falls back to the default rather than
// ever emitting arbitrary CSS.
export function fontStackFor(id: unknown): string {
  const font = typeof id === 'string' ? FONT_BY_ID.get(id) : undefined;
  return (font ?? FONT_BY_ID.get(DEFAULT_FONT_ID)!).stack;
}

// True only for a font id that matches a REGISTERED, explicitly
// msoSafe:true entry (every font in the registry today — see
// EmailSafeFont.msoSafe's docstring). Deliberately DIFFERENT from
// fontStackFor's fallback behavior: fontStackFor silently substitutes
// the mso-safe DEFAULT_FONT_ID's CSS stack for an unrecognized id (so
// the base render is already safe), but isMsoSafeFont answers "is THIS
// SPECIFIC id a known-safe font" — an unrecognized id is "not confirmed
// safe" (false), not "assumed safe", so a stale/tampered/future id
// still gets the defensive MSO-only fallback override rather than
// silently being treated as fine.
export function isMsoSafeFont(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const font = FONT_BY_ID.get(id);
  return font ? font.msoSafe : false;
}

// Only meaningful when isMsoSafeFont(id) is false — every real font
// today is safe, so this always returns the generic stack in practice;
// still a real, independently-testable function so the mechanism has
// unit coverage without needing a fabricated unsafe font in the live
// registry.
export function msoFallbackStackFor(_id: unknown): string {
  return MSO_GENERIC_FALLBACK_STACK;
}
