import { afterEach, describe, expect, it } from 'vitest';
import {
  clearReconstructionSession, loadReconstructionSession, storeReconstructionSession, updateReconstructionSessionProgress,
} from './reconstructionSessionStorage';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('reconstructionSessionStorage', () => {
  it('stores and re-reads without clearing (read-many, unlike the one-shot handoff)', () => {
    storeReconstructionSession({ documentId: 1, sourceHtml: '<p>Hi</p>', documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    expect(loadReconstructionSession(1)?.sourceHtml).toBe('<p>Hi</p>');
    // second read — still there
    expect(loadReconstructionSession(1)?.sourceHtml).toBe('<p>Hi</p>');
  });

  it('two documents remain isolated', () => {
    storeReconstructionSession({ documentId: 1, sourceHtml: '<p>A</p>', documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    storeReconstructionSession({ documentId: 2, sourceHtml: '<p>B</p>', documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    expect(loadReconstructionSession(1)?.sourceHtml).toBe('<p>A</p>');
    expect(loadReconstructionSession(2)?.sourceHtml).toBe('<p>B</p>');
  });

  it('reading a document id with nothing stored returns null without throwing', () => {
    expect(loadReconstructionSession(999)).toBeNull();
  });

  it('updateReconstructionSessionProgress updates passesUsed/lastFidelityScore while preserving sourceHtml', () => {
    storeReconstructionSession({ documentId: 3, sourceHtml: '<p>Keep me</p>', documentWidthPx: 700, passesUsed: 0, lastFidelityScore: null });
    updateReconstructionSessionProgress(3, 1, 72);
    const session = loadReconstructionSession(3);
    expect(session?.sourceHtml).toBe('<p>Keep me</p>');
    expect(session?.documentWidthPx).toBe(700);
    expect(session?.passesUsed).toBe(1);
    expect(session?.lastFidelityScore).toBe(72);
  });

  it('updateReconstructionSessionProgress is a no-op when no session exists for that document', () => {
    updateReconstructionSessionProgress(404, 1, 50);
    expect(loadReconstructionSession(404)).toBeNull();
  });

  it('clearReconstructionSession removes the entry', () => {
    storeReconstructionSession({ documentId: 7, sourceHtml: '<p>Bye</p>', documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    clearReconstructionSession(7);
    expect(loadReconstructionSession(7)).toBeNull();
  });

  it('a session stored under one document id is never returned for a different id', () => {
    storeReconstructionSession({ documentId: 5, sourceHtml: '<p>Five</p>', documentWidthPx: 600, passesUsed: 0, lastFidelityScore: null });
    expect(loadReconstructionSession(6)).toBeNull();
    expect(loadReconstructionSession(5)?.sourceHtml).toBe('<p>Five</p>');
  });
});
