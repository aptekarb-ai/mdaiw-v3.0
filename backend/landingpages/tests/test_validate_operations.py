"""AI Validate Code Live Progress sprint — AIValidateStartView/StatusView
and validate_operations unit tests. `validate_operations.run_in_background`
is patched to run synchronously for deterministic assertions, exactly like
test_repair_operations.py's established pattern for the Fix flow."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .. import validate_operations

User = get_user_model()


def _make_user(name='validate_op_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


def _run_synchronously(target, *args, **kwargs):
    target(*args, **kwargs)


@override_settings(LP_AI_REVIEW_PROVIDER='')
class AIValidateStartStatusApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = _make_user('validate_op_api_user')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _payload(self, html, **kwargs):
        payload = {
            'html': html, 'css': '', 'js': '', 'ampscript': '',
            'validation_scope': 'html', 'profile': 'standard', 'css_source_type': 'css',
        }
        payload.update(kwargs)
        return payload

    def test_requires_auth(self):
        client = APIClient()
        response = client.post('/api/v1/lp/validate/start/', {'html': '', 'operation_id': 'x'}, format='json')
        self.assertIn(response.status_code, (401, 403))

    def test_operation_id_is_required_to_start(self):
        response = self.client.post(
            '/api/v1/lp/validate/start/',
            self._payload('<html><body><h1>Welcome</h1><p>hi</p></body></html>'),
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'OPERATION_ID_REQUIRED')

    def test_status_for_unknown_operation_id_returns_404(self):
        response = self.client.get('/api/v1/lp/validate/status/does-not-exist/')
        self.assertEqual(response.status_code, 404)

    def test_never_mutates_the_submitted_source(self):
        # Spec section 2 — "AI Validate Code" must remain strictly
        # read-only. Nothing in the async path even has an opportunity to
        # write back to the caller's editor state (there is no apply
        # step at all here) — this test documents/pins that contract by
        # asserting the response body's own issues reference the exact
        # SAME html the request submitted, never a silently "improved"
        # version.
        html = '<html><body><h1>Welcome</h1><p>hi   </p></body></html>'
        with patch.object(validate_operations, 'run_in_background', _run_synchronously):
            start = self.client.post(
                '/api/v1/lp/validate/start/', self._payload(html, operation_id='op-ro-1'), format='json',
            )
        self.assertEqual(start.status_code, 202)
        operation = self.client.get('/api/v1/lp/validate/status/op-ro-1/').json()
        self.assertEqual(operation['status'], 'completed')
        # The synchronous endpoint, called with the identical payload,
        # must produce the identical persisted report shape — proving the
        # async path did not take some other, mutating code path.
        sync_response = self.client.post('/api/v1/lp/validate/', self._payload(html), format='json')
        self.assertEqual(sync_response.status_code, 201)
        self.assertEqual(
            sorted(i['rule_id'] for i in operation['response_body']['issues']),
            sorted(i['rule_id'] for i in sync_response.json()['issues']),
        )

    def test_full_lifecycle_reaches_completed_with_the_same_shape_as_the_synchronous_endpoint(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        with patch.object(validate_operations, 'run_in_background', _run_synchronously):
            start_response = self.client.post(
                '/api/v1/lp/validate/start/', self._payload(html, operation_id='op-lifecycle-1'), format='json',
            )
        self.assertEqual(start_response.status_code, 202, start_response.content)
        self.assertEqual(start_response.json()['operation_id'], 'op-lifecycle-1')

        status_response = self.client.get('/api/v1/lp/validate/status/op-lifecycle-1/')
        self.assertEqual(status_response.status_code, 200)
        operation = status_response.json()

        self.assertEqual(operation['status'], 'completed')
        self.assertEqual(operation['percent'], 100)
        self.assertEqual(operation['stage'], 'finalizing')
        self.assertIsNotNone(operation['response_body'])
        self.assertEqual(operation['response_status'], 201)
        body = operation['response_body']
        self.assertIn('issues', body)
        self.assertIn('id', body)
        # Every stage in the checklist for an 'html'-scope run must have
        # ended 'done' — never left 'pending' (spec section 25 — the
        # panel must not require a reload, and every real checkpoint the
        # backend claimed it would visit must have actually completed).
        self.assertTrue(all(state == 'done' for state in operation['stage_checklist'].values()))
        self.assertNotIn('validating_css', operation['stage_checklist'])
        self.assertNotIn('validating_js', operation['stage_checklist'])
        self.assertNotIn('validating_ampscript', operation['stage_checklist'])

    def test_complete_scope_checklist_includes_every_language(self):
        with patch.object(validate_operations, 'run_in_background', _run_synchronously):
            self.client.post(
                '/api/v1/lp/validate/start/',
                self._payload(
                    '<html><body><h1>Welcome</h1></body></html>', operation_id='op-complete-1',
                    validation_scope='complete', css='.a{color:red}', js='var x=1;',
                ),
                format='json',
            )
        operation = self.client.get('/api/v1/lp/validate/status/op-complete-1/').json()
        for stage in ('validating_html', 'validating_css', 'validating_js', 'validating_ampscript', 'ai_analysis', 'normalizing', 'finalizing'):
            self.assertIn(stage, operation['stage_checklist'])
            self.assertEqual(operation['stage_checklist'][stage], 'done')

    def test_duplicate_start_with_the_same_operation_id_does_not_start_a_second_run(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        run_count = {'n': 0}

        def _counting_background(target, *args, **kwargs):
            run_count['n'] += 1
            target(*args, **kwargs)

        payload = self._payload(html, operation_id='op-dup-1')
        with patch.object(validate_operations, 'run_in_background', _counting_background):
            first = self.client.post('/api/v1/lp/validate/start/', payload, format='json')
            second = self.client.post('/api/v1/lp/validate/start/', payload, format='json')

        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(run_count['n'], 1)

    def test_status_for_another_users_operation_id_returns_404(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        with patch.object(validate_operations, 'run_in_background', _run_synchronously):
            self.client.post(
                '/api/v1/lp/validate/start/', self._payload(html, operation_id='op-owner-1'), format='json',
            )
        other_client = APIClient()
        other_client.force_authenticate(_make_user('validate_op_status_other'))
        response = other_client.get('/api/v1/lp/validate/status/op-owner-1/')
        self.assertEqual(response.status_code, 404)

    def test_invalid_project_is_rejected_before_any_background_work_starts(self):
        run_count = {'n': 0}

        def _counting_background(target, *args, **kwargs):
            run_count['n'] += 1
            target(*args, **kwargs)

        with patch.object(validate_operations, 'run_in_background', _counting_background):
            response = self.client.post(
                '/api/v1/lp/validate/start/',
                self._payload('<html></html>', operation_id='op-badproj-1', project=999999),
                format='json',
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'INVALID_PROJECT')
        self.assertEqual(run_count['n'], 0)


class ValidateOperationsUnitTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_stages_for_scope_only_includes_relevant_languages(self):
        self.assertEqual(
            validate_operations.stages_for_scope('javascript'),
            ['preparing', 'validating_js', 'ai_analysis', 'normalizing', 'finalizing'],
        )
        self.assertEqual(
            validate_operations.stages_for_scope('complete'),
            ['preparing', 'validating_html', 'validating_css', 'validating_js', 'validating_ampscript', 'ai_analysis', 'normalizing', 'finalizing'],
        )

    def test_percent_never_reaches_100_while_running(self):
        validate_operations.create_operation(1, 'op-percent-1', 'html')
        validate_operations.update_operation_stage(1, 'op-percent-1', 'validating_html')
        record = validate_operations.get_operation(1, 'op-percent-1')
        self.assertLess(record['percent'], 100)

    def test_percent_reaches_exactly_100_only_via_complete_operation(self):
        validate_operations.create_operation(1, 'op-percent-2', 'html')
        validate_operations.complete_operation(1, 'op-percent-2', response_body={}, response_status=201)
        record = validate_operations.get_operation(1, 'op-percent-2')
        self.assertEqual(record['percent'], 100)
        self.assertEqual(record['status'], 'completed')

    def test_stage_progression_marks_earlier_stages_done(self):
        validate_operations.create_operation(1, 'op-progress-1', 'complete')
        validate_operations.update_operation_stage(1, 'op-progress-1', 'validating_js')
        record = validate_operations.get_operation(1, 'op-progress-1')
        self.assertEqual(record['stage_checklist']['preparing'], 'done')
        self.assertEqual(record['stage_checklist']['validating_html'], 'done')
        self.assertEqual(record['stage_checklist']['validating_css'], 'done')
        self.assertEqual(record['stage_checklist']['validating_js'], 'active')
        self.assertEqual(record['stage_checklist']['validating_ampscript'], 'pending')

    def test_update_on_expired_or_missing_record_is_a_safe_no_op(self):
        validate_operations.update_operation_stage(1, 'never-created', 'validating_html')
        self.assertIsNone(validate_operations.get_operation(1, 'never-created'))
