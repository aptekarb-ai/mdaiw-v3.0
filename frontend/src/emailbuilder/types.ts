import type { EmailColumn, EmailDocumentContent, EmailModuleSettings, EmailModuleType } from './edm';

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
  // Email Document Standards Sub-phase 1 — deliberately distinct from
  // `name` (the builder/dashboard draft name above). `email_title`
  // renders into <title>; `email_subject` is send/document metadata,
  // never rendered as markup. See DocumentSettingsDialog.tsx.
  email_title: string;
  email_subject: string;
  favicon_url: string;
  // Sub-phase 2. reset_css_enabled defaults true, custom_css_enabled
  // defaults false/empty at the model layer — see DocumentSettingsDialog.
  reset_css_enabled: boolean;
  custom_css_enabled: boolean;
  custom_css: string;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailDocumentInput {
  name: string;
  platform: EmailPlatform;
  width: number;
  start_type: EmailStartType;
}

// Feature 03 sends `content` only (builder autosave). The dashboard's
// rename action sends `name` only. Feature 10 sends `platform` only when
// applying a platform switch. Same PATCH endpoint for all three — each is
// just another writable serializer field (see backend
// EmailDocumentSerializer), so no new endpoint was needed for any of them.
export interface UpdateEmailDocumentInput {
  content?: EmailDocumentContent;
  name?: string;
  platform?: EmailPlatform;
  email_title?: string;
  email_subject?: string;
  favicon_url?: string;
  reset_css_enabled?: boolean;
  custom_css_enabled?: boolean;
  custom_css?: string;
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
  // Feature 05 — present only when the saved module is a layout with
  // nested column content; absent (undefined) for every other saved
  // module, same convention as EmailModule.columns.
  columns?: EmailColumn[];
  created_at: string;
  updated_at: string;
}

export interface CreateSavedModuleInput {
  name: string;
  module_type: EmailModuleType;
  props: Record<string, unknown>;
  settings: EmailModuleSettings;
  columns?: EmailColumn[];
}

export type EmailAssetCategory = 'image' | 'logo' | 'icon' | 'other';
export type EmailAssetSourceType = 'upload' | 'external';

// Feature 08 — a user's personal reusable image library, as returned by
// /api/v1/email-builder/assets/. `url` is always the one field callers
// need to actually use the asset (absolute URL for uploads, the external
// URL verbatim otherwise) — see backend EmailAssetSerializer.get_url.
// `width`/`height`/`file_size`/`content_type` are populated for uploads
// only; null for external assets (the backend never fetches a
// cross-origin URL server-side to probe its real dimensions).
export interface EmailAsset {
  id: number;
  name: string;
  category: EmailAssetCategory;
  source_type: EmailAssetSourceType;
  url: string;
  external_url: string;
  alt_text: string;
  content_type: string;
  file_size: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailAssetUploadInput {
  name: string;
  category: EmailAssetCategory;
  alt_text?: string;
  file: File;
}

export interface CreateEmailAssetExternalInput {
  name: string;
  category: EmailAssetCategory;
  alt_text?: string;
  external_url: string;
}

export interface UpdateEmailAssetInput {
  name?: string;
  category?: EmailAssetCategory;
  alt_text?: string;
  file?: File;
  external_url?: string;
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
