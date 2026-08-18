import { describe, expect, it } from 'vitest';
import type { AIProposal, FixPatch } from '../types/landingpages';
import {
  candidateFromPatch, candidateFromProposal, classifyIssue, groupIssueStates, selectAllLowRisk, summarizeBuckets,
} from './fixCandidates';

function patch(overrides: Partial<FixPatch> = {}): FixPatch {
  return {
    fix_id: 'det-1', issue_id: 1, fingerprint: 'fp', language: 'html', source_context: '',
    file: 'html', start_offset: 0, end_offset: 0, start_line: 1, start_column: 1, end_line: 1, end_column: 1,
    original_text: '', replacement_text: '<meta charset="utf-8">', description: 'Add charset.',
    risk: 'low', confidence: 'definite', status: 'safe',
    ...overrides,
  };
}

function proposal(overrides: Partial<AIProposal> = {}): AIProposal {
  return {
    fix_id: 'ai-1', issue_id: 1, language: 'html', source_context: '', file: 'html',
    start_line: 1, start_column: 1, end_line: 1, end_column: 1,
    original_text: '<img src="a.jpg">', replacement_text: '<img src="a.jpg" alt="">',
    explanation: 'Adds alt text.', risk: 'low', confidence: 'possible',
    assumptions: [], requires_configuration: false, status: 'safe', rejection_reason: '',
    ...overrides,
  };
}

describe('candidateFromPatch / candidateFromProposal', () => {
  it('marks a safe deterministic patch as selectable with no rejection notice', () => {
    const candidate = candidateFromPatch(patch({ status: 'safe' }));
    expect(candidate.method).toBe('deterministic');
    expect(candidate.selectable).toBe(true);
    expect(candidate.rejectionNotice).toBeNull();
  });

  it('marks a conflicting deterministic patch as not selectable with a conflict notice', () => {
    const candidate = candidateFromPatch(patch({ status: 'conflict' }));
    expect(candidate.selectable).toBe(false);
    expect(candidate.rejectionNotice).toMatch(/same source range/);
  });

  it('marks a safe AI proposal as selectable', () => {
    const candidate = candidateFromProposal(proposal({ status: 'safe' }));
    expect(candidate.method).toBe('ai');
    expect(candidate.selectable).toBe(true);
  });

  it('marks a rejected AI proposal as not selectable with its rejection reason', () => {
    const candidate = candidateFromProposal(proposal({ status: 'rejected', rejection_reason: 'Code changed.' }));
    expect(candidate.selectable).toBe(false);
    expect(candidate.rejectionNotice).toBe('Proposal rejected — Code changed.');
  });

  it('marks a conflicting AI proposal distinctly from a rejected one', () => {
    const candidate = candidateFromProposal(proposal({ status: 'conflict', rejection_reason: 'Two proposals overlap.' }));
    expect(candidate.rejectionNotice).toBe('Conflicts with another proposal — Two proposals overlap.');
  });
});

describe('classifyIssue', () => {
  it('classifies a safe deterministic candidate as "safe", even alongside other candidates', () => {
    const state = classifyIssue(1, [candidateFromPatch(patch({ status: 'safe' }))]);
    expect(state.bucket).toBe('safe');
  });

  it('classifies a single safe AI candidate as "ai-assisted"', () => {
    const state = classifyIssue(1, [candidateFromProposal(proposal({ status: 'safe', requires_configuration: false }))]);
    expect(state.bucket).toBe('ai-assisted');
  });

  it('classifies a single safe AI candidate that requires configuration as "needs-info"', () => {
    const state = classifyIssue(1, [candidateFromProposal(proposal({ status: 'safe', requires_configuration: true }))]);
    expect(state.bucket).toBe('needs-info');
  });

  it('classifies two or more safe AI candidates as "alternatives"', () => {
    const state = classifyIssue(1, [
      candidateFromProposal(proposal({ fix_id: 'ai-1', status: 'safe' })),
      candidateFromProposal(proposal({ fix_id: 'ai-2', status: 'safe' })),
    ]);
    expect(state.bucket).toBe('alternatives');
  });

  it('classifies zero selectable candidates as "unfixable"', () => {
    const state = classifyIssue(1, [candidateFromPatch(patch({ status: 'conflict' }))]);
    expect(state.bucket).toBe('unfixable');
  });

  it('classifies an issue with no candidates at all as "unfixable"', () => {
    const state = classifyIssue(1, []);
    expect(state.bucket).toBe('unfixable');
  });
});

describe('groupIssueStates', () => {
  it('produces one state per actionable issue id, in order, even when a candidate is missing', () => {
    const candidates = [candidateFromPatch(patch({ issue_id: 1, status: 'safe' }))];
    const states = groupIssueStates(candidates, [1, 2]);
    expect(states.map((s) => s.issueId)).toEqual([1, 2]);
    expect(states[0].bucket).toBe('safe');
    expect(states[1].bucket).toBe('unfixable');
  });
});

describe('summarizeBuckets', () => {
  it('counts every bucket independently', () => {
    const states = groupIssueStates([
      candidateFromPatch(patch({ issue_id: 1, status: 'safe' })),
      candidateFromProposal(proposal({ fix_id: 'ai-1', issue_id: 2, status: 'safe', requires_configuration: false })),
      candidateFromProposal(proposal({ fix_id: 'ai-2', issue_id: 3, status: 'safe' })),
      candidateFromProposal(proposal({ fix_id: 'ai-3', issue_id: 3, status: 'safe' })),
      candidateFromProposal(proposal({ fix_id: 'ai-4', issue_id: 4, status: 'safe', requires_configuration: true })),
      candidateFromPatch(patch({ fix_id: 'det-5', issue_id: 5, status: 'conflict' })),
    ], [1, 2, 3, 4, 5]);

    expect(summarizeBuckets(states)).toEqual({
      safe: 1, aiAssisted: 1, alternatives: 1, needsInfo: 1, unfixable: 1,
    });
  });
});

describe('selectAllLowRisk', () => {
  it('selects the sole low-risk candidate for an issue', () => {
    const states = groupIssueStates(
      [candidateFromPatch(patch({ issue_id: 1, status: 'safe', risk: 'low' }))], [1],
    );
    expect(selectAllLowRisk(states)).toEqual(new Set(['det-1']));
  });

  it('does not select anything when two low-risk alternatives tie', () => {
    const states = groupIssueStates([
      candidateFromProposal(proposal({ fix_id: 'ai-1', issue_id: 1, status: 'safe', risk: 'low' })),
      candidateFromProposal(proposal({ fix_id: 'ai-2', issue_id: 1, status: 'safe', risk: 'low' })),
    ], [1]);
    expect(selectAllLowRisk(states).size).toBe(0);
  });

  it('does not select a medium or high risk candidate', () => {
    const states = groupIssueStates(
      [candidateFromPatch(patch({ issue_id: 1, status: 'safe', risk: 'medium' }))], [1],
    );
    expect(selectAllLowRisk(states).size).toBe(0);
  });
});
