// Shared escaping/sanitization for both the builder canvas preview and
// the exported email HTML string — user-entered module text/URLs must
// never reach either as raw, unescaped markup.

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

// Returns a safe href/src, or '#' if the input is a disallowed scheme
// (javascript:, data:, vbscript:, ...). Relative/protocol-relative URLs
// and bare paths are allowed through as-is.
export function sanitizeUrl(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '#';

  // Anything that isn't parseable as an absolute URL is treated as a
  // relative path/anchor and passed through — new URL() throws for those.
  try {
    const parsed = new URL(trimmed, 'https://example.invalid');
    if (!SAFE_URL_SCHEMES.includes(parsed.protocol)) {
      return '#';
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}
