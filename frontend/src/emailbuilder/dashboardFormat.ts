// Dashboard-only display formatting (date, not platform — see
// platformOptions.ts's getPlatformLabel for that). Explicit `en-US`
// rather than the browser's default locale so every user sees the same
// "Aug 21, 10:27 PM" shape regardless of OS/browser locale settings —
// the instruction driving this file is "use consistent locale
// formatting", not "use the user's locale".
const SHORT_DATE_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

const FULL_DATE_TIME = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', second: '2-digit',
});

// "Aug 21, 10:27 PM" — the table's visible cell text.
export function formatUpdatedAtShort(iso: string): string {
  return SHORT_DATE_TIME.format(new Date(iso));
}

// "Aug 21, 2026, 10:27:16 PM" — the same timestamp's `title` tooltip, for
// anyone who needs the exact second (or the year, which the short form
// deliberately drops to stay scannable).
export function formatUpdatedAtFull(iso: string): string {
  return FULL_DATE_TIME.format(new Date(iso));
}
