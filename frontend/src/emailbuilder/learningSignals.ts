// Feature 14 V3 Sub-phase 8 — Safe Self-Learning / Memory (repair-signal
// ranking only). Everything in this module is advisory display-order
// sugar: it may reorder ValidationIssue/RepairCandidate lists WITHIN
// their existing severity/fixType tiers, and it must NEVER change which
// issues exist, their severity, fixType, safeFix, or whether a repair is
// safe/automatic. Every function here fails silently (never throws) so a
// network error, disabled backend, or malformed response reproduces the
// exact pre-Sub-phase-8 behavior — recording a signal is fire-and-forget,
// and ranking simply comes back empty.

import { apiRequest } from '../api/client';
import { generateId } from './idGenerator';

export type RepairSignalOutcome = 'accepted' | 'rejected';

export type RepairSignalSource =
  | 'validation_center_single'
  | 'validation_center_bulk'
  | 'ai_engineer_repair'
  // R4-C9 — matches backend/emailbuilder/models.py's own
  // RepairSignalSource.AI_ENGINEER_RECONSTRUCTION exactly (already
  // added, unused until now, in an earlier phase's migration).
  | 'ai_engineer_reconstruction';

export interface RecordRepairSignalInput {
  eventId: string;
  signature: string;
  outcome: RepairSignalOutcome;
  source: RepairSignalSource;
}

export interface RepairRankingEntry {
  score: number;
  evidenceCount: number;
  accepted: number;
  rejected: number;
}

export type RepairRanking = Record<string, RepairRankingEntry>;

const LEARNING_SIGNALS_PATH = '/api/v1/email-builder/learning/signals/';
const LEARNING_RANKING_PATH = '/api/v1/email-builder/learning/signals/ranking/';

// One event_id per human action (one click), generated client-side and
// reused verbatim on any retry of that same request — this is the field
// the backend's (user, event_id) uniqueness constraint dedupes on, so a
// caller MUST generate a fresh id per genuine decision and MUST NOT
// generate a new one when merely retrying a failed network call for the
// same decision.
export function newLearningEventId(): string {
  return generateId();
}

// Fire-and-forget: callers invoke this from an Apply/Cancel/Fix/Fix-All
// handler and never await/branch on its result — a failure here must
// never block or alter the repair/validation flow that triggered it.
export async function recordRepairSignal(input: RecordRepairSignalInput): Promise<void> {
  try {
    await apiRequest(LEARNING_SIGNALS_PATH, {
      method: 'POST',
      body: JSON.stringify({
        event_id: input.eventId,
        signature: input.signature,
        outcome: input.outcome,
        source: input.source,
      }),
    });
  } catch {
    // Recording is advisory-only; swallow every failure (network, 429,
    // validation) rather than surface it to the user.
  }
}

// Never throws. Returns {} (i.e. "no learned data") on any failure —
// callers can treat a failed fetch identically to a genuinely empty
// ranking without a special case.
export async function fetchRepairRanking(): Promise<RepairRanking> {
  try {
    const response = await apiRequest<{ success: boolean; signatures: RepairRanking }>(
      LEARNING_RANKING_PATH,
    );
    return response?.signatures ?? {};
  } catch {
    return {};
  }
}

// "Clear learned preferences" — immediate, synchronous, user-initiated.
// Returns whether the request succeeded so the caller can show an error
// state (this action is confirmed on purpose, unlike record/fetch).
export async function clearLearnedRepairSignals(): Promise<boolean> {
  try {
    await apiRequest(LEARNING_SIGNALS_PATH, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

// Stable sort: reorders `items` only among entries that share the same
// `tierKey` (e.g. severity+fixType) — entries in different tiers never
// cross tier boundaries, and entries with no ranking entry (absent
// signature, below MIN_EVIDENCE_THRESHOLD, or empty ranking overall) keep
// their original relative order. Higher score sorts first.
export function rankWithinTiers<T>(
  items: T[],
  ranking: RepairRanking,
  tierKey: (item: T) => string,
  signatureKey: (item: T) => string,
): T[] {
  if (!ranking || Object.keys(ranking).length === 0) return items;

  const scoreFor = (item: T): number | null => {
    const entry = ranking[signatureKey(item)];
    return entry ? entry.score : null;
  };

  // Group by tier, preserving first-appearance order of each tier and of
  // items within it — this is what guarantees no item ever crosses a
  // tier boundary, and ties (equal/absent scores) keep original order.
  const tierOrder: string[] = [];
  const buckets = new Map<string, { item: T; index: number }[]>();
  items.forEach((item, index) => {
    const tier = tierKey(item);
    if (!buckets.has(tier)) {
      buckets.set(tier, []);
      tierOrder.push(tier);
    }
    buckets.get(tier)!.push({ item, index });
  });

  return tierOrder.flatMap((tier) => {
    const bucket = buckets.get(tier)!;
    return bucket
      .slice()
      .sort((a, b) => {
        const scoreA = scoreFor(a.item);
        const scoreB = scoreFor(b.item);
        if (scoreA === null && scoreB === null) return a.index - b.index;
        if (scoreA === null) return 1;
        if (scoreB === null) return -1;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return a.index - b.index;
      })
      .map(({ item }) => item);
  });
}
