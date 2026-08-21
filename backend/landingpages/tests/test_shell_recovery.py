"""HTML Whole-Document Structural Recovery sprint — unit and integration
tests for the shell-corruption detector, deterministic premature-</html>
recovery, embedded-region protection for the AI whole-source fallback,
content-preservation fingerprinting, and the repair loop's cascade
detection. Reproduces the exact reported failure class: a corrupted
document shell producing a cascade of secondary parser findings that
regional patching alone cannot converge on.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ..ai_review.provider import AIReviewUnavailable, WholeSourceRepairResult
from ..fixes import iterative as it
from ..fixes import shell_recovery

User = get_user_model()


def _make_user(name='shell_recovery_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


_CORRUPTED_HTML = (
    '<!DOCTYPE html>\n<html lang="en">\n</html>\n<head>\n'
    '<meta charset="utf-8">\n<title>Landing</title>\n'
    '<style>\n.hero { color: red; }\n</style>\n</head>\n<body>\n'
    '<h1>Welcome to Our Landing Page</h1>\n<div class="container">\n'
    '<p>Contact us at <a href="mailto:test@example.com">test@example.com</a></p>\n'
    '<img src="hero.png" id="heroimg">\n<footer>Footer text</footer>\n</div>\n</body>\n'
)


class ClassifyShellCorruptionTests(TestCase):
    def test_detects_premature_html_close(self):
        self.assertEqual(
            shell_recovery.classify_shell_corruption(_CORRUPTED_HTML),
            frozenset({shell_recovery.CORRUPTION_PREMATURE_HTML_CLOSE}),
        )

    def test_clean_document_has_no_corruption(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body><p>hi</p></body></html>'
        self.assertEqual(shell_recovery.classify_shell_corruption(html), frozenset())

    def test_detects_duplicate_html(self):
        html = '<html><html></html></html>'
        self.assertIn(shell_recovery.CORRUPTION_DUPLICATE_HTML, shell_recovery.classify_shell_corruption(html))

    def test_detects_duplicate_head(self):
        html = '<html><head></head><head></head><body></body></html>'
        self.assertIn(shell_recovery.CORRUPTION_DUPLICATE_HEAD, shell_recovery.classify_shell_corruption(html))

    def test_detects_duplicate_body(self):
        html = '<html><head></head><body></body><body></body></html>'
        self.assertIn(shell_recovery.CORRUPTION_DUPLICATE_BODY, shell_recovery.classify_shell_corruption(html))

    def test_detects_head_after_body(self):
        html = '<html><body></body><head></head></html>'
        self.assertIn(shell_recovery.CORRUPTION_HEAD_AFTER_BODY, shell_recovery.classify_shell_corruption(html))

    def test_detects_content_before_html(self):
        # Correctness regression sprint, spec section A — the LIVE
        # reported fixture: a stray <meta> before the literal <html> tag.
        # Only one literal <html> and one literal <head> exist in the raw
        # source (the other 6 checks above see nothing wrong) — this is
        # the class those checks structurally cannot catch.
        html = (
            '<!DOCTYPE html>\n<meta name="description" content="A landing page">\n'
            '<html lang="en">\n<head><meta charset="UTF-8"><title>T</title></head>\n'
            '<body><h1>Hi</h1></body>\n</html>\n'
        )
        self.assertEqual(
            shell_recovery.classify_shell_corruption(html),
            frozenset({shell_recovery.CORRUPTION_CONTENT_BEFORE_HTML}),
        )

    def test_does_not_flag_a_bare_doctype_or_comment_before_html(self):
        html = '<!DOCTYPE html>\n<!-- a harmless comment -->\n<html><head><title>T</title></head><body></body></html>'
        self.assertNotIn(shell_recovery.CORRUPTION_CONTENT_BEFORE_HTML, shell_recovery.classify_shell_corruption(html))


class PrematureHtmlCloseRecoveryTests(TestCase):
    def test_moves_the_premature_close_to_the_true_end(self):
        recovered = shell_recovery.attempt_premature_html_close_recovery(_CORRUPTED_HTML)
        self.assertIsNotNone(recovered)
        self.assertEqual(shell_recovery.classify_shell_corruption(recovered), frozenset())
        # Nothing else moved — the closing tag now appears exactly once,
        # at the true end, and every other byte of content is untouched.
        self.assertEqual(recovered.count('</html>'), 1)
        self.assertTrue(recovered.rstrip().endswith('</html>'))
        self.assertIn('Welcome to Our Landing Page', recovered)
        self.assertIn('mailto:test@example.com', recovered)
        self.assertIn('hero.png', recovered)
        self.assertIn('.hero { color: red; }', recovered)

    def test_declines_when_duplicate_head_also_present(self):
        html = '<html>\n</html>\n<head></head>\n<head></head>\n<body></body>\n'
        self.assertIsNone(shell_recovery.attempt_premature_html_close_recovery(html))

    def test_declines_for_a_structurally_sound_document(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body><p>hi</p></body></html>'
        self.assertIsNone(shell_recovery.attempt_premature_html_close_recovery(html))

    def test_declines_when_multiple_close_tags_present(self):
        html = '<html>\n</html>\n<head></head>\n<body></body>\n</html>\n'
        self.assertIsNone(shell_recovery.attempt_premature_html_close_recovery(html))


_CONTENT_BEFORE_HTML = (
    '<!DOCTYPE html>\n'
    '<meta name="description" content="A landing page for the promo">\n'
    '<html lang="en">\n'
    '<head>\n'
    '<meta charset="UTF-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<title>Promo Landing</title>\n'
    '<style>\n.hero { color: red; }\n</style>\n'
    '</head>\n'
    '<body>\n'
    '<h1>Welcome</h1>\n'
    '<div id="award-panel">Congratulations!</div>\n'
    '<script>\nconsole.log("hi");\n</script>\n'
    '</body>\n'
    '</html>\n'
)


class ContentBeforeHtmlRecoveryTests(TestCase):
    def test_moves_the_orphaned_meta_into_the_existing_head(self):
        recovered = shell_recovery.attempt_content_before_html_recovery(_CONTENT_BEFORE_HTML)
        self.assertIsNotNone(recovered)
        self.assertEqual(shell_recovery.classify_shell_corruption(recovered), frozenset())
        self.assertEqual(recovered.count('<html'), 1)
        self.assertEqual(recovered.count('<head'), 1)
        # Moved, not dropped — the business content survives.
        self.assertIn('A landing page for the promo', recovered)
        self.assertIn('Congratulations!', recovered)
        self.assertIn('.hero { color: red; }', recovered)
        self.assertIn('console.log("hi")', recovered)
        # The orphaned meta now lands INSIDE <head>, not before <html>.
        head_start = recovered.index('<head')
        meta_pos = recovered.index('A landing page for the promo')
        html_end = recovered.index('</html>')
        self.assertGreater(meta_pos, head_start)
        self.assertLess(meta_pos, html_end)

    def test_declines_when_no_explicit_head_exists(self):
        html = '<!DOCTYPE html>\n<meta name="description" content="d">\n<html lang="en">\n<body><p>hi</p></body></html>'
        self.assertIsNone(shell_recovery.attempt_content_before_html_recovery(html))

    def test_declines_for_a_structurally_sound_document(self):
        html = '<!DOCTYPE html><html><head><title>T</title></head><body><p>hi</p></body></html>'
        self.assertIsNone(shell_recovery.attempt_content_before_html_recovery(html))

    def test_declines_when_duplicate_html_also_present(self):
        html = '<meta name="d" content="d">\n<html></html><html></html>'
        self.assertIsNone(shell_recovery.attempt_content_before_html_recovery(html))


class ContentBeforeHtmlIntegrationTests(TestCase):
    """The exact reported LIVE scenario, end to end, Complete-LP scope,
    with embedded CSS/JS surviving alongside a genuine CSS defect that
    only AI (not deterministic recovery) can safely resolve — proving
    the two layers compose correctly rather than one masking the other."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('content_before_html_user')

    def _run(self, html, css='', provider=None):
        with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])), \
             patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            return it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': html, 'css': css, 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='complete', profile='standard',
                rate_limit_identifier='u',
            )

    def test_structural_recovery_converges_without_any_ai_call_when_css_is_already_clean(self):
        from ..ai_review.provider import AIReviewResult

        class _RecordingNullProvider:
            def __init__(self):
                self.calls = 0

            def review(self, request):
                self.calls += 1
                return AIReviewResult(summary='', proposals=[])

            def repair_whole_source(self, request):
                raise AssertionError('deterministic recovery alone should resolve this fixture')

        provider = _RecordingNullProvider()
        result = self._run(_CONTENT_BEFORE_HTML, css='body { color: #333; }', provider=provider)

        self.assertEqual(shell_recovery.classify_shell_corruption(result.final_sources['html']), frozenset())
        final_rule_ids = {i.rule_id for i in result.report.issues.all()}
        self.assertFalse(any(r.startswith('html5lib:') or 'missing-head' in r or 'missing-html' in r for r in final_rule_ids))
        self.assertIn('Welcome', result.final_sources['html'])
        self.assertIn('Congratulations!', result.final_sources['html'])
        # Content preserved — the post-repair formatter (unrelated to
        # this fix) may reflow whitespace, so check content, not an
        # exact-formatting substring.
        self.assertIn('.hero', result.final_sources['html'])
        self.assertIn('color: red', result.final_sources['html'])
        self.assertIn('console.log("hi")', result.final_sources['html'])

    def test_never_shows_false_success_while_a_real_repairable_defect_remains(self):
        # No AI available — the CSS color typo can't be auto-fixed
        # (there is no safe deterministic recipe for an arbitrary color
        # typo), so the run must NOT claim everything technically
        # repairable was fixed.
        result = self._run(_CONTENT_BEFORE_HTML, css='body { background-color: blu; }', provider=None)
        self.assertEqual(shell_recovery.classify_shell_corruption(result.final_sources['html']), frozenset())
        self.assertGreater(result.issues_remaining_total, result.issues_requires_input_total + result.issues_advisory_total)

    def test_second_run_against_the_repaired_document_is_idempotent(self):
        first = self._run(_CONTENT_BEFORE_HTML, css='body { color: #333; }', provider=None)
        second = self._run(first.final_sources['html'], css=first.final_sources['css'], provider=None)
        self.assertEqual(first.final_sources['html'], second.final_sources['html'])
        self.assertEqual(shell_recovery.classify_shell_corruption(second.final_sources['html']), frozenset())


class EmbeddedRegionProtectionTests(TestCase):
    def test_protects_and_restores_style_and_script_content(self):
        html = (
            '<html><head><style>.a { color: red; }</style></head>'
            '<body><script>function f() { return 1; }</script></body></html>'
        )
        protected, placeholders = shell_recovery.protect_embedded_regions(html)
        self.assertNotIn('color: red', protected)
        self.assertNotIn('function f()', protected)
        self.assertEqual(len(placeholders), 2)
        restored = shell_recovery.restore_embedded_regions(protected, placeholders)
        self.assertEqual(restored, html)

    def test_protects_ampscript_blocks_and_output_expressions(self):
        html = '<html><body>%%[ VAR @x SET @x = 1 ]%% Hello %%=v(@x)=%%</body></html>'
        protected, placeholders = shell_recovery.protect_embedded_regions(html)
        self.assertNotIn('%%[', protected)
        self.assertNotIn('%%=', protected)
        restored = shell_recovery.restore_embedded_regions(protected, placeholders)
        self.assertEqual(restored, html)

    def test_restore_returns_none_when_a_placeholder_is_missing(self):
        html = '<html><head><style>.a{color:red}</style></head><body></body></html>'
        protected, placeholders = shell_recovery.protect_embedded_regions(html)
        tampered = protected.replace(next(iter(placeholders)), '')  # drop the placeholder entirely
        self.assertIsNone(shell_recovery.restore_embedded_regions(tampered, placeholders))

    def test_restore_returns_none_when_a_placeholder_is_duplicated(self):
        html = '<html><head><style>.a{color:red}</style></head><body></body></html>'
        protected, placeholders = shell_recovery.protect_embedded_regions(html)
        token = next(iter(placeholders))
        duplicated = protected + token  # candidate duplicated the placeholder somewhere
        self.assertIsNone(shell_recovery.restore_embedded_regions(duplicated, placeholders))


class ContentPreservationFingerprintTests(TestCase):
    def test_identical_documents_preserve_content(self):
        self.assertTrue(shell_recovery.content_preserved(_CORRUPTED_HTML, _CORRUPTED_HTML))

    def test_reformatted_but_content_intact_document_preserves_content(self):
        reformatted = _CORRUPTED_HTML.replace('\n', '\n  ')
        self.assertTrue(shell_recovery.content_preserved(_CORRUPTED_HTML, reformatted))

    def test_dropped_text_is_detected(self):
        candidate = _CORRUPTED_HTML.replace('<h1>Welcome to Our Landing Page</h1>', '')
        self.assertFalse(shell_recovery.content_preserved(_CORRUPTED_HTML, candidate))

    def test_dropped_href_is_detected(self):
        candidate = _CORRUPTED_HTML.replace('href="mailto:test@example.com"', '')
        self.assertFalse(shell_recovery.content_preserved(_CORRUPTED_HTML, candidate))

    def test_dropped_image_src_is_detected(self):
        candidate = _CORRUPTED_HTML.replace('src="hero.png"', '')
        self.assertFalse(shell_recovery.content_preserved(_CORRUPTED_HTML, candidate))


class DeterministicShellRecoveryIntegrationTests(TestCase):
    """The exact reported scenario, end to end, with the AI provider
    UNAVAILABLE — proving deterministic recovery alone converges without
    needing any AI call."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('shell_recovery_integration_user')

    def _run(self, html):
        with (
            patch.object(it, 'get_default_ai_review_provider', return_value=None),
            patch('landingpages.ai_review.provider.get_default_ai_review_provider', return_value=None),
        ):
            return it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': html, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u',
            )

    def test_converges_in_one_click_without_any_ai_call(self):
        result = self._run(_CORRUPTED_HTML)
        final_rule_ids = {i.rule_id for i in result.report.issues.all()}
        self.assertFalse(any(r.startswith('html5lib:') for r in final_rule_ids))
        self.assertEqual(shell_recovery.classify_shell_corruption(result.final_sources['html']), frozenset())

    def test_no_content_loss_through_the_full_repair_run(self):
        result = self._run(_CORRUPTED_HTML)
        final_html = result.final_sources['html']
        self.assertIn('Welcome to Our Landing Page', final_html)
        self.assertIn('mailto:test@example.com', final_html)
        self.assertIn('hero.png', final_html)
        self.assertIn('heroimg', final_html)
        self.assertIn('Footer text', final_html)
        self.assertIn('color: red', final_html)

    def test_second_run_against_the_repaired_document_is_idempotent(self):
        first = self._run(_CORRUPTED_HTML)
        second = self._run(first.final_sources['html'])
        self.assertEqual(
            sorted(i.rule_id for i in first.report.issues.all()),
            sorted(i.rule_id for i in second.report.issues.all()),
        )
        self.assertEqual(first.final_sources['html'], second.final_sources['html'])
        self.assertEqual(shell_recovery.classify_shell_corruption(second.final_sources['html']), frozenset())


class CascadeEscalationLoopDetectionTests(TestCase):
    """Section 17/18 — a shell defect that STILL cannot be resolved after
    both the deterministic path and the whole-source AI fallback have
    been tried must stop the loop honestly rather than cycle regional
    patches for the remaining iteration budget."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('shell_recovery_cascade_user')

    def test_stops_with_structural_recovery_failed_when_ai_declines_and_shape_is_ambiguous(self):
        # Two separate <head> pairs — NOT the single unambiguous
        # premature-close case, so the deterministic recipe declines;
        # the AI provider is unavailable, so the whole-source fallback
        # also can't help. The loop must stop quickly and honestly
        # rather than grind through regional patches against a shell it
        # can never fix this way.
        html = (
            '<!DOCTYPE html><html><head><title>A</title></head>'
            '<head><meta charset="utf-8"></head><body><p>hi</p></body></html>'
        )
        with (
            patch.object(it, 'get_default_ai_review_provider', return_value=None),
            patch('landingpages.ai_review.provider.get_default_ai_review_provider', return_value=None),
        ):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': html, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u',
            )
        self.assertEqual(result.stopped_reason, 'structural_recovery_failed')
        # Never burned the full iteration budget on a defect that can't
        # converge this way.
        self.assertLess(len(result.iterations), 5)
        # Source was never mutated into something worse — untouched.
        self.assertEqual(result.final_sources['html'], html)

    def test_ai_whole_source_recovery_is_accepted_for_the_ambiguous_case(self):
        # Same ambiguous fixture, but this time a competent whole-source
        # AI response IS available — proving the escalation path works,
        # not just the failure path.
        html = (
            '<!DOCTYPE html><html><head><title>A</title></head>'
            '<head><meta charset="utf-8"></head><body><p>hi</p></body></html>'
        )
        corrected = (
            '<!DOCTYPE html><html><head><title>A</title><meta charset="utf-8"></head>'
            '<body><p>hi</p></body></html>'
        )

        class _FakeProvider:
            def review(self, request):
                from ..ai_review.provider import AIReviewResult

                return AIReviewResult(summary='', proposals=[])

            def repair_whole_source(self, request):
                return WholeSourceRepairResult(corrected_source=corrected, explanation='merged duplicate head')

            def suggest_documentation(self, request):
                raise AIReviewUnavailable('not scripted for documentation in this test')

        with (
            patch.object(it, 'get_default_ai_review_provider', return_value=_FakeProvider()),
            patch('landingpages.ai_review.provider.get_default_ai_review_provider', return_value=_FakeProvider()),
        ):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': html, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u',
            )
        self.assertEqual(shell_recovery.classify_shell_corruption(result.final_sources['html']), frozenset())
        self.assertIn('hi', result.final_sources['html'])
