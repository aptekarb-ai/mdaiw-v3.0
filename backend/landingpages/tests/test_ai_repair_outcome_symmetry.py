"""Regional/Whole-Source AI Outcome-Recording Symmetry sprint — proves
that a regional AI repair ("AI Fix Issues" batch or "AI Fix This Issue"),
a whole-source AI repair, and Complete LP repair all write outcomes into
the SAME RepairKnowledgeRecord row for a given (language, rule_id,
generalized context_signature) — one shared strategy_key='ai-repair'
namespace, never a separate ledger row per UI entry point or repair mode.

Exercises fixes/iterative.py's AIRepairMetaEntry / _build_ai_repair_meta /
_record_ai_repair_outcomes / _is_rejected_ai_strategy directly — this is
the same level the whole-source wiring is proven at in test_knowledge.py,
and is a more reliable way to prove ledger-sharing semantics than
reverse-engineering a live end-to-end fixture for every one of the five
required scenarios (see the module's own compute_generic_context_signature
docstring for why the signature is deliberately coarse).
"""

import types

from django.test import TestCase

from ..fixes import iterative as it
from ..fixes import repair_memory
from ..models import RepairKnowledgeRecord, RepairKnowledgeStatus


def _issue(*, rule_id='totally-fake-ai-only-rule', language='javascript', file='javascript',
           severity='error', source_context='standalone-javascript'):
    return types.SimpleNamespace(rule_id=rule_id, language=language, file=file, severity=severity, source_context=source_context)


class RegionalSuccessBecomesVerifiedAndUnblocksFuturePathTests(TestCase):
    """Test A — regional repair succeeds -> verified strategy recorded ->
    the same generalized pattern is never blocked from a later attempt
    (the only 'fast path' an AI-sourced strategy can offer, since there is
    no code-registered executable to replay — see AI_STRATEGY_KEY's
    docstring in repair_memory.py)."""

    def test_regional_success_is_recorded_verified_and_stays_unblocked(self):
        issue = _issue()
        meta = it._build_ai_repair_meta(issue)
        self.assertFalse(it._is_rejected_ai_strategy(issue))

        it._record_ai_repair_outcomes({'fp-1': meta}, {'fp-1'}, profile='standard')

        record = RepairKnowledgeRecord.objects.get(
            language='javascript', rule_id='totally-fake-ai-only-rule',
            context_signature=meta.context_signature, strategy_key=repair_memory.AI_STRATEGY_KEY,
        )
        self.assertEqual(record.status, RepairKnowledgeStatus.VERIFIED)
        self.assertEqual(record.success_count, 1)
        self.assertFalse(it._is_rejected_ai_strategy(issue))


class RegionalFailureDemotesAndWholeSourceStaysIndependentTests(TestCase):
    """Test B — regional repair fails -> rejected/demoted; whole-source
    repair never blindly TRUSTS that memory either — it still runs its
    own full candidate-first authoritative revalidation regardless of
    what regional memory says (this project never replays/caches raw AI
    output, so there is nothing FOR whole-source to blindly reuse in the
    first place; this test proves the negative-memory row doesn't silently
    influence _build_ai_repair_meta's own attempt-recording behavior for
    a DIFFERENT, still-live whole-source attempt at the same context)."""

    def test_regional_failure_is_rejected_and_whole_source_meta_still_builds_independently(self):
        issue = _issue()
        meta = it._build_ai_repair_meta(issue)

        it._record_ai_repair_outcomes({'fp-1': meta}, set(), profile='standard')  # nothing resolved -> failure

        record = RepairKnowledgeRecord.objects.get(
            language='javascript', rule_id='totally-fake-ai-only-rule',
            context_signature=meta.context_signature, strategy_key=repair_memory.AI_STRATEGY_KEY,
        )
        self.assertEqual(record.status, RepairKnowledgeStatus.REJECTED)
        self.assertTrue(it._is_rejected_ai_strategy(issue))

        # A whole-source attempt at the exact same issue still builds its
        # own meta entry (never short-circuited/skipped by the regional
        # rejection) — it remains fully subject to its own independent
        # authoritative candidate-first acceptance gate.
        whole_source_meta = it._build_ai_repair_meta(issue)
        self.assertEqual(whole_source_meta.context_signature, meta.context_signature)
        self.assertEqual(whole_source_meta.strategy_key, repair_memory.AI_STRATEGY_KEY)


class WholeSourceSuccessIsReusableByRegionalTests(TestCase):
    """Test C — whole-source success is recorded on the SAME row a
    regional attempt at the identical generalized context would read/
    write, and does not itself get blocked."""

    def test_whole_source_success_leaves_the_context_unblocked_for_regional(self):
        issue = _issue(rule_id='another-fake-ai-only-rule')
        meta = it._build_ai_repair_meta(issue)

        # Simulates the whole-source call sites in run_autonomous_repair,
        # which record synchronously right after their own acceptance
        # check (no deferral needed — see _attempt_whole_source_repair's
        # docstring).
        it._record_ai_repair_outcomes({issue.file: meta}, {issue.file}, profile='standard')

        record = RepairKnowledgeRecord.objects.get(
            language='javascript', rule_id='another-fake-ai-only-rule',
            context_signature=meta.context_signature, strategy_key=repair_memory.AI_STRATEGY_KEY,
        )
        self.assertEqual(record.status, RepairKnowledgeStatus.VERIFIED)
        self.assertFalse(it._is_rejected_ai_strategy(issue))


class SameStrategyTwoEntryPointsOneRecordTests(TestCase):
    """Test D — 'AI Fix Issues' batch and 'AI Fix This Issue' both funnel
    through the exact same _build_ai_repair_meta/_record_ai_repair_outcomes
    pair for an identical issue shape; two separate calls (simulating the
    two entry points) must accumulate on ONE ledger row, never create a
    second one."""

    def test_two_separate_recording_calls_accumulate_on_one_row(self):
        issue = _issue(rule_id='shared-entry-point-rule')

        meta_from_batch_entry_point = it._build_ai_repair_meta(issue)
        it._record_ai_repair_outcomes({'fp-batch': meta_from_batch_entry_point}, {'fp-batch'}, profile='standard')

        meta_from_single_issue_entry_point = it._build_ai_repair_meta(issue)
        it._record_ai_repair_outcomes({'fp-single': meta_from_single_issue_entry_point}, {'fp-single'}, profile='standard')

        matching_records = RepairKnowledgeRecord.objects.filter(
            language='javascript', rule_id='shared-entry-point-rule',
            context_signature=meta_from_batch_entry_point.context_signature, strategy_key=repair_memory.AI_STRATEGY_KEY,
        )
        self.assertEqual(matching_records.count(), 1)
        self.assertEqual(matching_records.first().success_count, 2)
        self.assertEqual(matching_records.first().attempt_count, 2)


class RollbackForcesImmediateRejectionTests(TestCase):
    """Test E — a rollback (the whole round, including an AI-applied
    patch, was shipped then reverted for making things worse — see
    run_autonomous_repair's regression-revert branch, which now threads
    rolled_back=True through to _record_ai_repair_outcomes exactly like
    it already does for pending_recipe_meta) demotes the strategy to
    REJECTED immediately, bypassing the confidence math entirely — the
    SAME catastrophic-rollback rule repair_memory.record_attempt_result
    already enforces for recipes, now reachable through the AI-sourced
    path too."""

    def test_a_rolled_back_first_attempt_is_rejected_immediately(self):
        issue = _issue(rule_id='rollback-rule')
        meta = it._build_ai_repair_meta(issue)

        it._record_ai_repair_outcomes({'fp-1': meta}, set(), profile='standard', rolled_back=True)

        record = RepairKnowledgeRecord.objects.get(
            language='javascript', rule_id='rollback-rule',
            context_signature=meta.context_signature, strategy_key=repair_memory.AI_STRATEGY_KEY,
        )
        self.assertEqual(record.status, RepairKnowledgeStatus.REJECTED)
        self.assertEqual(record.rollback_count, 1)
        self.assertTrue(it._is_rejected_ai_strategy(issue))

    def test_rollback_overrides_a_previously_verified_history(self):
        issue = _issue(rule_id='rollback-after-verified-rule')
        meta = it._build_ai_repair_meta(issue)
        # 20 clean successes first (mirrors repair_memory's own docstring
        # example of a strategy that should otherwise stay comfortably
        # trusted) ...
        for i in range(20):
            it._record_ai_repair_outcomes({f'fp-{i}': meta}, {f'fp-{i}'}, profile='standard')
        record = RepairKnowledgeRecord.objects.get(
            language='javascript', rule_id='rollback-after-verified-rule',
            context_signature=meta.context_signature, strategy_key=repair_memory.AI_STRATEGY_KEY,
        )
        self.assertEqual(record.status, RepairKnowledgeStatus.VERIFIED)

        # ... then ONE rollback still immediately demotes it, unlike an
        # ordinary failure (which a 20-success history would absorb).
        it._record_ai_repair_outcomes({'fp-rollback': meta}, set(), profile='standard', rolled_back=True)
        record.refresh_from_db()
        self.assertEqual(record.status, RepairKnowledgeStatus.REJECTED)
