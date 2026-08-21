"""Deterministic Apply Safe Fixes engine tests — Module 3 LP Validator &
Fixer. Two layers: `PureEngineTests` exercises fixes/__init__.py's
conflict-detection and reverse-offset apply as plain functions (fastest,
most direct way to prove the ordering/verification/rollback mechanics);
everything else drives the real /fixes/preview/ and /fixes/apply/
endpoints against a report produced by the real /validate/ endpoint, so
every fingerprint/offset is genuine, never hand-crafted.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from ..fixes import apply_patches_to_source, detect_conflicts
from ..fixes.catalogue import Patch
from ..models import LandingPageProject, ValidationReport


def _patch(fix_id, file, start, end, original, replacement):
    return Patch(
        fix_id=fix_id, issue_id=1, fingerprint='fp', language='html', source_context='',
        file=file, start_offset=start, end_offset=end, start_line=1, start_column=start + 1,
        end_line=1, end_column=end + 1, original_text=original, replacement_text=replacement,
        description='', risk='low', confidence='definite',
    )


class PureEngineTests(TestCase):
    def test_reverse_offset_application_order(self):
        source = 'AAAA BBBB CCCC'
        patches = [
            _patch('1', 'html', 0, 4, 'AAAA', 'X'),
            _patch('2', 'html', 10, 14, 'CCCC', 'Y'),
        ]
        result, results = apply_patches_to_source(source, patches)
        self.assertEqual(result, 'X BBBB Y')
        self.assertTrue(all(r.status == 'applied' for r in results))

    def test_original_text_mismatch_fails_whole_source(self):
        source = 'AAAA BBBB'
        patches = [_patch('1', 'html', 0, 4, 'ZZZZ', 'X')]  # wrong original_text
        result, results = apply_patches_to_source(source, patches)
        self.assertIsNone(result)
        self.assertEqual(results[0].status, 'failed')

    def test_one_bad_patch_rolls_back_the_whole_source_not_just_itself(self):
        source = 'AAAA BBBB'
        patches = [
            _patch('1', 'html', 5, 9, 'BBBB', 'X'),  # valid
            _patch('2', 'html', 0, 4, 'ZZZZ', 'Y'),  # invalid original_text
        ]
        result, results = apply_patches_to_source(source, patches)
        self.assertIsNone(result)
        self.assertTrue(all(r.status == 'failed' for r in results))

    def test_overlap_conflict_detected(self):
        patches = [
            _patch('1', 'html', 0, 5, 'AAAAA', 'X'),
            _patch('2', 'html', 3, 8, 'AABBB', 'Y'),
        ]
        conflicts = detect_conflicts(patches)
        self.assertEqual(conflicts, {'1', '2'})

    def test_same_range_different_replacement_is_conflict(self):
        patches = [
            _patch('1', 'html', 5, 5, '', 'X'),
            _patch('2', 'html', 5, 5, '', 'Y'),
        ]
        conflicts = detect_conflicts(patches)
        self.assertEqual(conflicts, {'1', '2'})

    def test_non_overlapping_patches_in_different_files_never_conflict(self):
        patches = [
            _patch('1', 'html', 0, 4, 'AAAA', 'X'),
            _patch('2', 'css', 0, 4, 'AAAA', 'X'),
        ]
        self.assertEqual(detect_conflicts(patches), set())

    def test_adjacent_non_overlapping_patches_are_not_conflicts(self):
        patches = [
            _patch('1', 'html', 0, 4, 'AAAA', 'X'),
            _patch('2', 'html', 4, 8, ' BBB', 'Y'),
        ]
        self.assertEqual(detect_conflicts(patches), set())


class FixEngineApiTestCase(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='alice', password='pw12345!', email='alice@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _validate(self, **kwargs):
        payload = {
            'html': '', 'css': '', 'js': '', 'ampscript': '',
            'validation_scope': 'complete', 'profile': 'standard', 'css_source_type': 'css',
        }
        payload.update(kwargs)
        response = self.client.post('/api/v1/lp/validate/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def _issue_ids(self, report_json, rule_id):
        return [issue['id'] for issue in report_json['issues'] if issue['rule_id'] == rule_id]

    def _fix_payload(self, report_json, issue_ids, **overrides):
        payload = {
            'report': report_json['id'], 'issue_ids': issue_ids,
            'html': '', 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': report_json['css_source_type'],
            'validation_scope': report_json['validation_scope'],
            'profile': report_json['profile'],
        }
        payload.update(overrides)
        return payload

    def preview(self, **kwargs):
        return self.client.post('/api/v1/lp/fixes/preview/', kwargs, format='json')

    def apply(self, **kwargs):
        return self.client.post('/api/v1/lp/fixes/apply/', kwargs, format='json')


class AuthAndOwnershipTests(FixEngineApiTestCase):
    def test_preview_requires_auth(self):
        client = APIClient()
        response = client.post('/api/v1/lp/fixes/preview/', {'report': 1, 'issue_ids': [1], 'html': ''}, format='json')
        self.assertIn(response.status_code, (401, 403))

    def test_apply_requires_auth(self):
        client = APIClient()
        response = client.post('/api/v1/lp/fixes/apply/', {'report': 1, 'issue_ids': [1], 'html': ''}, format='json')
        self.assertIn(response.status_code, (401, 403))

    def test_cross_user_report_returns_404_on_preview(self):
        report = self._validate(html='<html><body></body></html>', validation_scope='html')
        other = get_user_model().objects.create_user(username='bob', password='pw12345!', email='bob@example.com')
        other_client = APIClient()
        other_client.force_authenticate(other)
        response = other_client.post(
            '/api/v1/lp/fixes/preview/',
            self._fix_payload(report, [report['issues'][0]['id']] if report['issues'] else [1]),
            format='json',
        )
        self.assertEqual(response.status_code, 404)

    def test_cross_user_report_returns_404_on_apply(self):
        report = self._validate(html='<html><body></body></html>', validation_scope='html')
        other = get_user_model().objects.create_user(username='carol', password='pw12345!', email='carol@example.com')
        other_client = APIClient()
        other_client.force_authenticate(other)
        response = other_client.post(
            '/api/v1/lp/fixes/apply/',
            self._fix_payload(report, [report['issues'][0]['id']] if report['issues'] else [1]),
            format='json',
        )
        self.assertEqual(response.status_code, 404)


class SafeHtmlFixTests(FixEngineApiTestCase):
    def test_safe_doctype_patch(self):
        html = '<html><head><title>T</title></head><body></body></html>'
        report = self._validate(html=html, validation_scope='html')
        issue_ids = self._issue_ids(report, 'missing-doctype')
        self.assertEqual(len(issue_ids), 1)

        preview = self.preview(**self._fix_payload(report, issue_ids, html=html))
        self.assertEqual(preview.status_code, 200, preview.content)
        patches = preview.json()['patches']
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0]['status'], 'safe')
        self.assertEqual(patches[0]['replacement_text'], '<!DOCTYPE html>\n')

        applied = self.apply(**self._fix_payload(report, issue_ids, html=html))
        self.assertEqual(applied.status_code, 200, applied.content)
        body = applied.json()
        self.assertEqual(body['results'][0]['status'], 'applied')
        self.assertTrue(body['proposed_sources']['html'].startswith('<!DOCTYPE html>\n'))

    def test_safe_html_closing_tag_patch(self):
        html = '<section>\n<h1>Hello\n</section>'
        report = self._validate(html=html, validation_scope='html')
        issue_ids = self._issue_ids(report, 'unclosed-tag')
        self.assertEqual(len(issue_ids), 1, report['issues'])

        applied = self.apply(**self._fix_payload(report, issue_ids, html=html))
        self.assertEqual(applied.status_code, 200, applied.content)
        new_html = applied.json()['proposed_sources']['html']
        self.assertIn('</h1>', new_html)
        self.assertLess(new_html.index('</h1>'), new_html.index('</section>'))

    def test_safe_charset_and_viewport_are_flagged_as_conflicting_when_selected_together(self):
        html = '<html><head><title>T</title></head><body></body></html>'
        report = self._validate(html=html, validation_scope='html')
        charset_ids = self._issue_ids(report, 'missing-charset')
        viewport_ids = self._issue_ids(report, 'missing-viewport')
        issue_ids = charset_ids + viewport_ids
        self.assertEqual(len(issue_ids), 2)

        preview = self.preview(**self._fix_payload(report, issue_ids, html=html))
        self.assertEqual(preview.status_code, 200, preview.content)
        body = preview.json()
        self.assertEqual(len(body['conflicts']), 2)
        self.assertTrue(all(p['status'] == 'conflict' for p in body['patches']))

    def test_charset_alone_applies_cleanly(self):
        html = '<html><head><title>T</title></head><body></body></html>'
        report = self._validate(html=html, validation_scope='html')
        issue_ids = self._issue_ids(report, 'missing-charset')
        applied = self.apply(**self._fix_payload(report, issue_ids, html=html))
        self.assertEqual(applied.status_code, 200, applied.content)
        new_html = applied.json()['proposed_sources']['html']
        self.assertIn('<meta charset="utf-8">', new_html)


class SafeCssFixTests(FixEngineApiTestCase):
    def test_safe_css_zero_unit_patch(self):
        css = '.card {\n  margin: 0px;\n}\n'
        report = self._validate(html='', css=css, validation_scope='css', css_source_type='css')
        issue_ids = self._issue_ids(report, 'stylelint:length-zero-no-unit')
        self.assertEqual(len(issue_ids), 1, report['issues'])

        applied = self.apply(**self._fix_payload(report, issue_ids, css=css))
        self.assertEqual(applied.status_code, 200, applied.content)
        new_css = applied.json()['proposed_sources']['css']
        self.assertIn('margin: 0;', new_css)
        self.assertNotIn('0px', new_css)

    def test_safe_scss_original_source_patch(self):
        scss = '$brand: red;\n.card {\n  margin: 0px;\n  color: $brand;\n}\n'
        report = self._validate(html='', css=scss, validation_scope='css', css_source_type='scss')
        issue_ids = self._issue_ids(report, 'stylelint:length-zero-no-unit')
        self.assertEqual(len(issue_ids), 1, report['issues'])

        applied = self.apply(**self._fix_payload(report, issue_ids, css=scss))
        self.assertEqual(applied.status_code, 200, applied.content)
        new_css = applied.json()['proposed_sources']['css']
        self.assertIn('margin: 0;', new_css)
        self.assertIn('$brand: red;', new_css)  # original SCSS source, not generated CSS

    def test_safe_sass_original_source_patch(self):
        sass = '.card\n  margin: 0px\n'
        report = self._validate(html='', css=sass, validation_scope='css', css_source_type='sass')
        issue_ids = self._issue_ids(report, 'stylelint:length-zero-no-unit')
        self.assertEqual(len(issue_ids), 1, report['issues'])

        applied = self.apply(**self._fix_payload(report, issue_ids, css=sass))
        self.assertEqual(applied.status_code, 200, applied.content)
        new_css = applied.json()['proposed_sources']['css']
        self.assertIn('margin: 0', new_css)
        self.assertNotIn('0px', new_css)

    def test_safe_less_original_source_patch(self):
        less = '@brand: red;\n.card {\n  margin: 0px;\n  color: @brand;\n}\n'
        report = self._validate(html='', css=less, validation_scope='css', css_source_type='less')
        issue_ids = self._issue_ids(report, 'stylelint:length-zero-no-unit')
        self.assertEqual(len(issue_ids), 1, report['issues'])

        applied = self.apply(**self._fix_payload(report, issue_ids, css=less))
        self.assertEqual(applied.status_code, 200, applied.content)
        new_css = applied.json()['proposed_sources']['css']
        self.assertIn('margin: 0;', new_css)
        self.assertIn('@brand: red;', new_css)

    def test_embedded_style_block_patch_changes_html_not_css_tab(self):
        html = '<html><head><style>.a { margin: 0px; }</style></head><body></body></html>'
        report = self._validate(html=html, validation_scope='html')
        issue_ids = self._issue_ids(report, 'stylelint:length-zero-no-unit')
        self.assertEqual(len(issue_ids), 1, report['issues'])

        applied = self.apply(**self._fix_payload(report, issue_ids, html=html))
        self.assertEqual(applied.status_code, 200, applied.content)
        body = applied.json()
        self.assertIn('html', body['proposed_sources'])
        self.assertNotIn('css', body['proposed_sources'])
        self.assertIn('margin: 0;', body['proposed_sources']['html'])


class SafeAmpscriptFixTests(FixEngineApiTestCase):
    def test_safe_ampscript_endif_patch(self):
        ampscript = '%%[\nIF @member == true THEN\n  SET @message = "Welcome"\n]%%'
        report = self._validate(html='', ampscript=ampscript, validation_scope='ampscript')
        issue_ids = self._issue_ids(report, 'ampscript:if-without-endif')
        self.assertEqual(len(issue_ids), 1, report['issues'])

        applied = self.apply(**self._fix_payload(report, issue_ids, ampscript=ampscript))
        self.assertEqual(applied.status_code, 200, applied.content)
        new_ampscript = applied.json()['proposed_sources']['ampscript']
        self.assertIn('ENDIF\n]%%', new_ampscript)

    def test_ambiguous_nested_unclosed_ampscript_is_not_auto_fixed(self):
        ampscript = '%%[\nFOR @i = 1 TO 3 DO\n  IF @i == 1 THEN\n    SET @x = 1\n]%%'
        report = self._validate(html='', ampscript=ampscript, validation_scope='ampscript')
        issue_ids = self._issue_ids(report, 'ampscript:if-without-endif')
        self.assertEqual(len(issue_ids), 1, report['issues'])

        preview = self.preview(**self._fix_payload(report, issue_ids, ampscript=ampscript))
        self.assertEqual(preview.status_code, 200, preview.content)
        body = preview.json()
        self.assertEqual(body['patches'], [])
        self.assertEqual(body['review_required'], issue_ids)


class MultiPatchAndOrderingTests(FixEngineApiTestCase):
    def test_multiple_non_overlapping_patches_across_files_all_applied(self):
        html = '<html><head><title>T</title></head><body></body></html>'
        css = '.card {\n  margin: 0px;\n}\n'
        report = self._validate(html=html, css=css, validation_scope='complete')
        doctype_ids = self._issue_ids(report, 'missing-doctype')
        zero_unit_ids = self._issue_ids(report, 'stylelint:length-zero-no-unit')
        issue_ids = doctype_ids + zero_unit_ids
        self.assertEqual(len(issue_ids), 2, report['issues'])

        applied = self.apply(**self._fix_payload(report, issue_ids, html=html, css=css))
        self.assertEqual(applied.status_code, 200, applied.content)
        body = applied.json()
        self.assertTrue(body['proposed_sources']['html'].startswith('<!DOCTYPE html>\n'))
        self.assertIn('margin: 0;', body['proposed_sources']['css'])
        self.assertTrue(all(r['status'] == 'applied' for r in body['results']))

    def test_patch_application_is_order_independent_in_the_request(self):
        css = '.a {\n  margin: 0px;\n}\n.b {\n  padding: 0em;\n}\n'
        report = self._validate(html='', css=css, validation_scope='css')
        issue_ids = self._issue_ids(report, 'stylelint:length-zero-no-unit')
        self.assertEqual(len(issue_ids), 2, report['issues'])

        applied = self.apply(**self._fix_payload(report, list(reversed(issue_ids)), css=css))
        self.assertEqual(applied.status_code, 200, applied.content)
        new_css = applied.json()['proposed_sources']['css']
        self.assertIn('margin: 0;', new_css)
        self.assertIn('padding: 0;', new_css)


class StaleAndFailureTests(FixEngineApiTestCase):
    def test_scope_mismatch_rejected(self):
        html = '<html><head><title>T</title></head><body></body></html>'
        report = self._validate(html=html, validation_scope='html')
        response = self.preview(**self._fix_payload(report, [1], html=html, validation_scope='complete'))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'REPORT_STALE')

    def test_profile_mismatch_rejected(self):
        html = '<html><head><title>T</title></head><body></body></html>'
        report = self._validate(html=html, validation_scope='html', profile='standard')
        response = self.preview(**self._fix_payload(report, [1], html=html, profile='strict'))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'REPORT_STALE')

    def test_css_source_type_mismatch_rejected(self):
        css = '.a { margin: 0px; }'
        report = self._validate(html='', css=css, validation_scope='css', css_source_type='css')
        response = self.preview(**self._fix_payload(report, [1], css=css, css_source_type='scss'))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'REPORT_STALE')

    def test_edited_source_issue_no_longer_reproduces_goes_to_review_required(self):
        css = '.card {\n  margin: 0px;\n}\n'
        report = self._validate(html='', css=css, validation_scope='css')
        issue_ids = self._issue_ids(report, 'stylelint:length-zero-no-unit')

        edited_css = '.card {\n  margin: 4px;\n}\n'  # 0px no longer present
        preview = self.preview(**self._fix_payload(report, issue_ids, css=edited_css))
        self.assertEqual(preview.status_code, 200, preview.content)
        body = preview.json()
        self.assertEqual(body['patches'], [])
        self.assertEqual(body['review_required'], issue_ids)

    def test_truncated_report_rejected(self):
        report_row = ValidationReport.objects.create(
            user=self.user, engine_status=[{'engine_name': 'input-limits', 'success': True,
                                             'duration_ms': 0, 'issue_count': 0, 'message': 'truncated'}],
        )
        response = self.preview(report=report_row.id, issue_ids=[1], html='', css='', js='', ampscript='')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'REPORT_TRUNCATED')

    def test_failed_compiler_engine_rejects_the_whole_request(self):
        # A user syntax error inside valid SCSS (e.g. an undefined
        # variable) still leaves engine_status success=True — the
        # *compiler itself* ran fine, it just reported an issue. Only a
        # genuine engine-level failure (missing package, crash, timeout)
        # sets success=False, so that is what REPORT_ENGINE_FAILED must
        # actually gate on — simulated directly here rather than hunting
        # for SCSS input that reliably crashes the real compiler.
        report_row = ValidationReport.objects.create(
            user=self.user, css_source_type='scss', validation_scope='css', profile='standard',
            engine_status=[{'engine_name': 'scss-compiler', 'success': False,
                             'duration_ms': 5, 'issue_count': 0, 'message': 'SCSS compilation engine is not installed.'}],
        )
        response = self.preview(
            report=report_row.id, issue_ids=[1], html='', css='.a { margin: 0px; }', js='', ampscript='',
            css_source_type='scss', validation_scope='css', profile='standard',
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'REPORT_ENGINE_FAILED')

    def test_not_found_issue_id_reported_not_silently_dropped(self):
        html = '<html><head><title>T</title></head><body></body></html>'
        report = self._validate(html=html, validation_scope='html')
        response = self.preview(**self._fix_payload(report, [999999], html=html))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['not_found'], [999999])


class InputLimitTests(FixEngineApiTestCase):
    def test_oversized_source_rejected(self):
        response = self.preview(
            report=1, issue_ids=[1], html='a' * 200_001, css='', js='', ampscript='',
        )
        self.assertEqual(response.status_code, 400)

    def test_too_many_issue_ids_rejected(self):
        response = self.preview(
            report=1, issue_ids=list(range(101)), html='', css='', js='', ampscript='',
        )
        self.assertEqual(response.status_code, 400)

    def test_empty_issue_ids_rejected(self):
        response = self.preview(report=1, issue_ids=[], html='', css='', js='', ampscript='')
        self.assertEqual(response.status_code, 400)


class NoArbitraryClientPatchTests(FixEngineApiTestCase):
    def test_client_supplied_replacement_text_is_ignored(self):
        html = '<html><head><title>T</title></head><body></body></html>'
        report = self._validate(html=html, validation_scope='html')
        issue_ids = self._issue_ids(report, 'missing-doctype')

        payload = self._fix_payload(report, issue_ids, html=html)
        # FixRequestSerializer has no field for a client-supplied patch —
        # this extra, malicious-looking key is simply not part of the
        # input contract and must have zero effect on the server's output.
        payload['patches'] = [{
            'fix_id': 'attacker', 'issue_id': issue_ids[0], 'start_offset': 0, 'end_offset': 0,
            'original_text': '', 'replacement_text': '<script>alert(1)</script>',
        }]
        response = self.apply(**payload)
        self.assertEqual(response.status_code, 200, response.content)
        new_html = response.json()['proposed_sources']['html']
        self.assertNotIn('<script>alert(1)</script>', new_html)
        self.assertTrue(new_html.startswith('<!DOCTYPE html>\n'))


class RevalidationContractTests(FixEngineApiTestCase):
    def test_applied_fix_output_revalidates_clean_for_that_rule(self):
        html = '<html><head><title>T</title></head><body></body></html>'
        report = self._validate(html=html, validation_scope='html')
        issue_ids = self._issue_ids(report, 'missing-doctype')

        applied = self.apply(**self._fix_payload(report, issue_ids, html=html))
        new_html = applied.json()['proposed_sources']['html']

        revalidated = self._validate(html=new_html, validation_scope='html')
        self.assertEqual(self._issue_ids(revalidated, 'missing-doctype'), [])
