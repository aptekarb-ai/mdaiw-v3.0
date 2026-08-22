import type { EmailPlatform } from './types';

// Feature 10 — "display compatibility impact" (operation 5). Advisory only,
// never blocking: scans the already-rendered email HTML (the same string
// Feature 09's Code Editor shows) for personalization-token syntax families
// and warns when the *target* platform doesn't natively support the family
// found. Token syntax overlaps across real vendors (Pardot and SFMC both
// use %%field%%; HubSpot and Marketo both use {{ }}), so this groups tokens
// into two syntax families rather than claiming to identify one vendor
// precisely — an honest heuristic, not a parser.
export interface CompatibilityImpact {
  family: 'percent' | 'curly';
  label: string;
  count: number;
}

const PERCENT_TOKEN_PATTERN = /%%[^%]+%%/g;
const CURLY_TOKEN_PATTERN = /\{\{[^}]+\}\}|\{%[^%]+%\}/g;

const PERCENT_FAMILY_PLATFORMS: EmailPlatform[] = ['sfmc', 'pardot'];
const CURLY_FAMILY_PLATFORMS: EmailPlatform[] = ['marketo', 'hubspot'];

function countMatches(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

// Returns the token families present in `html` that `targetPlatform` does
// not natively support — what a user switching platforms is about to lose
// native handling for (they'll render as literal text instead).
export function detectCompatibilityImpact(html: string, targetPlatform: EmailPlatform): CompatibilityImpact[] {
  const impacts: CompatibilityImpact[] = [];

  const percentCount = countMatches(html, PERCENT_TOKEN_PATTERN);
  if (percentCount > 0 && !PERCENT_FAMILY_PLATFORMS.includes(targetPlatform)) {
    impacts.push({
      family: 'percent',
      label: '%%token%%-style personalization tokens (Salesforce Marketing Cloud / Pardot style)',
      count: percentCount,
    });
  }

  const curlyCount = countMatches(html, CURLY_TOKEN_PATTERN);
  if (curlyCount > 0 && !CURLY_FAMILY_PLATFORMS.includes(targetPlatform)) {
    impacts.push({
      family: 'curly',
      label: '{{token}}-style personalization tokens (Marketo / HubSpot style)',
      count: curlyCount,
    });
  }

  return impacts;
}
