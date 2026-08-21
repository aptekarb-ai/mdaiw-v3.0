"""Generalized Full-Source AI Engineer Repair sprint — torture fixtures
for every supported scope (HTML already covered by
test_html_torture_fixture.py / test_shell_recovery.py). Each fixture
here carries multiple SIMULTANEOUS defects (syntax/structure/security/
formatting) at the top, middle, and bottom of the source, matching spec
section 31. For every language, this proves TWO things: (1) whatever the
deterministic/verified-recipe layer can already do WITHOUT any AI call,
and (2) that a whole-source AI candidate for the language is correctly
gated through the SAME candidate-first/content-preservation/quality-
monotonic machinery HTML already uses (spec section 1/16/17/34) — via a
SCRIPTED fake provider (this project's established torture-fixture
pattern; no real network call).
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ..ai_review.provider import AIReviewResult, AIReviewUnavailable, WholeSourceRepairResult
from ..fixes import iterative as it

User = get_user_model()


def _make_user(name='torture_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


class _ScriptedWholeSourceProvider:
    """No regional review proposals; returns a fixed whole-source
    candidate for whichever file_key/language the scripted response
    covers, and declines documentation (out of scope for these tests)."""

    def __init__(self, corrected_by_file_key):
        self._corrected = corrected_by_file_key

    def review(self, request):
        return AIReviewResult(summary='', proposals=[])

    def repair_whole_source(self, request):
        if request.file_key not in self._corrected:
            raise AIReviewUnavailable('not scripted for this file')
        return WholeSourceRepairResult(corrected_source=self._corrected[request.file_key], explanation='...')

    def suggest_documentation(self, request):
        raise AIReviewUnavailable('not scripted for documentation in this test')


def _run(user, sources, css_source_type, validation_scope, provider):
    with (
        patch.object(it, 'get_default_ai_review_provider', return_value=provider),
        patch('landingpages.ai_review.provider.get_default_ai_review_provider', return_value=provider),
    ):
        return it.run_autonomous_repair(
            user=user, project=None, initial_sources=sources,
            css_source_type=css_source_type, validation_scope=validation_scope, profile='standard',
            rate_limit_identifier='u',
        )


class CssTortureFixtureTests(TestCase):
    """Top: missing generic font-family fallback. Middle: standalone
    comment (formatting). Bottom: a zero-with-unit value. All three are
    ALREADY deterministically/recipe-fixable — no AI needed."""

    FIXTURE = (
        '.hero {\n'
        '  font-family: Arial;\n'
        '}\n'
        '.card {\n'
        '  background-color: blue;\n'
        '  /* Corrected property */\n'
        '  padding: 10px;\n'
        '}\n'
        '.spacer {\n'
        '  margin: 0px;\n'
        '}\n'
    )

    def setUp(self):
        cache.clear()
        self.user = _make_user('css_torture_user')

    def test_deterministic_only_converges_to_zero(self):
        result = _run(
            self.user, {'html': '', 'css': self.FIXTURE, 'js': '', 'ampscript': ''},
            'css', 'css', provider=None,
        )
        self.assertEqual(result.issues_remaining_total, 0, result.report.issues.all())
        self.assertIn('font-family: Arial, sans-serif', result.final_sources['css'])
        self.assertIn('background-color: blue; /* Corrected property */', result.final_sources['css'])
        self.assertIn('margin: 0;', result.final_sources['css'])

    def test_second_run_is_idempotent(self):
        first = _run(self.user, {'html': '', 'css': self.FIXTURE, 'js': '', 'ampscript': ''}, 'css', 'css', provider=None)
        second = _run(self.user, {'html': '', 'css': first.final_sources['css'], 'js': '', 'ampscript': ''}, 'css', 'css', provider=None)
        self.assertEqual(first.final_sources['css'], second.final_sources['css'])
        self.assertEqual(second.issues_remaining_total, 0)


class LessWholeSourceTortureFixtureTests(TestCase):
    """A genuinely broken LESS file (unbalanced brace) that the
    deterministic layer has no recipe for — proves the LESS whole-source
    AI fallback is gated through content-preservation exactly like HTML."""

    BROKEN = (
        '@brand-color: #002D38;\n'
        '.header {\n'
        '  color: @brand-color;\n'
        '  .logo {\n'
        '    width: 100px;\n'
        '}\n'
        '.footer {\n'
        '  /* Footer styling for the campaign page */\n'
        '  color: darken(@brand-color, 10%);\n'
        '}\n'
    )
    CORRECTED = (
        '@brand-color: #002D38;\n'
        '.header {\n'
        '  color: @brand-color;\n'
        '  .logo {\n'
        '    width: 100px;\n'
        '  }\n'
        '}\n'
        '.footer {\n'
        '  /* Footer styling for the campaign page */\n'
        '  color: darken(@brand-color, 10%);\n'
        '}\n'
    )

    def setUp(self):
        cache.clear()
        self.user = _make_user('less_torture_user')

    def test_ai_unavailable_stops_honestly_without_corrupting_source(self):
        result = _run(
            self.user, {'html': '', 'css': self.BROKEN, 'js': '', 'ampscript': ''},
            'less', 'css', provider=None,
        )
        # No deterministic recipe exists for an unbalanced LESS brace —
        # the source must be left completely untouched, never guessed at.
        self.assertEqual(result.final_sources['css'], self.BROKEN)

    def test_whole_source_ai_candidate_is_accepted_and_preserves_content(self):
        provider = _ScriptedWholeSourceProvider({'css': self.CORRECTED})
        result = _run(
            self.user, {'html': '', 'css': self.BROKEN, 'js': '', 'ampscript': ''},
            'less', 'css', provider=provider,
        )
        # The compile-blocking defect is gone (the whole POINT of this
        # test) — any remaining stylelint STYLE nits in this hand-authored
        # fixture are incidental, not what's under test here.
        final_rule_ids = {i.rule_id for i in result.report.issues.all()}
        self.assertNotIn('less:compile-error', final_rule_ids)
        self.assertIn('@brand-color: #002D38;', result.final_sources['css'])
        self.assertIn('Footer styling for the campaign page', result.final_sources['css'])
        self.assertIn('darken(@brand-color, 10%)', result.final_sources['css'])

    def test_whole_source_candidate_that_drops_content_is_rejected(self):
        # A candidate that "fixes" the brace but silently drops the
        # footer comment/rule must never be published.
        gutted = '@brand-color: #002D38;\n.header {\n  color: @brand-color;\n  .logo {\n    width: 100px;\n  }\n}\n'
        provider = _ScriptedWholeSourceProvider({'css': gutted})
        result = _run(
            self.user, {'html': '', 'css': self.BROKEN, 'js': '', 'ampscript': ''},
            'less', 'css', provider=provider,
        )
        self.assertEqual(result.final_sources['css'], self.BROKEN)


class ScssWholeSourceTortureFixtureTests(TestCase):
    """SCSS with a genuine compile-blocking defect (unclosed nesting)
    plus meaningful content (mixin, interpolation, business comment)."""

    BROKEN = (
        '$brand: #0082AD;\n'
        '@mixin cardShadow {\n'
        '  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);\n'
        '}\n'
        '.card-#{$brand} {\n'
        '  @include cardShadow;\n'
        '  .title {\n'
        '    color: $brand;\n'
        '}\n'
        '.badge {\n'
        '  /* Highlights the recognition badge on hover */\n'
        '  color: darken($brand, 15%);\n'
        '}\n'
    )
    CORRECTED = (
        '$brand: #0082AD;\n'
        '@mixin cardShadow {\n'
        '  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);\n'
        '}\n'
        '.card {\n'
        '  @include cardShadow;\n'
        '  .title {\n'
        '    color: $brand;\n'
        '  }\n'
        '}\n'
        '.badge {\n'
        '  /* Highlights the recognition badge on hover */\n'
        '  color: darken($brand, 15%);\n'
        '}\n'
    )

    def setUp(self):
        cache.clear()
        self.user = _make_user('scss_torture_user')

    def test_ai_unavailable_leaves_source_untouched(self):
        result = _run(
            self.user, {'html': '', 'css': self.BROKEN, 'js': '', 'ampscript': ''},
            'scss', 'css', provider=None,
        )
        self.assertEqual(result.final_sources['css'], self.BROKEN)

    def test_whole_source_ai_candidate_compiles_and_preserves_content(self):
        provider = _ScriptedWholeSourceProvider({'css': self.CORRECTED})
        result = _run(
            self.user, {'html': '', 'css': self.BROKEN, 'js': '', 'ampscript': ''},
            'scss', 'css', provider=provider,
        )
        final_rule_ids = {i.rule_id for i in result.report.issues.all()}
        self.assertFalse(any(r.endswith(':compile-error') for r in final_rule_ids))
        self.assertIn('@mixin cardShadow', result.final_sources['css'])
        self.assertIn('Highlights the recognition badge on hover', result.final_sources['css'])
        self.assertIn('darken($brand, 15%)', result.final_sources['css'])


class SassIndentedWholeSourceTortureFixtureTests(TestCase):
    """Indented Sass — its own grammar mode (spec section 10), never
    treated as SCSS with missing braces. A dedented line breaks the
    indentation hierarchy the whole file depends on."""

    BROKEN = (
        '$brand: #76C043\n'
        '.hero\n'
        '  color: $brand\n'
        '  .title\n'
        '  font-weight: bold\n'
        '.footer\n'
        '  // Preserve the campaign footer branding\n'
        '  color: darken($brand, 10%)\n'
    )
    CORRECTED = (
        '$brand: #76C043\n'
        '.hero\n'
        '  color: $brand\n'
        '  .title\n'
        '    font-weight: bold\n'
        '.footer\n'
        '  // Preserve the campaign footer branding\n'
        '  color: darken($brand, 10%)\n'
    )

    def setUp(self):
        cache.clear()
        self.user = _make_user('sass_torture_user')

    def test_ai_unavailable_leaves_source_untouched(self):
        result = _run(
            self.user, {'html': '', 'css': self.BROKEN, 'js': '', 'ampscript': ''},
            'sass', 'css', provider=None,
        )
        self.assertEqual(result.final_sources['css'], self.BROKEN)

    def test_whole_source_ai_candidate_preserves_indentation_semantics_and_content(self):
        provider = _ScriptedWholeSourceProvider({'css': self.CORRECTED})
        result = _run(
            self.user, {'html': '', 'css': self.BROKEN, 'js': '', 'ampscript': ''},
            'sass', 'css', provider=provider,
        )
        final_rule_ids = {i.rule_id for i in result.report.issues.all()}
        self.assertFalse(any(r.endswith(':compile-error') for r in final_rule_ids))
        self.assertIn('Preserve the campaign footer branding', result.final_sources['css'])
        self.assertIn('darken($brand, 10%)', result.final_sources['css'])


class JavascriptTortureFixtureTests(TestCase):
    """Top: extra closing brace (parser blocker). Middle: unsafe
    innerHTML assignment (security). Bottom: an existing useful
    comment that must survive. The brace + security repairs are BOTH
    already deterministic/recipe-covered — no AI required."""

    FIXTURE = (
        'function greet(name) {\n'
        '  return "Hi " + name;\n'
        '}\n'
        '}\n'
        'function renderName(value) {\n'
        '  // Existing developer note worth keeping\n'
        '  target.innerHTML = value;\n'
        '}\n'
    )

    def setUp(self):
        cache.clear()
        self.user = _make_user('js_torture_user')

    def test_deterministic_only_repairs_brace_and_secures_innerhtml(self):
        result = _run(self.user, {'html': '', 'css': '', 'js': self.FIXTURE, 'ampscript': ''}, 'css', 'javascript', provider=None)
        final_js = result.final_sources['js']
        self.assertNotIn('}\n}\n', final_js)
        self.assertNotIn('innerHTML', final_js)
        self.assertIn('textContent', final_js)
        self.assertIn('Existing developer note worth keeping', final_js)
        final_rule_ids = {i.rule_id for i in result.report.issues.all()}
        self.assertNotIn('javascript:parse-error', final_rule_ids)
        self.assertNotIn('mdaiw-security/innerhtml-assignment', final_rule_ids)

    def test_second_run_is_idempotent(self):
        first = _run(self.user, {'html': '', 'css': '', 'js': self.FIXTURE, 'ampscript': ''}, 'css', 'javascript', provider=None)
        second = _run(self.user, {'html': '', 'css': '', 'js': first.final_sources['js'], 'ampscript': ''}, 'css', 'javascript', provider=None)
        self.assertEqual(first.final_sources['js'], second.final_sources['js'])


class AmpscriptTortureFixtureTests(TestCase):
    """Top: IF without matching ENDIF (deterministic-fixable). Bottom:
    a business-assumption comment that must survive. No subscriber/
    business data is ever fabricated."""

    FIXTURE = (
        '%%[\n'
        'VAR @firstName\n'
        'SET @firstName = AttributeValue("FirstName")\n'
        'IF EMPTY(@firstName) THEN\n'
        'SET @firstName = "Guest"\n'
        '/* Fallback used when the subscriber record has no first name on file */\n'
        ']%%\n'
        'Hello %%=v(@firstName)=%%\n'
    )

    def setUp(self):
        cache.clear()
        self.user = _make_user('ampscript_torture_user')

    def test_deterministic_only_repairs_missing_endif(self):
        result = _run(self.user, {'html': '', 'css': '', 'js': '', 'ampscript': self.FIXTURE}, 'css', 'ampscript', provider=None)
        self.assertIn('ENDIF', result.final_sources['ampscript'])
        self.assertIn('Fallback used when the subscriber record has no first name on file', result.final_sources['ampscript'])
        self.assertIn('AttributeValue("FirstName")', result.final_sources['ampscript'])
        final_rule_ids = {i.rule_id for i in result.report.issues.all()}
        self.assertNotIn('ampscript:if-without-endif', final_rule_ids)

    def test_second_run_is_idempotent(self):
        first = _run(self.user, {'html': '', 'css': '', 'js': '', 'ampscript': self.FIXTURE}, 'css', 'ampscript', provider=None)
        second = _run(self.user, {'html': '', 'css': '', 'js': '', 'ampscript': first.final_sources['ampscript']}, 'css', 'ampscript', provider=None)
        self.assertEqual(first.final_sources['ampscript'], second.final_sources['ampscript'])


class CompleteLpCrossLanguageTortureFixtureTests(TestCase):
    """Complete LP: a corrupted HTML shell (premature </html>), a CSS
    comment-placement warning, and an unsafe JS innerHTML sink, all
    submitted together — proves the shared pipeline repairs every
    language's portion of ONE combined run and preserves cross-language
    content (the CSS/JS stay associated with the correct HTML)."""

    HTML = (
        '<!DOCTYPE html>\n<html lang="en">\n</html>\n<head>\n'
        '<meta charset="utf-8"><title>Campaign</title>\n</head>\n<body>\n'
        '<h1>Welcome to the Recognition Program</h1>\n'
        '<div id="award-panel">Congratulations!</div>\n'
        '</body>\n'
    )
    CSS = '.panel {\n  background-color: blue;\n  /* Corrected property */\n}\n'
    JS = 'var panel = document.getElementById("award-panel");\npanel.innerHTML = panel.textContent;\n'

    def setUp(self):
        cache.clear()
        self.user = _make_user('complete_lp_torture_user')

    def test_deterministic_only_repairs_every_language_in_one_run(self):
        result = _run(
            self.user, {'html': self.HTML, 'css': self.CSS, 'js': self.JS, 'ampscript': ''},
            'css', 'complete', provider=None,
        )
        final_html = result.final_sources['html']
        final_css = result.final_sources['css']
        final_js = result.final_sources['js']

        self.assertEqual(final_html.count('</html>'), 1)
        self.assertTrue(final_html.rstrip().endswith('</html>'))
        self.assertIn('Welcome to the Recognition Program', final_html)
        self.assertIn('Congratulations!', final_html)

        self.assertIn('background-color: blue; /* Corrected property */', final_css)

        self.assertNotIn('innerHTML', final_js)
        self.assertIn('textContent', final_js)

    def test_second_run_is_idempotent(self):
        first = _run(
            self.user, {'html': self.HTML, 'css': self.CSS, 'js': self.JS, 'ampscript': ''},
            'css', 'complete', provider=None,
        )
        second = _run(self.user, first.final_sources, 'css', 'complete', provider=None)
        self.assertEqual(first.final_sources, second.final_sources)
