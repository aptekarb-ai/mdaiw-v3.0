"""Sprint 1C fixture-based tests for the HTML validation pipeline —
orchestrator, adapters, unified schema, dedup/ordering, resource limits,
and the /api/v1/lp/validate/ profile contract."""

from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .. import validation as validation_package  # noqa: F401 - ensures package import path exists
from ..validation import engine as engine_module
from ..validation.engine import run
from ..validation.schema import severity_rank

User = get_user_model()

_FIXTURES_DIR = Path(__file__).resolve().parent / 'fixtures' / 'html'


def _load_fixture(name: str) -> str:
    return (_FIXTURES_DIR / name).read_text(encoding='utf-8')


def _make_user(username='alice', password='pw12345!'):
    return User.objects.create_user(username=username, password=password, email=f'{username}@example.com')


class MalformedHeadingAcceptanceTests(TestCase):
    """The exact Sprint 1C acceptance case."""

    def test_reports_unclosed_h1_error_and_missing_alt_warning_together(self):
        result = run(html=_load_fixture('malformed_h1.html'))

        h1_errors = [
            issue for issue in result.issues
            if issue.severity == 'error' and issue.related_element == 'h1'
        ]
        self.assertTrue(
            any(issue.start_line == 8 for issue in h1_errors),
            f'expected an h1 error at line 8, got: {[(i.start_line, i.message) for i in h1_errors]}',
        )

        alt_warnings = [
            issue for issue in result.issues
            if issue.rule_id == 'missing-alt' and issue.severity == 'warning'
        ]
        self.assertTrue(
            any(issue.start_line == 9 for issue in alt_warnings),
            f'expected a missing-alt warning at line 9, got: {[(i.start_line, i.message) for i in alt_warnings]}',
        )

        # Both findings must coexist in the same report — neither replaces
        # the other, and neither is displaced by the additional valid
        # metadata findings (missing lang/charset/viewport/description).
        self.assertTrue(h1_errors and alt_warnings)
        other_rule_ids = {issue.rule_id for issue in result.issues}
        self.assertIn('unclosed-tag', other_rule_ids)
        self.assertIn('missing-alt', other_rule_ids)

    def test_html5lib_independently_flags_the_same_document(self):
        # html5lib reports at its own detection point (the mismatched
        # closing tag), not the element's opening line — a different,
        # complementary signal to the structural adapter's line-8 finding.
        result = run(html=_load_fixture('malformed_h1.html'))
        conformance_issues = [issue for issue in result.issues if issue.source_engine == 'html5lib']
        self.assertTrue(conformance_issues)
        self.assertEqual(conformance_issues[0].rule_id, 'html5lib:end-tag-too-early')


class HtmlFixtureRuleTests(TestCase):
    def test_multiple_unclosed_nested_elements_each_reported_individually(self):
        result = run(html=_load_fixture('multiple_unclosed_nested.html'))
        unclosed = [
            issue for issue in result.issues
            if issue.rule_id == 'unclosed-tag' and issue.source_engine == 'html-structure'
        ]
        self.assertEqual(sorted(issue.related_element for issue in unclosed), ['div', 'span', 'strong'])
        # Ambiguous (more than one orphan for the same closing event) —
        # never silently offered as a safe automatic fix.
        self.assertTrue(all(issue.requires_manual_review for issue in unclosed))
        self.assertTrue(all(not issue.fixable for issue in unclosed))

    def test_incorrect_nesting_detected_by_conformance_adapter(self):
        # <div> is not allowed inside <p> — the custom structural scanner's
        # naive stack matching sees this as perfectly balanced (it has no
        # concept of content-model rules), so only html5lib's real
        # tree-construction algorithm catches it. Demonstrates why the
        # conformance adapter, not the supplemental one, is authoritative.
        result = run(html=_load_fixture('incorrect_nesting.html'))
        conformance_issues = [issue for issue in result.issues if issue.source_engine == 'html5lib']
        self.assertTrue(any(issue.rule_id == 'html5lib:unexpected-end-tag' for issue in conformance_issues))
        structural_unclosed = [
            issue for issue in result.issues
            if issue.source_engine == 'html-structure' and issue.rule_id == 'unclosed-tag'
        ]
        self.assertEqual(structural_unclosed, [])

    def test_unexpected_closing_tag_detected(self):
        result = run(html=_load_fixture('unexpected_closing_tag.html'))
        self.assertTrue(any(
            issue.rule_id == 'unexpected-closing-tag' and issue.related_element == 'div'
            for issue in result.issues
        ))

    def test_multiple_issues_on_one_line_are_both_preserved(self):
        result = run(html=_load_fixture('multiple_issues_one_line.html'))
        on_line_11 = [issue for issue in result.issues if issue.start_line == 11]
        rule_ids = {issue.rule_id for issue in on_line_11}
        self.assertIn('duplicate-id', rule_ids)
        self.assertIn('missing-alt', rule_ids)
        self.assertEqual(len(on_line_11), 2)

    def test_duplicate_ids_detected(self):
        result = run(html=_load_fixture('duplicate_ids.html'))
        self.assertTrue(any(issue.rule_id == 'duplicate-id' for issue in result.issues))

    def test_void_elements_not_flagged_as_unclosed(self):
        result = run(html=_load_fixture('void_elements.html'))
        self.assertEqual([i for i in result.issues if i.rule_id == 'unclosed-tag'], [])

    def test_valid_custom_elements_not_flagged(self):
        result = run(html=_load_fixture('custom_elements.html'))
        self.assertEqual([i for i in result.issues if i.source_engine == 'html5lib'], [])

    def test_embedded_svg_not_flagged(self):
        result = run(html=_load_fixture('embedded_svg.html'))
        self.assertEqual([i for i in result.issues if i.source_engine == 'html5lib'], [])

    def test_embedded_mathml_not_flagged(self):
        result = run(html=_load_fixture('embedded_mathml.html'))
        self.assertEqual([i for i in result.issues if i.source_engine == 'html5lib'], [])

    def test_invalid_form_nesting_detected(self):
        result = run(html=_load_fixture('invalid_form_nesting.html'))
        conformance_issues = [issue for issue in result.issues if issue.source_engine == 'html5lib']
        self.assertTrue(any('form' in issue.message.lower() for issue in conformance_issues))

    def test_invalid_list_structure_is_a_known_gap_not_a_crash(self):
        # Known Sprint 1C gap: neither html5lib's tree-construction
        # algorithm nor the supplemental scanner enforces <ul>'s content
        # model (a <div> directly inside <ul> parses without a parser
        # error). Not silently claimed as covered — this only asserts the
        # input is processed safely.
        result = run(html=_load_fixture('invalid_list_structure.html'))
        self.assertTrue(all(status.success for status in result.engine_status))

    def test_invalid_table_structure_detected(self):
        result = run(html=_load_fixture('invalid_table_structure.html'))
        self.assertTrue(any(
            issue.rule_id == 'html5lib:unexpected-cell-in-table-body' for issue in result.issues
        ))

    def test_missing_alt_detected(self):
        result = run(html=_load_fixture('missing_alt.html'))
        self.assertTrue(any(issue.rule_id == 'missing-alt' for issue in result.issues))

    def test_missing_form_label_detected(self):
        result = run(html=_load_fixture('missing_form_label.html'))
        self.assertTrue(any(issue.rule_id == 'missing-form-label' for issue in result.issues))

    def test_missing_lang_detected(self):
        result = run(html=_load_fixture('missing_lang.html'))
        self.assertTrue(any(issue.rule_id == 'missing-lang' for issue in result.issues))

    def test_missing_charset_detected(self):
        result = run(html=_load_fixture('missing_charset.html'))
        self.assertTrue(any(issue.rule_id == 'missing-charset' for issue in result.issues))

    def test_missing_viewport_detected(self):
        result = run(html=_load_fixture('missing_viewport.html'))
        self.assertTrue(any(issue.rule_id == 'missing-viewport' for issue in result.issues))

    def test_missing_metadata_detected(self):
        result = run(html=_load_fixture('missing_metadata.html'))
        rule_ids = {issue.rule_id for issue in result.issues}
        self.assertIn('missing-title', rule_ids)
        self.assertIn('missing-meta-description', rule_ids)

    def test_broken_fragment_link_detected(self):
        result = run(html=_load_fixture('broken_fragment.html'))
        self.assertTrue(any(issue.rule_id == 'broken-fragment-link' for issue in result.issues))

    def test_valid_modern_document_produces_no_issues(self):
        result = run(html=_load_fixture('valid_modern_document.html'))
        self.assertEqual(result.issues, [])
        self.assertTrue(all(status.success for status in result.engine_status))

    def test_unicode_source_produces_no_encoding_related_issues(self):
        result = run(html=_load_fixture('unicode_source.html'))
        self.assertEqual(result.issues, [])


class ResourceLimitTests(TestCase):
    def test_large_input_is_truncated(self):
        with patch.object(engine_module, 'MAX_LINE_COUNT', 5):
            html = '\n'.join(f'<!-- line {n} -->' for n in range(20))
            result = run(html=html)
        self.assertTrue(result.truncated)
        self.assertTrue(any('truncated' in status.message.lower() for status in result.engine_status))

    def test_issue_count_is_truncated_with_notice(self):
        with patch.object(engine_module, 'MAX_ISSUES', 2):
            duplicates = ''.join('<div id="x"></div>' for _ in range(10))
            html = (
                '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title>'
                '<meta name="viewport" content="width=device-width, initial-scale=1">'
                '<meta name="description" content="d"></head>'
                f'<body><h1>H</h1>{duplicates}</body></html>'
            )
            result = run(html=html)
        self.assertEqual(len(result.issues), 2)
        self.assertGreater(result.truncated_issue_count, 0)
        self.assertTrue(result.truncated)


class AdapterFailureIsolationTests(TestCase):
    def test_one_adapter_failing_does_not_discard_other_adapters_results(self):
        with patch(
            'landingpages.validation.adapters.html_conformance.HtmlConformanceAdapter.validate',
            side_effect=RuntimeError('boom — should never reach the client'),
        ):
            result = run(html=_load_fixture('missing_alt.html'))

        accessibility_issues = [issue for issue in result.issues if issue.source_engine == 'html-accessibility']
        self.assertTrue(accessibility_issues)

        html5lib_status = next(status for status in result.engine_status if status.engine_name == 'html5lib')
        self.assertFalse(html5lib_status.success)
        self.assertNotIn('RuntimeError', html5lib_status.message)
        self.assertNotIn('boom', html5lib_status.message)

        other_statuses = [status for status in result.engine_status if status.engine_name != 'html5lib']
        self.assertTrue(any(status.success for status in other_statuses))


class OrderingAndFingerprintTests(TestCase):
    def test_stable_ordering(self):
        result = run(html=_load_fixture('multiple_unclosed_nested.html'))
        keys = [
            (issue.language, issue.start_line, issue.start_column or 0, severity_rank(issue.severity), issue.rule_id)
            for issue in result.issues
        ]
        self.assertEqual(keys, sorted(keys))

    def test_fingerprint_is_stable_across_runs(self):
        html = _load_fixture('duplicate_ids.html')
        first = run(html=html)
        second = run(html=html)
        self.assertEqual(
            [issue.fingerprint for issue in first.issues],
            [issue.fingerprint for issue in second.issues],
        )

    def test_fingerprint_differs_for_different_rules_on_the_same_line(self):
        result = run(html=_load_fixture('multiple_issues_one_line.html'))
        fingerprints = [issue.fingerprint for issue in result.issues]
        self.assertEqual(len(fingerprints), len(set(fingerprints)))


class ValidateApiProfileTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('alice')
        self.client.force_authenticate(self.user)

    def test_validate_without_profile_defaults_to_standard(self):
        response = self.client.post('/api/v1/lp/validate/', {'html': '<p>hi</p>'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['profile'], 'standard')

    def test_validate_with_each_supported_profile(self):
        for profile in ('standard', 'strict', 'legacy', 'experimental'):
            with self.subTest(profile=profile):
                response = self.client.post(
                    '/api/v1/lp/validate/', {'html': '<p>hi</p>', 'profile': profile}, format='json',
                )
                self.assertEqual(response.status_code, 201, response.content)
                self.assertEqual(response.json()['profile'], profile)

    def test_engine_status_present_in_response(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': _load_fixture('valid_modern_document.html')}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        statuses = response.json()['engine_status']
        self.assertGreaterEqual(len(statuses), 5)
        self.assertTrue(all(status_entry['success'] for status_entry in statuses))

    def test_strict_profile_upgrades_missing_h1_to_error(self):
        html_without_h1 = _load_fixture('valid_modern_document.html').replace('<h1>Welcome</h1>', '')
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': html_without_h1, 'profile': 'strict'}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        missing_h1_issues = [
            issue for issue in response.json()['issues'] if issue['rule_id'] == 'missing-h1'
        ]
        self.assertTrue(missing_h1_issues)
        self.assertEqual(missing_h1_issues[0]['severity'], 'error')

    def test_issue_serialization_includes_unified_schema_fields(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': _load_fixture('missing_alt.html')}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        issue = next(i for i in response.json()['issues'] if i['rule_id'] == 'missing-alt')
        for field in (
            'id', 'fingerprint', 'language', 'source_engine', 'engine_version', 'profile',
            'rule_id', 'standards_reference', 'category', 'severity', 'confidence', 'message',
            'suggestion', 'start_line', 'start_column', 'end_line', 'end_column', 'code_excerpt',
            'fixable', 'fix_type', 'deterministic_fix', 'requires_manual_review',
            'related_element', 'related_attribute',
            # Sprint 1A/1B compatibility fields — unchanged.
            'file', 'line', 'column', 'auto_fixable', 'risk',
        ):
            self.assertIn(field, issue, f'missing field: {field}')
        self.assertEqual(issue['language'], issue['file'])
        self.assertEqual(issue['start_line'], issue['line'])
        self.assertEqual(issue['fixable'], issue['auto_fixable'])
