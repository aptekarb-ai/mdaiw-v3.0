export type EmailPlatform = 'generic' | 'sfmc' | 'marketo' | 'hubspot' | 'pardot' | 'other';

export type EmailStartType = 'blank' | 'template' | 'html' | 'ai';

export type EmailDocumentStatus = 'draft';

// The full persisted record, as returned by the backend
// (POST/GET /api/v1/email-builder/emails/).
export interface EmailDocument {
  id: number;
  name: string;
  platform: EmailPlatform;
  width: number;
  start_type: EmailStartType;
  status: EmailDocumentStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailDocumentInput {
  name: string;
  platform: EmailPlatform;
  width: number;
  start_type: EmailStartType;
}

export interface RecentEmailSummary {
  id: number;
  name: string;
  platform: EmailPlatform;
  width: number;
  status: EmailDocumentStatus;
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
