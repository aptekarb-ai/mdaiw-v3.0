// Feature 14 V2 — Email AI Engineer. Frontend mirror of
// backend/emailbuilder/ai_command.py's action schema. These types describe
// exactly what POST /api/v1/email-builder/ai-command/ can return AFTER the
// backend's own validate_action() allow-list gate — the frontend never
// needs to (and does not) re-validate prop values itself, since the
// server already rejected anything unsafe before this ever reaches here.
import type { EmailModuleType } from './edm';

// Phase A — every one of the registry's 53 module types is now a valid
// AI action target (the generated capability manifest, not a
// second-hand-typed subset, decides which PROPS are actually editable on
// a given type — see module_capabilities.py). There is no bounded
// "AI_COMMAND_MODULE_TYPES" alias anymore; use EmailModuleType directly.
export type AICommandModuleType = EmailModuleType;

// A validated `image_asset` field's value: either a reference to an
// asset the authenticated user owns (resolved server-side, ownership
// checked — see resolve_asset_references() in ai_command.py) or an
// already-safety-checked external URL. Never a bare string — see
// registryCore.tsx's SchemaFieldValueType docstring for why.
export type AIAssetReference = { assetId: number } | { url: string };

export interface AIInsertModuleEntry {
  module_type: AICommandModuleType;
  patch: Record<string, unknown>;
}

export type AICommandAction =
  | { type: 'NONE' }
  | { type: 'INSERT_MODULE'; modules: AIInsertModuleEntry[] }
  | { type: 'UPDATE_MODULE_PROPS'; target: 'selected'; module_type: AICommandModuleType; patch: Record<string, unknown> }
  | { type: 'DELETE_MODULE'; target: 'selected' }
  | { type: 'DUPLICATE_MODULE'; target: 'selected' }
  | { type: 'APPLY_GLOBAL_STYLE'; target: 'selected'; module_type: AICommandModuleType; patch: Record<string, unknown> };

export interface AICommandSelectedModuleContext {
  type: AICommandModuleType;
  props: Record<string, unknown>;
}

export interface AICommandRequest {
  message: string;
  selected_module?: AICommandSelectedModuleContext | null;
  platform?: string | null;
  width?: number | null;
}

// Phase A — 3-way provider identifier, extended from V1's
// 'deterministic' | 'openai'. Never mislabel deterministic rule output as
// AI inference — the provider badge (AIEngineerPanel) reads this field
// verbatim, it never infers a label from context.
export type AICommandProviderId = 'deterministic' | 'local' | 'openai';

export interface AICommandResponse {
  success: boolean;
  reply: string;
  action: AICommandAction;
  requires_confirmation: boolean;
  confidence: number;
  provider: AICommandProviderId;
}

// Session-only action history entry (Feature 14 requirement — never
// presented as persisted; EmailBuilderWorkspacePage resets it whenever a
// different email is loaded). Distinguishes the command, the
// interpretation Yukti/the router gave, and the eventual outcome.
export type AIActionHistoryStatus = 'applied' | 'cancelled' | 'clarification' | 'failed';

export interface AIActionHistoryEntry {
  id: string;
  command: string;
  interpretation: string;
  action: AICommandAction;
  status: AIActionHistoryStatus;
  summary: string;
  provider: AICommandProviderId;
  requiresConfirmation: boolean;
}

export function describeAction(action: AICommandAction): string {
  switch (action.type) {
    case 'INSERT_MODULE': {
      const names = action.modules.map((m) => m.module_type).join(', ');
      return action.modules.length === 1
        ? `Add a ${names} module`
        : `Add ${action.modules.length} modules: ${names}`;
    }
    case 'UPDATE_MODULE_PROPS':
      return `Update the selected ${action.module_type} module (${Object.keys(action.patch).join(', ')})`;
    case 'DELETE_MODULE':
      return 'Delete the selected module';
    case 'DUPLICATE_MODULE':
      return 'Duplicate the selected module';
    case 'APPLY_GLOBAL_STYLE':
      return `Apply a style change to every ${action.module_type} module (${Object.keys(action.patch).join(', ')})`;
    case 'NONE':
    default:
      return 'No change proposed';
  }
}
