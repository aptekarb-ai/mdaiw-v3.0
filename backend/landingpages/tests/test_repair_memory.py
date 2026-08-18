"""Verified Repair Memory sprint — unit tests for fixes/repair_memory.py's
storage/lookup contract in isolation from the repair loop that consumes it
(see test_iterative_fix.py for the wired-in fast-path/negative-memory
behavior)."""

from django.test import TestCase

from ..fixes import repair_memory
from ..models import RepairKnowledgeRecord, RepairKnowledgeStatus


class ContextSignatureTests(TestCase):
    def test_same_facts_hash_identically_regardless_of_key_order(self):
        a = repair_memory.compute_context_signature({'head_count': 1, 'charset_count': 1})
        b = repair_memory.compute_context_signature({'charset_count': 1, 'head_count': 1})
        self.assertEqual(a, b)

    def test_different_facts_hash_differently(self):
        a = repair_memory.compute_context_signature({'head_count': 1})
        b = repair_memory.compute_context_signature({'head_count': 2})
        self.assertNotEqual(a, b)

    def test_never_produces_something_resembling_raw_source(self):
        # A structural-facts signature is always a fixed-length hex digest
        # — there is no code path that could leak source text into it.
        signature = repair_memory.compute_context_signature({'head_count': 1, 'charset_position': 'not_first'})
        self.assertEqual(len(signature), 64)
        self.assertTrue(all(c in '0123456789abcdef' for c in signature))


class RepairKnowledgeLookupTests(TestCase):
    def test_find_verified_recipe_returns_none_when_nothing_known(self):
        self.assertIsNone(repair_memory.find_verified_recipe(
            language='html', rule_id='seo:charset-declared-late', context_signature='x',
        ))

    def test_a_successful_attempt_becomes_findable_as_verified(self):
        repair_memory.record_attempt_result(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-1',
            strategy_key='move-existing-charset', success=True,
            strategy_description='Move the existing <meta charset> to the first appropriate <head> child.',
        )
        found = repair_memory.find_verified_recipe(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-1',
        )
        self.assertIsNotNone(found)
        self.assertEqual(found.strategy_key, 'move-existing-charset')
        self.assertEqual(found.status, RepairKnowledgeStatus.VERIFIED)
        self.assertEqual(found.success_count, 1)
        self.assertEqual(found.attempt_count, 1)

    def test_a_failed_attempt_is_not_findable_as_verified(self):
        repair_memory.record_attempt_result(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-2',
            strategy_key='add-new-charset-in-new-head', success=False,
            strategy_description='Insert a brand new <head><meta charset> — duplicates head.',
        )
        self.assertIsNone(repair_memory.find_verified_recipe(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-2',
        ))
        self.assertTrue(repair_memory.is_rejected_strategy(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-2',
            strategy_key='add-new-charset-in-new-head',
        ))

    def test_rejected_strategy_descriptions_surface_for_ai_negative_guidance(self):
        repair_memory.record_attempt_result(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-3',
            strategy_key='add-new-charset-in-new-head', success=False,
            strategy_description='Insert a brand new <head><meta charset> — duplicates head.',
        )
        descriptions = repair_memory.rejected_strategy_descriptions(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-3',
        )
        self.assertEqual(descriptions, ['Insert a brand new <head><meta charset> — duplicates head.'])

    def test_repeated_success_accumulates_counts_and_prefers_higher_success_count(self):
        for _ in range(3):
            repair_memory.record_attempt_result(
                language='css', rule_id='generic-font-fallback', context_signature='ctx-4',
                strategy_key='append-generic-family', success=True,
            )
        repair_memory.record_attempt_result(
            language='css', rule_id='generic-font-fallback', context_signature='ctx-4',
            strategy_key='rare-alternative-strategy', success=True,
        )
        best = repair_memory.find_verified_recipe(language='css', rule_id='generic-font-fallback', context_signature='ctx-4')
        self.assertEqual(best.strategy_key, 'append-generic-family')
        self.assertEqual(best.success_count, 3)
        self.assertEqual(best.attempt_count, 3)

    def test_a_strategy_that_starts_failing_after_previously_verified_gets_demoted(self):
        repair_memory.record_attempt_result(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-5',
            strategy_key='move-existing-charset', success=True,
        )
        repair_memory.record_attempt_result(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-5',
            strategy_key='move-existing-charset', success=False, rolled_back=True,
        )
        record = RepairKnowledgeRecord.objects.get(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-5',
            strategy_key='move-existing-charset',
        )
        self.assertEqual(record.status, RepairKnowledgeStatus.REJECTED)
        self.assertEqual(record.attempt_count, 2)
        self.assertEqual(record.success_count, 1)
        self.assertEqual(record.failure_count, 1)
        self.assertEqual(record.rollback_count, 1)
        self.assertIsNone(repair_memory.find_verified_recipe(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-5',
        ))

    def test_environment_is_captured_only_on_success(self):
        repair_memory.record_attempt_result(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-6',
            strategy_key='move-existing-charset', success=True, environment={'profile': 'standard'},
        )
        record = RepairKnowledgeRecord.objects.get(context_signature='ctx-6')
        self.assertEqual(record.last_verified_environment, {'profile': 'standard'})
        self.assertIsNotNone(record.last_verified_at)


class ConfidenceBasedPromotionDemotionTests(TestCase):
    """Closure spec section 9 — a strategy's trust must not flip on a
    single data point. Every scenario here checks BOTH the raw counters
    AND the derived `confidence` property that decides status."""

    def test_confidence_is_laplace_smoothed_not_a_raw_ratio(self):
        record = repair_memory.record_attempt_result(
            language='html', rule_id='r', context_signature='c1', strategy_key='s', success=True,
        )
        # 1 success / 1 attempt is NOT confidence 1.0 — smoothing keeps a
        # single data point from claiming full certainty.
        self.assertAlmostEqual(record.confidence, 2 / 3)

    def test_one_isolated_non_rollback_failure_does_not_reject_a_broadly_successful_strategy(self):
        for _ in range(20):
            repair_memory.record_attempt_result(
                language='html', rule_id='seo:charset-declared-late', context_signature='ctx-stable',
                strategy_key='move-existing-charset', success=True,
            )
        record = repair_memory.record_attempt_result(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-stable',
            strategy_key='move-existing-charset', success=False,  # plain failure, NOT a rollback
        )
        self.assertEqual(record.status, RepairKnowledgeStatus.VERIFIED)
        self.assertGreater(record.confidence, 0.85)
        # Still findable — a single soft failure did not evict it.
        found = repair_memory.find_verified_recipe(
            language='html', rule_id='seo:charset-declared-late', context_signature='ctx-stable',
        )
        self.assertEqual(found.strategy_key, 'move-existing-charset')

    def test_exactly_one_success_then_one_plain_failure_stays_verified_at_the_boundary(self):
        # Precisely the case the old "one success/one failure flips
        # everything" policy got wrong: confidence lands exactly at the
        # promotion threshold (0.5), which must count as still trusted.
        repair_memory.record_attempt_result(
            language='css', rule_id='r', context_signature='c2', strategy_key='s', success=True,
        )
        record = repair_memory.record_attempt_result(
            language='css', rule_id='r', context_signature='c2', strategy_key='s', success=False,
        )
        self.assertAlmostEqual(record.confidence, 0.5)
        self.assertEqual(record.status, RepairKnowledgeStatus.VERIFIED)

    def test_a_rollback_immediately_rejects_regardless_of_a_long_successful_history(self):
        for _ in range(20):
            repair_memory.record_attempt_result(
                language='html', rule_id='r', context_signature='c3', strategy_key='s', success=True,
            )
        record = repair_memory.record_attempt_result(
            language='html', rule_id='r', context_signature='c3', strategy_key='s',
            success=False, rolled_back=True,
        )
        # Confidence is still high in raw-ratio terms, but a shipped
        # regression is catastrophic and bypasses the confidence math.
        self.assertGreater(record.confidence, 0.9)
        self.assertEqual(record.status, RepairKnowledgeStatus.REJECTED)
        self.assertIsNone(repair_memory.find_verified_recipe(
            language='html', rule_id='r', context_signature='c3',
        ))

    def test_repeatedly_failing_strategy_converges_to_rejected(self):
        repair_memory.record_attempt_result(
            language='html', rule_id='r', context_signature='c4', strategy_key='s', success=True,
        )
        record = None
        for _ in range(4):
            record = repair_memory.record_attempt_result(
                language='html', rule_id='r', context_signature='c4', strategy_key='s', success=False,
            )
        self.assertLess(record.confidence, 0.5)
        self.assertEqual(record.status, RepairKnowledgeStatus.REJECTED)

    def test_lookup_prefers_higher_confidence_over_higher_raw_success_count(self):
        # 'volatile' has more RAW successes but a mixed history (lower
        # confidence); 'consistent' has fewer successes but a clean
        # record (higher confidence) — the lookup must prefer confidence.
        for _ in range(5):
            repair_memory.record_attempt_result(
                language='html', rule_id='r', context_signature='c5', strategy_key='volatile', success=True,
            )
        for _ in range(4):
            repair_memory.record_attempt_result(
                language='html', rule_id='r', context_signature='c5', strategy_key='volatile', success=False,
            )
        for _ in range(2):
            repair_memory.record_attempt_result(
                language='html', rule_id='r', context_signature='c5', strategy_key='consistent', success=True,
            )
        volatile = RepairKnowledgeRecord.objects.get(context_signature='c5', strategy_key='volatile')
        consistent = RepairKnowledgeRecord.objects.get(context_signature='c5', strategy_key='consistent')
        self.assertGreater(volatile.success_count, consistent.success_count)
        self.assertGreater(consistent.confidence, volatile.confidence)

        best = repair_memory.find_verified_recipe(language='html', rule_id='r', context_signature='c5')
        self.assertEqual(best.strategy_key, 'consistent')
