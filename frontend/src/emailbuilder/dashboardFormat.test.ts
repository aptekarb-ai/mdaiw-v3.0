import { describe, expect, it } from 'vitest';
import { formatUpdatedAtFull, formatUpdatedAtShort } from './dashboardFormat';

// Regexes deliberately don't pin the day/month — Intl.DateTimeFormat
// without an explicit `timeZone` renders in the SYSTEM timezone, so a UTC
// timestamp near midnight can land on the previous or next local day
// depending on where the test runs. Only the *shape* is under test here.
describe('formatUpdatedAtShort', () => {
  it('formats as "Mon D, H:MM AM/PM" without a raw ISO/ms-of-year artifact', () => {
    const formatted = formatUpdatedAtShort('2026-08-21T12:27:16Z');
    expect(formatted).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/);
    expect(formatted).not.toContain('2026-08-21');
  });
});

describe('formatUpdatedAtFull', () => {
  it('includes the year and seconds for the exact-timestamp tooltip', () => {
    const formatted = formatUpdatedAtFull('2026-08-21T12:27:16Z');
    expect(formatted).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026, \d{1,2}:\d{2}:\d{2} (AM|PM)$/);
  });
});
