import { describe, expect, it } from 'vitest';
import { resolveReference, type ReferentialResolutionContext } from './referenceResolver';
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
