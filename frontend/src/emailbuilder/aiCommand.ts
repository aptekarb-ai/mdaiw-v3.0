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
  | { type: 'APPLY_GLOBAL_STYLE'; target: 'selected'; module_type: AICommandModuleType; patch: Record<string, unknown> }
  // Email Document Standards Sub-phase 2, item F — document-level (not
  // EDM/module-level) proposals. Never applied without an explicit
  // Apply click, same as every action type above — see AIEngineerPanel's
  // onApplyDocumentSettingAction.
  | { type: 'SET_RESET_CSS_ENABLED'; enabled: boolean }
  | { type: 'SET_CUSTOM_CSS_ENABLED'; enabled: boolean }
  | { type: 'SET_CUSTOM_CSS'; css: string }
  | { type: 'CLEAR_CUSTOM_CSS' }
  // Sub-phase 4, item 3 — pulled forward title/subject/favicon onto the
  // same proposal-before-apply, DOCUMENT_SCOPE contract as the CSS
  // actions above. `title`/`subject`/`url` (not `value`) match exactly
  // what backend/emailbuilder/ai_command.py's validate_action() returns
  // after normalizing the raw provider output.
  | { type: 'SET_EMAIL_TITLE'; title: string }
  | { type: 'SET_EMAIL_SUBJECT'; subject: string }
  | { type: 'SET_FAVICON'; url: string }
  | { type: 'CLEAR_FAVICON' }
  // Sub-phase 4, item 4 — a LOCAL-ONLY pseudo-action: never sent to or
  // received from the backend (the repair-issue mapping only exists on
  // the client, which is the only side that has a live ValidationReport
  // to repair). AIEngineerPanel constructs this directly and applies it
  // through the SAME per-item mutators every other action already uses —
  // see repairEngine.ts.
  | { type: 'REPAIR_ISSUES'; items: RepairActionItem[] };

// One deterministic, already-validated repair step — either a module
// prop patch (routed through the existing onApplyAction/onUpdateProps
// path) or a document-settings patch (routed through
// onApplyDocumentSettingAction/updateDocumentSettings), never a third
// mutation path.
export type RepairActionItem =
  | { kind: 'module'; issueId: string; moduleId: string; propPatch: Record<string, unknown> }
  | { kind: 'document'; issueId: string; documentPatch: Record<string, unknown> };

export const DOCUMENT_SCOPE_ACTION_TYPES = new Set<AICommandAction['type']>([
  'SET_RESET_CSS_ENABLED', 'SET_CUSTOM_CSS_ENABLED', 'SET_CUSTOM_CSS', 'CLEAR_CUSTOM_CSS',
  'SET_EMAIL_TITLE', 'SET_EMAIL_SUBJECT', 'SET_FAVICON', 'CLEAR_FAVICON',
]);

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
  // Sub-phase 2, item F — a substantial Custom CSS replacement needs a
  // stronger confirmation treatment than a trivial property change;
  // false for every non-CSS action type.
  requires_strong_confirmation: boolean;
  confidence: number;
  provider: AICommandProviderId;
}

// Session-only action history entry (Feature 14 requirement — never
// presented as persisted; EmailBuilderWorkspacePage resets it whenever a
// different email is loaded). Distinguishes the command, the
// interpretation Yukti/the router gave, and the eventual outcome.
// Sub-phase 4 — 'reported' is a distinct outcome from 'clarification':
// the AI Engineer gave a real, complete analysis (e.g. "Found 2 issues:
// ...") rather than asking the user a follow-up question. Both carry no
// action, but conflating them would misrepresent a genuine diagnostic
// answer as an unanswered clarifying question in the History tab.
export type AIActionHistoryStatus = 'applied' | 'cancelled' | 'clarification' | 'failed' | 'reported';

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
    case 'SET_RESET_CSS_ENABLED':
      return action.enabled ? 'Enable Email Reset CSS' : 'Disable Email Reset CSS';
    case 'SET_CUSTOM_CSS_ENABLED':
      return action.enabled ? 'Enable Custom CSS' : 'Disable Custom CSS';
    case 'SET_CUSTOM_CSS':
      return 'Update Custom CSS';
    case 'CLEAR_CUSTOM_CSS':
      return 'Remove Custom CSS';
    case 'SET_EMAIL_TITLE':
      return `Set the email title to "${action.title}"`;
    case 'SET_EMAIL_SUBJECT':
      return `Set the email subject to "${action.subject}"`;
    case 'SET_FAVICON':
      return `Set the favicon to ${action.url}`;
    case 'CLEAR_FAVICON':
      return 'Remove the favicon';
    case 'REPAIR_ISSUES':
      return action.items.length === 1
        ? 'Repair 1 issue'
        : `Repair ${action.items.length} issues`;
    case 'NONE':
    default:
      return 'No change proposed';
  }
}
