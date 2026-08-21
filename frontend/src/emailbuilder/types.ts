import type { EmailDocumentContent, EmailModuleSettings, EmailModuleType } from './edm';

export type EmailPlatform = 'generic' | 'sfmc' | 'marketo' | 'hubspot' | 'pardot' | 'other';

export type EmailStartType = 'blank' | 'template' | 'html' | 'ai';

export type EmailDocumentStatus = 'draft';

// The full persisted record, as returned by the backend
// (POST/GET/PATCH /api/v1/email-builder/emails/). `content` is the Email
// Document Model — see edm.ts for its validated shape.
export interface EmailDocument {
  id: number;
  name: string;
  platform: EmailPlatform;
  width: number;
  start_type: EmailStartType;
  status: EmailDocumentStatus;
  content: EmailDocumentContent;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailDocumentInput {
  name: string;
  platform: EmailPlatform;
  width: number;
  start_type: EmailStartType;
}

export interface UpdateEmailDocumentInput {
  content: EmailDocumentContent;
}

// Feature 04 — a personal Saved Module, as returned by
// /api/v1/email-builder/saved-modules/. `props`/`settings` are typed
// loosely (Record<string, unknown>) here because a saved module can wrap
// any registry module type's own Props shape.
export interface SavedEmailModule {
  id: number;
  name: string;
  module_type: EmailModuleType;
  props: Record<string, unknown>;
  settings: EmailModuleSettings;
  created_at: string;
  updated_at: string;
}

export interface CreateSavedModuleInput {
  name: string;
  module_type: EmailModuleType;
  props: Record<string, unknown>;
  settings: EmailModuleSettings;
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
