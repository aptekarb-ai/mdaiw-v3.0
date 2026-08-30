// Module-4 E11 — turns an AI Engineer chat reply into SAFE speech input.
// Text remains authoritative/accessible in the transcript no matter what
// this returns; this only decides what (if anything) gets spoken aloud.
// Never speaks code/HTML character-by-character, never reads a huge
// response verbatim — both would make the spoken output useless noise.
const MAX_SPOKEN_CHARS = 400;
const HTML_LIKE_PATTERN = /<[a-z][\s\S]*>/i;

export function speakableSummary(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (HTML_LIKE_PATTERN.test(trimmed)) {
    return 'The reply includes generated HTML — see the transcript to read it.';
  }
  if (trimmed.length <= MAX_SPOKEN_CHARS) return trimmed;
  // Cut at the last sentence boundary before the cap, so speech doesn't
  // stop mid-word — falls back to a hard cut only if no boundary exists.
  const truncated = trimmed.slice(0, MAX_SPOKEN_CHARS);
  const lastBoundary = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('\n'));
  const cut = lastBoundary > MAX_SPOKEN_CHARS * 0.4 ? truncated.slice(0, lastBoundary + 1) : truncated;
  return `${cut} See the transcript for the full reply.`;
}
