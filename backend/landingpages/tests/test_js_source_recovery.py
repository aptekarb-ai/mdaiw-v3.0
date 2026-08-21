"""JavaScript Source-Recovery Architecture sprint — Module 3 LP Validator
& Fixer.

Root cause of the reported "AI Fix Issues -> Resolved 0, Remaining 1,
Validation Issues shows only 'Parsing error: Unexpected token ,'": Espree
(correctly, as the authoritative parser) aborts at the FIRST fatal syntax
token and hides every other defect in the file. That part is fine — the
Rule Knowledge Registry's own repair_strategy for 'javascript:parse-error'
already says as much. The bug was in what happened NEXT:

1. `_try_accept_whole_source_candidate` compared raw error counts with no
   exemption for "resolved the parser blocker" — a whole-source candidate
   that made the file parse again (but, in doing so, legitimately exposed
   real findings the parse error had been hiding) had MORE error-severity
   issues than before and was rejected as "worse", even though a
   parseable file with honest findings is objectively better than an
   unparseable black box. This is the exact reported symptom: the correct
   candidate got proposed and thrown away every time.

2. `attempted_whole_source_files` permanently excluded a file_key for the
   rest of the run the moment it was tried once — including after a
   SUCCESSFUL repair. A file with multiple sequential parser blockers
   (fix blocker A, reparse, blocker B is now exposed) could only ever get
   ONE whole-source attempt per run, defeating the "click AI Fix Issues
   once" cascade requirement.

Both are fixed in fixes/iterative.py. Unit tests inject a fake AI review
provider (no real network call).
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ..ai_review.provider import AIReviewResult, WholeSourceRepairResult
from ..fixes import iterative as it
from ..models import RepairKnowledgeRecord, RepairKnowledgeStatus
from ..report_builder import persist_validation_report

User = get_user_model()

# The user's own reported fixture, byte-for-byte as given in the bug
# report (spec section 1) — a permanent regression fixture (spec section
# 25) covering, simultaneously: a malformed function signature/missing
# closing paren+brace, an unterminated console.log call, an
# assignment-in-condition, an undeclared global assignment, a missing
# object-literal colon, a malformed for-loop header (missing `;`), and an
# illegal top-level return.
MULTI_DEFECT_JS = (
    'function testFunc( {\n'
    '    console.log("Missing closing parenthesis and brace" // syntax error\n'
    '\n'
    'let x = 10\n'
    'if (x = 5) {\n'
    '    console.log("This will still run but is logically wrong")\n'
    '}\n'
    '\n'
    'undeclaredVar = 42;\n'
    '\n'
    'const obj = {\n'
    '    key1: "value1",\n'
    '    key2 "missingColon"\n'
    '}\n'
    '\n'
    'for (let i = 0; i < 5 i++) {\n'
    '    console.log(i)\n'
    '}\n'
    '\n'
    'return "This return is outside a function"\n'
)

# A hand-written, fully-corrected candidate a capable model could
# reasonably return in ONE shot — preserves every original string literal
# (content-preservation requirement), fixes every syntax defect, keeps
# the assignment-in-condition fix (the fixture's own comment proves intent
# — spec section 14) and moves the top-level return inside the only
# function present (spec section 12 — structure makes intent inferable).
_FULLY_CORRECTED_JS = (
    'function testFunc() {\n'
    '  console.log("Missing closing parenthesis and brace");\n'
    '  return "This return is outside a function";\n'
    '}\n'
    'testFunc();\n'
    '\n'
    'let x = 10;\n'
    'if (x === 5) {\n'
    '  console.log("This will still run but is logically wrong");\n'
    '}\n'
    '\n'
    'window.undeclaredVar = 42;\n'
    '\n'
    'const obj = {\n'
    '  key1: "value1",\n'
    '  key2: "missingColon",\n'
    '};\n'
    'console.log(obj);\n'
    '\n'
    'for (let i = 0; i < 5; i++) {\n'
    '  console.log(i);\n'
    '}\n'
)


class OneShotFullRepairProvider:
    def __init__(self, corrected):
        self.corrected = corrected
        self.whole_source_calls = []

    def review(self, request):
        return AIReviewResult(summary='', proposals=[])

    def repair_whole_source(self, request):
        self.whole_source_calls.append(request)
        return WholeSourceRepairResult(corrected_source=self.corrected, explanation='Repaired all syntax defects at once.')


_user_counter = [0]


def _run_js(js, provider, *, validation_scope='javascript'):
    cache.clear()
    _user_counter[0] += 1
    user = User.objects.create_user(
        username=f'js_recovery_user_{_user_counter[0]}', password='pw12345!', email=f'jsr{_user_counter[0]}@example.com',
    )
    with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])):
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            return it.run_autonomous_repair(
                user=user, project=None,
                initial_sources={'html': '', 'css': '', 'js': js, 'ampscript': ''},
                css_source_type='css', validation_scope=validation_scope, profile='standard',
                rate_limit_identifier='jsr',
            )


class MultipleHiddenDefectsRepairedInOneCandidateTests(TestCase):
    def test_the_original_fixture_only_reports_the_first_parse_error(self):
        cache.clear()
        user = User.objects.create_user(username='js_probe_user', password='pw12345!', email='jsp@example.com')
        report, _result = persist_validation_report(
            user=user, project=None, html='', css='', js=MULTI_DEFECT_JS, ts='', ampscript='',
            profile='standard', validation_scope='javascript', css_source_type='css',
        )
        rule_ids = [issue.rule_id for issue in report.issues.all()]
        self.assertEqual(rule_ids, ['javascript:parse-error'])

    def test_a_whole_source_candidate_that_exposes_new_real_errors_is_accepted(self):
        """The core regression proof — before the fix, this candidate
        (which correctly resolves the parse error but the fixed file
        might still trip a lint/style warning or two) was rejected purely
        for having a different error-severity count than the single parse
        error it replaced."""
        provider = OneShotFullRepairProvider(_FULLY_CORRECTED_JS)
        result = _run_js(MULTI_DEFECT_JS, provider)

        self.assertEqual(len(provider.whole_source_calls), 1)  # spec section 23 — 0-1 AI calls
        final_rule_ids = {issue.rule_id for issue in result.report.issues.all() if issue.severity == 'error'}
        self.assertNotIn('javascript:parse-error', final_rule_ids)
        self.assertIn('function testFunc()', result.final_sources['js'])
        self.assertIn('This return is outside a function', result.final_sources['js'])
        self.assertIn('This will still run but is logically wrong', result.final_sources['js'])
        self.assertIn('value1', result.final_sources['js'])

    def test_success_banner_metrics_reflect_genuine_convergence(self):
        provider = OneShotFullRepairProvider(_FULLY_CORRECTED_JS)
        result = _run_js(MULTI_DEFECT_JS, provider)
        self.assertEqual(result.issues_remaining_total, result.issues_requires_input_total + result.issues_advisory_total)

    def test_second_run_against_the_repaired_source_is_idempotent(self):
        provider = OneShotFullRepairProvider(_FULLY_CORRECTED_JS)
        result_1 = _run_js(MULTI_DEFECT_JS, provider)
        provider_2 = OneShotFullRepairProvider(_FULLY_CORRECTED_JS)
        result_2 = _run_js(result_1.final_sources['js'], provider_2)

        self.assertEqual(len(provider_2.whole_source_calls), 0)  # nothing left that needs an AI call
        self.assertEqual(result_1.final_sources['js'], result_2.final_sources['js'])


class WholeSourceCascadeRetryTests(TestCase):
    """Bug #2 — a file with TWO sequential parser blockers (the second
    only visible once the first is fixed) must get a SECOND whole-source
    attempt in the SAME run, not be permanently excluded after its first,
    successful attempt."""

    _TWO_SEQUENTIAL_BLOCKERS_JS = (
        'function a( {\n'
        '  return 1;\n'
        '}\n'
        '\n'
        'function b() {\n'
        '  return 2;\n'
        '}\n'
        '\n'
        'for (let i = 0; i < 3 i++) {\n'
        '  console.log(i);\n'
        '}\n'
    )

    class TwoStepProvider:
        def __init__(self):
            self.whole_source_calls = []

        def review(self, request):
            return AIReviewResult(summary='', proposals=[])

        def repair_whole_source(self, request):
            self.whole_source_calls.append(request)
            source = request.source
            if 'function a( {' in source:
                fixed = source.replace('function a( {', 'function a() {')
                return WholeSourceRepairResult(corrected_source=fixed, explanation='Fixed the first malformed signature.')
            if 'i < 3 i++' in source:
                fixed = source.replace('i < 3 i++', 'i < 3; i++')
                return WholeSourceRepairResult(corrected_source=fixed, explanation='Fixed the malformed for-header.')
            return WholeSourceRepairResult(corrected_source=None, explanation='Nothing left to repair.')

    def test_a_second_parser_blocker_gets_its_own_whole_source_attempt(self):
        provider = self.TwoStepProvider()
        result = _run_js(self._TWO_SEQUENTIAL_BLOCKERS_JS, provider)

        self.assertGreaterEqual(len(provider.whole_source_calls), 2)
        final_rule_ids = {issue.rule_id for issue in result.report.issues.all() if issue.severity == 'error'}
        self.assertNotIn('javascript:parse-error', final_rule_ids)
        self.assertIn('function a() {', result.final_sources['js'])
        self.assertIn('i < 3; i++', result.final_sources['js'])


class WholeSourceAiOutcomeRecordedForJsParserBlockersTests(TestCase):
    """Ties the two sprints together — a whole-source JS repair that
    resolves the parser blocker is recorded into the SAME
    RepairKnowledgeRecord ledger regional/whole-source repairs everywhere
    else already share (Regional/Whole-Source AI Outcome-Recording
    Symmetry sprint)."""

    def test_resolving_the_parser_blocker_records_a_verified_ai_repair_strategy(self):
        provider = OneShotFullRepairProvider(_FULLY_CORRECTED_JS)
        _run_js(MULTI_DEFECT_JS, provider)

        records = RepairKnowledgeRecord.objects.filter(
            language='javascript', rule_id='javascript:parse-error', strategy_key='ai-repair',
        )
        self.assertTrue(records.exists())
        self.assertEqual(records.first().status, RepairKnowledgeStatus.VERIFIED)


class DeclinedWholeSourceCandidateNeverPublishedTests(TestCase):
    def test_a_declined_repair_leaves_the_js_source_untouched(self):
        class DeclinesProvider:
            def review(self, request):
                return AIReviewResult(summary='', proposals=[])

            def repair_whole_source(self, request):
                return WholeSourceRepairResult(corrected_source=None, explanation='Cannot safely repair.')

        result = _run_js(MULTI_DEFECT_JS, DeclinesProvider())
        self.assertEqual(result.final_sources['js'], MULTI_DEFECT_JS)

    def test_a_still_unparseable_candidate_is_never_published_as_success(self):
        class StillBrokenProvider:
            def review(self, request):
                return AIReviewResult(summary='', proposals=[])

            def repair_whole_source(self, request):
                # "Fixes" the reported token but leaves the file just as
                # unparseable in a different way — must not be accepted
                # as if parsing were restored.
                return WholeSourceRepairResult(
                    corrected_source=request.source.replace('function testFunc( {', 'function testFunc( ,{'),
                    explanation='Still broken.',
                )

        result = _run_js(MULTI_DEFECT_JS, StillBrokenProvider())
        final_rule_ids = {issue.rule_id for issue in result.report.issues.all()}
        self.assertIn('javascript:parse-error', final_rule_ids)
        self.assertNotEqual(result.stopped_reason, 'all_resolved')
