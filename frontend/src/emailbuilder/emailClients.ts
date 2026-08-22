import type { CompatibilityCheck } from './htmlCompatibilityChecks';

// Feature 11 — Preview Studio's Email Clients matrix. Each client belongs to
// a rendering-engine family; the family determines which of Feature 09's
// existing compatibility checks actually matter for that client, so this is
// real per-engine knowledge (Outlook's Word engine cares about flex/grid and
// external CSS in ways WebKit/Blink/Gecko clients don't) rather than a
// hardcoded per-vendor branch scattered through UI code — the "capability
// adapter" the master prompt asks for lives here as data, not logic.
export type RenderEngineFamily = 'outlook-word' | 'outlook-webview' | 'webkit' | 'blink' | 'gecko';

export interface EmailClientDefinition {
  id: string;
  name: string;
  platformLabel: string;
  engine: RenderEngineFamily;
  // mdaiw-icon suffix — no dedicated per-client vendor icons exist in the
  // asset pack (same convention as platformOptions.ts), so these are the
  // closest neutral functional icons, not vendor marks.
  icon: string;
  requiredChecks: CompatibilityCheck['id'][];
}

export const EMAIL_CLIENTS: EmailClientDefinition[] = [
  {
    id: 'outlook-2016',
    name: 'Outlook 2016',
    platformLabel: 'Windows',
    engine: 'outlook-word',
    icon: 'email',
    requiredChecks: ['html-valid', 'inline-css', 'no-div', 'outlook-safe'],
  },
  {
    id: 'outlook-new',
    name: 'Outlook (New)',
    platformLabel: 'Windows',
    engine: 'outlook-webview',
    icon: 'email',
    requiredChecks: ['html-valid', 'inline-css'],
  },
  {
    id: 'gmail-desktop',
    name: 'Gmail',
    platformLabel: 'Desktop',
    icon: 'email',
    engine: 'webkit',
    requiredChecks: ['html-valid', 'inline-css'],
  },
  {
    id: 'gmail-android',
    name: 'Gmail',
    platformLabel: 'Android',
    icon: 'email',
    engine: 'blink',
    requiredChecks: ['html-valid', 'inline-css'],
  },
  {
    id: 'apple-mail',
    name: 'Apple Mail',
    platformLabel: 'macOS',
    icon: 'email',
    engine: 'webkit',
    requiredChecks: ['html-valid', 'inline-css'],
  },
  {
    id: 'iphone-mail',
    name: 'iPhone Mail',
    platformLabel: 'iOS',
    icon: 'email',
    engine: 'webkit',
    requiredChecks: ['html-valid', 'inline-css'],
  },
  {
    id: 'yahoo-mail',
    name: 'Yahoo Mail',
    platformLabel: 'Web',
    icon: 'email',
    engine: 'blink',
    requiredChecks: ['html-valid', 'inline-css'],
  },
  {
    id: 'samsung-mail',
    name: 'Samsung Mail',
    platformLabel: 'Android',
    icon: 'email',
    engine: 'blink',
    requiredChecks: ['html-valid', 'inline-css'],
  },
  {
    id: 'thunderbird',
    name: 'Thunderbird',
    platformLabel: 'Desktop',
    icon: 'email',
    engine: 'gecko',
    requiredChecks: ['html-valid', 'inline-css'],
  },
];
