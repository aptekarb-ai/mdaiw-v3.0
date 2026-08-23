// Sub-phase 4, item 2/4 — the Email AI Engineer's document-level
// "understand, diagnose, explain, repair" intents. Deliberately entirely
// CLIENT-SIDE and zero-network: only the client has a live rendered HTML
// + ValidationReport (the backend never renders a document — see
// htmlRenderer.ts/emailValidation.ts), so routing these through a
// backend round-trip would mean either duplicating validation logic
// server-side (a second, divergence-prone rule set — exactly what item 7
// forbids) or sending the whole rendered HTML over the wire for no
// benefit. Every diagnostic reply is built directly from the SAME
// ValidationReport Validation Center already shows (item 7); every
// repair proposal is built from repairEngine.ts's candidates (item 4) —
// zero OpenAI/local-AI tokens, exactly like backend/emailbuilder's
// RuleBasedEmailCommandProvider is for module/CSS commands.
//
// Bounded vocabulary, same posture as the backend's deterministic router
// (see ai_command.py's RuleBasedEmailCommandProvider docstring):
// recognizes a documented set of English phrasings, not arbitrary
// natural language. Anything unmatched returns null so the caller falls
// through to the normal backend-routed command flow unchanged.
import { getModuleDefinition } from './moduleRegistry';
import { findModuleById } from './layoutModel';
import { buildRepairCandidates, type RepairCandidate } from './repairEngine';
import type { ValidationIssue, ValidationReport } from './emailValidation';
import type { EmailModule } from './edm';
import type { EmailDocumentSettingsSnapshot } from './useEmailBuilderState';

export type DocumentIntentKind =
  | 'diagnose-classic-outlook'
  | 'diagnose-new-outlook'
  | 'whats-wrong-head'
  | 'which-module'
  | 'why-custom-css-unsafe'
  | 'validate-complete'
  | 'repair-all-safe'
  | 'repair-keyword';

interface DocumentIntentMatch {
  kind: DocumentIntentKind;
  keyword?: string;
}

const INTENT_PATTERNS: { pattern: RegExp; kind: DocumentIntentKind }[] = [
  // Repair intents checked BEFORE diagnostic ones — "repair all safe
  // outlook problems" mentions "outlook" too and must not be misread as
  // a plain diagnostic question.
  { pattern: /\b(repair|fix)\b.*\ball\b.*\bsafe\b|\ball\s+safe\b.*\b(repair|fix)\b/i, kind: 'repair-all-safe' },
  { pattern: /\bwhy\b.*\b(failing|broken|wrong)\b.*\b(classic\s+outlook|outlook\s+2016)\b/i, kind: 'diagnose-classic-outlook' },
  { pattern: /\bwhy\b.*\bfailing\b.*\boutlook\b/i, kind: 'diagnose-classic-outlook' },
  { pattern: /\bcheck\b.*\bclassic\s+outlook\b|\bclassic\s+outlook\b.*\bissues?\b/i, kind: 'diagnose-classic-outlook' },
  { pattern: /\bcheck\b.*\bnew\s+outlook\b|\bnew\s+outlook\b.*\b(compatib|issues?)\b/i, kind: 'diagnose-new-outlook' },
  { pattern: /\bwhat(?:'s|\s+is)\s+wrong\s+with\s+the\s+head\b/i, kind: 'whats-wrong-head' },
  { pattern: /\bwhich\s+module\b.*\bcauses?\b|\bwhich\s+module\b.*\bcompatib/i, kind: 'which-module' },
  { pattern: /\bwhy\b.*\bcustom\s*css\b.*\bunsafe\b/i, kind: 'why-custom-css-unsafe' },
  { pattern: /\bvalidate\s+(?:the\s+)?(?:complete|whole|entire)?\s*email\b/i, kind: 'validate-complete' },
  // "add the required Outlook metadata" — deliberately scoped to
  // metadata/Outlook-specific nouns, never a bare "add", so it can never
  // collide with a genuine module-insert command like "add a button"
  // (which must fall through to the backend's INSERT_MODULE flow).
  { pattern: /\badd\b.*\b(outlook\s*metadata|required\s*metadata|office\s*document\s*settings|dpi|allowpng|vml\s*namespace)\b/i, kind: 'repair-keyword' },
  // Generic "repair"/"fix" + a topic keyword — checked last so the more
  // specific patterns above always win first.
  { pattern: /\b(repair|fix)\b/i, kind: 'repair-keyword' },
];

// Maps a keyword the user typed to an issue-id FRAGMENT (substring match
// against ValidationIssue.id) — bounded, explicit, same style as
// backend/emailbuilder/ai_command.py's _EXPLAIN_TOPICS.
const REPAIR_KEYWORD_HINTS: [RegExp, string][] = [
  [/\bdpi\b|\bpixels\s*per\s*inch\b|\ballow\s*png\b|\b(?:outlook\s*)?metadata\b/i, 'missing-office-dpi'],
  [/\breset\s*css\b/i, 'reset-css-disabled'],
  [/\bfavicon\b/i, 'invalid-favicon'],
  [/\bcustom\s*css\b/i, 'custom-css-security'],
  [/\bnamespace\b/i, 'namespace'],
  [/\brow[\s-]*collapse\b/i, 'row-collapse'],
  [/\bconditional\s*comment\b/i, 'conditional-comment'],
  [/\btitle\b/i, 'missing-title'],
  [/\bsubject\b/i, 'missing-subject'],
];

export function matchDocumentIntent(message: string): DocumentIntentMatch | null {
  const lowered = message.trim().toLowerCase();
  if (!lowered) return null;
  for (const { pattern, kind } of INTENT_PATTERNS) {
    if (pattern.test(lowered)) {
      return kind === 'repair-keyword' ? { kind, keyword: lowered } : { kind };
    }
  }
  return null;
}

function issuesByKeyword(report: ValidationReport, keyword: string): ValidationIssue[] {
  for (const [pattern, fragment] of REPAIR_KEYWORD_HINTS) {
    if (pattern.test(keyword)) {
      const matches = report.issues.filter((issue) => issue.id.includes(fragment));
      if (matches.length > 0) return matches;
    }
  }
  return [];
}

function summarizeIssues(issues: ValidationIssue[], noneMessage: string): string {
  if (issues.length === 0) return noneMessage;
  const lines = issues.map((issue) => `• ${issue.title} — ${issue.detail}`);
  return `Found ${issues.length} issue${issues.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
}

export interface DocumentIntentResult {
  reply: string;
  // Present only for a repair intent that found at least one SAFE,
  // deterministically-fixable candidate — AIEngineerPanel turns this into
  // a pending REPAIR_ISSUES proposal (Apply/Cancel), never an immediate
  // mutation (item 4's "no repair may silently execute").
  repairCandidates?: RepairCandidate[];
}

export function resolveDocumentIntent(
  match: DocumentIntentMatch,
  report: ValidationReport,
  modules: EmailModule[],
  documentSettings: EmailDocumentSettingsSnapshot,
): DocumentIntentResult {
  switch (match.kind) {
    case 'diagnose-classic-outlook': {
      const issues = report.issues.filter((issue) => issue.id.startsWith('outlook-classic:'));
      return { reply: summarizeIssues(issues, 'No Classic Outlook compatibility problems were found — the required Outlook metadata and scoping are already correct.') };
    }
    case 'diagnose-new-outlook': {
      const issues = report.issues.filter((issue) => issue.id.startsWith('outlook-new:'));
      return { reply: summarizeIssues(issues, 'No New Outlook compatibility concerns were found. New Outlook uses a web rendering engine, not the Word engine, so it is unaffected by MSO conditional comments — only real VML usage would concern it.') };
    }
    case 'whats-wrong-head': {
      const issues = report.issues.filter((issue) => issue.category === 'document');
      return { reply: summarizeIssues(issues, 'Nothing is wrong with the document head — title, subject, favicon, Reset CSS, Custom CSS, and the required meta/Outlook baseline all check out.') };
    }
    case 'which-module': {
      const withModule = report.issues.filter((issue): issue is ValidationIssue & { moduleId: string } => Boolean(issue.moduleId));
      if (withModule.length === 0) {
        return { reply: 'No currently-found issue traces back to a specific module — the issues present (if any) are document- or platform-level, not module-specific.' };
      }
      const lines = withModule.map((issue) => {
        const module = findModuleById(modules, issue.moduleId);
        const label = module ? getModuleDefinition(module.type)?.label ?? module.type : issue.moduleId;
        return `• ${label} module — ${issue.title}`;
      });
      return { reply: `These modules have a compatibility or accessibility issue:\n${lines.join('\n')}` };
    }
    case 'why-custom-css-unsafe': {
      const issue = report.issues.find((i) => i.id === 'document:custom-css-security');
      if (!issue) {
        return { reply: documentSettings.custom_css_enabled && documentSettings.custom_css.trim() !== ''
          ? 'Your current Custom CSS passed the security check — nothing unsafe was found in it.'
          : 'Custom CSS is not currently enabled, so there is nothing to check.' };
      }
      return { reply: issue.detail };
    }
    case 'validate-complete': {
      const categoryLines = report.categories.map((c) => `• ${c.label}: ${c.status === 'good' ? 'Good' : c.status === 'needs-improvement' ? 'Needs improvement' : 'Needs attention'}`);
      return { reply: `Email Health Score: ${report.score}/100, ${report.issues.length} issue${report.issues.length === 1 ? '' : 's'} found.\n${categoryLines.join('\n')}` };
    }
    case 'repair-all-safe': {
      const candidates = buildRepairCandidates(report, modules, documentSettings);
      if (candidates.length === 0) {
        return { reply: 'No safely auto-fixable issues were found — everything that can be repaired automatically already has been, or the remaining issues need a manual decision.' };
      }
      const lines = candidates.map((c) => `• ${c.title} (${c.affectedClient}): ${c.before} → ${c.after}`);
      return {
        reply: `I found ${candidates.length} safely auto-fixable issue${candidates.length === 1 ? '' : 's'}:\n${lines.join('\n')}\nReview the proposed changes below.`,
        repairCandidates: candidates,
      };
    }
    case 'repair-keyword': {
      const matchedIssues = issuesByKeyword(report, match.keyword ?? '');
      if (matchedIssues.length === 0) {
        return { reply: 'I could not find a matching problem in this document — it may already be correct. Try "validate the complete email" to see the full report.' };
      }
      const allCandidates = buildRepairCandidates(report, modules, documentSettings);
      const matchedIds = new Set(matchedIssues.map((issue) => issue.id));
      const candidates = allCandidates.filter((candidate) => matchedIds.has(candidate.issueId));
      if (candidates.length === 0) {
        const issue = matchedIssues[0];
        return { reply: `I found the issue — ${issue.title}: ${issue.detail} — but it does not have a safe, fully-automatic fix. ${issue.moduleId ? 'Open the module in the canvas to adjust it manually.' : 'Please adjust it in Document Settings.'}` };
      }
      const lines = candidates.map((c) => `• ${c.title} (${c.affectedClient}): ${c.before} → ${c.after}`);
      return {
        reply: `I found a fix for that:\n${lines.join('\n')}\nReview the proposed change below.`,
        repairCandidates: candidates,
      };
    }
    default:
      return { reply: 'I could not process that request.' };
  }
}
