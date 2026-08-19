export type EmailPlatform = 'generic' | 'salesforce' | 'marketo' | 'hubspot' | 'pardot';

export interface RecentEmailSummary {
  id: string;
  name: string;
  platform: EmailPlatform;
  updatedAt: string;
}

export interface QuickActionDefinition {
  key: 'create' | 'template' | 'import' | 'ai-generate';
  icon: string;
  title: string;
  description: string;
}

export interface GettingStartedStep {
  step: number;
  title: string;
}
