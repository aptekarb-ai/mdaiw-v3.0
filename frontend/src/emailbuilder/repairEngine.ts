// Sub-phase 4, item 4 — the Repair Engine. Connects Validation Center
// findings to AI Engineer repair proposals WITHOUT a second validation
// pass or a second notion of "which issues exist" — every candidate here
// is built directly from a ValidationReport the SAME validateEmail()
// Validation Center already computed (item 7: one canonical rule set,
// never two). This module is pure/deterministic — zero network, zero
// OpenAI/local-AI tokens — the proposal-before-apply UI (AIEngineerPanel)
// is what makes "no repair may silently execute" true, not this module.
import { findModuleById } from './layoutModel';
import type { RepairActionItem } from './aiCommand';
import type { ValidationIssue, ValidationReport } from './emailValidation';
import type { EmailModule } from './edm';
import type { EmailDocumentSettingsSnapshot } from './useEmailBuilderState';

export interface RepairCandidate {
  issueId: string;
  title: string;
  detail: string;
  severity: ValidationIssue['severity'];
  category: ValidationIssue['category'];
  // "Classic Outlook" / "New Outlook (web engine)" / "All email clients"
  // — derived from the issue id's own outlook-classic:/outlook-new:
  // prefix convention (Sub-phase 3), never a second client-classification
  // scheme (item 5/7).
  affectedClient: string;
  moduleId?: string;
  before: string;
  after: string;
  // Every candidate here is fixType 'safe' by construction (see
  // buildRepairCandidates), so confidence is always 1.0 and
  // safeAutoFix is always true — deterministic repairs, not a model
  // guess. Kept as explicit fields (rather than implied) because item
  // 4 requires exposing confidence/safe-auto-fix-status on every
  // proposed repair, not just implying it.
  confidence: number;
  safeAutoFix: true;
  item: RepairActionItem;
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(not set)';
  if (value === '') return '(empty)';
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  return String(value);
}

export function affectedClientLabel(issueId: string): string {
  if (issueId.startsWith('outlook-classic:')) return 'Classic Outlook';
  if (issueId.startsWith('outlook-new:')) return 'New Outlook (web engine)';
  return 'All email clients';
}

// ValidationIssue ids follow `<category>:<rule-slug>:<instanceId>` (some
// rules have no per-instance suffix at all and are already stable). The
// trailing instanceId segment is per-document/per-module and must never be
// persisted as a learning signature (Sub-phase 8) — only the first two
// segments identify a stable, cross-document issue type. Keep this the one
// place that derives a signature from an issue id so both panels agree.
export function signatureForIssueId(issueId: string): string {
  const parts = issueId.split(':');
  if (parts.length <= 2) return issueId;
  return parts.slice(0, 2).join(':');
}

// Every ValidationIssue with fixType === 'safe' is a genuine repair
// candidate — nothing here invents a fix for a 'manual' or 'none' issue
// (those have no deterministic, safe, automatic remedy; item 4 explicitly
// scopes deterministic repair to SAFE fixes only). `before` reads the
// REAL current value from the live modules/documentSettings, not a
// placeholder — so the proposal card shows an honest diff.
export function buildRepairCandidates(
  report: ValidationReport,
  modules: EmailModule[],
  documentSettings: EmailDocumentSettingsSnapshot,
): RepairCandidate[] {
  const candidates: RepairCandidate[] = [];

  for (const issue of report.issues) {
    if (issue.fixType !== 'safe' || !issue.safeFix) continue;

    if ('settingsPatch' in issue.safeFix) {
      const { moduleId, settingsPatch } = issue.safeFix;
      const entries = Object.entries(settingsPatch);
      const [key, afterValue] = entries[0] ?? [undefined, undefined];
      const module = findModuleById(modules, moduleId);
      const beforeValue = key && module ? (module.settings as unknown as Record<string, unknown>)[key] : undefined;
      candidates.push({
        issueId: issue.id,
        title: issue.title,
        detail: issue.detail,
        severity: issue.severity,
        category: issue.category,
        affectedClient: affectedClientLabel(issue.id),
        moduleId,
        before: formatValue(beforeValue),
        after: formatValue(afterValue),
        confidence: 1.0,
        safeAutoFix: true,
        item: { kind: 'module-settings', issueId: issue.id, moduleId, settingsPatch },
      });
      continue;
    }

    if ('documentPatch' in issue.safeFix) {
      const entries = Object.entries(issue.safeFix.documentPatch);
      const [key, afterValue] = entries[0] ?? [undefined, undefined];
      if (!key) continue;
      const beforeValue = (documentSettings as unknown as Record<string, unknown>)[key];
      candidates.push({
        issueId: issue.id,
        title: issue.title,
        detail: issue.detail,
        severity: issue.severity,
        category: issue.category,
        affectedClient: affectedClientLabel(issue.id),
        before: formatValue(beforeValue),
        after: formatValue(afterValue),
        confidence: 1.0,
        safeAutoFix: true,
        item: { kind: 'document', issueId: issue.id, documentPatch: issue.safeFix.documentPatch },
      });
    } else {
      const { moduleId, propPatch } = issue.safeFix;
      const entries = Object.entries(propPatch);
      const [key, afterValue] = entries[0] ?? [undefined, undefined];
      const module = findModuleById(modules, moduleId);
      const beforeValue = key && module ? (module.props as Record<string, unknown>)[key] : undefined;
      candidates.push({
        issueId: issue.id,
        title: issue.title,
        detail: issue.detail,
        severity: issue.severity,
        category: issue.category,
        affectedClient: affectedClientLabel(issue.id),
        moduleId,
        before: formatValue(beforeValue),
        after: formatValue(afterValue),
        confidence: 1.0,
        safeAutoFix: true,
        item: { kind: 'module', issueId: issue.id, moduleId, propPatch },
      });
    }
  }

  return candidates;
}

// Splits a set of candidates back into the two mutator-shaped inputs
// applyRepairPatch expects, merging every document-scope candidate's
// patch into ONE object (several document repairs in the same batch —
// e.g. re-enable Reset CSS AND disable unsafe Custom CSS — apply as one
// combined patch, one history commit).
export function toApplyRepairPatchArgs(candidates: RepairCandidate[]): {
  modulePatches: { moduleId: string; propPatch: Record<string, unknown> }[];
  settingsPatches: { moduleId: string; settingsPatch: Record<string, unknown> }[];
  documentPatch: Partial<EmailDocumentSettingsSnapshot> | null;
  // R4-C1 — additive: every existing caller that only reads the three
  // fields above (there are none in production today — see this
  // function's own callers) keeps compiling and behaving unchanged.
  restructurePatches: { moduleId: string; widths: number[] }[];
  columnSettingsPatches: { layoutId: string; columnId: string; settingsPatch: Record<string, unknown> }[];
} {
  const modulePatches: { moduleId: string; propPatch: Record<string, unknown> }[] = [];
  const settingsPatches: { moduleId: string; settingsPatch: Record<string, unknown> }[] = [];
  const restructurePatches: { moduleId: string; widths: number[] }[] = [];
  const columnSettingsPatches: { layoutId: string; columnId: string; settingsPatch: Record<string, unknown> }[] = [];
  let documentPatch: Record<string, unknown> | null = null;

  for (const candidate of candidates) {
    if (candidate.item.kind === 'module') {
      modulePatches.push({ moduleId: candidate.item.moduleId, propPatch: candidate.item.propPatch });
    } else if (candidate.item.kind === 'module-settings') {
      settingsPatches.push({ moduleId: candidate.item.moduleId, settingsPatch: candidate.item.settingsPatch });
    } else if (candidate.item.kind === 'restructure') {
      restructurePatches.push({ moduleId: candidate.item.moduleId, widths: candidate.item.widths });
    } else if (candidate.item.kind === 'column-settings') {
      columnSettingsPatches.push({ layoutId: candidate.item.layoutId, columnId: candidate.item.columnId, settingsPatch: candidate.item.settingsPatch });
    } else {
      documentPatch = { ...(documentPatch ?? {}), ...candidate.item.documentPatch };
    }
  }

  return {
    modulePatches, settingsPatches, restructurePatches, columnSettingsPatches,
    documentPatch: documentPatch as Partial<EmailDocumentSettingsSnapshot> | null,
  };
}
