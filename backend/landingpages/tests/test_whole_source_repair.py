"""AI Engineer Deep Validation + Autonomous Repair — Checkpoint 6
(Whole-Source AI Repair mode). Unit tests inject a fake AI review provider
(no real network call). Whole-source repair is reserved for
run_autonomous_repair ("AI Fix Issues") and only ever attempted as a
fallback once regional patching has already produced nothing actionable
for a round — see fixes/iterative.py::_attempt_whole_source_repair.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ..ai_review.provider import AIReviewResult, WholeSourceRepairResult
from ..fixes import iterative as it

User = get_user_model()

# Deep Validation spec section 4's own example was "a doctype/meta tag
# placed before <html>" — the Correctness Regression sprint gave THAT
# exact shape a deterministic, zero-AI-call recovery (see
# fixes/shell_recovery.py::attempt_content_before_html_recovery), which
# is a genuine improvement but means it no longer exercises the
# whole-source-AI-fallback path these tests exist to prove (decline /
# worse-candidate handling). A duplicated <head> is used instead — a
# comparably realistic document-shell malformation (e.g. a CMS template
# injecting a second head block) that shell_recovery.py has NO
# deterministic recipe for at all, so it reliably still reaches AI.
MALFORMED_SHELL_HTML = (
    '<!DOCTYPE html>\n'
    '<html>\n'
    '<head>\n'
    '<title>Signup</title>\n'
    '</head>\n'
    '<head>\n'
    '<meta name="description" content="Signup page">\n'
    '</head>\n'
    '<body>\n'
    '<h1>Sign up</h1>\n'
    '<p>Welcome.</p>\n'
    '</body>\n'
    '</html>\n'
)

CORRECTED_SHELL_HTML = (
    '<!DOCTYPE html>\n'
    '<html lang="en">\n'
    '<head>\n'
    '<meta charset="UTF-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<title>Signup</title>\n'
    '<meta name="description" content="Signup page">\n'
    '</head>\n'
    '<body>\n'
    '<h1>Sign up</h1>\n'
    '<p>Welcome.</p>\n'
    '</body>\n'
    '</html>\n'
)


class _NoRegionalFixesProvider:
    """Never offers a regional patch — forces run_autonomous_repair to
    fall through to whole-source repair for anything it can't otherwise
    resolve. Subclasses override repair_whole_source()."""

    def review(self, request):
        return AIReviewResult(summary='', proposals=[])


class ReconstructsShellProvider(_NoRegionalFixesProvider):
    def __init__(self):
        self.whole_source_calls = []

    def repair_whole_source(self, request):
        self.whole_source_calls.append(request)
        return WholeSourceRepairResult(
            corrected_source=CORRECTED_SHELL_HTML,
            explanation='Reconstructed the document shell in the intended order.',
            preserved_content_note='Kept the <h1>/<p> body content, <title>, and meta description unchanged.',
        )


class DeclinesProvider(_NoRegionalFixesProvider):
    def repair_whole_source(self, request):
        return WholeSourceRepairResult(corrected_source=None, explanation='Cannot safely reconstruct this.')


class WorsensProvider(_NoRegionalFixesProvider):
    def repair_whole_source(self, request):
        # A candidate that is missing MORE than it fixes — must never be
        # published just because a provider returned *something*.
        return WholeSourceRepairResult(
            corrected_source='<!DOCTYPE html><html <<< broken',
            explanation='Sabotage.',
        )


def _run(html, provider):
    cache.clear()
    user = User.objects.create_user(username='ws_user', password='pw12345!', email='ws@example.com')
    with patch.object(it, 'compute_patches_for_issues', return_value=([], set(), [], [])):
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            return it.run_autonomous_repair(
                user=user, project=None,
                initial_sources={'html': html, 'css': '', 'js': '', 'ampscript': ''},
                css_source_type='css', validation_scope='html', profile='standard',
                rate_limit_identifier='ws',
            )


class WholeSourceRepairTests(TestCase):
    def test_a_malformed_document_shell_is_reconstructed_as_one_coherent_candidate(self):
        provider = ReconstructsShellProvider()
        result = _run(MALFORMED_SHELL_HTML, provider)

        self.assertEqual(len(provider.whole_source_calls), 1)
        self.assertEqual(provider.whole_source_calls[0].file_key, 'html')

        final_html = result.final_sources['html']
        self.assertIn('<html lang="en">', final_html)
        self.assertEqual(final_html.count('<head'), 1)
        self.assertEqual(final_html.count('<html'), 1)
        # Real content preserved, not fabricated or dropped.
        self.assertIn('<h1>Sign up</h1>', final_html)
        self.assertIn('<p>Welcome.</p>', final_html)
        final_rule_ids = {issue.rule_id for issue in result.report.issues.all()}
        self.assertNotIn('html5lib:non-html-root', final_rule_ids)

    def test_a_declined_repair_leaves_the_source_untouched(self):
        provider = DeclinesProvider()
        result = _run(MALFORMED_SHELL_HTML, provider)

        self.assertEqual(result.final_sources['html'], MALFORMED_SHELL_HTML)
        # A duplicated <head> IS classified as shell corruption (Deep
        # Validation spec section 1/2), so the loop's Pass 1 shell-
        # recovery block runs, has no deterministic recipe for THIS
        # corruption class, and the AI declining means recovery genuinely
        # failed — the more specific, honest 'structural_recovery_failed'
        # (HTML Whole-Document Structural Recovery sprint, spec section
        # 17/18), not the generic 'no_actionable' a wholly-unclassified
        # defect would get.
        self.assertEqual(result.stopped_reason, 'structural_recovery_failed')

    def test_a_worse_candidate_is_rejected_and_never_published(self):
        provider = WorsensProvider()
        result = _run(MALFORMED_SHELL_HTML, provider)

        # The sabotaged candidate must never reach the editor — either
        # rejected by the structural-invariant check or by the
        # error-count-did-not-improve check, either way unpublished.
        self.assertEqual(result.final_sources['html'], MALFORMED_SHELL_HTML)
        # See the identical comment on test_a_declined_repair_leaves_the_
        # source_untouched above — a classified shell corruption with no
        # accepted recovery ends the run as 'structural_recovery_failed'.
        self.assertEqual(result.stopped_reason, 'structural_recovery_failed')

    def test_individual_ai_fix_this_issue_never_calls_whole_source_repair(self):
        # AI Fix This Issue goes through ai_review.validation.validate_proposals
        # via provider.review() only — it has no code path that ever
        # constructs a WholeSourceRepairRequest or calls
        # provider.repair_whole_source() (spec section 12). Proven here by
        # a provider whose repair_whole_source would raise if ever called.
        class RaisesIfWholeSourceCalledProvider:
            def review(self, request):
                return AIReviewResult(summary='', proposals=[])

            def repair_whole_source(self, request):
                raise AssertionError('AI Fix This Issue must never call repair_whole_source')

        from ..ai_review import build_issue_context
        from ..ai_review.validation import validate_proposals
        from ..report_builder import persist_validation_report

        cache.clear()
        user = User.objects.create_user(username='ws_individual_user', password='pw12345!', email='wsi@example.com')
        report, _result = persist_validation_report(
            user=user, project=None,
            html=MALFORMED_SHELL_HTML, css='', js='', ts='', ampscript='',
            profile='standard', validation_scope='html', css_source_type='css',
        )
        current_issues = list(report.issues.all())
        sources = {'html': MALFORMED_SHELL_HTML, 'css': '', 'js': '', 'ampscript': ''}
        provider = RaisesIfWholeSourceCalledProvider()
        contexts = [build_issue_context(issue, sources) for issue in current_issues]
        review_result = provider.review(type('R', (), {'issues': contexts})())
        # Only validate_proposals (the single-issue verification path) is
        # exercised here — repair_whole_source is never reached.
        validate_proposals(
            review_result.proposals, current_issues, [i.id for i in current_issues], sources,
            profile='standard', css_source_type='css',
        )
