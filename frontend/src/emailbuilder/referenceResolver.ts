import type { EmailModule } from './edm';
import type { AICommandImportReconstructionContext } from './aiCommand';

// R4-B3 §B — the Referential Context Resolver R4-B2's own report
// identified as missing. Resolves referring expressions ("it", "this
// button", "the second column", "the imported one", "that issue we
// discussed", ...) against BOUNDED, already-available conversation/
// document state, using the exact priority order the spec gives:
// current explicit selection -> selected validation issue -> selected
// column -> selected module -> import reconstruction region ->
// immediately previous conversational referent -> document context.
//
// Runs entirely client-side, BEFORE any backend call — a genuinely
// ambiguous reference is answered with a clarifying question locally
// (no wasted /ai-command/ round trip, no risk of an LLM silently
// guessing wrong); an unambiguous one is resolved to a short, explicit
// grounding note that gets shown to the user as part of the outgoing
// turn's context, never invented from text pattern-matching alone when
// more than one real candidate exists.
//
// This is intentionally a PATTERN-BASED signal detector, not a full NLU
// parser — see the module's own test file for the exact phrase set this
// must handle (drawn directly from the R4-B3 spec's own examples).
// English-focused, matching every example phrase in the spec; a message
// this resolver does not recognize as containing a referring expression
// passes through completely unchanged (the common case — most messages,
// and most non-English messages, have nothing for it to do).

export type LastReferentKind = 'module' | 'validationIssue' | 'reconstructionCategory';

export interface LastReferent {
  kind: LastReferentKind;
  id: string;
  label: string;
}

export interface ResolverModuleSummary {
  id: string;
  type: string;
  label: string;
}

export interface ResolverValidationIssueSummary {
  id: string;
  title: string;
  category: string;
}

export interface ReferentialResolutionContext {
  message: string;
  modules: EmailModule[];
  selectedModule: ResolverModuleSummary | null;
  selectedColumn: { layoutModuleId: string; layoutModuleType: string; columnIndex: number } | null;
  lastDiscussedValidationIssue: ResolverValidationIssueSummary | null;
  openValidationIssues: ResolverValidationIssueSummary[];
  importReconstructionContext: AICommandImportReconstructionContext | null;
  lastDiscussedReconstructionCategory: string | null;
  lastReferent: LastReferent | null;
}

export type ReferentialResolution =
  | { status: 'no-referring-expression' }
  | { status: 'resolved'; referent: LastReferent; note: string }
  | { status: 'ambiguous'; clarifyingQuestion: string };

function flattenModules(modules: EmailModule[]): EmailModule[] {
  return modules.flatMap((m) => [m, ...(m.columns ? m.columns.flatMap((c) => flattenModules(c.modules)) : [])]);
}

function moduleLabel(module: EmailModule, index: number): string {
  return `the ${ordinalWord(index + 1)} ${module.type} module`;
}

function ordinalWord(n: number): string {
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  return words[n - 1] ?? `${n}th`;
}

// Maps a plain-language type word to the module-type family it refers
// to: an exact type match, OR a family-prefixed type ("hero-image-cta"
// for "hero"), OR the word appearing as its own '-'-delimited segment
// ("content-image-left" for "image"). Deliberately loose — a false
// POSITIVE here only means "candidate found," which still goes through
// the same current-selection-first / single-candidate / ambiguous-if-
// multiple resolution below, never a silent wrong guess.
function matchesTypeWord(moduleType: string, word: string): boolean {
  if (moduleType === word) return true;
  if (moduleType.startsWith(`${word}-`)) return true;
  return moduleType.split('-').includes(word);
}

const TYPE_WORDS = [
  'button', 'image', 'hero', 'header', 'footer', 'text', 'divider', 'spacer', 'module',
] as const;

const TYPED_MODULE_RE = new RegExp(`\\b(?:this|that|the)\\s+(${TYPE_WORDS.join('|')})\\b`, 'i');
const ORDINAL_COLUMN_RE = /\b(first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th)\s+column\b/i;
const SECTION_RE = /\b(this|that|the|previous)\s+section\b/i;
const RECONSTRUCTION_RE = /\b(?:the\s+)?imported\s+(?:one|version|design)\b|\boriginal\b|\breconstructed(?:\s+version)?\b|\blike\s+before\b|\bsame\s+(?:\w+\s+)?as\s+(?:the\s+)?(?:section\s+)?above\b/i;
const ISSUE_RE = /\bthe\s+issue\s+we\s+discussed\b|\bthat\s+(?:validation\s+)?(?:problem|issue)\b|\bfix\s+it\b|\bthe\s+previous\s+issue\b/i;
const BARE_PRONOUN_RE = /\b(it|this|that)\b/i;

const ORDINAL_INDEX: Record<string, number> = {
  first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3, fifth: 4, '5th': 4, sixth: 5, '6th': 5,
};

export function resolveReference(ctx: ReferentialResolutionContext): ReferentialResolution {
  const { message } = ctx;
  const flat = flattenModules(ctx.modules);

  // 1. Reconstruction reference — "the imported one", "original",
  // "reconstructed version", "like before", "same as above".
  if (RECONSTRUCTION_RE.test(message)) {
    if (!ctx.importReconstructionContext) {
      return {
        status: 'resolved',
        referent: { kind: 'reconstructionCategory', id: 'none', label: 'the imported email' },
        note: 'This conversation has no imported-email reconstruction context — there is no original/reconstructed comparison available here.',
      };
    }
    const categoryId = ctx.lastDiscussedReconstructionCategory ?? 'overall';
    return {
      status: 'resolved',
      referent: { kind: 'reconstructionCategory', id: categoryId, label: `the imported email (${categoryId})` },
      note: `The user is referring to the imported email's reconstruction${ctx.lastDiscussedReconstructionCategory ? `, specifically the ${categoryId} category just discussed` : ''}.`,
    };
  }

  // 2. Issue reference — "that problem", "fix it", "the issue we discussed".
  if (ISSUE_RE.test(message)) {
    if (ctx.lastDiscussedValidationIssue) {
      const issue = ctx.lastDiscussedValidationIssue;
      return {
        status: 'resolved',
        referent: { kind: 'validationIssue', id: issue.id, label: issue.title },
        note: `The user is referring to the previously discussed issue: "${issue.title}".`,
      };
    }
    if (ctx.openValidationIssues.length === 1) {
      const issue = ctx.openValidationIssues[0];
      return {
        status: 'resolved',
        referent: { kind: 'validationIssue', id: issue.id, label: issue.title },
        note: `The user is referring to the only unresolved issue: "${issue.title}".`,
      };
    }
    if (ctx.openValidationIssues.length > 1) {
      const titles = ctx.openValidationIssues.map((i) => i.title);
      return {
        status: 'ambiguous',
        clarifyingQuestion: `There are ${titles.length} unresolved issues here: ${titles.join(', ')}. Which one would you like me to handle?`,
      };
    }
    // No known issue at all — let the assistant say so naturally rather
    // than fabricate a target; not an ambiguity (nothing to choose among).
    return {
      status: 'resolved',
      referent: { kind: 'validationIssue', id: 'none', label: 'no known issue' },
      note: 'There is no previously discussed or currently open validation issue to refer to.',
    };
  }

  // 3. Ordinal column — "the second column".
  const ordinalMatch = message.match(ORDINAL_COLUMN_RE);
  if (ordinalMatch) {
    const index = ORDINAL_INDEX[ordinalMatch[1].toLowerCase()];
    const layoutModules = flat.filter((m) => Array.isArray(m.columns) && m.columns.length > 0);
    if (ctx.selectedColumn) {
      return {
        status: 'resolved',
        referent: { kind: 'module', id: ctx.selectedColumn.layoutModuleId, label: `column ${index + 1} of the currently selected layout module` },
        note: `The user is referring to column index ${index} of the currently selected layout module.`,
      };
    }
    if (layoutModules.length === 1 && layoutModules[0].columns && index < layoutModules[0].columns.length) {
      return {
        status: 'resolved',
        referent: { kind: 'module', id: layoutModules[0].id, label: `column ${index + 1} of the only layout module` },
        note: `The user is referring to column index ${index} of the document's only layout module.`,
      };
    }
    if (layoutModules.length > 1) {
      return {
        status: 'ambiguous',
        clarifyingQuestion: `There are ${layoutModules.length} multi-column sections in this email. Which one's column ${index + 1} do you mean?`,
      };
    }
    return {
      status: 'resolved',
      referent: { kind: 'module', id: 'none', label: 'no matching column' },
      note: `No layout module has a column at index ${index}.`,
    };
  }

  // 4. Typed module reference — "this button", "that image", "the hero".
  const typedMatch = message.match(TYPED_MODULE_RE);
  if (typedMatch) {
    const word = typedMatch[1].toLowerCase();
    if (word !== 'module' && ctx.selectedModule && matchesTypeWord(ctx.selectedModule.type, word)) {
      return {
        status: 'resolved',
        referent: { kind: 'module', id: ctx.selectedModule.id, label: ctx.selectedModule.label },
        note: `The user is referring to the currently selected ${ctx.selectedModule.type} module.`,
      };
    }
    if (word === 'module' && ctx.selectedModule) {
      return {
        status: 'resolved',
        referent: { kind: 'module', id: ctx.selectedModule.id, label: ctx.selectedModule.label },
        note: `The user is referring to the currently selected module.`,
      };
    }
    const candidates = word === 'module' ? flat : flat.filter((m) => matchesTypeWord(m.type, word));
    if (candidates.length === 1) {
      const only = candidates[0];
      const index = flat.indexOf(only);
      return {
        status: 'resolved',
        referent: { kind: 'module', id: only.id, label: moduleLabel(only, index) },
        note: `The user is referring to the document's only ${word} module.`,
      };
    }
    if (candidates.length > 1) {
      const labels = candidates.map((m) => moduleLabel(m, flat.indexOf(m)));
      return {
        status: 'ambiguous',
        clarifyingQuestion: `There are ${candidates.length} ${word} modules in this email — ${labels.join(', ')}. Which one do you mean?`,
      };
    }
    return {
      status: 'resolved',
      referent: { kind: 'module', id: 'none', label: `no ${word} module` },
      note: `There is no ${word} module in this document.`,
    };
  }

  // 5. Section reference — "this section", "the previous section".
  if (SECTION_RE.test(message)) {
    if (ctx.selectedModule) {
      return {
        status: 'resolved',
        referent: { kind: 'module', id: ctx.selectedModule.id, label: ctx.selectedModule.label },
        note: `The user is referring to the section containing the currently selected module.`,
      };
    }
    if (ctx.lastReferent?.kind === 'module') {
      return {
        status: 'resolved',
        referent: ctx.lastReferent,
        note: `The user is referring to the previously discussed section (${ctx.lastReferent.label}).`,
      };
    }
    // Zero usable candidates, not multiple — this is "nothing to
    // disambiguate," not the "more than one real candidate" case §B
    // reserves 'ambiguous' for. Pass through untouched; the backend/LLM
    // tier's own natural-language handling covers this better than a
    // second, locally-invented generic prompt would.
    return { status: 'no-referring-expression' };
  }

  // 6. Bare pronoun only — "it", "this", "that" with nothing more
  // specific already matched above. Priority chain per spec: current
  // explicit selection -> selected validation issue -> import
  // reconstruction -> previous conversational referent -> ambiguous.
  if (BARE_PRONOUN_RE.test(message)) {
    if (ctx.selectedModule) {
      return {
        status: 'resolved',
        referent: { kind: 'module', id: ctx.selectedModule.id, label: ctx.selectedModule.label },
        note: `The user is referring to the currently selected ${ctx.selectedModule.type} module.`,
      };
    }
    if (ctx.lastDiscussedValidationIssue) {
      const issue = ctx.lastDiscussedValidationIssue;
      return {
        status: 'resolved',
        referent: { kind: 'validationIssue', id: issue.id, label: issue.title },
        note: `The user is referring to the previously discussed issue: "${issue.title}".`,
      };
    }
    if (ctx.importReconstructionContext && ctx.lastDiscussedReconstructionCategory) {
      return {
        status: 'resolved',
        referent: { kind: 'reconstructionCategory', id: ctx.lastDiscussedReconstructionCategory, label: `the ${ctx.lastDiscussedReconstructionCategory} reconstruction difference` },
        note: `The user is referring to the previously discussed ${ctx.lastDiscussedReconstructionCategory} reconstruction difference.`,
      };
    }
    if (ctx.lastReferent) {
      return {
        status: 'resolved',
        referent: ctx.lastReferent,
        note: `The user is referring to what was just discussed: ${ctx.lastReferent.label}.`,
      };
    }
    if (ctx.openValidationIssues.length > 1) {
      const titles = ctx.openValidationIssues.map((i) => i.title);
      return {
        status: 'ambiguous',
        clarifyingQuestion: `Nothing is currently selected. There are ${titles.length} unresolved issues here: ${titles.join(', ')}. Which one do you mean, or would you like to select a module first?`,
      };
    }
    if (ctx.openValidationIssues.length === 1) {
      const issue = ctx.openValidationIssues[0];
      return {
        status: 'resolved',
        referent: { kind: 'validationIssue', id: issue.id, label: issue.title },
        note: `Nothing is selected; the only unresolved issue is "${issue.title}", so the user likely means that.`,
      };
    }
    // Zero usable candidates anywhere in the priority chain — not
    // "multiple plausible candidates," so this is not the case §B
    // reserves local clarification for. Pass through: the backend/LLM
    // tier already has its own (and, per §E, increasingly context-aware)
    // handling for a genuinely unresolvable bare reference.
    return { status: 'no-referring-expression' };
  }

  return { status: 'no-referring-expression' };
}
