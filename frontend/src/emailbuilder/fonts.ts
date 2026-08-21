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
}

export const EMAIL_SAFE_FONTS: EmailSafeFont[] = [
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'helvetica', label: 'Helvetica', stack: 'Helvetica, Arial, sans-serif' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: "'Trebuchet MS', Tahoma, sans-serif" },
  { id: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
];

export const DEFAULT_FONT_ID = 'arial';

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
