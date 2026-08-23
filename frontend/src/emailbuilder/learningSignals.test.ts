import { describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../api/client';
import {
  clearLearnedRepairSignals, fetchRepairRanking, newLearningEventId,
  rankWithinTiers, recordRepairSignal, type RepairRanking,
} from './learningSignals';

vi.mock('../api/client', () => ({ apiRequest: vi.fn() }));

describe('newLearningEventId', () => {
  it('returns a non-empty string each call', () => {
    const id = newLearningEventId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('never repeats across many calls (one id per human action)', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newLearningEventId()));
    expect(ids.size).toBe(50);
  });
});

describe('recordRepairSignal', () => {
  it('POSTs the four-field contract to the learning signals endpoint', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, created: true });
    await recordRepairSignal({
      eventId: 'evt-1', signature: 'accessibility:contrast', outcome: 'accepted', source: 'validation_center_single',
    });

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/email-builder/learning/signals/', {
      method: 'POST',
      body: JSON.stringify({
        event_id: 'evt-1', signature: 'accessibility:contrast', outcome: 'accepted', source: 'validation_center_single',
      }),
    });
  });

  it('never throws when the request fails — recording is fire-and-forget/advisory-only', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('network down'));
    await expect(recordRepairSignal({
      eventId: 'evt-1', signature: 'accessibility:contrast', outcome: 'accepted', source: 'ai_engineer_repair',
    })).resolves.toBeUndefined();
  });
});

describe('fetchRepairRanking', () => {
  it('returns the signatures map from a successful response', async () => {
    const signatures: RepairRanking = {
      'accessibility:contrast': { score: 0.8, evidenceCount: 4, accepted: 3, rejected: 1 },
    };
    vi.mocked(apiRequest).mockResolvedValue({ success: true, signatures });
    await expect(fetchRepairRanking()).resolves.toEqual(signatures);
  });

  it('returns {} (never throws) when the request fails — a ranking failure must reproduce baseline order', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('502'));
    await expect(fetchRepairRanking()).resolves.toEqual({});
  });

  it('returns {} when the response has no signatures field (malformed response)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true });
    await expect(fetchRepairRanking()).resolves.toEqual({});
  });
});

describe('clearLearnedRepairSignals', () => {
  it('DELETEs the learning signals endpoint and returns true on success', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ success: true, deleted: 3 });
    await expect(clearLearnedRepairSignals()).resolves.toBe(true);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/email-builder/learning/signals/', { method: 'DELETE' });
  });

  it('returns false (never throws) on failure', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('network down'));
    await expect(clearLearnedRepairSignals()).resolves.toBe(false);
  });
});

interface Item { id: string; tier: string; sig: string; }

function item(id: string, tier: string, sig: string): Item {
  return { id, tier, sig };
}

describe('rankWithinTiers', () => {
  const tierKey = (i: Item) => i.tier;
  const sigKey = (i: Item) => i.sig;

  it('returns items unchanged when ranking is empty — zero learned data reproduces exact original order', () => {
    const items = [item('a', 't1', 'sig-a'), item('b', 't1', 'sig-b')];
    expect(rankWithinTiers(items, {}, tierKey, sigKey)).toEqual(items);
  });

  it('reorders items within one tier by descending score', () => {
    const items = [item('a', 't1', 'sig-a'), item('b', 't1', 'sig-b')];
    const ranking: RepairRanking = {
      'sig-a': { score: 0.2, evidenceCount: 5, accepted: 1, rejected: 4 },
      'sig-b': { score: 0.9, evidenceCount: 5, accepted: 4, rejected: 1 },
    };
    expect(rankWithinTiers(items, ranking, tierKey, sigKey).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('never moves an item across tier boundaries, even with a huge cross-tier score gap', () => {
    const items = [item('a', 't1', 'sig-a'), item('b', 't2', 'sig-b'), item('c', 't1', 'sig-c')];
    const ranking: RepairRanking = {
      'sig-a': { score: 0.1, evidenceCount: 5, accepted: 0, rejected: 5 },
      'sig-b': { score: 1.0, evidenceCount: 5, accepted: 5, rejected: 0 },
      'sig-c': { score: 0.99, evidenceCount: 5, accepted: 5, rejected: 0 },
    };
    const result = rankWithinTiers(items, ranking, tierKey, sigKey).map((i) => i.id);
    // t1's two items (a, c) reorder among themselves (c ahead of a); t2's
    // single item (b) never leaves its own tier slot despite the highest
    // score of all three.
    expect(result).toEqual(['c', 'a', 'b']);
  });

  it('items with no ranking entry keep their original relative order and sort after ranked items in the same tier', () => {
    const items = [item('a', 't1', 'sig-a'), item('b', 't1', 'sig-unranked'), item('c', 't1', 'sig-c')];
    const ranking: RepairRanking = {
      'sig-a': { score: 0.5, evidenceCount: 5, accepted: 3, rejected: 2 },
      'sig-c': { score: 0.4, evidenceCount: 5, accepted: 2, rejected: 3 },
    };
    expect(rankWithinTiers(items, ranking, tierKey, sigKey).map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });

  it('two items with equal score keep their original relative order (stable tie-break)', () => {
    const items = [item('a', 't1', 'sig-a'), item('b', 't1', 'sig-b')];
    const ranking: RepairRanking = {
      'sig-a': { score: 0.5, evidenceCount: 5, accepted: 2, rejected: 2 },
      'sig-b': { score: 0.5, evidenceCount: 4, accepted: 2, rejected: 2 },
    };
    expect(rankWithinTiers(items, ranking, tierKey, sigKey).map((i) => i.id)).toEqual(['a', 'b']);
  });
});
