"""AI Engineer Formatting + Documentation sprint — integration tests for
the pass wired into run_autonomous_repair ("AI Fix Issues"), spec section
3/4/17/18/26/27. Uses a SCRIPTED fake provider for the documentation
sub-pass only (no repair proposals are needed — the fixtures below are
already valid HTML, just badly formatted, so the structural repair loop
converges immediately and the format+documentation pass is what's under
test)."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ..ai_review.provider import DocumentationResult
from ..fixes import iterative as it

User = get_user_model()


def _make_user(name='format_doc_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


class _DocumentationOnlyProvider:
    """No repair proposals (unused by these fixtures); scripted
    documentation responses keyed by file_key."""

    def __init__(self, doc_responses):
        self._doc_responses = doc_responses

    def review(self, request):
        from ..ai_review.provider import AIReviewResult

        return AIReviewResult(summary='', proposals=[])

    def suggest_documentation(self, request):
        if request.file_key not in self._doc_responses:
            from ..ai_review.provider import AIReviewUnavailable

            raise AIReviewUnavailable('not scripted')
        return self._doc_responses[request.file_key]


class FormattingPassIntegrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = _make_user('format_pass_user')

    def _run(self, html, provider=None):
        provider = provider or _DocumentationOnlyProvider({})
        stages_seen = []

        def on_progress(*, stage, **_kwargs):
            stages_seen.append(stage)

        with (
            patch.object(it, 'get_default_ai_review_provider', return_value=provider),
            patch('landingpages.ai_review.provider.get_default_ai_review_provider', return_value=provider),
        ):
            result = it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': html, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='u', on_progress=on_progress,
            )
        return result, stages_seen

    def test_badly_formatted_but_valid_html_is_reformatted_after_convergence(self):
        html = (
            '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8">'
            '<title>T</title></head><body><main><h1>Welcome</h1><p>hi</p></main></body></html>'
        )
        result, stages_seen = self._run(html)
        self.assertIn('formatting', stages_seen)
        self.assertIn('documenting', stages_seen)
        # Real reformatting happened — nested elements now indented.
        self.assertIn('<h1>Welcome</h1>', result.final_sources['html'])
        self.assertIn('<head>\n  <meta charset', result.final_sources['html'])

    def test_formatting_stage_is_skipped_when_every_source_is_empty(self):
        # No populated source at all — nothing for the pass to touch. An
        # empty JavaScript-only scope converges with zero issues and zero
        # repair rounds, so this isolates the pass's own empty-input
        # guard rather than any repair-loop edge case.
        stages_seen = []

        def on_progress(*, stage, **_kwargs):
            stages_seen.append(stage)

        with (
            patch.object(it, 'get_default_ai_review_provider', return_value=_DocumentationOnlyProvider({})),
            patch('landingpages.ai_review.provider.get_default_ai_review_provider', return_value=_DocumentationOnlyProvider({})),
        ):
            it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': '', 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='javascript', profile='standard',
                rate_limit_identifier='u', on_progress=on_progress,
            )
        self.assertNotIn('formatting', stages_seen)
        self.assertNotIn('documenting', stages_seen)

    def test_a_verified_documentation_candidate_is_adopted_into_final_sources(self):
        # Closure spec section 7 — documentation now runs BEFORE
        # formatting, so the scripted candidate must be built against the
        # RAW (pre-format) source, not the formatted one.
        html = '<!DOCTYPE html>\n<html><head><title>T</title></head><body><div>\n<form></form>\n</div></body></html>'
        # Insert a pure NEW line above the form's line — the original
        # line itself must stay byte-for-byte unchanged, or the
        # add-only-comments safety net (correctly) rejects the whole
        # candidate (see test_documentation.py).
        commented = html.replace(
            '<form></form>', '<!-- Primary lead-capture form -->\n<form></form>',
        )
        provider = _DocumentationOnlyProvider({
            'html': DocumentationResult(documented_source=commented, comments_added=1, explanation='...'),
        })

        result, _stages_seen = self._run(html, provider=provider)
        self.assertIn('Primary lead-capture form', result.final_sources['html'])

    def test_a_documentation_candidate_that_alters_code_is_discarded(self):
        html = '<!DOCTYPE html>\n<html><head><title>T</title></head><body><p>Keep me</p></body></html>'
        tampered = html.replace('Keep me', 'Changed content disguised as documentation')
        provider = _DocumentationOnlyProvider({
            'html': DocumentationResult(documented_source=tampered, comments_added=1, explanation='...'),
        })

        result, _stages_seen = self._run(html, provider=provider)
        self.assertIn('Keep me', result.final_sources['html'])
        self.assertNotIn('Changed content disguised as documentation', result.final_sources['html'])
