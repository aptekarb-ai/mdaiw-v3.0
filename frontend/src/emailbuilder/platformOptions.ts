import type { EmailPlatform } from './types';

// A platform-appropriate personalization/merge-tag token — reference only
// (Feature 10). Never auto-inserted into module content; the Platform
// Environment dialog surfaces these as copy-to-clipboard text so the user
// can paste one into any text field manually. Because it's always plain
// text handed to the user, not interpreted or injected as markup, this
// carries no risk to the table-first/zero-script HTML contract.
export interface MergeTagSample {
  token: string;
  description: string;
}

// Capability flags a platform-adapter layer reads (AMPScript injection,
// Marketo personalization tokens, HubL, dynamic-content blocks, per-platform
// HTML rules). Feature 02 only stores which platform was selected; Feature
// 10 is the first feature to actually read compatibilityMode/htmlStructure/
// css/scripting/mergeTags — the shape existed ahead of time so this feature
// didn't have to touch the PLATFORM_OPTIONS list shape again, just add
// fields to it.
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
  // Feature 10 — Platform Environment capability matrix (matches the
  // reference PNG's "Compatibility Mode / HTML Structure / CSS /
  // Scripting" rows). Display-only; every platform still renders through
  // the same table-first htmlRenderer, so these describe the platform's
  // safe-to-assume constraints rather than switch any actual rendering
  // logic.
  compatibilityMode: string;
  htmlStructure: string;
  css: string;
  scripting: string;
  mergeTags: MergeTagSample[];
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
    compatibilityMode: 'Maximum',
    htmlStructure: 'Table based (Email safe)',
    css: 'Inline & Email safe',
    scripting: 'Disabled',
    mergeTags: [],
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
    compatibilityMode: 'High',
    htmlStructure: 'Table based (Email safe)',
    css: 'Inline & Email safe',
    scripting: 'AMPScript enabled',
    mergeTags: [
      { token: '%%FirstName%%', description: 'Subscriber first name' },
      { token: '%%EmailAddress%%', description: 'Subscriber email address' },
      { token: '%%=v(@discount)=%%', description: 'AMPScript variable output' },
    ],
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
    compatibilityMode: 'High',
    htmlStructure: 'Table based (Email safe)',
    css: 'Inline & Email safe',
    scripting: 'Marketo tokens enabled',
    mergeTags: [
      { token: '{{lead.First Name}}', description: 'Lead first name' },
      { token: '{{lead.Email Address}}', description: 'Lead email address' },
      { token: '{{my.tokenName}}', description: 'My Tokens value' },
    ],
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
    compatibilityMode: 'High',
    htmlStructure: 'Table based (Email safe)',
    css: 'Inline & Email safe',
    scripting: 'HubL enabled',
    mergeTags: [
      { token: '{{ contact.firstname }}', description: 'Contact first name' },
      { token: '{{ contact.email }}', description: 'Contact email address' },
      { token: '{% if contact.lifecyclestage == "customer" %}', description: 'HubL personalization block' },
    ],
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
    compatibilityMode: 'High',
    htmlStructure: 'Table based (Email safe)',
    css: 'Inline & Email safe',
    scripting: 'Dynamic content enabled',
    mergeTags: [
      { token: '%%first_name%%', description: 'Prospect first name' },
      { token: '%%email%%', description: 'Prospect email address' },
      { token: '{{Recipient.FirstName}}', description: 'Dynamic content variable' },
    ],
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
    compatibilityMode: 'Unknown',
    htmlStructure: 'Table based (Email safe)',
    css: 'Inline & Email safe',
    scripting: 'Disabled',
    mergeTags: [],
  },
];

export const DEFAULT_PLATFORM: EmailPlatform = 'generic';

// Dashboard row/badge display — reuses this same centralized list instead
// of a second platform → label map, so "how is SFMC display-named" only
// has one answer anywhere in the app.
export function getPlatformLabel(platform: EmailPlatform): string {
  return PLATFORM_OPTIONS.find((option) => option.value === platform)?.label ?? platform;
}
