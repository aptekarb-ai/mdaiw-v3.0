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
        self.assertTrue(all(
            status.success for status in result.engine_status
            if status.engine_name != 'nu-html-checker'  # environment-dependent Java 11+ runtime, not a correctness signal
        ))

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
        self.assertTrue(all(
            status.success for status in result.engine_status
            if status.engine_name != 'nu-html-checker'  # environment-dependent Java 11+ runtime, not a correctness signal
        ))

    def test_unicode_source_produces_no_encoding_related_issues(self):
        result = run(html=_load_fixture('unicode_source.html'))
        self.assertEqual(result.issues, [])


class ParserIndependentLexicalTests(TestCase):
    """Correctness-sprint regression coverage for the confirmed live gap:
    both html5lib and the stdlib-parser-backed HtmlStructureAdapter can be
    made blind to a tag by an EARLIER malformed tag's own error recovery
    (see html_lexical.py's module docstring for the full root-cause
    explanation). HtmlLexicalAdapter (Pass A) and HtmlTagStackAdapter
    (Pass C) exist specifically to close this gap without depending on
    either parser's repaired DOM."""

    def test_malformed_link_start_tag_reported_at_its_own_position(self):
        result = run(html=_load_fixture('malformed_link_missing_gt.html'))
        lexical = [issue for issue in result.issues if issue.source_engine == 'html-lexical']
        self.assertTrue(any(
            issue.rule_id == 'malformed-start-tag' and issue.related_element == 'link' and issue.start_line == 8
            for issue in lexical
        ), f'expected a link malformed-start-tag finding at line 8, got: {[(i.related_element, i.start_line) for i in lexical]}')

    def test_malformed_img_start_tag_reported_at_its_own_position(self):
        # <img> is a VOID element — HtmlStructureAdapter's stack never
        # tracks it at all (correctly, per HTML5), so nothing else in the
        # pipeline can ever catch its own malformed opening syntax.
        result = run(html=_load_fixture('malformed_img_missing_gt.html'))
        lexical = [issue for issue in result.issues if issue.source_engine == 'html-lexical']
        self.assertTrue(any(
            issue.rule_id == 'malformed-start-tag' and issue.related_element == 'img' and issue.start_line == 12
            for issue in lexical
        ), f'expected an img malformed-start-tag finding at line 12, got: {[(i.related_element, i.start_line) for i in lexical]}')
        # The genuinely different defect — <p> is only ever a "no closing
        # tag" candidate, never a "missing >" one here — must not be
        # misreported as also missing its own ">".
        self.assertFalse(any(
            issue.rule_id == 'malformed-start-tag' and issue.related_element == 'p' for issue in lexical
        ))

    def test_malformed_html_root_tag_reported_and_head_still_recognized(self):
        # The root cause (html's own missing ">") is now directly visible
        # via html-lexical, in addition to whatever derivative "missing
        # head" html-structure still reports from its own swallowed-DOM
        # perspective — see html_lexical.py's module docstring on why
        # that derivative finding is left in place rather than suppressed.
        result = run(html=_load_fixture('malformed_html_root_tag.html'))
        lexical = [issue for issue in result.issues if issue.source_engine == 'html-lexical']
        self.assertTrue(any(
            issue.rule_id == 'malformed-start-tag' and issue.related_element == 'html' and issue.start_line == 2
            for issue in lexical
        ))

    def test_anchor_hidden_by_a_preceding_malformed_tag_is_still_caught(self):
        # This is the case NEITHER html5lib NOR HtmlStructureAdapter can
        # catch on their own: the preceding malformed <img> tag swallows
        # the literal `<a href="contact.html">` text into its own bogus
        # attribute soup for BOTH real parsers, so neither ever calls a
        # start-tag callback for <a> at all. Only HtmlTagStackAdapter's
        # independent, raw-text tokenizer sees it.
        result = run(html=_load_fixture('cascading_malformed_tag_hides_anchor.html'))
        tag_stack = [issue for issue in result.issues if issue.source_engine == 'html-tag-stack']
        self.assertTrue(any(
            issue.rule_id == 'unclosed-tag-independent' and issue.related_element == 'a' and issue.start_line == 13
            for issue in tag_stack
        ), f'expected an independent unclosed <a> finding at line 13, got: {[(i.related_element, i.start_line) for i in tag_stack]}')
        # html-structure never saw <a> as a start tag at all — confirming
        # this really is the gap html-tag-stack exists to close, not a
        # duplicate of something already reported.
        structure_anchor_findings = [
            issue for issue in result.issues
            if issue.source_engine == 'html-structure' and issue.related_element == 'a'
        ]
        self.assertEqual(structure_anchor_findings, [])

    def test_agreeing_findings_are_not_duplicated_across_engines(self):
        # Where HtmlTagStackAdapter's independent stack reaches the SAME
        # conclusion as HtmlStructureAdapter (the common case — most
        # documents have no cascading-corruption interaction at all), the
        # cross-engine merge in engine.py must keep exactly one finding
        # per position, not report the same defect twice.
        result = run(html=_load_fixture('malformed_h1.html'))
        h1_unclosed = [
            issue for issue in result.issues
            if issue.rule_id in ('unclosed-tag', 'unclosed-tag-independent') and issue.related_element == 'h1'
        ]
        self.assertEqual(len(h1_unclosed), 1)
        # The merge keeps HtmlStructureAdapter's original, more detailed
        # finding (registered first) rather than the backstop's.
        self.assertEqual(h1_unclosed[0].source_engine, 'html-structure')

    def test_script_content_with_comparison_operators_is_not_tokenized_as_markup(self):
        # <script> bodies routinely contain '<'/'>' as code operators, not
        # markup — HtmlTagStackAdapter must skip them verbatim rather than
        # flooding the report with false positives.
        result = run(html=_load_fixture('script_with_comparison_operators.html'))
        tag_stack = [issue for issue in result.issues if issue.source_engine == 'html-tag-stack']
        self.assertEqual(tag_stack, [])
        lexical = [issue for issue in result.issues if issue.source_engine == 'html-lexical']
        self.assertEqual(lexical, [])


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
        self.assertTrue(all(
            status_entry['success'] for status_entry in statuses
            if status_entry['engine_name'] != 'nu-html-checker'  # environment-dependent Java 11+ runtime, not a correctness signal
        ))

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
