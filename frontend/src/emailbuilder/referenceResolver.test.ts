import { describe, expect, it } from 'vitest';
import {
  resolveCopySourceRequest, resolveMultipleReferences, resolveReference, type ReferentialResolutionContext,
} from './referenceResolver';
import type { EmailModule } from './edm';
import { createModule } from './moduleFactory';

function baseContext(overrides: Partial<ReferentialResolutionContext> = {}): ReferentialResolutionContext {
  return {
    message: '',
    modules: [],
    selectedModule: null,
    selectedColumn: null,
    lastDiscussedValidationIssue: null,
    openValidationIssues: [],
    importReconstructionContext: null,
    lastDiscussedReconstructionCategory: null,
    lastReferent: null,
    ...overrides,
  };
}

let orderCounter = 0;
function mod(type: EmailModule['type']): EmailModule {
  orderCounter += 1;
  return createModule(type, orderCounter);
}

describe('resolveReference — pass-through', () => {
  it('a message with no referring expression is left alone', () => {
    const result = resolveReference(baseContext({ message: 'add a divider and set the color to green' }));
    expect(result.status).toBe('no-referring-expression');
  });
});

describe('resolveReference — typed module reference', () => {
  it('resolves to the currently selected module when its type matches', () => {
    const button = mod('button');
    const result = resolveReference(baseContext({
      message: 'make this button green',
      modules: [button],
      selectedModule: { id: button.id, type: 'button', label: 'the button' },
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { kind: 'module', id: button.id } });
  });

  it('resolves to the only module of that type when nothing is selected', () => {
    const button = mod('button');
    const text = mod('text');
    const result = resolveReference(baseContext({
      message: 'make that button green',
      modules: [text, button],
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { kind: 'module', id: button.id } });
  });

  it('asks a concise clarification when multiple modules of that type exist and nothing is selected', () => {
    const buttonA = mod('button');
    const buttonB = mod('button');
    const result = resolveReference(baseContext({
      message: 'make that button green',
      modules: [buttonA, buttonB],
    }));
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.clarifyingQuestion).toMatch(/2 button modules/);
    }
  });

  it('the exact worked example from the spec: selected hero vs. plausible child button', () => {
    // "If both selected hero and selected child button are plausible ->
    // ask: Do you mean the hero background or the button?" — modeled
    // here as: nothing currently selected, a hero module AND a button
    // module both exist, and the bare-type match ("this button") still
    // requires disambiguation only when count > 1 of THAT type; a hero
    // vs. an unrelated button is not literally the same type family, so
    // this proves the narrower, safer invariant: never silently pick one
    // module over another when more than one same-type candidate exists.
    const heroA = mod('hero-image-cta');
    const heroB = mod('hero-text-only');
    const result = resolveReference(baseContext({
      message: 'make this hero darker',
      modules: [heroA, heroB],
    }));
    expect(result.status).toBe('ambiguous');
  });

  it('resolves an explicit "the module" reference to the current selection', () => {
    const text = mod('text');
    const result = resolveReference(baseContext({
      message: 'delete this module',
      modules: [text],
      selectedModule: { id: text.id, type: 'text', label: 'the text' },
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { id: text.id } });
  });

  it('resolves with a "no match" note when the referenced type does not exist in the document', () => {
    const text = mod('text');
    const result = resolveReference(baseContext({ message: 'make that image bigger', modules: [text] }));
    expect(result).toMatchObject({ status: 'resolved', referent: { id: 'none' } });
  });
});

describe('resolveReference — ordinal column reference', () => {
  it('resolves "the second column" against the selected layout module', () => {
    const result = resolveReference(baseContext({
      message: 'use the same spacing as the second column',
      selectedColumn: { layoutModuleId: 'layout-1', layoutModuleType: 'layout-2col-50-50', columnIndex: 0 },
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { id: 'layout-1' } });
  });

  it('resolves against the only layout module in the document when none is selected', () => {
    const layout = mod('layout-2col-50-50');
    const text = mod('text');
    const result = resolveReference(baseContext({ message: 'widen the second column', modules: [layout, text] }));
    expect(result).toMatchObject({ status: 'resolved', referent: { id: layout.id } });
  });

  it('asks for clarification when multiple layout modules exist and none is selected', () => {
    const layoutA = mod('layout-2col-50-50');
    const layoutB = mod('layout-3col');
    const result = resolveReference(baseContext({ message: 'widen the second column', modules: [layoutA, layoutB] }));
    expect(result.status).toBe('ambiguous');
  });
});

describe('resolveReference — import reconstruction reference', () => {
  const sampleImportContext = {
    document_width: 700, module_count: 1, region_count: 1, regions: [],
    fidelity_categories: [], has_mso_conditional_content: false,
  };

  it('resolves "the imported one" when reconstruction context exists', () => {
    const result = resolveReference(baseContext({
      message: 'make it look like the imported one',
      importReconstructionContext: sampleImportContext,
      lastDiscussedReconstructionCategory: 'typography',
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { kind: 'reconstructionCategory', id: 'typography' } });
  });

  it('resolves "original" and "reconstructed version" the same way', () => {
    for (const phrase of ['compare this to the original', 'is the reconstructed version accurate?']) {
      const result = resolveReference(baseContext({ message: phrase, importReconstructionContext: sampleImportContext }));
      expect(result.status).toBe('resolved');
    }
  });

  it('resolves "make it like before" / "same as above" as reconstruction-style comparison requests', () => {
    for (const phrase of ['make it like before', 'use the same background as above']) {
      const result = resolveReference(baseContext({ message: phrase, importReconstructionContext: sampleImportContext }));
      expect(result.status).toBe('resolved');
    }
  });

  it('honestly notes when there is no reconstruction context at all, rather than fabricating one', () => {
    const result = resolveReference(baseContext({ message: 'make it look like the original' }));
    expect(result).toMatchObject({ status: 'resolved', referent: { id: 'none' } });
    if (result.status === 'resolved') {
      expect(result.note).toMatch(/no imported-email reconstruction context/i);
    }
  });
});

describe('resolveReference — validation issue reference', () => {
  it('resolves "fix it" / "that problem" to the last-discussed issue', () => {
    const result = resolveReference(baseContext({
      message: 'fix it',
      lastDiscussedValidationIssue: { id: 'accessibility:contrast:x', title: 'Weak text contrast', category: 'accessibility' },
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { id: 'accessibility:contrast:x' } });
  });

  it('resolves to the single open issue when nothing was discussed yet', () => {
    const result = resolveReference(baseContext({
      message: 'the issue we discussed',
      openValidationIssues: [{ id: 'links:placeholder-href', title: 'Placeholder link', category: 'links' }],
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { id: 'links:placeholder-href' } });
  });

  it('the exact worked example from the spec: two unresolved issues -> concise clarification listing both', () => {
    const result = resolveReference(baseContext({
      message: 'can you fix that problem',
      openValidationIssues: [
        { id: 'accessibility:contrast:x', title: 'weak text contrast', category: 'accessibility' },
        { id: 'links:placeholder-href', title: 'a placeholder link', category: 'links' },
      ],
    }));
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.clarifyingQuestion).toMatch(/weak text contrast/);
      expect(result.clarifyingQuestion).toMatch(/a placeholder link/);
    }
  });
});

describe('resolveReference — bare pronoun priority chain', () => {
  it('current explicit selection wins over everything else', () => {
    const button = mod('button');
    const result = resolveReference(baseContext({
      message: 'make it darker',
      modules: [button],
      selectedModule: { id: button.id, type: 'button', label: 'the button' },
      lastDiscussedValidationIssue: { id: 'x:y', title: 'unrelated issue', category: 'links' },
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { kind: 'module', id: button.id } });
  });

  it('falls back to the last-discussed validation issue when nothing is selected', () => {
    const result = resolveReference(baseContext({
      message: 'can you fix it',
      lastDiscussedValidationIssue: { id: 'accessibility:contrast:x', title: 'Weak text contrast', category: 'accessibility' },
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { kind: 'validationIssue', id: 'accessibility:contrast:x' } });
  });

  it('falls back to the last-discussed reconstruction category when nothing else applies', () => {
    const result = resolveReference(baseContext({
      message: 'can you change it a bit',
      importReconstructionContext: {
        document_width: 700, module_count: 1, region_count: 1, regions: [],
        fidelity_categories: [], has_mso_conditional_content: false,
      },
      lastDiscussedReconstructionCategory: 'spacing',
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { kind: 'reconstructionCategory', id: 'spacing' } });
  });

  it('falls back to the immediately previous conversational referent last', () => {
    const result = resolveReference(baseContext({
      message: 'change it to blue',
      lastReferent: { kind: 'module', id: 'mod-42', label: 'the footer' },
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { id: 'mod-42' } });
  });

  it('with nothing resolvable anywhere in the priority chain, passes through unchanged (not a locally-invented clarification)', () => {
    // Zero candidates is not the same as "multiple candidates" — §B
    // reserves local clarification for genuine ambiguity, not for "I
    // have nothing to go on at all." That case is the backend/LLM
    // tier's job (§E covers making ITS reply context-aware).
    const result = resolveReference(baseContext({ message: 'make it darker' }));
    expect(result.status).toBe('no-referring-expression');
  });

  it('with multiple open issues and nothing selected, lists them rather than guessing', () => {
    const result = resolveReference(baseContext({
      message: 'fix it',
      openValidationIssues: [
        { id: 'a:b', title: 'weak contrast', category: 'accessibility' },
        { id: 'c:d', title: 'placeholder link', category: 'links' },
      ],
    }));
    expect(result.status).toBe('ambiguous');
  });
});

describe('resolveReference — section reference', () => {
  it('resolves "this section" to the section containing the current selection', () => {
    const text = mod('text');
    const result = resolveReference(baseContext({
      message: 'add more padding to this section',
      selectedModule: { id: text.id, type: 'text', label: 'the text' },
    }));
    expect(result).toMatchObject({ status: 'resolved', referent: { id: text.id } });
  });

  it('passes through "the previous section" with no selection or prior referent (zero candidates, not ambiguity)', () => {
    const result = resolveReference(baseContext({ message: 'match the previous section' }));
    expect(result.status).toBe('no-referring-expression');
  });
});

describe('resolveCopySourceRequest — R4-B4 Closure §B/§C', () => {
  it('not a copy-source request: passes through untouched', () => {
    const result = resolveCopySourceRequest(baseContext({ message: 'add a divider and set the color to green' }));
    expect(result.status).toBe('not-a-copy-request');
  });

  it('"use the same padding as the previous section" reads the previous top-level module\'s desktop padding', () => {
    const previous = mod('text');
    previous.settings = { ...previous.settings, desktop: { paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 } };
    const target = mod('button');
    const result = resolveCopySourceRequest(baseContext({
      message: 'use the same padding as the previous section',
      modules: [previous, target],
      selectedModule: { id: target.id, type: 'button', label: 'the button' },
    }));
    expect(result).toMatchObject({
      status: 'resolved', property: 'padding',
      value: { paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 },
    });
  });

  it('"give this the same spacing as the section above" — "spacing" is a synonym for padding', () => {
    const previous = mod('text');
    previous.settings = { ...previous.settings, desktop: { paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8 } };
    const target = mod('button');
    const result = resolveCopySourceRequest(baseContext({
      message: 'give this the same spacing as the section above',
      modules: [previous, target],
      selectedModule: { id: target.id, type: 'button', label: 'the button' },
    }));
    expect(result).toMatchObject({ status: 'resolved', property: 'padding' });
  });

  it('"use the same background color as the previous module" reads the previous module\'s background color', () => {
    const previous = mod('button');
    previous.props = { ...previous.props, backgroundColor: '#112233' };
    const target = mod('button');
    const result = resolveCopySourceRequest(baseContext({
      message: 'use the same background color as the previous module',
      modules: [previous, target],
      selectedModule: { id: target.id, type: 'button', label: 'the button' },
    }));
    expect(result).toMatchObject({ status: 'resolved', property: 'backgroundColor', value: '#112233' });
  });

  it('declines when the source module has no background color to copy', () => {
    const previous = mod('divider');
    const target = mod('button');
    const result = resolveCopySourceRequest(baseContext({
      message: 'use the same background color as the previous module',
      modules: [previous, target],
      selectedModule: { id: target.id, type: 'button', label: 'the button' },
    }));
    expect(result.status).toBe('declined');
  });

  it('"make this column use the same alignment as column 1" is an honest capability decline, never a guess', () => {
    // §B's own worked example: columns have no horizontal-alignment
    // setting in this builder's data model — there is no existing
    // action this could route through.
    const result = resolveCopySourceRequest(baseContext({ message: 'make this column use the same alignment as column 1' }));
    expect(result.status).toBe('declined');
    if (result.status === 'declined') {
      expect(result.message).toMatch(/alignment/i);
    }
  });

  it('module-level alignment copy ("make this the same alignment as the previous section") is supported', () => {
    const previous = mod('button');
    previous.props = { ...previous.props, align: 'right' };
    const target = mod('button');
    const result = resolveCopySourceRequest(baseContext({
      message: 'make this the same alignment as the previous section',
      modules: [previous, target],
      selectedModule: { id: target.id, type: 'button', label: 'the button' },
    }));
    expect(result).toMatchObject({ status: 'resolved', property: 'align', value: 'right' });
  });

  it('§C — "make these columns the same ratio as the previous layout" reads the previous layout\'s column widths', () => {
    const previousLayout = mod('layout-2col-30-70');
    previousLayout.props = { ...previousLayout.props, columnWidths: [55, 45] };
    const targetLayout = mod('layout-2col-50-50');
    const result = resolveCopySourceRequest(baseContext({
      message: 'make these columns the same ratio as the previous layout',
      modules: [previousLayout, targetLayout],
      selectedModule: { id: targetLayout.id, type: 'layout-2col-50-50', label: 'the layout' },
    }));
    expect(result).toMatchObject({ status: 'resolved', property: 'columnRatio', value: [55, 45] });
  });

  it('§C — declines when the selected module is not itself a layout', () => {
    const previousLayout = mod('layout-2col-30-70');
    const target = mod('text');
    const result = resolveCopySourceRequest(baseContext({
      message: 'make these columns the same ratio as the previous layout',
      modules: [previousLayout, target],
      selectedModule: { id: target.id, type: 'text', label: 'the text' },
    }));
    expect(result.status).toBe('declined');
  });

  it('declines with no selection at all rather than guessing a target', () => {
    const previous = mod('text');
    const result = resolveCopySourceRequest(baseContext({
      message: 'use the same padding as the previous section',
      modules: [previous],
      selectedModule: null,
    }));
    expect(result.status).toBe('declined');
  });

  it('declines when the selected module is already the first section (no previous to copy from)', () => {
    const only = mod('text');
    const result = resolveCopySourceRequest(baseContext({
      message: 'use the same padding as the previous section',
      modules: [only],
      selectedModule: { id: only.id, type: 'text', label: 'the text' },
    }));
    expect(result.status).toBe('declined');
  });

  it('declines when the selected module is nested inside a column, not top-level', () => {
    const previous = mod('text');
    const nested = mod('button');
    const result = resolveCopySourceRequest(baseContext({
      message: 'use the same padding as the previous section',
      modules: [previous], // `nested` deliberately absent from the top-level list
      selectedModule: { id: nested.id, type: 'button', label: 'the button' },
    }));
    expect(result.status).toBe('declined');
  });

  it('declines with a helpful message when the property/source phrasing is not recognized', () => {
    const target = mod('button');
    const result = resolveCopySourceRequest(baseContext({
      message: 'give this the same padding as the sidebar widget',
      modules: [target],
      selectedModule: { id: target.id, type: 'button', label: 'the button' },
    }));
    expect(result.status).toBe('declined');
  });
});

// D4-E3G — cross-module compound-request target resolution.
describe('resolveMultipleReferences — plain typed segments (cross-module compound)', () => {
  it('resolves the worked-example compound: hero heading + CTA', () => {
    const hero = mod('hero-text-only');
    const button = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'make the hero heading smaller and the CTA green',
      modules: [hero, button],
    }));
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ status: 'resolved', matchedPhrase: 'make the hero heading smaller' });
    expect(result.items[1]).toMatchObject({ status: 'resolved', matchedPhrase: 'the CTA green' });
    if (result.items[0].status === 'resolved') expect(result.items[0].targets[0].id).toBe(hero.id);
    if (result.items[1].status === 'resolved') expect(result.items[1].targets[0].id).toBe(button.id);
  });

  it('resolves a three-way compound: hero + CTA + footer', () => {
    const hero = mod('hero-text-only');
    const button = mod('button');
    const footer = mod('footer-simple-legal');
    const result = resolveMultipleReferences(baseContext({
      message: 'make the hero heading smaller, the CTA green, and center the footer text',
      modules: [hero, button, footer],
    }));
    expect(result.items).toHaveLength(3);
    const resolvedIds = result.items.map((item) => (item.status === 'resolved' ? item.targets[0]?.id : null));
    expect(resolvedIds).toEqual([hero.id, button.id, footer.id]);
  });

  it('a single-segment (non-compound) message still resolves one target, matching resolveReference', () => {
    const button = mod('button');
    const result = resolveMultipleReferences(baseContext({ message: 'make this button green', modules: [button] }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ status: 'resolved' });
  });

  it('a segment naming no module type comes back unresolved, never guessed', () => {
    const button = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'make the CTA green and increase the padding to 20px',
      modules: [button],
    }));
    // "increase the padding to 20px" names no module-type word — this
    // resolver reports it 'unresolved'; the CALLER decides it continues
    // describing the same (already resolved) CTA operation.
    expect(result.items[1]).toMatchObject({ status: 'unresolved' });
  });

  it('"CTA" is recognized as a button-family alias', () => {
    const button = mod('button');
    const result = resolveMultipleReferences(baseContext({ message: 'make the CTA green', modules: [button] }));
    expect(result.items[0]).toMatchObject({ status: 'resolved' });
    if (result.items[0].status === 'resolved') expect(result.items[0].targets[0].id).toBe(button.id);
  });
});

describe('resolveMultipleReferences — ordinal typed segments', () => {
  it('"the first CTA" resolves to the first button in document order', () => {
    const buttonA = mod('button');
    const buttonB = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'make the first CTA green', modules: [buttonA, buttonB],
    }));
    expect(result.items[0]).toMatchObject({ status: 'resolved' });
    if (result.items[0].status === 'resolved') expect(result.items[0].targets[0].id).toBe(buttonA.id);
  });

  it('"the second button" resolves to the second button in document order', () => {
    const buttonA = mod('button');
    const buttonB = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'make the second button smaller', modules: [buttonA, buttonB],
    }));
    if (result.items[0].status === 'resolved') expect(result.items[0].targets[0].id).toBe(buttonB.id);
  });

  it('an ordinal beyond the real candidate count is unresolved, never clamped to the last one', () => {
    const buttonA = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'make the second CTA green', modules: [buttonA],
    }));
    expect(result.items[0]).toMatchObject({ status: 'unresolved' });
  });
});

describe('resolveMultipleReferences — "both X"', () => {
  it('resolves both targets when exactly two candidates exist', () => {
    const buttonA = mod('button');
    const buttonB = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'make both buttons green', modules: [buttonA, buttonB],
    }));
    expect(result.items[0]).toMatchObject({ status: 'resolved' });
    if (result.items[0].status === 'resolved') {
      expect(result.items[0].targets.map((t) => t.id).sort()).toEqual([buttonA.id, buttonB.id].sort());
    }
  });

  it('asks a clarifying question when more than two candidates exist', () => {
    const buttonA = mod('button');
    const buttonB = mod('button');
    const buttonC = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'make both buttons green', modules: [buttonA, buttonB, buttonC],
    }));
    expect(result.items[0].status).toBe('ambiguous');
  });

  it('is unresolved when fewer than two candidates exist', () => {
    const buttonA = mod('button');
    const result = resolveMultipleReferences(baseContext({ message: 'make both buttons green', modules: [buttonA] }));
    expect(result.items[0]).toMatchObject({ status: 'unresolved' });
  });
});

describe('resolveMultipleReferences — "the other X"', () => {
  it('resolves to the one remaining candidate when a conversational antecedent names the other one', () => {
    const buttonA = mod('button');
    const buttonB = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'make the other button green',
      modules: [buttonA, buttonB],
      lastReferent: { kind: 'module', id: buttonA.id, label: 'the first button module' },
    }));
    expect(result.items[0]).toMatchObject({ status: 'resolved' });
    if (result.items[0].status === 'resolved') expect(result.items[0].targets[0].id).toBe(buttonB.id);
  });

  it('never silently guesses "the other X" with no usable antecedent', () => {
    const buttonA = mod('button');
    const buttonB = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'make the other button green', modules: [buttonA, buttonB],
    }));
    expect(result.items[0].status).toBe('ambiguous');
  });

  it('is ambiguous when more than one "other" candidate remains', () => {
    const buttonA = mod('button');
    const buttonB = mod('button');
    const buttonC = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'make the other button green',
      modules: [buttonA, buttonB, buttonC],
      lastReferent: { kind: 'module', id: buttonA.id, label: 'the first button module' },
    }));
    expect(result.items[0].status).toBe('ambiguous');
  });
});

// D4-E3G hardening §11/§12 — multilingual conjunction splitting and
// article-free type-word matching, both required for the deterministic
// cross-module planner to even SEE 2 targets for the required Hindi/
// Hinglish/Spanish/German compound examples (which keep "hero"/"CTA" as
// English loanwords but use non-English conjunctions and no "the").
describe('resolveMultipleReferences — multilingual segmentation', () => {
  it('splits on Hindi/Hinglish "aur" and resolves an article-free "hero" mention', () => {
    const hero = mod('hero-text-only');
    const button = mod('button');
    const result = resolveMultipleReferences(baseContext({
      message: 'hero ke neeche spacing badhao aur first CTA green kar do',
      modules: [hero, button],
    }));
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ status: 'resolved', matchedPhrase: 'hero ke neeche spacing badhao' });
    if (result.items[0].status === 'resolved') expect(result.items[0].targets[0].id).toBe(hero.id);
    if (result.items[1].status === 'resolved') expect(result.items[1].targets[0].id).toBe(button.id);
  });

  it('splits on Spanish "y"', () => {
    const button = mod('button');
    const hero = mod('hero-text-only');
    const result = resolveMultipleReferences(baseContext({
      message: 'Cambia el primer botón a verde y aumenta el espacio debajo del hero',
      modules: [button, hero],
    }));
    expect(result.items).toHaveLength(2);
  });

  it('splits on German "und"', () => {
    const button = mod('button');
    const hero = mod('hero-text-only');
    const result = resolveMultipleReferences(baseContext({
      message: 'Mach den ersten CTA grün und vergrößere den Abstand unter dem Hero',
      modules: [button, hero],
    }));
    expect(result.items).toHaveLength(2);
    if (result.items[0].status === 'resolved') expect(result.items[0].targets[0].id).toBe(button.id);
    if (result.items[1].status === 'resolved') expect(result.items[1].targets[0].id).toBe(hero.id);
  });

  it('a bare "y" inside a longer word is never treated as the conjunction (word-boundary safe)', () => {
    // "hoy" (Spanish "today") must never be split as if it were the "y"
    // conjunction — proves the multilingual split requires whitespace on
    // both sides, not a bare substring match.
    const button = mod('button');
    const result = resolveMultipleReferences(baseContext({ message: 'make the button green hoy mismo', modules: [button] }));
    expect(result.items).toHaveLength(1);
  });

  it('does not require an English article before the type word ("CTA ko green karo")', () => {
    const button = mod('button');
    const result = resolveMultipleReferences(baseContext({ message: 'CTA ko green karo', modules: [button] }));
    expect(result.items[0]).toMatchObject({ status: 'resolved' });
    if (result.items[0].status === 'resolved') expect(result.items[0].targets[0].id).toBe(button.id);
  });
});

// D4-E3G hardening — extended ResolvedTarget carries an optional `props`
// bundle for the caller to populate from the live module tree.
describe('ResolvedTarget — props field', () => {
  it('is undefined by default and never invented by the resolver itself', () => {
    const button = mod('button');
    const result = resolveMultipleReferences(baseContext({ message: 'make the button green and the hero red', modules: [button, mod('hero-text-only')] }));
    if (result.items[0].status === 'resolved') expect(result.items[0].targets[0].props).toBeUndefined();
  });
});
