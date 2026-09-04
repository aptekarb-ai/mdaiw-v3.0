import type { EmailModule } from './edm';
import { isLayoutModuleType } from './layoutModel';
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

// R4-B4 Closure §B/§C — "use the same padding as the previous section",
// "give this the same spacing as the section above", "use the same
// background color as the previous module", "make these columns the
// same ratio as the previous layout". A DIFFERENT kind of resolution
// from resolveReference() above: that function answers "what does 'it'/
// 'this'/'the previous section' refer to" for the TARGET of an ordinary
// command; this one additionally READS a whitelisted property value off
// a resolved SOURCE module so the caller (AIEngineerPanel.tsx) can hand
// it, already-read, to the backend's compute_copy_source_result() —
// which still builds the mutation through the EXISTING UPDATE_MODULE_
// SETTINGS/UPDATE_MODULE_PROPS/RESTRUCTURE_LAYOUT actions and the EXISTING
// validate_action() gate (see that function's own docstring). This
// resolver NEVER mutates anything itself and NEVER reads more than the
// one property family the message names — "no silent guesses" applies
// here exactly as it does to resolveReference().
//
// Deliberately narrow, matching only the source phrasings this pass's
// spec gives verbatim ("the previous section"/"the section above"/"the
// previous module"/"the previous layout") against the TOP-LEVEL document
// order — "section" and "module" are treated as synonyms for one
// top-level EmailModule, one slot before the target. A source resolved
// from inside a column, or an ordinal "column N" SOURCE, is out of
// scope for this pass (see the column-target decline branch below for
// the one column-related example the spec does give) — not a silent
// guess either way, since every unrecognized shape below falls through
// to 'not-a-copy-request' and is handled by the normal command path.
export type CopySourcePropertyFamily = 'padding' | 'backgroundColor' | 'align' | 'columnRatio';

export type CopySourceRequest =
  | { status: 'not-a-copy-request' }
  | { status: 'declined'; message: string }
  | { status: 'resolved'; property: CopySourcePropertyFamily; value: unknown; sourceLabel: string };

const COPY_TRIGGER_RE = /\bsame\b[\s\S]*\bas\b/i;
const PADDING_WORD_RE = /\b(padding|spacing)\b/i;
const BACKGROUND_WORD_RE = /\bbackground\s*colou?r\b/i;
const RATIO_WORD_RE = /\b(ratio|widths?)\b/i;
const ALIGNMENT_WORD_RE = /\balignment\b/i;
const COLUMN_TARGET_RE = /\bthis\s+column\b/i;
const PREVIOUS_SOURCE_RE = /\b(?:the\s+)?(?:previous|prior)\s+(section|module|layout)\b|\b(?:the\s+)?section\s+above\b/i;

const NOT_UNDERSTOOD_SOURCE_MESSAGE =
  'I can copy padding, background color, alignment, or column ratio from "the previous section"/"the section above"/'
  + '"the previous layout" right now — try one of those, or tell me exactly which module to match.';

function readBackgroundColor(module: EmailModule): string | undefined {
  const propsValue = (module.props as Record<string, unknown>)?.backgroundColor;
  if (typeof propsValue === 'string' && propsValue.trim()) return propsValue;
  const settingsValue = module.settings?.backgroundColor;
  return typeof settingsValue === 'string' && settingsValue.trim() ? settingsValue : undefined;
}

function readAlign(module: EmailModule): string | undefined {
  const value = (module.props as Record<string, unknown>)?.align;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

// D4-E3G §5/§6 — cross-module compound-request target resolution
// ("make the hero heading smaller, the CTA green, and center the footer
// text"). A SEPARATE function from resolveReference() above (which only
// ever answers "what is THE ONE thing being referred to"): this one
// segments a message into per-target phrases and resolves EACH segment
// independently, so the caller (AIEngineerPanel.tsx) can hand the backend
// a bounded, already-vouched-for `resolved_targets` list — never asking
// an LLM to invent or enumerate module ids itself (this app never sends
// the live module tree to any AI provider; see GET_DOCUMENT_SUMMARY's own
// documented boundary in ai_command.py).
//
// Reuses the EXACT SAME matchesTypeWord/moduleLabel/ORDINAL_INDEX
// machinery resolveReference() already uses — never a second, parallel
// module-matching system. Every resolution path below follows §6's
// "never guess when genuinely ambiguous" rule: "both X" only resolves
// when EXACTLY two candidates exist; "the other X" only resolves when a
// conversational antecedent (ctx.lastReferent) names one candidate of
// that same type AND exactly one OTHER candidate remains; an ordinal
// ("the first CTA") only resolves when that index is actually in range;
// anything else that can't be pinned down comes back 'ambiguous' with a
// clarifying question, never a silent wrong pick.
export interface ResolvedTarget {
  id: string;
  type: string;
  label: string;
  matchedPhrase: string;
  // D4-E3G hardening — this ONE resolved module's own current editable
  // props (the SAME shape AICommandSelectedModuleContext.props already
  // carries for the single-selection case), so the backend's
  // deterministic cross-module planner can resolve a relative request
  // ("make the CTA text bigger") without ever being sent the rest of the
  // document. Bounded to only the (at most MAX_MULTI_MODULE_OPERATIONS)
  // targets this message actually named — never the full module tree.
  // Optional: populated by the caller (AIEngineerPanel.tsx) from the live
  // module tree; this resolver itself never reads or sets it.
  props?: Record<string, unknown>;
}

export type MultiReferenceItem =
  | { status: 'resolved'; targets: ResolvedTarget[]; matchedPhrase: string }
  | { status: 'ambiguous'; clarifyingQuestion: string; matchedPhrase: string }
  | { status: 'unresolved'; matchedPhrase: string };

export interface MultiReferenceResolution {
  items: MultiReferenceItem[];
}

// "CTA" is this builder's own common shorthand for a button module —
// never a distinct module type of its own (module_capabilities has no
// "cta" type), so it is normalized to 'button' before matchesTypeWord
// ever sees it, exactly like "buttons"/"ctas" plural forms.
const TYPE_ALIASES: Record<string, string> = { cta: 'button', ctas: 'button', buttons: 'button' };

function normalizeTypeWord(word: string): string {
  return TYPE_ALIASES[word.toLowerCase()] ?? word.toLowerCase();
}

const MULTI_REF_TYPE_WORDS = [...TYPE_WORDS, 'cta', 'ctas', 'buttons'] as const;
const MULTI_REF_TYPE_WORD_ALT = MULTI_REF_TYPE_WORDS.join('|');
const MULTI_REF_ORDINAL_ALT = 'first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th';

const ORDINAL_TYPED_RE = new RegExp(`\\b(${MULTI_REF_ORDINAL_ALT})\\s+(${MULTI_REF_TYPE_WORD_ALT})\\b`, 'i');
const BOTH_TYPED_RE = new RegExp(`\\bboth\\s+(${MULTI_REF_TYPE_WORD_ALT})\\b`, 'i');
const OTHER_TYPED_RE = new RegExp(`\\b(?:the\\s+)?other\\s+(${MULTI_REF_TYPE_WORD_ALT})\\b`, 'i');
const BARE_TYPED_RE = new RegExp(`\\b(?:this|that|the)\\s+(${MULTI_REF_TYPE_WORD_ALT})\\b`, 'i');
// D4-E3G hardening §11/§12 — many of the required multilingual examples
// name a module type WITHOUT an English article at all ("Hero ke neeche
// spacing badhao", "CTA ko green karo") — Hindi/Spanish/German/Hinglish
// grammar has no equivalent of "the" placed exactly there. This fallback
// only ever runs AFTER BARE_TYPED_RE (which stays the primary match, same
// priority/behavior as before this hardening pass) fails to find an
// article-led reference — matches the SAME small, closed TYPE_WORDS
// vocabulary as a standalone token anywhere in the segment. Bounded risk:
// this only runs inside resolveMultipleReferences, whose caller
// (AIEngineerPanel.tsx) only ever acts on a result when 2+ DISTINCT real
// targets resolve across the whole message — a single stray match here
// can never, by itself, turn an ordinary single-target message into a
// cross-module one.
const ARTICLE_FREE_TYPED_RE = new RegExp(`\\b(${MULTI_REF_TYPE_WORD_ALT})\\b`, 'i');

// Splits a compound request on top-level conjunctions ("," / " and ") —
// deliberately simple, not a clause parser. A segment that names no
// recognizable module-type word comes back 'unresolved' below and is the
// CALLER's job to fold into whichever target the surrounding segments
// already resolved (e.g. "increase the padding to 20px" inside "make the
// CTA green and increase the padding to 20px" describes the SAME CTA,
// not a second target) — this function only ever reports per-segment
// findings, never merges across segments itself.
//
// D4-E3G hardening §11 — "and" is also matched in the handful of
// languages this app's own canonical multilingual layer already commits
// to (Hindi/Hinglish "aur", Spanish "y", German "und") so a compound
// cross-module request in one of those languages segments the same way
// an English one does; each `\s+word\s+` alternative REQUIRES whitespace
// on both sides, so a short word like "y" can never match as part of a
// longer word. This is a pure vocabulary extension of the SAME splitter,
// never a second, per-language segmentation implementation.
const CONJUNCTION_SPLIT_RE = /\s*,\s*|\s+(?:and|aur|und|y)\s+/i;
const CONJUNCTION_PREFIX_RE = /^(?:and|aur|und|y)\s+/i;

function splitIntoTargetSegments(message: string): string[] {
  return message
    .split(CONJUNCTION_SPLIT_RE)
    .map((segment) => segment.replace(CONJUNCTION_PREFIX_RE, '').trim())
    .filter(Boolean);
}

function candidatesForWord(flat: EmailModule[], rawWord: string): EmailModule[] {
  const word = normalizeTypeWord(rawWord);
  return flat.filter((m) => matchesTypeWord(m.type, word));
}

function resolveSegmentTargets(segment: string, ctx: ReferentialResolutionContext, flat: EmailModule[]): MultiReferenceItem {
  // "both buttons" / "both CTAs" — only meaningful when exactly two
  // candidates of that type exist; more than two is genuinely ambiguous
  // (which two?), fewer than two means there is nothing to pair up.
  const bothMatch = segment.match(BOTH_TYPED_RE);
  if (bothMatch) {
    const word = normalizeTypeWord(bothMatch[1]);
    const candidates = candidatesForWord(flat, word);
    if (candidates.length === 2) {
      return {
        status: 'resolved',
        matchedPhrase: segment,
        targets: candidates.map((m) => ({ id: m.id, type: m.type, label: moduleLabel(m, flat.indexOf(m)), matchedPhrase: segment })),
      };
    }
    if (candidates.length > 2) {
      const labels = candidates.map((m) => moduleLabel(m, flat.indexOf(m)));
      return {
        status: 'ambiguous',
        matchedPhrase: segment,
        clarifyingQuestion: `There are ${candidates.length} ${word} modules — ${labels.join(', ')}. "Both" is ambiguous here; which two do you mean?`,
      };
    }
    return { status: 'unresolved', matchedPhrase: segment };
  }

  // "the other button" / "the other CTA" — only resolves when a
  // conversational antecedent (ctx.lastReferent) names one candidate of
  // this same type AND exactly one other candidate remains; never
  // silently interpreted as an arbitrary next module (§6).
  const otherMatch = segment.match(OTHER_TYPED_RE);
  if (otherMatch) {
    const word = normalizeTypeWord(otherMatch[1]);
    const candidates = candidatesForWord(flat, word);
    const antecedent = ctx.lastReferent?.kind === 'module'
      ? flat.find((m) => m.id === ctx.lastReferent!.id)
      : undefined;
    if (antecedent && matchesTypeWord(antecedent.type, word)) {
      const remaining = candidates.filter((m) => m.id !== antecedent.id);
      if (remaining.length === 1) {
        const only = remaining[0];
        return {
          status: 'resolved',
          matchedPhrase: segment,
          targets: [{ id: only.id, type: only.type, label: moduleLabel(only, flat.indexOf(only)), matchedPhrase: segment }],
        };
      }
      if (remaining.length === 0) {
        return { status: 'unresolved', matchedPhrase: segment };
      }
      const labels = remaining.map((m) => moduleLabel(m, flat.indexOf(m)));
      return {
        status: 'ambiguous',
        matchedPhrase: segment,
        clarifyingQuestion: `There is more than one other ${word} module — ${labels.join(', ')}. Which one do you mean?`,
      };
    }
    return {
      status: 'ambiguous',
      matchedPhrase: segment,
      clarifyingQuestion: `"The other ${word}" isn't clear yet — which ${word} did you mean, and which one is the "other" one?`,
    };
  }

  // "the first CTA" / "second button" — only resolves when that ordinal
  // index is actually within range of the real candidates.
  const ordinalMatch = segment.match(ORDINAL_TYPED_RE);
  if (ordinalMatch) {
    const index = ORDINAL_INDEX[ordinalMatch[1].toLowerCase()];
    const word = normalizeTypeWord(ordinalMatch[2]);
    const candidates = candidatesForWord(flat, word);
    if (index !== undefined && index < candidates.length) {
      const only = candidates[index];
      return {
        status: 'resolved',
        matchedPhrase: segment,
        targets: [{ id: only.id, type: only.type, label: moduleLabel(only, flat.indexOf(only)), matchedPhrase: segment }],
      };
    }
    return { status: 'unresolved', matchedPhrase: segment };
  }

  // Plain typed reference ("the hero", "the footer text") — reuses the
  // SAME current-selection-first / single-candidate / ambiguous-if-
  // multiple priority resolveReference() already uses, scoped to this
  // one segment only.
  const bareMatch = segment.match(BARE_TYPED_RE) ?? segment.match(ARTICLE_FREE_TYPED_RE);
  if (bareMatch) {
    const word = normalizeTypeWord(bareMatch[1]);
    if (word !== 'module' && ctx.selectedModule && matchesTypeWord(ctx.selectedModule.type, word)) {
      return {
        status: 'resolved',
        matchedPhrase: segment,
        targets: [{ id: ctx.selectedModule.id, type: ctx.selectedModule.type, label: ctx.selectedModule.label, matchedPhrase: segment }],
      };
    }
    const candidates = candidatesForWord(flat, word);
    if (candidates.length === 1) {
      const only = candidates[0];
      return {
        status: 'resolved',
        matchedPhrase: segment,
        targets: [{ id: only.id, type: only.type, label: moduleLabel(only, flat.indexOf(only)), matchedPhrase: segment }],
      };
    }
    if (candidates.length > 1) {
      const labels = candidates.map((m) => moduleLabel(m, flat.indexOf(m)));
      return {
        status: 'ambiguous',
        matchedPhrase: segment,
        clarifyingQuestion: `There are ${candidates.length} ${word} modules in this email — ${labels.join(', ')}. Which one do you mean?`,
      };
    }
    return { status: 'unresolved', matchedPhrase: segment };
  }

  return { status: 'unresolved', matchedPhrase: segment };
}

export function resolveMultipleReferences(ctx: ReferentialResolutionContext): MultiReferenceResolution {
  const flat = flattenModules(ctx.modules);
  const segments = splitIntoTargetSegments(ctx.message);
  return { items: segments.map((segment) => resolveSegmentTargets(segment, ctx, flat)) };
}

export function resolveCopySourceRequest(ctx: ReferentialResolutionContext): CopySourceRequest {
  const { message } = ctx;
  if (!COPY_TRIGGER_RE.test(message)) return { status: 'not-a-copy-request' };

  // §B example 4 — "make this column use the same alignment as column
  // 1." Columns genuinely have no horizontal-alignment setting of their
  // own in this builder (ColumnContainerSettings only carries a vertical
  // top/middle/bottom align — see edm.ts) — there is no existing action
  // this could ever route through without inventing a new mutation
  // capability, which §B explicitly forbids. Honest capability decline,
  // matching the spec's own worked example ("the previous module has an
  // image background, but this module type does not support image
  // backgrounds") rather than a silent no-op or a wrong guess.
  if (ALIGNMENT_WORD_RE.test(message) && COLUMN_TARGET_RE.test(message)) {
    return {
      status: 'declined',
      message:
        "Columns don't have their own alignment setting in this builder — alignment is set per module. "
        + "Select the specific module inside the column you'd like to align instead.",
    };
  }

  let property: CopySourcePropertyFamily | null = null;
  if (RATIO_WORD_RE.test(message) && /\b(column|layout)\b/i.test(message)) property = 'columnRatio';
  else if (BACKGROUND_WORD_RE.test(message)) property = 'backgroundColor';
  else if (ALIGNMENT_WORD_RE.test(message)) property = 'align';
  else if (PADDING_WORD_RE.test(message)) property = 'padding';

  if (!property) return { status: 'not-a-copy-request' };

  const sourceMatch = message.match(PREVIOUS_SOURCE_RE);
  if (!sourceMatch) return { status: 'declined', message: NOT_UNDERSTOOD_SOURCE_MESSAGE };

  if (property === 'columnRatio') {
    if (!ctx.selectedModule || !isLayoutModuleType(ctx.selectedModule.type as never)) {
      return { status: 'declined', message: 'Select a multi-column layout section first, then I can match its column ratio to another layout.' };
    }
  } else if (!ctx.selectedModule) {
    return { status: 'declined', message: 'Select the module you want to update first, then I can copy that property from the previous section.' };
  }

  const topLevel = ctx.modules;
  const targetIndex = topLevel.findIndex((m) => m.id === ctx.selectedModule!.id);
  if (targetIndex === -1) {
    return {
      status: 'declined',
      message:
        'The "previous section" reference only works for a top-level section right now — select one directly on '
        + 'the canvas (not a module nested inside a column).',
    };
  }
  if (targetIndex === 0) {
    return { status: 'declined', message: 'The selected module is already the first section in this email — there is no previous section to copy from.' };
  }

  const sourceModule = topLevel[targetIndex - 1];
  const sourceLabel = `the previous section (${moduleLabel(sourceModule, targetIndex - 1)})`;

  if (property === 'padding') {
    return { status: 'resolved', property, value: { ...sourceModule.settings.desktop }, sourceLabel };
  }

  if (property === 'backgroundColor') {
    const value = readBackgroundColor(sourceModule);
    if (value === undefined) {
      return { status: 'declined', message: `${sourceLabel} has no background color set, so there is nothing to copy.` };
    }
    return { status: 'resolved', property, value, sourceLabel };
  }

  if (property === 'align') {
    const value = readAlign(sourceModule);
    if (value === undefined) {
      return { status: 'declined', message: `${sourceLabel} has no alignment of its own to copy.` };
    }
    return { status: 'resolved', property, value, sourceLabel };
  }

  // property === 'columnRatio' — the SOURCE layout's own builder-level
  // column widths (LayoutModuleProps.columnWidths), never rendered pixel
  // widths. computeLayoutAvailableWidthPx/resolveColumnPixelWidths, outer
  // spacing, gutter, and internal padding stay fully authoritative on
  // the render side — this only ever reads the percentage array that
  // already drives them, the same value RESTRUCTURE_LAYOUT already
  // takes from typed "70/30"-style commands.
  if (!isLayoutModuleType(sourceModule.type as never)) {
    return { status: 'declined', message: `${sourceLabel} is not a multi-column layout, so it has no column ratio to copy.` };
  }
  const widths = (sourceModule.props as Record<string, unknown>)?.columnWidths;
  if (!Array.isArray(widths) || widths.length === 0) {
    return { status: 'declined', message: `I could not read a column ratio from ${sourceLabel}.` };
  }
  return { status: 'resolved', property, value: widths, sourceLabel };
}
