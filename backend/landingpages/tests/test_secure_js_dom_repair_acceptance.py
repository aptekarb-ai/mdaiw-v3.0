"""Secure JavaScript DOM Repair closure spec, sections 5/7/15/16/17 —
acceptance-level tests for the parts NOT covered by a deterministic
verified recipe (document.write removal, URL-assignment validation,
AMPscript-originated values reaching a JS sink). These necessarily go
through a SCRIPTED fake AI provider (no real network call, matching this
project's established torture-fixture pattern) since no recipe exists
for document.write/URL-validation — the point under test is that (a) the
deterministic secure-DOM verifier accepts a genuinely safe AI proposal
and (b) rejects one that merely swaps one dangerous sink for another,
and (c) a JS-side dangerous-sink recipe fires identically regardless of
whether the value came from a DOM read or an AMPscript-emitted variable.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase

from ..ai_review.provider import AIReviewResult, ProposalDraft
from ..fixes import apply_patches_to_source, verified_recipes
from ..fixes import iterative as it
from ..report_builder import persist_validation_report

User = get_user_model()


def _make_user(name='secure_js_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


class DocumentWriteSafeRemovalProvider:
    """A competent model's response for `document.write(userName);` —
    replace the unsafe global-document write with a safe, targeted
    DOM update instead of just deleting the call (spec section 16 —
    never force zero by deleting functionality)."""

    def review(self, request):
        proposals = []
        for issue in request.issues:
            if issue.rule_id != 'mdaiw-security/document-write':
                continue
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='javascript', source_context=issue.source_context,
                explanation='Replace document.write with a targeted, safe DOM update.',
                risk='medium', confidence='definite',
                start_offset=0, end_offset=0,
                expected_text='document.write(userName);',
                replacement_text='document.body.appendChild(document.createTextNode(userName));',
                requires_configuration=False, assumptions=[],
            ))
        return AIReviewResult(summary='', proposals=proposals)


class DocumentWriteToInsertAdjacentHtmlProvider:
    """An INCOMPETENT response — swaps one dangerous sink for another.
    Must be rejected by the deterministic secure-DOM verifier regardless
    of how plausible the `explanation` sounds."""

    def review(self, request):
        proposals = []
        for issue in request.issues:
            if issue.rule_id != 'mdaiw-security/document-write':
                continue
            proposals.append(ProposalDraft(
                issue_ids=[issue.issue_id], language='javascript', source_context=issue.source_context,
                explanation='Use insertAdjacentHTML instead of document.write — this is safe.',
                risk='low', confidence='definite',
                start_offset=0, end_offset=0,
                expected_text='document.write(userName);',
                replacement_text='document.body.insertAdjacentHTML("beforeend", userName);',
                requires_configuration=False, assumptions=[],
            ))
        return AIReviewResult(summary='', proposals=proposals)


class DocumentWriteRepairAcceptanceTests(TestCase):
    """Section 15's document.write case — no recipe exists for this
    rule_id, so it always goes through AI Engineer; these tests prove the
    deterministic verifier is the actual gatekeeper, not the model's own
    claims."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('docwrite_user')

    def _run(self, provider):
        js = 'function announce(userName) {\n  document.write(userName);\n}\n'
        with patch.object(it, 'get_default_ai_review_provider', return_value=provider):
            return it.run_autonomous_repair(
                user=self.user, project=None,
                initial_sources={'html': '', 'css': '', 'js': js, 'ampscript': ''},
                css_source_type='css', validation_scope='javascript', profile='standard',
                rate_limit_identifier='u',
            )

    def test_a_genuinely_safe_replacement_is_accepted_and_preserves_the_intended_output(self):
        result = self._run(DocumentWriteSafeRemovalProvider())
        final_rule_ids = [i.rule_id for i in result.report.issues.all()]
        self.assertNotIn('mdaiw-security/document-write', final_rule_ids)
        # The function still exists and still does something with
        # userName — behavior preserved, not just deleted (spec 16).
        self.assertIn('function announce(userName)', result.final_sources['js'])
        self.assertIn('userName', result.final_sources['js'])
        self.assertNotIn('document.write', result.final_sources['js'])

    def test_swapping_to_insertadjacenthtml_is_rejected_and_the_finding_survives(self):
        result = self._run(DocumentWriteToInsertAdjacentHtmlProvider())
        final_rule_ids = [i.rule_id for i in result.report.issues.all()]
        # The bad candidate was rejected outright by the deterministic
        # verifier — the ORIGINAL document.write call is still there
        # (never silently replaced by an equally dangerous sink), and
        # the finding correctly survives as unresolved rather than a
        # false "fixed".
        self.assertIn('document.write(userName);', result.final_sources['js'])
        self.assertNotIn('insertAdjacentHTML', result.final_sources['js'])
        self.assertIn('mdaiw-security/document-write', final_rule_ids)


class AmpscriptOriginatedValueReachesJsSinkTests(TestCase):
    """Section 7/17 — a value that conceptually originates from AMPscript
    output, once it reaches the embedded JavaScript as a plain variable,
    is fixed by the SAME deterministic secure-DOM recipe as any other
    plain dynamic value — the recipe's textContent rewrite doesn't care
    WHERE the value came from, which is exactly the "protect the sink
    regardless of source" property the spec asks for. AMPscript's own
    output syntax is never touched or reinterpreted — only the JS sink
    is repaired."""

    def setUp(self):
        cache.clear()
        self.user = _make_user('ampscript_js_user')

    def test_a_value_threaded_from_an_ampscript_emitted_variable_into_innerhtml_is_safely_fixed(self):
        # Conceptually: %%=RequestParameter("name")=%% was emitted into
        # the page as `var subscriberName = "...";` earlier in the
        # document (AMPscript execution happens server-side before the
        # browser ever sees this JS) — from the JS engine's static
        # perspective this is exactly a plain identifier reaching
        # innerHTML, which is precisely the untrusted-by-default case
        # the recipe already refuses to guess is safe and instead
        # neutralizes via textContent rather than ever assuming AMPscript
        # already sanitized it.
        html = (
            '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>T</title></head>\n'
            '<body>\n<script>\n'
            'var subscriberName = "%%=RequestParameter(\\"name\\")=%%";\n'
            'greeting.innerHTML = subscriberName;\n'
            '</script>\n</body></html>\n'
        )
        report, _result = persist_validation_report(
            user=self.user, project=None, html=html, css='', js='', ts='', ampscript='',
            profile='standard', validation_scope='html', css_source_type='css',
        )
        issue = next(i for i in report.issues.all() if i.rule_id == 'mdaiw-security/innerhtml-assignment')
        result = verified_recipes.generate_recipe_result(issue, {'html': html, 'css': '', 'js': '', 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertEqual(result.strategy_key, 'innerhtml-dynamic-text-to-textcontent')

        new_html, patch_results = apply_patches_to_source(html, result.patches)
        self.assertIsNotNone(new_html)
        self.assertTrue(all(r.status == 'applied' for r in patch_results))
        self.assertIn('greeting.textContent = subscriberName;', new_html)
        # The AMPscript personalization value itself is completely
        # untouched — only the JS-side sink changed.
        self.assertIn('RequestParameter', new_html)
