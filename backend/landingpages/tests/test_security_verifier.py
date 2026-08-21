"""Deterministic Secure-DOM verifier — Verified Repair Memory + Secure
JavaScript closure spec, sections 5/6. Unit tests for the pure functions
in security_verifier.py, plus an integration test proving
ai_review/validation.py's `validate_proposals` actually rejects an
unsafe-to-unsafe sink swap using a REAL persisted issue (never a
hand-crafted one — fingerprints/offsets must be genuine)."""

from django.contrib.auth import get_user_model
from django.test import TestCase

from .. import security_verifier as sv
from ..ai_review.provider import ProposalDraft
from ..ai_review.validation import validate_proposals
from ..report_builder import persist_validation_report

User = get_user_model()


class DangerousSinkCountingTests(TestCase):
    def test_counts_each_category_independently(self):
        js = 'a.innerHTML = x; b.outerHTML = y; c.insertAdjacentHTML("beforeend", z);'
        counts = sv.count_dangerous_sinks(js)
        self.assertEqual(counts['innerHTML-assignment'], 1)
        self.assertEqual(counts['outerHTML-assignment'], 1)
        self.assertEqual(counts['insertAdjacentHTML-call'], 1)
        self.assertEqual(counts['document-write-call'], 0)

    def test_detects_document_write_eval_function_and_javascript_url(self):
        js = 'document.write(x); eval(y); new Function(z); el.href = "javascript:alert(1)";'
        counts = sv.count_dangerous_sinks(js)
        self.assertEqual(counts['document-write-call'], 1)
        self.assertEqual(counts['eval-call'], 1)
        self.assertEqual(counts['function-constructor'], 1)
        self.assertEqual(counts['javascript-url-scheme'], 1)

    def test_no_false_positive_on_a_function_named_evaluate(self):
        js = 'function evaluate(x) { return x; } evaluate(1);'
        self.assertEqual(sv.count_dangerous_sinks(js)['eval-call'], 0)


class IntroducesNewDangerousSinkTests(TestCase):
    def test_swapping_innerhtml_for_insertadjacenthtml_is_flagged(self):
        before = 'el.innerHTML = value;'
        after = 'el.insertAdjacentHTML("beforeend", value);'
        self.assertIn('insertAdjacentHTML-call', sv.introduces_new_dangerous_sink(before, after))

    def test_a_genuine_safe_fix_is_never_flagged(self):
        before = 'el.innerHTML = value;'
        after = 'el.textContent = value;'
        self.assertEqual(sv.introduces_new_dangerous_sink(before, after), [])

    def test_an_unrelated_untouched_sink_elsewhere_is_never_flagged(self):
        # The candidate legitimately fixes ONE sink; a second, untouched
        # dangerous call elsewhere in the file must not itself trip the
        # "new sink" check — it was already there, unchanged.
        before = 'el.innerHTML = value;\nother.innerHTML = "";'
        after = 'el.textContent = value;\nother.innerHTML = "";'
        self.assertEqual(sv.introduces_new_dangerous_sink(before, after), [])

    def test_removing_a_sink_entirely_is_never_flagged(self):
        before = 'el.innerHTML = "";'
        after = 'el.replaceChildren();'
        self.assertEqual(sv.introduces_new_dangerous_sink(before, after), [])


class TrustBoundaryClassificationTests(TestCase):
    def test_static_string_literal_is_trusted(self):
        self.assertEqual(sv.classify_value_source('"Hello world"'), sv.TRUST_STATIC_LITERAL)

    def test_template_literal_with_interpolation_is_not_static(self):
        self.assertNotEqual(sv.classify_value_source('`Hello ${name}`'), sv.TRUST_STATIC_LITERAL)

    def test_dom_value_read_is_dom_input(self):
        self.assertEqual(
            sv.classify_value_source('document.getElementById("name").value'), sv.TRUST_DOM_INPUT,
        )

    def test_location_search_is_query_parameter(self):
        self.assertEqual(
            sv.classify_value_source('new URLSearchParams(location.search).get("next")'),
            sv.TRUST_QUERY_PARAMETER,
        )

    def test_location_hash_is_url_parameter(self):
        self.assertEqual(sv.classify_value_source('location.hash'), sv.TRUST_URL_PARAMETER)

    def test_local_storage_is_classified(self):
        self.assertEqual(sv.classify_value_source('localStorage.getItem("x")'), sv.TRUST_LOCAL_STORAGE)

    def test_unrecognized_expression_is_unknown_never_guessed_safe(self):
        result = sv.classify_value_source('computeGreeting(userProfile)')
        self.assertEqual(result, sv.TRUST_UNKNOWN)
        self.assertIn(result, sv.UNTRUSTED_CATEGORIES)

    def test_empty_expression_is_unknown(self):
        self.assertEqual(sv.classify_value_source(''), sv.TRUST_UNKNOWN)


def _make_user(name='sv_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


class ValidateProposalsSecureDomGateTests(TestCase):
    """Proves the gate is actually wired into validate_proposals, using a
    REAL persisted unsafe-innerHTML issue — never a hand-crafted one."""

    def setUp(self):
        self.user = _make_user()
        self.js = 'function show(value) {\n  result.innerHTML = value;\n}\n'
        report, _result = persist_validation_report(
            user=self.user, project=None, html='', css='', js=self.js, ts='', ampscript='',
            profile='standard', validation_scope='javascript', css_source_type='css',
        )
        self.report = report
        self.issue = next(i for i in report.issues.all() if i.rule_id == 'mdaiw-security/innerhtml-assignment')

    def _draft(self, replacement_text):
        return ProposalDraft(
            issue_ids=[self.issue.id], language='javascript', source_context=self.issue.source_context,
            explanation='Fix it.', risk='medium', confidence='definite',
            start_offset=0, end_offset=0,
            expected_text='result.innerHTML = value;', replacement_text=replacement_text,
            requires_configuration=False, assumptions=[],
        )

    def test_swapping_to_insertadjacenthtml_is_rejected(self):
        draft = self._draft('result.insertAdjacentHTML("beforeend", value);')
        proposals, _not_reviewed = validate_proposals(
            [draft], list(self.report.issues.all()), [self.issue.id],
            {'html': '', 'css': '', 'js': self.js, 'ampscript': ''},
        )
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0].status, 'rejected')
        self.assertIn('secure-DOM verifier', proposals[0].rejection_reason)

    def test_a_genuine_textcontent_fix_is_accepted(self):
        draft = self._draft('result.textContent = value;')
        proposals, _not_reviewed = validate_proposals(
            [draft], list(self.report.issues.all()), [self.issue.id],
            {'html': '', 'css': '', 'js': self.js, 'ampscript': ''},
        )
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0].status, 'safe')
