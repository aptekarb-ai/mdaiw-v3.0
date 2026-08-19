import type { EmailPlatform } from './types';

// Capability flags a future platform-adapter layer will read (AMPScript
// injection, Marketo personalization tokens, HubL, dynamic-content blocks,
// per-platform HTML rules). None of that is implemented yet — Feature 02
// only stores which platform was selected — but the shape exists now so
// later features don't have to touch this list again, just read from it.
export interface PlatformOption {
  value: EmailPlatform;
  label: string;
  description: string;
  // mdaiw-icon suffix (see public/assets/mdaiw/css/mdaiw-icons.css). No
  // dedicated platform-logo icons exist in the asset pack, so these are
  // the closest neutral functional icons, not vendor marks.
  icon: string;
  supportsAmpscript: boolean;
  supportsMarketoTokens: boolean;
  supportsHubL: boolean;
  supportsDynamicContent: boolean;
  emailHtmlRules: string | null;
}

export const PLATFORM_OPTIONS: PlatformOption[] = [
  {
    value: 'generic',
    label: 'Generic',
    description: 'Maximum compatibility',
    icon: 'email',
    supportsAmpscript: false,
    supportsMarketoTokens: false,
    supportsHubL: false,
    supportsDynamicContent: false,
    emailHtmlRules: null,
  },
  {
    value: 'sfmc',
    label: 'Salesforce Marketing Cloud',
    description: 'SFMC / Email Studio',
    icon: 'shield-check',
    supportsAmpscript: true,
    supportsMarketoTokens: false,
    supportsHubL: false,
    supportsDynamicContent: false,
    emailHtmlRules: null,
  },
  {
    value: 'marketo',
    label: 'Marketo',
    description: 'Marketo Engage',
    icon: 'performance',
    supportsAmpscript: false,
    supportsMarketoTokens: true,
    supportsHubL: false,
    supportsDynamicContent: false,
    emailHtmlRules: null,
  },
  {
    value: 'hubspot',
    label: 'HubSpot',
    description: 'Marketing Hub',
    icon: 'department',
    supportsAmpscript: false,
    supportsMarketoTokens: false,
    supportsHubL: true,
    supportsDynamicContent: false,
    emailHtmlRules: null,
  },
  {
    value: 'pardot',
    label: 'Pardot / Account Engagement',
    description: 'Salesforce Account Engagement',
    icon: 'briefcase',
    supportsAmpscript: false,
    supportsMarketoTokens: false,
    supportsHubL: false,
    supportsDynamicContent: true,
    emailHtmlRules: null,
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Custom platform',
    icon: 'settings',
    supportsAmpscript: false,
    supportsMarketoTokens: false,
    supportsHubL: false,
    supportsDynamicContent: false,
    emailHtmlRules: null,
  },
];

export const DEFAULT_PLATFORM: EmailPlatform = 'generic';
