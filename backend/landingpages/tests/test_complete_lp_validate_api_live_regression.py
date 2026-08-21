"""Live regression: "AI Validate Code" returning a generic 500 in the
real browser for Complete LP with all four languages populated.

Root cause (confirmed by direct reproduction, not guessed): migrations
0013_authoritativeknowledgerecord and 0014_validationissue_root_cause_id
existed in the codebase but had never been applied to the persistent dev
database (`python manage.py migrate` was not re-run after they were
generated earlier in the same session) — `ValidationIssue.objects.
bulk_create(...)` in report_builder.py then raised
`sqlite3.OperationalError: table landingpages_validationissue has no
column named root_cause_id`, caught by AIValidateStartView's blanket
`except Exception`, which is exactly why the browser only ever showed
"Validation could not be completed. Please try again." — that handler
is deliberately generic so a raw traceback is never leaked to the
frontend; it also means this exact failure class was never distinguishable
from any other backend error without checking the server-side log.

This test CANNOT reproduce the actual trigger (a real Django TestCase
always runs against a freshly, fully migrated in-memory database — that
is what made every automated test in this session pass while the live
dev database was stale). What it guards against instead is the entire
class of "a new persisted field breaks the real API path" bug: it
exercises the SAME public view the frontend calls (ValidateView, not
engine.py internals directly), with every language populated at once, and
asserts the response serializes cleanly including root_cause_id in both
its populated (HTML shell-corruption cascade) and empty (every other
engine) forms.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

User = get_user_model()

# Same shape as the live browser fixture that triggered the regression —
# content before <html> (shell corruption -> populates root_cause_id),
# real CSS/JS/AMPscript alongside it.
_HTML = (
    '<!DOCTYPE html>\n'
    '<meta name="description" content="A landing page for the promo">\n'
    '<html lang="en">\n<head>\n<meta charset="UTF-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<title>Promo Landing</title>\n<style>\n.hero { color: red; }\n</style>\n</head>\n'
    '<body>\n<!-- promo banner -->\n<h1>Welcome</h1>\n'
    '<div id="award-panel">Congratulations!</div>\n'
    '<script>\nconsole.log("hi");\n</script>\n</body>\n</html>\n'
)
_CSS = 'body {\n  background-color: blue;\n}\n'
_JS = 'function greet(name) {\n  console.log("Hello, " + name);\n}\ngreet("Promo");\n'
_AMPSCRIPT = '%%[ VAR @x SET @x = 1 ]%%\nHello %%=v(@x)=%%\n'


class CompleteLpValidateApiLiveRegressionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='clp_api_user', password='pw12345!', email='clpapi@example.com')
        self.client.force_authenticate(self.user)

    def test_complete_lp_all_four_languages_validates_successfully_via_the_real_view(self):
        response = self.client.post(
            '/api/v1/lp/validate/',
            {
                'html': _HTML, 'css': _CSS, 'js': _JS, 'ampscript': _AMPSCRIPT,
                'validation_scope': 'complete', 'profile': 'standard', 'css_source_type': 'css',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertIn('issues', body)
        self.assertIsInstance(body['issues'], list)
        self.assertTrue(body['issues'])  # the shell-corruption cascade IS present in this fixture

    def test_root_cause_id_serializes_for_both_grouped_and_ungrouped_issues(self):
        response = self.client.post(
            '/api/v1/lp/validate/',
            {
                'html': _HTML, 'css': _CSS, 'js': _JS, 'ampscript': _AMPSCRIPT,
                'validation_scope': 'complete', 'profile': 'standard', 'css_source_type': 'css',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        issues = response.json()['issues']
        self.assertTrue(issues)
        for issue in issues:
            self.assertIn('root_cause_id', issue)
            self.assertIsInstance(issue['root_cause_id'], str)  # never null/missing — always at least ''
        html_root_causes = {i['root_cause_id'] for i in issues if i['language'] == 'html' and i['root_cause_id']}
        self.assertEqual(len(html_root_causes), 1)  # the whole shell-corruption cascade shares one id
        # No grouping engine exists for css/js/ampscript yet — every
        # non-html issue (if any) must carry the empty default, never a
        # stray value borrowed from the html cascade.
        non_html_issues = [i for i in issues if i['language'] != 'html']
        for issue in non_html_issues:
            self.assertEqual(issue['root_cause_id'], '')

    def test_a_report_with_no_root_cause_grouping_at_all_still_serializes_cleanly(self):
        response = self.client.post(
            '/api/v1/lp/validate/',
            {'html': '<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><h1>Hi</h1></body></html>',
             'css': 'body { color: #333; }', 'validation_scope': 'complete'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        for issue in response.json()['issues']:
            self.assertEqual(issue['root_cause_id'], '')

    def test_each_individual_scope_also_validates_successfully(self):
        for scope, payload in [
            ('html', {'html': _HTML}),
            ('css', {'html': '', 'css': _CSS}),
            ('javascript', {'html': '', 'js': _JS}),
            ('ampscript', {'html': '', 'ampscript': _AMPSCRIPT}),
        ]:
            with self.subTest(scope=scope):
                response = self.client.post(
                    '/api/v1/lp/validate/', {**payload, 'validation_scope': scope}, format='json',
                )
                self.assertEqual(response.status_code, 201, response.content)
                self.assertIn('issues', response.json())
