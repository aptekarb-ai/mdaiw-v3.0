"""Correctness-pass sprint — JavaScript code that safely handles a missing
DOM element (null guard/fallback) must never be classified as a
repairable technical error. Splits the old single 'mdaiw-lp/missing-
selector-target' rule into two: the unsafe case (unchanged rule_id,
warning) and the safely-guarded case (new 'mdaiw-lp/optional-selector-
target', info severity, advisory-only in the Rule Knowledge Registry —
never offered to AI Fix Issues, never counted toward issues_requires_
input_total).
"""

from django.contrib.auth import get_user_model
from django.test import TestCase

from ..fixes.iterative import _is_advisory_only
from ..validation.engine import run

User = get_user_model()

_HTML_WITH_KNOWN = (
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    '<meta name="description" content="Test page"><title>T</title></head>'
    '<body><h1>Test</h1><div id="known">known</div></body></html>'
)


def _js_issues(html, js):
    result = run(html=html, js=js, validation_scope='complete')
    return [i for i in result.issues if i.language == 'javascript' and i.rule_id.startswith('mdaiw-lp/')]


class UnsafeMissingSelectorTests(TestCase):
    """Case A — no null guard at all: still a real, actionable warning."""

    def test_direct_chained_access_is_unsafe(self):
        issues = _js_issues(_HTML_WITH_KNOWN, 'const v = document.getElementById("username").value;\n')
        self.assertTrue(any(i.rule_id == 'mdaiw-lp/missing-selector-target' and i.severity == 'warning' for i in issues), issues)
        self.assertFalse(any(i.rule_id == 'mdaiw-lp/optional-selector-target' for i in issues), issues)

    def test_assigned_but_used_without_any_guard_is_unsafe(self):
        js = 'const el = document.getElementById("username");\nel.value = "x";\n'
        issues = _js_issues(_HTML_WITH_KNOWN, js)
        self.assertTrue(any(i.rule_id == 'mdaiw-lp/missing-selector-target' and i.severity == 'warning' for i in issues), issues)


class NullSafeOptionalSelectorTests(TestCase):
    """Case B — the code already handles absence safely; must be
    advisory (info), never a repairable warning/error."""

    def _assert_advisory_only(self, js):
        issues = _js_issues(_HTML_WITH_KNOWN, js)
        optional = [i for i in issues if i.rule_id == 'mdaiw-lp/optional-selector-target']
        self.assertTrue(optional, issues)
        self.assertEqual(optional[0].severity, 'info')
        self.assertFalse(any(i.rule_id == 'mdaiw-lp/missing-selector-target' for i in issues), issues)
        self.assertTrue(_is_advisory_only(optional[0]))

    def test_optional_chaining(self):
        self._assert_advisory_only('const el = document.getElementById("username");\nconst v = el?.value;\n')

    def test_ternary_null_fallback(self):
        self._assert_advisory_only(
            'const el = document.getElementById("username");\nconst v = el ? el.value : "Guest";\n',
        )

    def test_if_guard(self):
        self._assert_advisory_only(
            'const el = document.getElementById("username");\nif (el) { el.value = "x"; }\n',
        )

    def test_and_guard(self):
        self._assert_advisory_only('const el = document.getElementById("username");\nel && (el.value = "x");\n')

    def test_the_reported_live_fixture_is_advisory(self):
        # The exact code from the live regression report.
        js = (
            'const userNameElement = document.getElementById("username");\n'
            'const userName = userNameElement ? userNameElement.value : "Guest";\n'
            'console.log(userName);\n'
        )
        self._assert_advisory_only(js)


class DeterministicIdMatchStillWorksTests(TestCase):
    """Section 3 — no fuzzy/deterministic auto-rename is implemented (an
    explicitly optional feature per spec: "may be automatically repaired
    only when... Otherwise -> Requires Input"). An unguarded reference to
    a near-match id must still surface as a normal, AI/human-reviewable
    finding — never silently ignored, never auto-corrected, never used
    to fabricate HTML."""

    def test_near_match_unguarded_is_still_a_normal_actionable_warning(self):
        html = '<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><input id="user-name"></body></html>'
        js = 'const v = document.getElementById("username").value;\n'
        issues = _js_issues(html, js)
        self.assertTrue(any(i.rule_id == 'mdaiw-lp/missing-selector-target' for i in issues), issues)

    def test_near_match_guarded_is_advisory_not_auto_corrected(self):
        html = '<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><input id="user-name"></body></html>'
        js = 'const el = document.getElementById("username");\nif (el) { el.value = "x"; }\n'
        issues = _js_issues(html, js)
        optional = [i for i in issues if i.rule_id == 'mdaiw-lp/optional-selector-target']
        self.assertTrue(optional, issues)
        # The finding names the id actually referenced — never silently
        # substitutes the near-match id it did NOT ask about.
        self.assertIn('"username"', optional[0].message)


class NoRepairableFindingBlocksSuccessTests(TestCase):
    """The advisory finding must never be offered to AI Fix Issues and
    must never prevent 'nothing technically repairable remains' from
    being true (see LandingPageValidatorPage.tsx's own nothingTechnical
    Remains condition — issues_remaining == issues_requires_input +
    issues_advisory)."""

    def test_ai_fix_issues_never_attempts_the_advisory_finding(self):
        from unittest.mock import patch

        from django.core.cache import cache

        from ..fixes import iterative as it

        cache.clear()
        user = User.objects.create_user(username='optsel_user', password='pw12345!', email='optsel@example.com')
        js = (
            'const userNameElement = document.getElementById("username");\n'
            'const userName = userNameElement ? userNameElement.value : "Guest";\n'
            'console.log(userName);\n'
        )

        class _RaisesIfCalledProvider:
            def review(self, request):
                raise AssertionError('AI Engineer must not be consulted for an advisory-only finding')

            def repair_whole_source(self, request):
                raise AssertionError('AI Engineer must not be consulted for an advisory-only finding')

        with patch.object(it, 'get_default_ai_review_provider', return_value=_RaisesIfCalledProvider()):
            result = it.run_autonomous_repair(
                user=user, project=None,
                initial_sources={'html': _HTML_WITH_KNOWN, 'css': '', 'js': js, 'ampscript': ''},
                css_source_type='css', validation_scope='complete', profile='standard',
                rate_limit_identifier='optsel',
            )
        final_issues = list(result.report.issues.all())
        optional = [i for i in final_issues if i.rule_id == 'mdaiw-lp/optional-selector-target']
        self.assertTrue(optional, final_issues)
        self.assertEqual(
            result.issues_remaining_total,
            result.issues_requires_input_total + result.issues_advisory_total,
        )
        self.assertGreaterEqual(result.issues_advisory_total, 1)
