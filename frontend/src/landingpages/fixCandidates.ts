import type {
  AIConfidence, AIProposal, AIRisk, FixPatch, FixSourceFile, IssueRisk,
} from '../types/landingpages';

// A unified view over the two fix engines the backend already runs (see
// backend/landingpages/fixes/ and ai_review/) — this is a purely
// presentational merge. It never re-derives correctness: a FixCandidate's
// selectable/rejection state is copied straight from whichever engine
// produced it, and Apply always sends the original fix_id back through
// THAT engine's own apply endpoint (see api/fixCandidates apply helpers
// in LandingPageValidatorPage.tsx) — never a client-synthesized patch.
export type FixMethod = 'deterministic' | 'ai';

export interface FixCandidate {
  fixId: string;
  issueId: number;
  method: FixMethod;
  file: FixSourceFile;
  startLine: number;
  originalText: string;
  replacementText: string;
  description: string;
  risk: IssueRisk | AIRisk;
  confidence: 'definite' | 'likely' | 'possible' | null;
  selectable: boolean;
  rejectionNotice: string | null;
  assumptions: string[];
  requiresConfiguration: boolean;
}

export function candidateFromPatch(patch: FixPatch): FixCandidate {
  return {
    fixId: patch.fix_id,
    issueId: patch.issue_id,
    method: 'deterministic',
    file: patch.file,
    startLine: patch.start_line,
    originalText: patch.original_text,
    replacementText: patch.replacement_text,
    description: patch.description,
    risk: patch.risk,
    confidence: patch.confidence,
    selectable: patch.status === 'safe',
    rejectionNotice: patch.status === 'conflict'
      ? 'Two fixes modify the same source range and require individual review.'
      : null,
    assumptions: [],
    requiresConfiguration: false,
  };
}

export function candidateFromProposal(proposal: AIProposal): FixCandidate {
  return {
    fixId: proposal.fix_id,
    issueId: proposal.issue_id,
    method: 'ai',
    file: proposal.file,
    startLine: proposal.start_line,
    originalText: proposal.original_text,
    replacementText: proposal.replacement_text,
    description: proposal.explanation,
    risk: proposal.risk,
    confidence: proposal.confidence,
    selectable: proposal.status === 'safe',
    rejectionNotice: proposal.status === 'safe' ? null : (
      proposal.status === 'conflict'
        ? `Conflicts with another proposal — ${proposal.rejection_reason}`
        : `Proposal rejected — ${proposal.rejection_reason}`
    ),
    assumptions: proposal.assumptions,
    requiresConfiguration: proposal.requires_configuration,
  };
}

export type IssueFixBucket = 'safe' | 'ai-assisted' | 'alternatives' | 'needs-info' | 'unfixable';

export interface IssueFixState {
  issueId: number;
  candidates: FixCandidate[];
  bucket: IssueFixBucket;
}

const RISK_RANK: Record<AIRisk, number> = { low: 0, medium: 1, high: 2 };
const CONFIDENCE_RANK: Record<AIConfidence, number> = { definite: 0, likely: 1, possible: 2 };

function rank(candidate: FixCandidate): [number, number, number] {
  const confidence = candidate.confidence ?? 'possible';
  return [RISK_RANK[candidate.risk as AIRisk] ?? 1, CONFIDENCE_RANK[confidence], candidate.replacementText.length];
}

// Classifies each issue into exactly one of the five buckets the unified
// review screen summarizes (spec: "13 validation issues / Safe automatic
// fixes: 4 / AI-assisted fixes: 5 / Issues requiring a choice: 2 / Need
// user information: 1 / Unable to safely fix: 1"). A deterministic patch
// always wins the issue outright when present and safe — the orchestrator
// (buildFixCandidates) never even requests an AI proposal for an issue a
// deterministic rule already covers, so "alternatives"/"needs-info" only
// ever arise from AI proposals in practice.
export function classifyIssue(issueId: number, candidates: FixCandidate[]): IssueFixState {
  const deterministic = candidates.filter((c) => c.method === 'deterministic' && c.selectable);
  if (deterministic.length > 0) {
    return { issueId, candidates, bucket: 'safe' };
  }

  const aiSafe = candidates
    .filter((c) => c.method === 'ai' && c.selectable)
    .slice()
    .sort((a, b) => {
      const rankA = rank(a);
      const rankB = rank(b);
      for (let i = 0; i < rankA.length; i += 1) {
        if (rankA[i] !== rankB[i]) return rankA[i] - rankB[i];
      }
      return 0;
    });

  if (aiSafe.length >= 2) return { issueId, candidates, bucket: 'alternatives' };
  if (aiSafe.length === 1) {
    return { issueId, candidates, bucket: aiSafe[0].requiresConfiguration ? 'needs-info' : 'ai-assisted' };
  }
  return { issueId, candidates, bucket: 'unfixable' };
}

export function groupIssueStates(candidates: FixCandidate[], actionableIssueIds: number[]): IssueFixState[] {
  const byIssue = new Map<number, FixCandidate[]>();
  for (const candidate of candidates) {
    if (!byIssue.has(candidate.issueId)) byIssue.set(candidate.issueId, []);
    byIssue.get(candidate.issueId)!.push(candidate);
  }
  return actionableIssueIds.map((issueId) => classifyIssue(issueId, byIssue.get(issueId) ?? []));
}

export interface FixSummaryCounts {
  safe: number;
  aiAssisted: number;
  alternatives: number;
  needsInfo: number;
  unfixable: number;
}

export function summarizeBuckets(states: IssueFixState[]): FixSummaryCounts {
  const counts: FixSummaryCounts = { safe: 0, aiAssisted: 0, alternatives: 0, needsInfo: 0, unfixable: 0 };
  for (const state of states) {
    if (state.bucket === 'safe') counts.safe += 1;
    else if (state.bucket === 'ai-assisted') counts.aiAssisted += 1;
    else if (state.bucket === 'alternatives') counts.alternatives += 1;
    else if (state.bucket === 'needs-info') counts.needsInfo += 1;
    else counts.unfixable += 1;
  }
  return counts;
}

// Same "exactly one low-risk option is unambiguous, two or more is not"
// rule the original AIReviewDialog used for its own Accept All Low Risk —
// generalized across both engines. A deterministic 'safe' bucket issue
// always has exactly one candidate, so it is always unambiguous here too.
export function selectAllLowRisk(states: IssueFixState[]): Set<string> {
  const next = new Set<string>();
  for (const state of states) {
    const lowRisk = state.candidates.filter((c) => c.selectable && c.risk === 'low');
    if (lowRisk.length === 1) next.add(lowRisk[0].fixId);
  }
  return next;
}
