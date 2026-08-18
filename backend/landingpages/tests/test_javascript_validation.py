"""JS engine sprint tests — JavaScript scope dispatch, embedded <script>
blocks, inline event handlers, external <script src>, security rules,
selector checks, and the four required acceptance cases (see the sprint's
Phase 13). Mirrors test_style_block_validation.py / test_less_compilation.py's
patterns: hits validation.engine.run() directly, real Node subprocess calls
(no mocking of the engine itself — these are effectively integration
tests against the real ESLint pipeline)."""

import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from ..models import LandingPageProject, LandingPageVersion
from ..storage.base import build_path
from ..storage.registry import get_storage_provider
from ..validation.engine import run
from ..validation.node_bridge import NodeBridgeError

User = get_user_model()


def _js_issues(result):
    return [issue for issue in result.issues if issue.language == 'javascript']


def _rule_ids(issues):
    return {issue.rule_id for issue in issues}


class JavaScriptScopeDispatchTests(TestCase):
    def test_javascript_scope_validates_only_javascript(self):
        result = run(
            html='<div><unclosed></div>', css='.a { color red; }', js='const x = 1',
            validation_scope='javascript',
        )
        # No HTML/CSS/AMPscript findings under a pure javascript scope.
        self.assertFalse(any(issue.language != 'javascript' for issue in result.issues))

    def test_empty_javascript_is_skipped_cleanly(self):
        result = run(html='', js='   ', validation_scope='javascript')
        self.assertEqual(_js_issues(result), [])

    def test_javascript_engine_status_reports_success(self):
        result = run(html='', js='const x = 1;', validation_scope='javascript')
        statuses = {s.engine_name: s for s in result.engine_status}
        self.assertIn('javascript-conformance', statuses)
        self.assertTrue(statuses['javascript-conformance'].success)


class SyntaxAndQualityTests(TestCase):
    def test_syntax_error_reported(self):
        result = run(html='', js='const x = ', validation_scope='javascript')
        issues = _js_issues(result)
        self.assertTrue(any(i.rule_id == 'javascript:parse-error' for i in issues), issues)
        self.assertTrue(all(i.severity == 'error' for i in issues if i.rule_id == 'javascript:parse-error'))

    def test_undefined_variable_reported(self):
        result = run(html='', js='console.log(totallyUndefinedName);', validation_scope='javascript')
        self.assertIn('no-undef', _rule_ids(_js_issues(result)))

    def test_unused_variable_reported(self):
        result = run(html='', js='function f() { const unused = 1; }', validation_scope='javascript')
        self.assertIn('no-unused-vars', _rule_ids(_js_issues(result)))

    def test_valid_modern_syntax_produces_no_findings(self):
        js = (
            'const obj = { a: 1, ...{ b: 2 } };\n'
            'const { a, b } = obj;\n'
            'const maybe = (obj?.a ?? 0) + a + b;\n'
            'async function run() {\n'
            '  await Promise.resolve(maybe);\n'
            '}\n'
            'class Widget {\n'
            '  #count = 0;\n'
            '  increment() { this.#count += 1; return this.#count; }\n'
            '}\n'
            'new Widget().increment();\n'
            'run();\n'
        )
        result = run(html='', js=js, validation_scope='javascript')
        self.assertEqual(_js_issues(result), [], _js_issues(result))

    def test_duplicate_case_labels_reported(self):
        js = 'switch (1) { case 1: break; case 1: break; }'
        result = run(html='', js=js, validation_scope='javascript')
        self.assertIn('no-duplicate-case', _rule_ids(_js_issues(result)))


class SecurityRuleTests(TestCase):
    def test_eval_reported(self):
        result = run(html='', js="eval('1+1');", validation_scope='javascript')
        issues = _js_issues(result)
        eval_issues = [i for i in issues if i.rule_id == 'no-eval']
        self.assertTrue(eval_issues)
        self.assertEqual(eval_issues[0].category, 'security')

    def test_function_constructor_reported(self):
        result = run(html='', js="new Function('return 1');", validation_scope='javascript')
        self.assertIn('no-new-func', _rule_ids(_js_issues(result)))

    def test_string_settimeout_reported(self):
        result = run(html='', js="setTimeout('doThing()', 100);", validation_scope='javascript')
        self.assertIn('no-implied-eval', _rule_ids(_js_issues(result)))

    def test_javascript_url_reported(self):
        result = run(html='', js="const href = 'javascript:doThing()';", validation_scope='javascript')
        self.assertIn('no-script-url', _rule_ids(_js_issues(result)))

    def test_document_write_reported(self):
        result = run(html='', js="document.write('<b>hi</b>');", validation_scope='javascript')
        self.assertIn('mdaiw-security/document-write', _rule_ids(_js_issues(result)))

    def test_inner_html_assignment_reported(self):
        result = run(html='', js="el.innerHTML = userInput;", validation_scope='javascript')
        self.assertIn('mdaiw-security/innerhtml-assignment', _rule_ids(_js_issues(result)))

    def test_insert_adjacent_html_reported(self):
        result = run(html='', js="el.insertAdjacentHTML('beforeend', userInput);", validation_scope='javascript')
        self.assertIn('mdaiw-security/insert-adjacent-html', _rule_ids(_js_issues(result)))

    def test_wildcard_postmessage_reported(self):
        result = run(html='', js="window.postMessage(data, '*');", validation_scope='javascript')
        self.assertIn('mdaiw-security/wildcard-postmessage', _rule_ids(_js_issues(result)))

    def test_hardcoded_secret_reported(self):
        result = run(html='', js="const apiKey = 'sk_live_abcdefghijklmnop';", validation_scope='javascript')
        self.assertIn('mdaiw-security/hardcoded-secret', _rule_ids(_js_issues(result)))

    def test_prototype_pollution_reported(self):
        result = run(html='', js="obj['__proto__'] = { polluted: true };", validation_scope='javascript')
        self.assertIn('mdaiw-security/prototype-pollution', _rule_ids(_js_issues(result)))

    def test_mixed_content_url_reported(self):
        result = run(html='', js="fetch('http://example.com/api');", validation_scope='javascript')
        self.assertIn('mdaiw-security/mixed-content-url', _rule_ids(_js_issues(result)))

    def test_sensitive_storage_key_reported(self):
        result = run(html='', js="localStorage.setItem('password', value);", validation_scope='javascript')
        self.assertIn('mdaiw-security/sensitive-storage', _rule_ids(_js_issues(result)))

    def test_confidence_never_definite_for_missing_selector_target(self):
        html = '<html><body></body></html>'
        js = "document.getElementById('missing');"
        result = run(html=html, js=js, validation_scope='complete')
        target_issues = [i for i in _js_issues(result) if i.rule_id == 'mdaiw-lp/missing-selector-target']
        self.assertTrue(target_issues)
        self.assertTrue(all(i.confidence != 'definite' for i in target_issues), target_issues)


class SelectorAndNullAccessTests(TestCase):
    def test_missing_selector_target_only_reported_with_html_context(self):
        js = "document.getElementById('missing');"
        result_js_only = run(html='', js=js, validation_scope='javascript')
        self.assertNotIn('mdaiw-lp/missing-selector-target', _rule_ids(_js_issues(result_js_only)))

    def test_missing_selector_target_reported_under_complete_scope(self):
        html = '<html><body><button id="cta">Click</button></body></html>'
        js = "document.querySelector('#missing');"
        result = run(html=html, js=js, validation_scope='complete')
        self.assertIn('mdaiw-lp/missing-selector-target', _rule_ids(_js_issues(result)))

    def test_known_selector_target_not_flagged(self):
        html = '<html><body><button id="cta">Click</button></body></html>'
        js = "document.getElementById('cta');"
        result = run(html=html, js=js, validation_scope='complete')
        self.assertNotIn('mdaiw-lp/missing-selector-target', _rule_ids(_js_issues(result)))

    def test_duplicate_id_reference_reported(self):
        html = '<html><body><div id="dup"></div><div id="dup"></div></body></html>'
        js = "document.getElementById('dup');"
        result = run(html=html, js=js, validation_scope='complete')
        target_issues = [i for i in _js_issues(result) if i.rule_id == 'mdaiw-lp/missing-selector-target']
        self.assertTrue(any('more than one element' in i.message for i in target_issues), target_issues)

    def test_unchecked_selector_access_reported(self):
        js = "const el = document.querySelector('.thing');\nel.addEventListener('click', () => {});"
        result = run(html='', js=js, validation_scope='javascript')
        self.assertIn('mdaiw-lp/unchecked-selector-access', _rule_ids(_js_issues(result)))

    def test_guarded_selector_access_not_flagged(self):
        js = "const el = document.querySelector('.thing');\nif (el) { el.addEventListener('click', () => {}); }"
        result = run(html='', js=js, validation_scope='javascript')
        self.assertNotIn('mdaiw-lp/unchecked-selector-access', _rule_ids(_js_issues(result)))

    def test_optional_chaining_access_not_flagged(self):
        js = "const el = document.querySelector('.thing');\nel?.addEventListener('click', () => {});"
        result = run(html='', js=js, validation_scope='javascript')
        self.assertNotIn('mdaiw-lp/unchecked-selector-access', _rule_ids(_js_issues(result)))


class EmbeddedScriptTests(TestCase):
    def test_html_scope_validates_embedded_script(self):
        html = '<html><body><script>eval("1");</script></body></html>'
        result = run(html=html, validation_scope='html')
        issues = _js_issues(result)
        self.assertTrue(any(i.rule_id == 'no-eval' and i.source_context == 'html-script-block' for i in issues), issues)
        self.assertTrue(all(i.file == 'html' for i in issues))

    def test_json_ld_script_is_skipped(self):
        html = (
            '<html><body>'
            '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "not js {{{"}</script>'
            '</body></html>'
        )
        result = run(html=html, validation_scope='html')
        self.assertEqual(_js_issues(result), [])

    def test_module_script_parses_import_export(self):
        html = '<html><body><script type="module">import { x } from "./mod.js"; console.log(x);</script></body></html>'
        result = run(html=html, validation_scope='html')
        issues = _js_issues(result)
        self.assertFalse(any(i.rule_id == 'javascript:parse-error' for i in issues), issues)

    def test_multiple_script_blocks_independently_validated(self):
        html = (
            '<html><body>'
            '<script>eval("a");</script>'
            '<script>eval("b");</script>'
            '</body></html>'
        )
        result = run(html=html, validation_scope='html')
        block_indices = {i.source_block_index for i in _js_issues(result) if i.rule_id == 'no-eval'}
        self.assertEqual(block_indices, {0, 1}, block_indices)

    def test_standalone_javascript_tab_not_validated_under_html_scope(self):
        html = '<html><body></body></html>'
        result = run(html=html, js="eval('1');", validation_scope='html')
        self.assertEqual(_js_issues(result), [])

    def test_external_script_with_src_not_double_counted_as_embedded(self):
        html = '<html><body><script src="app.js"></script></body></html>'
        result = run(html=html, validation_scope='html')
        self.assertEqual([i for i in _js_issues(result) if i.source_context == 'html-script-block'], [])


class InlineEventHandlerTests(TestCase):
    def test_inline_handler_eval_reported(self):
        html = '<button onclick="eval(\'alert(1)\')">Click</button>'
        result = run(html=html, validation_scope='html')
        issues = _js_issues(result)
        self.assertTrue(any(
            i.rule_id == 'no-eval' and i.source_context == 'html-inline-event-handler' for i in issues
        ), issues)
        self.assertTrue(all(i.file == 'html' for i in issues))

    def test_missing_referenced_function_reported(self):
        html = '<button onclick="totallyUndefinedHandler()">Click</button>'
        result = run(html=html, validation_scope='html')
        issues = _js_issues(result)
        self.assertTrue(any(i.rule_id == 'html-inline-event-handler:missing-function-reference' for i in issues), issues)

    def test_declared_function_reference_not_flagged(self):
        html = (
            '<script>function doThing() { return 1; }</script>'
            '<button onclick="doThing()">Click</button>'
        )
        result = run(html=html, validation_scope='html')
        issues = _js_issues(result)
        self.assertFalse(any(i.rule_id == 'html-inline-event-handler:missing-function-reference' for i in issues), issues)

    def test_bare_global_call_not_flagged_as_missing(self):
        html = '<button onclick="alert(\'hi\')">Click</button>'
        result = run(html=html, validation_scope='html')
        issues = _js_issues(result)
        self.assertFalse(any(i.rule_id == 'html-inline-event-handler:missing-function-reference' for i in issues), issues)


class TimeoutsAndOutputLimitsTests(TestCase):
    # Validator Worker sprint — the persistent worker pool never calls
    # subprocess.run per request, so it would silently bypass this mock.
    @override_settings(LP_VALIDATOR_WORKER_ENABLED=False)
    def test_timeout_reported_as_engine_failure_html_findings_preserved(self):
        html = '<html><body><div><unclosed></body></html>'
        with patch(
            'landingpages.validation.node_bridge.subprocess.run',
            side_effect=subprocess.TimeoutExpired(cmd='node', timeout=1),
        ):
            result = run(html=html, js="eval('1');", validation_scope='complete')
        statuses = {s.engine_name: s for s in result.engine_status}
        self.assertFalse(statuses['javascript-conformance'].success)
        # HTML findings (a separate, non-Node adapter for html5lib itself)
        # must survive a JS engine failure untouched.
        self.assertTrue(any(issue.language == 'html' for issue in result.issues))


class EngineFailurePreservesOtherFindingsTests(TestCase):
    def test_js_engine_failure_does_not_remove_html_or_css_findings(self):
        with patch(
            'landingpages.validation.adapters.js_conformance.run_js_validation',
            side_effect=NodeBridgeError('boom'),
        ):
            result = run(
                html='<div><unclosed></div>', css='.a { color red; }', js='const x = 1;',
                validation_scope='complete',
            )
        self.assertTrue(any(i.language == 'html' for i in result.issues))
        self.assertTrue(any(i.language == 'css' for i in result.issues))
        statuses = {s.engine_name: s for s in result.engine_status}
        self.assertFalse(statuses['javascript-conformance'].success)


class StableOrderingAndFingerprintTests(TestCase):
    def test_repeated_runs_produce_identical_fingerprints(self):
        js = "eval('1'); const unused = 1;"
        first = run(html='', js=js, validation_scope='javascript')
        second = run(html='', js=js, validation_scope='javascript')
        self.assertEqual(
            [i.fingerprint for i in first.issues],
            [i.fingerprint for i in second.issues],
        )

    def test_multiple_findings_same_line_not_deduplicated(self):
        js = "eval('1'); document.write('x');"
        result = run(html='', js=js, validation_scope='javascript')
        line_one = [i for i in _js_issues(result) if i.start_line == 1]
        self.assertGreaterEqual(len(line_one), 2, line_one)


def _make_user(username='alice'):
    return User.objects.create_user(username=username, password='pw12345!', email=f'{username}@example.com')


class _StorageBackedTestCase(TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.root = Path(self._tmpdir.name)
        self._settings_override = override_settings(LP_STORAGE_ROOT=self.root)
        self._settings_override.enable()
        self.addCleanup(self._settings_override.disable)

        self.user = _make_user('alice')
        self.project = LandingPageProject.objects.create(user=self.user, slug='p1', name='Page 1')

    def _save_project_js(self, content: str) -> str:
        js_path = build_path('projects', str(self.project.id), 'script_js')
        get_storage_provider().save(js_path, content.encode('utf-8'))
        LandingPageVersion.objects.create(project=self.project, version_number=1, js_path=js_path)
        return js_path


class ExternalScriptTests(_StorageBackedTestCase):
    def test_local_asset_matching_saved_path_is_validated(self):
        js_path = self._save_project_js("eval('1');")
        html = f'<script src="{js_path}"></script>'
        result = run(html=html, validation_scope='complete', project=self.project)
        issues = [i for i in _js_issues(result) if i.source_context == 'local-external-script']
        self.assertTrue(any(i.rule_id == 'no-eval' for i in issues), issues)

    def test_local_asset_not_matching_saved_path_reported_missing(self):
        self._save_project_js("const x = 1;")
        html = '<script src="not-the-saved-path.js"></script>'
        result = run(html=html, validation_scope='complete', project=self.project)
        issues = _js_issues(result)
        self.assertTrue(any(i.rule_id == 'javascript-external:missing-local-asset' for i in issues), issues)

    def test_path_traversal_src_never_reaches_storage_read(self):
        self._save_project_js("const x = 1;")
        html = '<script src="../../../../etc/passwd"></script>'
        with patch('landingpages.validation.adapters.html_external_script.get_storage_provider') as mock_get:
            result = run(html=html, validation_scope='complete', project=self.project)
            mock_get.assert_not_called()
        issues = _js_issues(result)
        self.assertTrue(any(i.rule_id == 'javascript-external:missing-local-asset' for i in issues), issues)

    def test_remote_content_never_downloaded(self):
        html = '<script src="https://cdn.jsdelivr.net/npm/some-lib@1.0.0/dist/lib.js"></script>'
        result = run(html=html, validation_scope='complete', project=self.project)
        issues = _js_issues(result)
        self.assertTrue(any(i.rule_id == 'javascript-external:reference-validated' for i in issues), issues)

    def test_unapproved_remote_host_flagged(self):
        html = '<script src="https://example.com/some-lib.js"></script>'
        result = run(html=html, validation_scope='complete', project=self.project)
        issues = _js_issues(result)
        self.assertTrue(any(i.rule_id == 'javascript-external:unapproved-remote-source' for i in issues), issues)

    def test_mixed_content_http_flagged(self):
        html = '<script src="http://cdn.jsdelivr.net/npm/some-lib@1.0.0/dist/lib.js"></script>'
        result = run(html=html, validation_scope='complete', project=self.project)
        issues = _js_issues(result)
        self.assertTrue(any(i.rule_id == 'javascript-external:mixed-content' for i in issues), issues)

    def test_external_script_only_validated_under_complete_scope(self):
        js_path = self._save_project_js("eval('1');")
        html = f'<script src="{js_path}"></script>'
        result = run(html=html, validation_scope='html', project=self.project)
        self.assertEqual([i for i in _js_issues(result) if i.source_context == 'local-external-script'], [])


class AuthenticationAndOwnershipTests(_StorageBackedTestCase):
    def test_another_users_project_js_path_never_used(self):
        other_user = _make_user('bob')
        other_project = LandingPageProject.objects.create(user=other_user, slug='p2', name='Page 2')
        other_js_path = build_path('projects', str(other_project.id), 'script_js')
        get_storage_provider().save(other_js_path, b"eval('should not be read');")
        LandingPageVersion.objects.create(project=other_project, version_number=1, js_path=other_js_path)

        # Simulates views.py's ownership filter never handing this adapter
        # a project it doesn't belong to — `self.project` (alice's, with no
        # saved js asset) is what's passed, never `other_project`.
        html = f'<script src="{other_js_path}"></script>'
        result = run(html=html, validation_scope='complete', project=self.project)
        issues = _js_issues(result)
        self.assertTrue(any(i.rule_id == 'javascript-external:missing-local-asset' for i in issues), issues)


class AcceptanceCaseTests(TestCase):
    """Phase 13 — the four required acceptance cases, verified exactly."""

    def test_case_a_javascript_only(self):
        js = (
            'const button = document.querySelector("#button");\n\n'
            'button.addEventListener("click", () => {\n'
            '  eval("alert(\'test\')");\n'
            '  document.getElementById("output").innerHTML = location.hash;\n'
            '});\n'
        )
        result = run(html='', js=js, validation_scope='javascript')
        issues = _js_issues(result)
        rule_ids = _rule_ids(issues)
        self.assertIn('no-eval', rule_ids)
        self.assertIn('mdaiw-security/innerhtml-assignment', rule_ids)
        self.assertIn('mdaiw-lp/unchecked-selector-access', rule_ids)
        self.assertFalse(any(i.language != 'javascript' for i in result.issues))

    def test_case_b_complete_lp(self):
        html = (
            '<!DOCTYPE html>\n'
            '<html lang="en">\n'
            '<head>\n'
            '  <meta charset="UTF-8">\n'
            '  <title>JavaScript Test</title>\n'
            '</head>\n'
            '<body>\n'
            '  <button id="cta">Click</button>\n'
            '</body>\n'
            '</html>\n'
        )
        js = (
            'const button = document.querySelector("#missing");\n'
            'button.addEventListener("click", () => console.log("clicked"));\n'
        )
        result = run(html=html, js=js, validation_scope='complete')
        js_issues = _js_issues(result)
        rule_ids = _rule_ids(js_issues)
        self.assertIn('mdaiw-lp/missing-selector-target', rule_ids)
        self.assertIn('mdaiw-lp/unchecked-selector-access', rule_ids)
        self.assertTrue(any(i.language == 'html' for i in result.issues))
        self.assertTrue(all(i.file == 'javascript' for i in js_issues))

    def test_case_c_embedded_script(self):
        html = (
            '<script>\n'
            '  const button = document.querySelector("#cta");\n'
            '  button.addEventListener("click", () => {\n'
            '    document.body.innerHTML = location.hash;\n'
            '  });\n'
            '</script>\n'
        )
        result = run(html=html, validation_scope='html')
        js_issues = _js_issues(result)
        self.assertTrue(any(
            i.rule_id == 'mdaiw-security/innerhtml-assignment' and i.source_context == 'html-script-block'
            for i in js_issues
        ), js_issues)
        self.assertTrue(all(i.file == 'html' for i in js_issues))

    def test_case_d_inline_handler(self):
        html = '<button onclick="eval(\'alert(1)\')">Click</button>'
        result = run(html=html, validation_scope='html')
        js_issues = _js_issues(result)
        self.assertTrue(any(
            i.rule_id == 'no-eval' and i.source_context == 'html-inline-event-handler'
            for i in js_issues
        ), js_issues)
        self.assertTrue(all(i.file == 'html' for i in js_issues))
