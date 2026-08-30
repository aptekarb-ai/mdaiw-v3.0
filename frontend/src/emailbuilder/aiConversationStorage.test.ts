import { afterEach, describe, expect, it } from 'vitest';
import {
  boundedHistoryForRequest, clearConversation, loadConversation, saveConversation,
} from './aiConversationStorage';

afterEach(() => {
  window.localStorage.clear();
});

describe('aiConversationStorage — Module-4 E10 per-document persistence', () => {
  it('loadConversation returns empty for a document with no stored conversation', () => {
    expect(loadConversation(1)).toEqual([]);
  });

  it('round-trips a saved conversation', () => {
    saveConversation(1, [{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hi there' }]);
    expect(loadConversation(1)).toEqual([{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hi there' }]);
  });

  it('different document ids never leak into each other', () => {
    saveConversation(1, [{ role: 'user', text: 'Doc 1 message' }]);
    saveConversation(2, [{ role: 'user', text: 'Doc 2 message' }]);
    expect(loadConversation(1)).toEqual([{ role: 'user', text: 'Doc 1 message' }]);
    expect(loadConversation(2)).toEqual([{ role: 'user', text: 'Doc 2 message' }]);
  });

  it('clearConversation removes only that document\'s stored conversation', () => {
    saveConversation(1, [{ role: 'user', text: 'Doc 1 message' }]);
    saveConversation(2, [{ role: 'user', text: 'Doc 2 message' }]);
    clearConversation(1);
    expect(loadConversation(1)).toEqual([]);
    expect(loadConversation(2)).toEqual([{ role: 'user', text: 'Doc 2 message' }]);
  });

  it('caps stored messages at 20, keeping the most recent', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, text: `message ${i}` }));
    saveConversation(1, messages);
    const loaded = loadConversation(1);
    expect(loaded.length).toBeLessThanOrEqual(20);
    expect(loaded[loaded.length - 1]).toEqual({ role: 'user', text: 'message 29' });
    expect(loaded[0]).not.toEqual({ role: 'user', text: 'message 0' });
  });

  it('caps stored serialized size, dropping oldest messages first when a few very long messages exceed it', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, text: 'x'.repeat(2000) + i }));
    saveConversation(1, messages);
    const loaded = loadConversation(1);
    expect(JSON.stringify(loaded).length).toBeLessThanOrEqual(8000);
    // The most recent message survives even under the size cap.
    expect(loaded[loaded.length - 1].text.endsWith('9')).toBe(true);
  });

  it('malformed/corrupted stored JSON degrades to an empty conversation, never throws', () => {
    window.localStorage.setItem('emailbuilder-ai-conversation:1', 'not valid json{{{');
    expect(() => loadConversation(1)).not.toThrow();
    expect(loadConversation(1)).toEqual([]);
  });

  it('a stored value that is not an array degrades to an empty conversation', () => {
    window.localStorage.setItem('emailbuilder-ai-conversation:1', JSON.stringify({ not: 'an array' }));
    expect(loadConversation(1)).toEqual([]);
  });

  it('filters out malformed individual entries (missing/invalid role or text)', () => {
    window.localStorage.setItem('emailbuilder-ai-conversation:1', JSON.stringify([
      { role: 'user', text: 'valid' },
      { role: 'not-a-real-role', text: 'bad role' },
      { role: 'assistant' },
      'not even an object',
      null,
    ]));
    expect(loadConversation(1)).toEqual([{ role: 'user', text: 'valid' }]);
  });

  it('boundedHistoryForRequest returns only the last 8 turns', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, text: `turn ${i}` }));
    const bounded = boundedHistoryForRequest(messages);
    expect(bounded).toHaveLength(8);
    expect(bounded[bounded.length - 1]).toEqual({ role: 'user', text: 'turn 19' });
  });

  it('boundedHistoryForRequest returns everything when under the cap', () => {
    const messages = [{ role: 'user' as const, text: 'one' }, { role: 'assistant' as const, text: 'two' }];
    expect(boundedHistoryForRequest(messages)).toEqual(messages);
  });
});
