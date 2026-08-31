import { afterEach, describe, expect, it } from 'vitest';
import { storePendingImportHandoff, takePendingImportHandoff } from './importHandoffStorage';
import { createImportReconstructionHandoff } from './aiEngineerHandoff';
import { analyzeImportedHtml } from './htmlImportAnalysis';
import { buildFidelityReport } from './htmlImportFidelity';
import { mapImportedHtml } from './htmlImportMapper';
import { buildReconstructionReview } from './reconstructionReview';
import { buildImportReconstructionContext } from './importReconstructionContext';

function sampleReview() {
  const html = '<table><tr><td><p style="font-weight:bold;">Bold via CSS</p></td></tr></table>';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const structure = analyzeImportedHtml(doc, 700);
  const mapping = mapImportedHtml(doc);
  const fidelity = buildFidelityReport(doc, structure, mapping);
  return buildReconstructionReview(doc, structure, fidelity, mapping.modules);
}

function sampleImportContext() {
  const html = '<table><tr><td><p>Hello</p></td></tr></table>';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const structure = analyzeImportedHtml(doc, 700);
  const mapping = mapImportedHtml(doc);
  const fidelity = buildFidelityReport(doc, structure, mapping);
  return buildImportReconstructionContext(structure, fidelity, mapping.modules.length);
}

afterEach(() => {
  window.sessionStorage.clear();
});

describe('importHandoffStorage', () => {
  it('stores a handoff and returns it exactly once (read-and-clear)', () => {
    const handoff = createImportReconstructionHandoff(42, sampleReview(), sampleImportContext());
    storePendingImportHandoff(42, handoff);

    const taken = takePendingImportHandoff(42);
    expect(taken?.id).toBe(handoff.id);
    expect(taken?.source).toBe('import-reconstruction');

    // one-shot — a second read (simulating a reload or back/forward
    // navigation to the same document) must never resend the same handoff
    expect(takePendingImportHandoff(42)).toBeNull();
  });

  it('two documents remain isolated — one document’s handoff never leaks into another’s read', () => {
    const handoffA = createImportReconstructionHandoff(1, sampleReview(), sampleImportContext());
    const handoffB = createImportReconstructionHandoff(2, sampleReview(), sampleImportContext());
    storePendingImportHandoff(1, handoffA);
    storePendingImportHandoff(2, handoffB);

    expect(takePendingImportHandoff(1)?.id).toBe(handoffA.id);
    expect(takePendingImportHandoff(2)?.id).toBe(handoffB.id);
    // both already consumed above — re-reading either finds nothing
    expect(takePendingImportHandoff(1)).toBeNull();
    expect(takePendingImportHandoff(2)).toBeNull();
  });

  it('reading a document id with nothing stored returns null without throwing', () => {
    expect(takePendingImportHandoff(999)).toBeNull();
  });

  it('a handoff stored under one document id is never returned for a different id', () => {
    const handoff = createImportReconstructionHandoff(5, sampleReview(), sampleImportContext());
    storePendingImportHandoff(5, handoff);
    expect(takePendingImportHandoff(6)).toBeNull();
    // still there for the correct id — the mismatched read must not have consumed it
    expect(takePendingImportHandoff(5)?.id).toBe(handoff.id);
  });
});
