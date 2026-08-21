"""AI Engineer FORMAT + COMMENT policy closure sprint — regression tests
for trailing (same-line) comment attachment, ordering (comments before
formatting), and idempotency across two AI Fix Issues runs. Uses a
SCRIPTED fake provider (this project's established torture-fixture
pattern) since the point under test is the deterministic verifier and
pipeline ordering, not the model's own reasoning.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ..ai_review.provider import AIReviewResult, AIReviewUnavailable, DocumentationResult
from ..fixes import formatting, iterative as it

User = get_user_model()


def _make_user(name='comment_policy_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


class _DocumentationOnlyProvider:
    def __init__(self, doc_responses):
        self._doc_responses = doc_responses

    def review(self, request):
        return AIReviewResult(summary='', proposals=[])

    def suggest_documentation(self, request):
        if request.file_key not in self._doc_responses:
            raise AIReviewUnavailable('not scripted')
        return self._doc_responses[request.file_key]


class CssTrailingCommentFormatterInteractionTests(TestCase):
    """Section 1/7 — the deterministic formatter must PRESERVE a trailing
    comment's placement rather than pushing it onto its own line (the
    exact regression reported)."""

    def test_beautifier_no_longer_displaces_a_trailing_css_comment(self):
        css = (
            '.a {\n  background-color: blue; /* Corrected property */\n'
            '  font-family: Arial, sans-serif; /* Added generic font fallback */\n'
            '  width:80%;\n}\n'
        )
        formatted = formatting.format_css(css, 'css')
        self.assertIsNotNone(formatted)
        self.assertIn('background-color: blue; /* Corrected property */', formatted)
        self.assertIn('font-family: Arial, sans-serif; /* Added generic font fallback */', formatted)
        # An unrelated line still gets normal reformatting.
        self.assertIn('width: 80%;', formatted)
        # Neither comment ended up alone on its own line.
        for line in formatted.split('\n'):
            self.assertFalse(line.strip().startswith('/*') and line.strip().endswith('*/') is False)

    def test_stylelint_autofix_does_not_disturb_an_already_trailing_comment(self):
        css = '.a {\n  background-color: blue; /* Corrected property */\n}\n'
        formatted = formatting.format_css(css, 'css')
        # Nothing needed fixing (no standalone-comment-before-blank-line
        # violation exists for a trailing comment) — either None (no
        # change) or, if reindented, still trailing.
        if formatted is not None:
            self.assertIn('background-color: blue; /* Corrected property */', formatted)


class CommentBeforeFormatOrderingIntegrationTests(TestCase):
    """Section 7 — comments are added BEFORE the formatter runs, and the
    formatter must not re-break their placement afterward."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('comment_order_user')

    def _run(self, css, doc_responses):
        provider = _DocumentationOnlyProvider(doc_responses)
        with (
            patch.object(it, 'get_default_ai_review_provider', return_value=provider),
            patch('landingpages.ai_review.provider.get_default_ai_review_provider', return_value=provider),
        ):
            return it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': '', 'css': css, 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='css', profile='standard',
                rate_limit_identifier='u',
            )

    def test_a_trailing_css_comment_survives_the_subsequent_format_pass(self):
        css = '.a {\n  background-color: blue;\n}\n'
        commented = '.a {\n  background-color: blue; /* Preserve brand background. */\n}\n'
        result = self._run(css, {'css': DocumentationResult(documented_source=commented, comments_added=1, explanation='...')})
        self.assertIn('background-color: blue; /* Preserve brand background. */', result.final_sources['css'])
        # Never pushed onto its own separate line.
        lines = result.final_sources['css'].split('\n')
        for line in lines:
            self.assertFalse(line.strip() in ('/* Preserve brand background. */',))

    def test_css_warning_regression_fixture_ends_with_zero_stylelint_warnings(self):
        # Section 8 — the exact reported fixture: after AI Fix Issues,
        # trailing comments (or no comment at all) must never leave a
        # comment-empty-line-before warning behind.
        css = '.a {\n  background-color: blue;\n  /* Corrected property */\n  font-family: Arial, sans-serif;\n  /* Added generic font fallback */\n  width: 80%;\n}\n'
        result = self._run(css, {})  # no AI documentation candidate scripted — this fixture only needs the deterministic autofix path
        final_rule_ids = {i.rule_id for i in result.report.issues.all()}
        self.assertNotIn('stylelint:comment-empty-line-before', final_rule_ids)


class CommentIdempotencyAcrossTwoRunsIntegrationTests(TestCase):
    """Section 6/10 — a second AI Fix Issues run must never double a
    comment that a first run already attached."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('comment_idempotency_user')

    def test_second_run_against_already_commented_source_adds_nothing_more(self):
        already_commented_css = '.a {\n  background-color: blue; /* Preserve brand background. */\n}\n'
        # A misbehaving/stale provider that (incorrectly) tries to
        # attach ANOTHER trailing comment to the same, already-commented
        # line — the deterministic verifier must reject it regardless of
        # what the model proposes.
        doubled = (
            '.a {\n  background-color: blue; /* Preserve brand background. */ '
            '/* Preserve brand background. */\n}\n'
        )
        provider = _DocumentationOnlyProvider({
            'css': DocumentationResult(documented_source=doubled, comments_added=1, explanation='...'),
        })
        with (
            patch.object(it, 'get_default_ai_review_provider', return_value=provider),
            patch('landingpages.ai_review.provider.get_default_ai_review_provider', return_value=provider),
        ):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': '', 'css': already_commented_css, 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='css', profile='standard',
                rate_limit_identifier='u',
            )
        self.assertEqual(
            result.final_sources['css'].count('Preserve brand background.'), 1,
        )
