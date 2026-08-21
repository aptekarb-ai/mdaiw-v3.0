"""Real-Time Progress UX sprint — AIFixIssuesStartView/StatusView tests.
`repair_operations.run_in_background` is patched to run the target
callable SYNCHRONOUSLY (no real thread) for deterministic assertions —
these tests verify the operation record's DATA correctness (lifecycle,
idempotency, percentage, final-body shape), not real concurrency timing,
which is exercised separately by the live-verification pass.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .. import repair_operations

User = get_user_model()


def _make_user(name='op_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


def _run_synchronously(target, *args, **kwargs):
    target(*args, **kwargs)


@override_settings(LP_AI_REVIEW_PROVIDER='')
class AIFixIssuesStartStatusApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = _make_user('op_api_user')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _validate(self, html, **kwargs):
        payload = {
            'html': html, 'css': '', 'js': '', 'ampscript': '',
            'validation_scope': 'html', 'profile': 'standard', 'css_source_type': 'css',
        }
        payload.update(kwargs)
        response = self.client.post('/api/v1/lp/validate/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_requires_auth(self):
        client = APIClient()
        response = client.post('/api/v1/lp/ai-fix/start/', {'report': 1, 'html': '', 'operation_id': 'x'}, format='json')
        self.assertIn(response.status_code, (401, 403))

    def test_operation_id_is_required_to_start(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)
        response = self.client.post('/api/v1/lp/ai-fix/start/', {
            'report': report_json['id'], 'html': html, 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'OPERATION_ID_REQUIRED')

    def test_status_for_unknown_operation_id_returns_404(self):
        response = self.client.get('/api/v1/lp/ai-fix/status/does-not-exist/')
        self.assertEqual(response.status_code, 404)

    def test_full_lifecycle_reaches_completed_with_the_same_shape_as_the_synchronous_endpoint(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)

        with patch.object(repair_operations, 'run_in_background', _run_synchronously):
            start_response = self.client.post('/api/v1/lp/ai-fix/start/', {
                'report': report_json['id'], 'operation_id': 'op-lifecycle-1',
                'html': html, 'css': '', 'js': '', 'ampscript': '',
                'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
            }, format='json')

        self.assertEqual(start_response.status_code, 202, start_response.content)
        self.assertEqual(start_response.json()['operation_id'], 'op-lifecycle-1')

        status_response = self.client.get('/api/v1/lp/ai-fix/status/op-lifecycle-1/')
        self.assertEqual(status_response.status_code, 200)
        operation = status_response.json()

        self.assertEqual(operation['status'], 'completed')
        self.assertEqual(operation['percent'], 100)
        self.assertEqual(operation['stage'], 'finalizing')
        self.assertIsNotNone(operation['response_body'])
        self.assertEqual(operation['response_status'], 201)
        # Same authoritative shape the synchronous endpoint returns.
        body = operation['response_body']
        self.assertIn('final_sources', body)
        self.assertIn('fix_metrics', body)
        self.assertGreaterEqual(body['fix_metrics']['fixes_applied'], 1)
        self.assertNotIn('missing-doctype', [i['rule_id'] for i in body['issues']])
        # Percent must never claim 100 for anything but the true final
        # state — every intermediate write this run made must have used
        # compute_percent's capped range.
        self.assertLessEqual(operation['issues_remaining'], operation['issues_initial'])
        # Per-card status is keyed by stable fingerprint, never a DB id —
        # DB ids are fresh on every persist_validation_report() call, so
        # a card keyed by id would silently lose its identity across a
        # revalidation.
        self.assertIn('issue_updates', operation)
        for fingerprint, card_status in operation['issue_updates'].items():
            self.assertIsInstance(fingerprint, str)
            self.assertNotEqual(fingerprint, '')
            self.assertIn(
                card_status,
                {'pending', 'fixing', 'revalidating', 'resolved', 'requires_input', 'newly_exposed', 'failed'},
            )

    def test_duplicate_start_with_the_same_operation_id_does_not_start_a_second_run(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)
        run_count = {'n': 0}

        def _counting_background(target, *args, **kwargs):
            run_count['n'] += 1
            target(*args, **kwargs)

        payload = {
            'report': report_json['id'], 'operation_id': 'op-dup-1',
            'html': html, 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
        }
        with patch.object(repair_operations, 'run_in_background', _counting_background):
            first = self.client.post('/api/v1/lp/ai-fix/start/', payload, format='json')
            second = self.client.post('/api/v1/lp/ai-fix/start/', payload, format='json')

        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(run_count['n'], 1)

    def test_cross_user_report_returns_404(self):
        report_json = self._validate('<html><body><h1>Welcome</h1><p>hi</p></body></html>')
        other_client = APIClient()
        other_client.force_authenticate(_make_user('op_other_user'))
        response = other_client.post('/api/v1/lp/ai-fix/start/', {
            'report': report_json['id'], 'operation_id': 'op-cross-1',
            'html': '<html><body><h1>Welcome</h1><p>hi</p></body></html>', 'css': '', 'js': '', 'ampscript': '',
            'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
        }, format='json')
        self.assertEqual(response.status_code, 404)

    def test_status_for_another_users_operation_id_returns_404(self):
        html = '<html><body><h1>Welcome</h1><p>hi</p></body></html>'
        report_json = self._validate(html)
        with patch.object(repair_operations, 'run_in_background', _run_synchronously):
            self.client.post('/api/v1/lp/ai-fix/start/', {
                'report': report_json['id'], 'operation_id': 'op-owner-1',
                'html': html, 'css': '', 'js': '', 'ampscript': '',
                'css_source_type': 'css', 'validation_scope': 'html', 'profile': 'standard',
            }, format='json')

        other_client = APIClient()
        other_client.force_authenticate(_make_user('op_status_other'))
        response = other_client.get('/api/v1/lp/ai-fix/status/op-owner-1/')
        self.assertEqual(response.status_code, 404)


class RepairOperationsUnitTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_compute_percent_never_reaches_100_while_running(self):
        self.assertEqual(repair_operations.compute_percent(10, 10), 0)
        self.assertEqual(repair_operations.compute_percent(10, 5), 50)
        self.assertLessEqual(repair_operations.compute_percent(10, 0), 95)

    def test_compute_percent_handles_zero_initial_without_dividing_by_zero(self):
        self.assertEqual(repair_operations.compute_percent(0, 0), 0)

    def test_update_operation_on_expired_or_missing_record_is_a_safe_no_op(self):
        # No create_operation call first — the record was never created
        # (or already expired past its TTL). Must not raise.
        repair_operations.update_operation(1, 'never-created', status='completed')
        self.assertIsNone(repair_operations.get_operation(1, 'never-created'))

    def test_create_then_update_preserves_untouched_fields(self):
        repair_operations.create_operation(7, 'op-unit-1', issues_initial=5)
        repair_operations.update_operation(7, 'op-unit-1', percent=40)
        record = repair_operations.get_operation(7, 'op-unit-1')
        self.assertEqual(record['percent'], 40)
        self.assertEqual(record['issues_initial'], 5)
        self.assertEqual(record['status'], 'running')

    def test_create_operation_initializes_an_empty_issue_updates_map(self):
        record = repair_operations.create_operation(7, 'op-unit-2', issues_initial=3)
        self.assertEqual(record['issue_updates'], {})

    def test_update_operation_merges_issue_updates_rather_than_overwriting(self):
        repair_operations.create_operation(7, 'op-unit-3', issues_initial=3)
        repair_operations.update_operation(7, 'op-unit-3', issue_updates={'fp-a': 'pending', 'fp-b': 'pending'})
        repair_operations.update_operation(7, 'op-unit-3', issue_updates={'fp-a': 'fixing'})
        record = repair_operations.get_operation(7, 'op-unit-3')
        # fp-a's status was overwritten by the newer round, but fp-b's
        # earlier status must survive — a later, smaller emit must not
        # wipe out fingerprints it didn't mention.
        self.assertEqual(record['issue_updates'], {'fp-a': 'fixing', 'fp-b': 'pending'})

    def test_update_operation_without_issue_updates_leaves_existing_map_untouched(self):
        repair_operations.create_operation(7, 'op-unit-4', issues_initial=3)
        repair_operations.update_operation(7, 'op-unit-4', issue_updates={'fp-a': 'pending'})
        repair_operations.update_operation(7, 'op-unit-4', percent=50)
        record = repair_operations.get_operation(7, 'op-unit-4')
        self.assertEqual(record['issue_updates'], {'fp-a': 'pending'})
        self.assertEqual(record['percent'], 50)
