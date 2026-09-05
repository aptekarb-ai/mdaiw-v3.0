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

// Sub-phase 7 — one node in a COMPOSE_EMAIL plan. Mirrors
// backend/emailbuilder/ai_command.py's _validate_composition_item shape
// exactly (snake_case field names match the wire format — never
// remapped client-side, so a captured network response can be pasted
// straight into a test fixture). `children` only appears on a layout
// module type (one group per column index); `repeatable_items` only
// appears on a module type with a repeatableField. Both are one level
// deep only — a child module is always AIInsertModuleEntry-shaped, never
// itself carrying `children`/`repeatable_items`.
export interface AIComposeChildGroup {
  column_index: number;
  modules: AIInsertModuleEntry[];
}

export interface AIComposeItem {
  module_type: AICommandModuleType;
  patch: Record<string, unknown>;
  children?: AIComposeChildGroup[];
  repeatable_items?: Record<string, unknown>[];
}

export type AICommandAction =
  | { type: 'NONE' }
  | { type: 'INSERT_MODULE'; modules: AIInsertModuleEntry[] }
  | { type: 'UPDATE_MODULE_PROPS'; target: 'selected'; module_type: AICommandModuleType; patch: Record<string, unknown> }
  | { type: 'DELETE_MODULE'; target: 'selected' }
  | { type: 'DUPLICATE_MODULE'; target: 'selected' }
  | { type: 'APPLY_GLOBAL_STYLE'; target: 'selected'; module_type: AICommandModuleType; patch: Record<string, unknown> }
  // D4-E3 item 7/8 — a compound request against the SAME currently
  // selected module: a props-shaped patch AND a settings-shaped patch in
  // ONE proposal/ONE undo step (see EmailBuilderWorkspacePage.tsx's
  // handleApplyAiAction, which reuses the EXISTING applyRepairPatch batch
  // primitive — never a new mutation path). Either half may be null, but
  // never both (the backend's validate_action() already guarantees that).
  | {
      type: 'BATCH_UPDATE'; target: 'selected'; module_type: AICommandModuleType;
      props_patch: Record<string, unknown> | null; settings_patch: Record<string, unknown> | null;
    }
  // D4-E3G — a cross-module compound request ("make the hero heading
  // smaller, the CTA green, and center the footer text"). Each
  // `operations` entry targets a DIFFERENT real module id, already
  // resolved client-side by referenceResolver.ts's
  // resolveMultipleReferences before this was ever sent to the backend
  // (see aiCommand's own resolved_targets request field) — the backend
  // never invents a module id here. Applied through the SAME
  // applyRepairPatch batch-commit primitive BATCH_UPDATE already uses,
  // just with multiple distinct module ids instead of one — still
  // exactly ONE history/Undo entry (see EmailBuilderWorkspacePage.tsx's
  // handleApplyAiAction).
  | {
      type: 'MULTI_MODULE_UPDATE';
      operations: Array<{
        target_module_id: string; module_type: AICommandModuleType;
        props_patch: Record<string, unknown> | null; settings_patch: Record<string, unknown> | null;
      }>;
    }
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
  // Sub-phase 7 — the composition engine's one action type. Always
  // requires confirmation (see requires_confirmation() in ai_command.py)
  // and applies as ONE undo/redo history entry through
  // useEmailBuilderState.ts's addComposedModules — see
  // EmailBuilderWorkspacePage.tsx's handleApplyAiAction.
  | { type: 'COMPOSE_EMAIL'; items: AIComposeItem[] }
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
  | { kind: 'document'; issueId: string; documentPatch: Record<string, unknown> }
  // R4-C1 — column ratio repair, routed through the EXISTING
  // updateColumnWidths mutator (layoutModel.ts's own width-sum/min-width
  // clamping — the SAME authority RESTRUCTURE_LAYOUT already defers to,
  // never a second geometry check).
  | { kind: 'restructure'; issueId: string; moduleId: string; widths: number[] }
  // R4-C1 — a column's OWN settings (background/padding), routed through
  // the EXISTING updateColumnSettings mutator. Not a new EDM capability —
  // ColumnContainerSettings already has these fields and the Properties
  // panel already edits them one column at a time; this only wires the
  // SAME existing per-column mutator into the batch repair-apply path so
  // a reconstruction candidate touching a column can share one history
  // commit with every other repair in the same batch.
  | { kind: 'column-settings'; issueId: string; layoutId: string; columnId: string; settingsPatch: Record<string, unknown> };

export const DOCUMENT_SCOPE_ACTION_TYPES = new Set<AICommandAction['type']>([
  'SET_RESET_CSS_ENABLED', 'SET_CUSTOM_CSS_ENABLED', 'SET_CUSTOM_CSS', 'CLEAR_CUSTOM_CSS',
  'SET_EMAIL_TITLE', 'SET_EMAIL_SUBJECT', 'SET_FAVICON', 'CLEAR_FAVICON',
]);

export interface AICommandSelectedModuleContext {
  type: AICommandModuleType;
  // D4-E2 item 2 — the module's own id, passed through so the backend's
  // active-target context can carry module_id. Optional/additive: the
  // AI Engineer already worked correctly without it (via type + props
  // alone); this only lets the model state unambiguously that an
  // already-resolved selection IS the target, without asking the user
  // to re-select it. ReferenceResolver.ts remains the sole authority on
  // WHICH module is selected — this field is never used to resolve that.
  id?: string;
  props: Record<string, unknown>;
}

// E9 — a small, informational description of the currently selected
// COLUMN (never full column content). Today this only helps the model
// phrase a more grounded reply ("the second column of this layout...");
// it does not yet drive a real column-scoped edit action — see
// AIEngineerPanel's own docstring for that disclosed, honest gap.
export interface AICommandSelectedColumnContext {
  layout_module_type: AICommandModuleType;
  column_index: number;
}

// E9 — bounded, whitelisted validation context (never the full
// ValidationReport). Mirrors ValidationIssue's own small, already-public
// fields — nothing here is derived beyond what Validation Center already
// shows the user.
export interface AICommandValidationIssueContext {
  id: string;
  title: string;
  detail: string;
  severity: 'error' | 'warning';
  category: string;
}

// E10 — one bounded prior turn. See aiConversationStorage.ts's
// boundedHistoryForRequest for the actual cap enforced before this is
// ever sent.
export interface AICommandHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

// R4-A (Import HTML AI Reconstruction) — the same "small, whitelisted,
// bounded" contract selected_validation_issue already established for
// E9, applied to an Import Review reconstruction instead of a
// validation issue. Never the raw imported HTML, never a full
// DetectedStructure/FidelityReport dump — see
// importReconstructionContext.ts's buildImportReconstructionContext,
// the ONE place that condenses those two (already-existing, R1/R2)
// artifacts into this shape. Field names are snake_case to match the
// wire format exactly, same convention as AIComposeItem above.
export interface AICommandImportFindingSummary {
  category: string;
  source: string;
  location: string;
  reason: string;
}

export interface AICommandFidelityCategorySummary {
  id: string;
  status: string;
  summary: string;
  finding_count: number;
  // Capped sample, never the full findings list for a category with
  // many — see MAX_SAMPLE_FINDINGS_PER_CATEGORY in
  // importReconstructionContext.ts.
  sample_findings: AICommandImportFindingSummary[];
}

export interface AICommandRegionSummary {
  role: string;
  confidence: number;
  source_position: string;
  // First ~120 chars only — a preview for grounding, never the full
  // source text of every region in the document.
  content_preview?: string;
  column_ratio?: number[];
  has_image: boolean;
  has_links: boolean;
  background_color?: string;
  align?: string;
}

export interface AICommandImportReconstructionContext {
  document_width: number;
  module_count: number;
  // The TRUE total number of detected regions, even when `regions`
  // below has been capped/truncated — so the model knows it may be
  // seeing a partial list, never silently assumes completeness.
  region_count: number;
  regions: AICommandRegionSummary[];
  // Always exactly the 8 FidelityReport categories, in FIDELITY_CATEGORY_ORDER.
  fidelity_categories: AICommandFidelityCategorySummary[];
  has_mso_conditional_content: boolean;
}

export interface AICommandRequest {
  message: string;
  selected_module?: AICommandSelectedModuleContext | null;
  platform?: string | null;
  width?: number | null;
  // E9 — additive, optional context. Every existing caller/test that
  // omits these keeps compiling and behaving unchanged.
  editor_mode?: string | null;
  selected_column?: AICommandSelectedColumnContext | null;
  selected_validation_issue?: AICommandValidationIssueContext | null;
  // E10 — bounded prior turns for this SAME document's conversation only.
  conversation_history?: AICommandHistoryTurn[];
  // R4-A — additive, optional; present only for an Import Review
  // reconstruction-review conversation (see
  // ImportReviewWorkspace.tsx/AIEngineerPanel.tsx's R4-B wiring). Every
  // existing caller/test that omits this keeps compiling and behaving
  // unchanged, same convention as every prior additive context field.
  import_reconstruction?: AICommandImportReconstructionContext | null;
  // R4-B4 Closure §B/§C — present only when referenceResolver.ts's
  // resolveCopySourceRequest has already resolved a "same X as the
  // previous section/layout" request and read the value client-side.
  // Every existing caller/test that omits this keeps compiling and
  // behaving unchanged, same convention as every prior additive context
  // field.
  copy_source?: AICommandCopySourceContext | null;
  // D4-E3G — present only when referenceResolver.ts's
  // resolveMultipleReferences has already resolved 2+ distinct
  // cross-module targets for this message (see AIEngineerPanel.tsx's
  // wiring). Every existing caller/test that omits this keeps compiling
  // and behaving unchanged, same convention as every prior additive
  // context field.
  resolved_targets?: AICommandResolvedTargetContext[];
  // D4-E3J §3/§6 — real modules the frontend's resolveExclusions() (new,
  // referenceResolver.ts) already resolved as explicitly preserved
  // ("leave the footer alone", "except the footer CTA"). Same shape/trust
  // posture as resolved_targets above. Every existing caller/test that
  // omits this keeps compiling and behaving unchanged.
  excluded_targets?: AICommandResolvedTargetContext[];
  // D4-E3H §20/§4 — diagnostics-only: did this turn's target come from
  // the reference resolver (anaphora/follow-up) rather than the live
  // canvas selection. Never read for routing or validation server-side.
  reference_resolved?: boolean;
  // D4-E3I §3 — a bounded, manifest-driven document overview (ordered
  // top-level module TYPES only, never props/content/nested children).
  // Rides along on GET_DOCUMENT_SUMMARY's existing bounded tool-call
  // result server-side — never dumped into every prompt inline.
  document_summary?: AICommandDocumentSummaryContext;
}

export interface AICommandDocumentSummaryContext {
  module_count: number;
  module_types: AICommandModuleType[];
}

export interface AICommandCopySourceContext {
  property: 'padding' | 'backgroundColor' | 'align' | 'columnRatio';
  value: unknown;
  source_label: string;
}

// D4-E3G — mirrors backend/emailbuilder/serializers.py's
// ResolvedTargetContextSerializer exactly (snake_case field names match
// the wire format). `matched_phrase` is used server-side ONLY to
// independently scope-gate/correct that one operation against its own
// segment (see ai_command.py's apply_scope_gate()/
// apply_semantic_consistency_gate() target_segments parameter) — never to
// drive the mutation itself.
export interface AICommandResolvedTargetContext {
  id: string;
  type: AICommandModuleType;
  label: string;
  matched_phrase: string;
  // D4-E3G hardening — this ONE resolved module's own current editable
  // props (same shape as AICommandSelectedModuleContext.props), used by
  // the backend's deterministic cross-module planner for relative
  // requests ("make it bigger") and by the LLM tier (residual reasoning
  // path) for per-target capability grounding. Never the whole document.
  props?: Record<string, unknown>;
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
    case 'BATCH_UPDATE': {
      const propsKeys = action.props_patch ? Object.keys(action.props_patch) : [];
      const settingsKeys = action.settings_patch ? Object.keys(action.settings_patch) : [];
      const parts = [...propsKeys, ...settingsKeys];
      return `Update the selected ${action.module_type} module (${parts.join(', ') || 'no changes'})`;
    }
    case 'MULTI_MODULE_UPDATE': {
      const moduleTypes = action.operations.map((op) => op.module_type);
      return `Update ${action.operations.length} modules: ${moduleTypes.join(', ')}`;
    }
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
    case 'COMPOSE_EMAIL': {
      const topLevelCount = action.items.length;
      return `Compose a full email with ${topLevelCount} section${topLevelCount === 1 ? '' : 's'}`;
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
