// Module-4 E7 — Validation Explanation system. Deliberately entirely
// CLIENT-SIDE and zero-network, same posture as aiDocumentIntelligence.ts/
// repairEngine.ts (item 7: one canonical ValidationReport, never a second
// rule set or a second content source) — every field here is built
// directly from the SAME ValidationIssue Validation Center already shows,
// never a fabricated fact. The category-level "why it matters"/"what can
// happen" framing is general, well-established email-development
// knowledge (never issue-specific invented detail); the issue-specific
// claim always comes from the issue's own real `detail` string.
import { getModuleDefinition } from './moduleRegistry';
import { findModuleById } from './layoutModel';
import { affectedClientLabel } from './repairEngine';
import type { ValidationCategoryId, ValidationIssue } from './emailValidation';
import type { EmailModule } from './edm';

const CATEGORY_WHY_IT_MATTERS: Record<ValidationCategoryId, string> = {
  document: 'Document-level settings issues affect metadata Email Settings controls (title, subject, favicon, Reset CSS, Custom CSS) — even when not a rendering-safety issue, an unresolved one can leave the compatibility baseline off or a security check unresolved.',
  html: 'HTML issues affect how reliably email clients parse and render the message\'s markup — a structural or attribute issue here can break layout in strict-parsing clients.',
  outlook: 'Outlook issues affect Microsoft Outlook\'s desktop Word rendering engine specifically — it does not support many modern CSS features and needs MSO-specific fallbacks instead.',
  responsive: 'Responsive issues affect how the email adapts to narrow (mobile) viewports — an unresolved issue can cause overflow, unreadable text, or a broken layout on a phone.',
  accessibility: 'Accessibility issues affect people relying on screen readers or high-contrast/zoom settings — an unresolved issue can make content unreadable or unusable for them.',
  links: 'Link issues affect whether recipients can safely and reliably follow a link — an unresolved issue can break click tracking, break the link entirely, or expose an unsafe URL.',
  images: 'Image issues affect how reliably images load and degrade gracefully when blocked — many email clients block remote images by default.',
  'dark-mode': 'Dark Mode issues affect how the email looks when a client auto-inverts colors for its dark theme — an unresolved issue can produce illegible or visually broken content.',
  platform: 'Platform Compatibility issues affect how the email behaves on the specific platform this document targets — an unresolved issue can break platform-specific personalization or sending.',
};

export interface IssueExplanation {
  whatIsWrong: string;
  whyItMatters: string;
  where: string;
  affectedClients: string;
  whatCanHappen: string;
  canAutoFix: boolean;
  howToFix: string;
}

function whereLabel(issue: ValidationIssue, modules: EmailModule[]): string {
  if (!issue.moduleId) return 'Document-level (Email Settings), not tied to one specific module.';
  const module = findModuleById(modules, issue.moduleId);
  if (!module) return 'A module that no longer exists in this document.';
  const label = getModuleDefinition(module.type)?.label ?? module.type;
  return `The selected ${label} module on the canvas.`;
}

function howToFixText(issue: ValidationIssue): string {
  if (issue.fixType === 'safe') {
    return 'Yes — this can be fixed automatically. Click "Fix" (or "Fix Issues") to apply the deterministic, safe repair directly, or ask the AI Engineer to explain it further first.';
  }
  if (issue.fixType === 'manual' && issue.moduleId) {
    return 'This needs a manual decision — it may change the design, so it is not auto-applied. Open the module (use "Go to module") and adjust it directly, or ask the AI Engineer to propose a change for you to review.';
  }
  if (issue.fixType === 'manual') {
    return 'This needs a manual decision in Email Settings — it is not auto-applied because it may be an intentional choice.';
  }
  return 'This is informational only — there is no fix to apply; it is either already correct or not something this app can change directly.';
}

// Pure — no network, no side effects, safe to call on every render.
export function explainIssue(issue: ValidationIssue, modules: EmailModule[]): IssueExplanation {
  return {
    whatIsWrong: issue.title,
    whyItMatters: `${CATEGORY_WHY_IT_MATTERS[issue.category]} ${issue.detail}`,
    where: whereLabel(issue, modules),
    affectedClients: affectedClientLabel(issue.id),
    whatCanHappen: issue.severity === 'error'
      ? 'This is flagged as an error — left unresolved, it is likely to visibly break or meaningfully degrade the email for at least some recipients, not just a minor inconsistency.'
      : 'This is flagged as a warning — left unresolved, it is a real but lower-severity risk, not a guaranteed break for every recipient.',
    canAutoFix: issue.fixType === 'safe',
    howToFix: howToFixText(issue),
  };
}
