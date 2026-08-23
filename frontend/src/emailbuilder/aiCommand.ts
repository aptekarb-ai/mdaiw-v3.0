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
  // Sub-phase 6, work package D — the six actions reserved (named but
  // never implemented) in Phase A. Each routes through an EXISTING
  // mutator (updateModuleSettings/insertNestedModule/updateColumnWidths/
  // updateModuleProps) — see EmailBuilderWorkspacePage.tsx's
  // handleApplyAiAction, never a parallel mutation path.
  | { type: 'UPDATE_MODULE_SETTINGS'; target: 'selected'; module_type: AICommandModuleType; patch: Record<string, unknown> }
  // APPLY_VML_PATTERN (buttons) / APPLY_OUTLOOK_WRAPPER (background-image
  // modules) — narrow, single-purpose "enable the VML fallback" aliases;
  // see vml.ts's supportsVmlButtonPattern/supportsVmlBackgroundPattern.
  | { type: 'APPLY_VML_PATTERN'; target: 'selected'; module_type: AICommandModuleType }
  | { type: 'APPLY_OUTLOOK_WRAPPER'; target: 'selected'; module_type: AICommandModuleType }
  | { type: 'RESTRUCTURE_LAYOUT'; target: 'selected'; module_type: AICommandModuleType; widths: number[] }
  | { type: 'INSERT_NESTED_MODULE'; target: 'selected_column'; module_type: AICommandModuleType; patch: Record<string, unknown> }
  // Validated through the EXACT SAME manifest-driven gate as
  // UPDATE_MODULE_PROPS on the backend — see ai_command.py's docstring on
  // that branch for why this is not a parallel validation path.
  | { type: 'REPLACE_UNSUPPORTED_PROPERTY'; target: 'selected'; module_type: AICommandModuleType; patch: Record<string, unknown> }
  // Sub-phase 6, work package E — structured repeatable/composite-field
  // editing (nav links, social links, product cards, feature/icon-text
  // rows). The CURRENT array lives only in the live module tree (the
  // backend has no document access), so 'add'/'update'/'remove'/
  // 'reorder' are APPLIED frontend-side against builder.selectedModule's
  // live props, then submitted through the SAME updateModuleProps path
  // every other prop patch already uses — see
  // EmailBuilderWorkspacePage.tsx's handleApplyAiAction.
  | {
      type: 'UPDATE_REPEATABLE_FIELD'; target: 'selected'; module_type: AICommandModuleType;
      op: 'add' | 'update' | 'remove' | 'reorder';
      item?: Record<string, unknown>; index?: number; fromIndex?: number; toIndex?: number;
    }
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

// One deterministic, already-validated repair step — a module prop patch
// (routed through the existing onApplyAction/onUpdateProps path), a
// module SETTINGS patch (Sub-phase 6 — routed through the existing
// updateModuleSettings path, e.g. toggling settings.outlookVml), or a
// document-settings patch (routed through
// onApplyDocumentSettingAction/updateDocumentSettings). Never a fourth
// mutation path.
export type RepairActionItem =
  | { kind: 'module'; issueId: string; moduleId: string; propPatch: Record<string, unknown> }
  | { kind: 'module-settings'; issueId: string; moduleId: string; settingsPatch: Record<string, unknown> }
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
    case 'UPDATE_MODULE_SETTINGS':
      return `Update the selected ${action.module_type} module's settings (${Object.keys(action.patch).join(', ')})`;
    case 'APPLY_VML_PATTERN':
      return `Enable the Classic Outlook VML fallback for the selected ${action.module_type} module`;
    case 'APPLY_OUTLOOK_WRAPPER':
      return `Enable the Classic Outlook VML background fallback for the selected ${action.module_type} module`;
    case 'RESTRUCTURE_LAYOUT':
      return `Change the selected layout's column widths to ${action.widths.map((w) => `${w}%`).join(' / ')}`;
    case 'INSERT_NESTED_MODULE':
      return `Insert a ${action.module_type} module into the selected column`;
    case 'REPLACE_UNSUPPORTED_PROPERTY':
      return `Replace an unsupported property on the selected ${action.module_type} module (${Object.keys(action.patch).join(', ')})`;
    case 'UPDATE_REPEATABLE_FIELD':
      switch (action.op) {
        case 'add': return `Add an item to the selected ${action.module_type} module's list`;
        case 'update': return `Update item ${(action.index ?? 0) + 1} of the selected ${action.module_type} module's list`;
        case 'remove': return `Remove item ${(action.index ?? 0) + 1} from the selected ${action.module_type} module's list`;
        case 'reorder': return `Reorder items in the selected ${action.module_type} module's list`;
        default: return `Update the selected ${action.module_type} module's list`;
      }
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
