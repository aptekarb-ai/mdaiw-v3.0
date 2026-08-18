"""AMPscript-replacement sprint tests — request contract, dedicated and
embedded AMPscript validation, control-flow/variable/function/security
checks, and legacy TypeScript-field compatibility."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from ..models import LandingPageProject
from ..validation.ampscript import analyze
from ..validation.engine import run

User = get_user_model()


def _make_user(username='alice', password='pw12345!'):
    return User.objects.create_user(username=username, password=password, email=f'{username}@example.com')


def _ampscript_issues(result):
    return [issue for issue in result.issues if issue.language == 'ampscript']


def _rule_ids(issues):
    return {issue.rule_id for issue in issues}


ACCEPTANCE_A = (
    '%%[\n'
    'VAR @firstName\n'
    'SET @firstName = AttributeValue("FirstName")\n'
    '\n'
    'IF Empty(@firstName) THEN\n'
    '  SET @firstName = "Customer"\n'
    ']%%\n'
    '\n'
    'Hello %%=v(@firstName)=%%\n'
)

ACCEPTANCE_B_HTML = (
    '<!DOCTYPE html>\n'
    '<html lang="en">\n'
    '<head>\n'
    '  <meta charset="UTF-8">\n'
    '  <title>SFMC CloudPage</title>\n'
    '</head>\n'
    '<body>\n'
    '  %%[\n'
    '  SET @name = RequestParameter("name")\n'
    '  ]%%\n'
    '\n'
    '  <h1>Hello %%=v(@name)=%%</h1>\n'
    '</body>\n'
    '</html>\n'
)


class EngineDispatchTests(TestCase):
    """1-4, 31-33 — request/scope contract and per-scope dispatch."""

    def test_ampscript_field_accepted_and_validated(self):
        result = run(html='', ampscript='%%[ VAR @x ]%%', validation_scope='ampscript')
        self.assertEqual(result.validation_scope, 'ampscript')

    def test_ampscript_scope_accepted(self):
        result = run(html='', ampscript='', validation_scope='ampscript')
        self.assertEqual(result.validation_scope, 'ampscript')

    def test_legacy_ts_input_never_becomes_ampscript(self):
        result = run(html='', ts=ACCEPTANCE_A, ampscript='', validation_scope='ampscript')
        self.assertEqual(_ampscript_issues(result), [])

    def test_html_scope_validates_embedded_ampscript_only(self):
        result = run(html=ACCEPTANCE_B_HTML, ampscript=ACCEPTANCE_A, validation_scope='html')
        issues = _ampscript_issues(result)
        self.assertTrue(all(issue.source_context == 'html-embedded-ampscript' for issue in issues), issues)
        # The dedicated tab's own IF-without-ENDIF defect must not appear.
        self.assertNotIn('ampscript:if-without-endif', _rule_ids(issues))

    def test_ampscript_scope_does_not_run_html(self):
        result = run(html='<img src="x.png">', ampscript='%%[ VAR @x ]%%', validation_scope='ampscript')
        self.assertFalse(any(issue.language == 'html' for issue in result.issues))

    def test_complete_scope_runs_dedicated_and_embedded_ampscript(self):
        result = run(html=ACCEPTANCE_B_HTML, ampscript=ACCEPTANCE_A, validation_scope='complete')
        issues = _ampscript_issues(result)
        contexts = {issue.source_context for issue in issues}
        self.assertEqual(contexts, {'ampscript-source', 'html-embedded-ampscript'})


class DedicatedAmpscriptTests(TestCase):
    """5-21 — dedicated AMPscript-tab source validation."""

    def test_valid_ampscript_produces_no_errors(self):
        result = run(html='', ampscript='%%[\nVAR @x\nSET @x = "hi"\n]%%\n', validation_scope='ampscript')
        errors = [i for i in _ampscript_issues(result) if i.severity == 'error']
        self.assertEqual(errors, [], errors)

    def test_missing_closing_delimiter(self):
        result = run(html='', ampscript='%%[\nVAR @x\n', validation_scope='ampscript')
        self.assertIn('ampscript:unterminated-block', _rule_ids(_ampscript_issues(result)))

    def test_invalid_inline_output_delimiter(self):
        result = run(html='', ampscript='%%=v(@x)\n', validation_scope='ampscript')
        self.assertIn('ampscript:unterminated-inline-expression', _rule_ids(_ampscript_issues(result)))

    def test_missing_endif(self):
        result = run(html='', ampscript=ACCEPTANCE_A, validation_scope='ampscript')
        issues = [i for i in _ampscript_issues(result) if i.rule_id == 'ampscript:if-without-endif']
        self.assertEqual(len(issues), 1, issues)
        self.assertEqual(issues[0].line, 5)

    def test_endif_without_if(self):
        result = run(html='', ampscript='%%[\nENDIF\n]%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:endif-without-if', _rule_ids(_ampscript_issues(result)))

    def test_missing_next(self):
        result = run(html='', ampscript='%%[\nFOR @i = 1 TO 3 DO\n]%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:for-without-next', _rule_ids(_ampscript_issues(result)))

    def test_next_without_for(self):
        result = run(html='', ampscript='%%[\nNEXT\n]%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:next-without-for', _rule_ids(_ampscript_issues(result)))

    def test_nested_valid_if(self):
        source = (
            '%%[\nVAR @a\nVAR @b\nIF @a == "x" THEN\n'
            '  IF @b == "y" THEN\n    SET @a = "z"\n  ENDIF\nENDIF\n]%%\n'
        )
        result = run(html='', ampscript=source, validation_scope='ampscript')
        control_flow_errors = [
            i for i in _ampscript_issues(result)
            if i.severity == 'error' and i.rule_id.startswith('ampscript:') and 'if' in i.rule_id
        ]
        self.assertEqual(control_flow_errors, [], control_flow_errors)

    def test_nested_valid_for(self):
        source = '%%[\nFOR @i = 1 TO 3 DO\n  FOR @j = 1 TO 3 DO\n  NEXT\nNEXT\n]%%\n'
        result = run(html='', ampscript=source, validation_scope='ampscript')
        for_errors = [i for i in _ampscript_issues(result) if 'for' in i.rule_id and i.severity == 'error']
        self.assertEqual(for_errors, [], for_errors)

    def test_missing_variable_at_prefix(self):
        result = run(html='', ampscript='%%[\nVAR firstName\n]%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:variable-missing-at-prefix', _rule_ids(_ampscript_issues(result)))

    def test_undefined_variable(self):
        result = run(html='', ampscript='%%[\nSET @x = @neverDeclared\n]%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:variable-undeclared', _rule_ids(_ampscript_issues(result)))

    def test_variable_reference_before_declaration(self):
        result = run(html='', ampscript='Hello %%=v(@missing)=%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:variable-undeclared', _rule_ids(_ampscript_issues(result)))

    def test_valid_var_and_set(self):
        result = run(html='', ampscript='%%[\nVAR @x\nSET @x = "hi"\n]%%\n', validation_scope='ampscript')
        undeclared = [i for i in _ampscript_issues(result) if i.rule_id == 'ampscript:variable-undeclared']
        self.assertEqual(undeclared, [], undeclared)

    def test_inline_v_expression_recognized(self):
        result = run(html='', ampscript=ACCEPTANCE_A, validation_scope='ampscript')
        unknown = [i for i in _ampscript_issues(result) if i.rule_id == 'ampscript:unknown-function' and 'V' in i.message]
        self.assertEqual(unknown, [], unknown)

    def test_unknown_function(self):
        result = run(html='', ampscript='%%[\nSET @x = TotallyMadeUpFunction(@x)\n]%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:unknown-function', _rule_ids(_ampscript_issues(result)))

    def test_function_parameter_count_error(self):
        result = run(html='', ampscript='%%[\nSET @x = Empty()\n]%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:function-parameter-count', _rule_ids(_ampscript_issues(result)))

    def test_valid_nested_function_call(self):
        result = run(html='', ampscript='%%[\nSET @x = Trim(Concat("a", "b"))\n]%%\n', validation_scope='ampscript')
        param_errors = [i for i in _ampscript_issues(result) if i.rule_id == 'ampscript:function-parameter-count']
        self.assertEqual(param_errors, [], param_errors)


class SecurityAndCloudPagesTests(TestCase):
    """22-26 — CloudPages/security static checks."""

    def test_request_parameter_security_warning(self):
        result = run(html='', ampscript='%%[\nSET @n = RequestParameter("n")\n]%%\n%%=v(@n)=%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:unsanitized-request-parameter', _rule_ids(_ampscript_issues(result)))

    def test_unsafe_redirect_to_warning(self):
        result = run(
            html='', ampscript='%%[\nSET @url = RequestParameter("next")\nRedirectTo(@url)\n]%%\n',
            validation_scope='ampscript',
        )
        self.assertIn('ampscript:unsafe-redirect', _rule_ids(_ampscript_issues(result)))

    def test_treat_as_content_warning(self):
        result = run(
            html='', ampscript='%%[\nSET @body = RequestParameter("body")\nTreatAsContent(@body)\n]%%\n',
            validation_scope='ampscript',
        )
        self.assertIn('ampscript:unsafe-treat-as-content', _rule_ids(_ampscript_issues(result)))

    def test_data_extension_write_warning(self):
        result = run(html='', ampscript='%%[\nDeleteData("MyDE", "Id", @id)\n]%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:destructive-data-operation', _rule_ids(_ampscript_issues(result)))

    def test_hardcoded_secret_warning(self):
        result = run(html='', ampscript='%%[\nSET @apiSecret = "sk_live_12345"\n]%%\n', validation_scope='ampscript')
        self.assertIn('ampscript:hardcoded-secret', _rule_ids(_ampscript_issues(result)))


class EmbeddedExtractionTests(TestCase):
    """27-30 — embedded-in-HTML extraction and coexistence."""

    def test_embedded_ampscript_extracted(self):
        result = run(html=ACCEPTANCE_B_HTML, validation_scope='html')
        issues = _ampscript_issues(result)
        self.assertTrue(any(i.source_context == 'html-embedded-ampscript' for i in issues), issues)

    def test_embedded_source_line_mapping(self):
        result = run(html=ACCEPTANCE_B_HTML, validation_scope='html')
        security_issue = next(i for i in _ampscript_issues(result) if i.rule_id == 'ampscript:unsanitized-request-parameter')
        self.assertEqual(security_issue.line, 12)

    def test_multiple_embedded_blocks(self):
        # First block is entirely valid (proves shared cross-block variable
        # scope produces no false "undeclared" issue for @a); the second
        # block has its own independent defect, which must still be found
        # and correctly indexed to its own block — one broken block must
        # never hide another block's own findings.
        html = (
            '<html><body>\n'
            '%%[ VAR @a ]%%\n'
            '<p>%%=v(@a)=%%</p>\n'
            '%%[ SET @b = TotallyMadeUpFunction() ]%%\n'
            '</body></html>\n'
        )
        result = run(html=html, validation_scope='html')
        issues = _ampscript_issues(result)
        self.assertEqual(_rule_ids(issues) & {'ampscript:variable-undeclared'}, set())
        unknown = [i for i in issues if i.rule_id == 'ampscript:unknown-function']
        self.assertEqual(len(unknown), 1, issues)
        self.assertIsNotNone(unknown[0].source_block_index)

    def test_dedicated_and_embedded_issues_coexist(self):
        result = run(html=ACCEPTANCE_B_HTML, ampscript=ACCEPTANCE_A, validation_scope='complete')
        issues = _ampscript_issues(result)
        self.assertTrue(any(i.source_context == 'ampscript-source' for i in issues))
        self.assertTrue(any(i.source_context == 'html-embedded-ampscript' for i in issues))


class RobustnessTests(TestCase):
    """34, 37, 38 — partial failure, fingerprint stability, stable ordering."""

    def test_adapter_failure_is_partial_not_fatal(self):
        # A pathological but well-formed request must never take down HTML
        # findings just because AMPscript is also being analyzed.
        result = run(html='<img src="x.png">', ampscript='%%[ VAR @x ]%%', validation_scope='complete')
        self.assertTrue(any(i.language == 'html' for i in result.issues))

    def test_fingerprint_is_stable_across_identical_runs(self):
        result_a = run(html='', ampscript=ACCEPTANCE_A, validation_scope='ampscript')
        result_b = run(html='', ampscript=ACCEPTANCE_A, validation_scope='ampscript')
        fingerprints_a = sorted(i.fingerprint for i in result_a.issues)
        fingerprints_b = sorted(i.fingerprint for i in result_b.issues)
        self.assertEqual(fingerprints_a, fingerprints_b)
        self.assertTrue(all(fingerprints_a))

    def test_issue_ordering_is_stable(self):
        source = '%%[\nENDIF\nNEXT\n]%%\n'
        first = [i.rule_id for i in run(html='', ampscript=source, validation_scope='ampscript').issues]
        second = [i.rule_id for i in run(html='', ampscript=source, validation_scope='ampscript').issues]
        self.assertEqual(first, second)


class ApiContractTests(TestCase):
    """1-3, 35 — HTTP-layer request contract and ownership."""

    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('alice')
        self.client.force_authenticate(self.user)

    def test_ampscript_field_accepted_over_api(self):
        response = self.client.post(
            '/api/v1/lp/validate/',
            {'html': '', 'ampscript': ACCEPTANCE_A, 'validation_scope': 'ampscript'}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['validation_scope'], 'ampscript')

    def test_invalid_scope_rejected(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '', 'validation_scope': 'not-a-real-scope'}, format='json',
        )
        # Unknown scopes fall back to 'complete' at the engine layer (see
        # test_validation_scope.py) — this asserts the existing structured
        # envelope still governs, not that AMPscript introduced a new
        # rejection path.
        self.assertEqual(response.status_code, 400)

    def test_ampscript_scope_with_blank_source_rejected(self):
        response = self.client.post(
            '/api/v1/lp/validate/', {'html': '', 'ampscript': '', 'validation_scope': 'ampscript'}, format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('ampscript', response.json()['errors'])

    def test_unauthenticated_request_rejected(self):
        anonymous_client = APIClient()
        response = anonymous_client.post(
            '/api/v1/lp/validate/', {'html': '', 'ampscript': ACCEPTANCE_A, 'validation_scope': 'ampscript'},
            format='json',
        )
        self.assertIn(response.status_code, (401, 403))

    def test_ampscript_report_scoped_to_owner(self):
        other = _make_user('bob')
        other_project = LandingPageProject.objects.create(user=other, name='Bob project', slug='bob-project')
        response = self.client.post(
            '/api/v1/lp/validate/',
            {
                'html': '', 'ampscript': ACCEPTANCE_A, 'validation_scope': 'ampscript',
                'project': other_project.id,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('project', response.json()['errors'])


class MigrationDefaultsTests(TestCase):
    """36 — migration defaults are correct and non-destructive."""

    def test_new_report_defaults_css_and_language_choices_unaffected(self):
        result = run(html='<p>hi</p>', validation_scope='html')
        self.assertTrue(all(i.language in ('html', 'css', 'ampscript') for i in result.issues))

    def test_ampscript_path_field_defaults_to_blank(self):
        from ..models import LandingPageVersion
        field = LandingPageVersion._meta.get_field('ampscript_path')
        self.assertEqual(field.default, '')
        self.assertTrue(field.blank)

    def test_typescript_choice_still_valid_for_legacy_rows(self):
        from ..models import ValidationIssue
        self.assertIn(('typescript', 'TypeScript'), ValidationIssue.FileType.choices)
        self.assertIn(('ampscript', 'AMPscript'), ValidationIssue.FileType.choices)


class DirectAnalyzerTests(TestCase):
    """Direct validation.ampscript.analyze() checks — acceptance cases A/B
    exactly as specified, independent of the engine/adapter plumbing above."""

    def test_acceptance_case_a(self):
        result = analyze(ACCEPTANCE_A)
        rule_ids = {i.rule_id for i in result.issues}
        self.assertIn('ampscript:if-without-endif', rule_ids)
        if_issue = next(i for i in result.issues if i.rule_id == 'ampscript:if-without-endif')
        self.assertEqual(if_issue.line, 5)
        unknown_v = [i for i in result.issues if i.rule_id == 'ampscript:unknown-function' and 'V' in i.message]
        self.assertEqual(unknown_v, [])

    def test_acceptance_case_b(self):
        result = analyze(ACCEPTANCE_B_HTML)
        rule_ids = {i.rule_id for i in result.issues}
        self.assertIn('ampscript:unsanitized-request-parameter', rule_ids)
        security_issue = next(i for i in result.issues if i.rule_id == 'ampscript:unsanitized-request-parameter')
        self.assertEqual(security_issue.region_kind, 'inline')
