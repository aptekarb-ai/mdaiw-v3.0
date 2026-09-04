"""D4-E0 — tests for local_ai_diagnostics.py and its endpoint.

Covers: model-capability inference (data-driven, never a network call),
the health-check function (configured/unconfigured, reachable/
unreachable, model-list matching — all via an injected fake HTTP call,
never a real network request), the full diagnostics payload's shape and
secret-non-leakage, and the endpoint (auth required, never 500s even on
an internal failure)."""

import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings

from . import local_ai_diagnostics as diagnostics


class ModelCapabilityInferenceTests(SimpleTestCase):
    def test_known_model_family_matches(self):
        profile = diagnostics.infer_model_capabilities('llama3.1:8b-instruct')
        self.assertTrue(profile['tool_calling'])
        self.assertEqual(profile['context_window'], 128000)

    def test_more_specific_entry_wins_over_generic_one(self):
        # "llama3.2-vision" must match its OWN entry (vision=True), not
        # fall through to the more generic "llama3.2" entry (vision=False).
        profile = diagnostics.infer_model_capabilities('llama3.2-vision:11b')
        self.assertTrue(profile['vision'])

    def test_unrecognized_model_gets_honest_unknown_profile(self):
        profile = diagnostics.infer_model_capabilities('some-experimental-finetune-v7')
        self.assertTrue(profile['natural_language'])
        self.assertEqual(profile['multilingual'], 'unknown')
        self.assertEqual(profile['vision'], 'unknown')
        # structured_output stays an honest True default — see module
        # docstring: a server that can't honor json_schema fails the call
        # outright rather than silently mismatching.
        self.assertTrue(profile['structured_output'])

    def test_non_string_model_name_never_raises(self):
        profile = diagnostics.infer_model_capabilities(None)
        self.assertEqual(profile, diagnostics._UNKNOWN_MODEL_PROFILE)

    def test_returned_profile_is_a_fresh_dict_never_a_shared_reference(self):
        first = diagnostics.infer_model_capabilities('mistral:7b')
        first['tool_calling'] = 'MUTATED'
        second = diagnostics.infer_model_capabilities('mistral:7b')
        self.assertNotEqual(second['tool_calling'], 'MUTATED')


class HealthCheckTests(SimpleTestCase):
    def test_unconfigured_reports_not_configured_never_raises(self):
        result = diagnostics.check_local_ai_health(base_url='', model='', api_key='', timeout=1)
        self.assertEqual(result, {
            'configured': False, 'reachable': False, 'configured_model_available': None,
            'available_models': [], 'error': None,
        })

    def test_unreachable_server_degrades_safely_never_raises(self):
        with patch.object(diagnostics, '_http_get_json', side_effect=ConnectionError('refused')):
            result = diagnostics.check_local_ai_health(base_url='http://localhost:11434/v1', model='llama3.1', timeout=1)
        self.assertTrue(result['configured'])
        self.assertFalse(result['reachable'])
        self.assertEqual(result['error'], 'unreachable')
        self.assertEqual(result['available_models'], [])
        # Never leaks the raw exception message/type into the response.
        self.assertNotIn('refused', json.dumps(result))

    def test_reachable_with_configured_model_present(self):
        payload = {'data': [{'id': 'llama3.1:8b'}, {'id': 'qwen2.5:7b'}]}
        with patch.object(diagnostics, '_http_get_json', return_value=payload):
            result = diagnostics.check_local_ai_health(base_url='http://localhost:11434/v1', model='llama3.1:8b', timeout=1)
        self.assertTrue(result['reachable'])
        self.assertTrue(result['configured_model_available'])
        self.assertEqual(result['available_models'], ['llama3.1:8b', 'qwen2.5:7b'])

    def test_reachable_but_configured_model_not_present(self):
        payload = {'data': [{'id': 'qwen2.5:7b'}]}
        with patch.object(diagnostics, '_http_get_json', return_value=payload):
            result = diagnostics.check_local_ai_health(base_url='http://localhost:11434/v1', model='llama3.1:8b', timeout=1)
        self.assertTrue(result['reachable'])
        self.assertFalse(result['configured_model_available'])

    def test_malformed_models_payload_never_raises(self):
        with patch.object(diagnostics, '_http_get_json', return_value={'unexpected': 'shape'}):
            result = diagnostics.check_local_ai_health(base_url='http://localhost:11434/v1', model='llama3.1', timeout=1)
        self.assertTrue(result['reachable'])
        self.assertEqual(result['available_models'], [])
        self.assertIsNone(result['configured_model_available'])

    def test_model_list_is_capped(self):
        payload = {'data': [{'id': f'model-{i}'} for i in range(50)]}
        with patch.object(diagnostics, '_http_get_json', return_value=payload):
            result = diagnostics.check_local_ai_health(base_url='http://localhost:11434/v1', model='model-0', timeout=1)
        self.assertLessEqual(len(result['available_models']), diagnostics._MAX_LISTED_MODELS)


@override_settings(
    EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1:8b',
    EMAILBUILDER_LOCAL_AI_API_KEY='super-secret-value-never-returned', EMAILBUILDER_LOCAL_AI_RUNTIME='ollama',
)
class FullDiagnosticsPayloadTests(SimpleTestCase):
    def test_never_exposes_the_api_key_value(self):
        with patch.object(diagnostics, 'check_local_ai_health', return_value={
            'configured': True, 'reachable': True, 'configured_model_available': True,
            'available_models': ['llama3.1:8b'], 'error': None,
        }):
            result = diagnostics.get_local_ai_diagnostics()
        self.assertNotIn('super-secret-value-never-returned', json.dumps(result))
        self.assertTrue(result['api_key_configured'])

    def test_deterministic_fallback_always_ready(self):
        with patch.object(diagnostics, 'check_local_ai_health', return_value={
            'configured': False, 'reachable': False, 'configured_model_available': None,
            'available_models': [], 'error': None,
        }):
            result = diagnostics.get_local_ai_diagnostics()
        self.assertTrue(result['deterministic_fallback_ready'])

    def test_includes_runtime_and_capability_profile(self):
        with patch.object(diagnostics, 'check_local_ai_health', return_value={
            'configured': True, 'reachable': True, 'configured_model_available': True,
            'available_models': ['llama3.1:8b'], 'error': None,
        }):
            result = diagnostics.get_local_ai_diagnostics()
        self.assertEqual(result['runtime'], 'ollama')
        self.assertEqual(result['model'], 'llama3.1:8b')
        self.assertTrue(result['capabilities']['tool_calling'])


class LocalAIDiagnosticsEndpointTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='jane.doe', email='jane.doe@example.com', password='StrongPass123')
        self.url = '/api/v1/email-builder/local-ai-diagnostics/'

    def test_unauthenticated_rejected(self):
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_authenticated_returns_diagnostics_shape(self):
        self.client.force_login(self.user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['success'])
        for key in ('configured', 'reachable', 'runtime', 'model', 'deterministic_fallback_ready'):
            self.assertIn(key, body['diagnostics'])

    def test_never_500s_even_if_diagnostics_computation_fails(self):
        self.client.force_login(self.user)
        with patch('emailbuilder.views.get_local_ai_diagnostics', side_effect=RuntimeError('boom')):
            response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['diagnostics']['deterministic_fallback_ready'])

    def test_no_api_key_value_ever_leaks_through_the_endpoint(self):
        self.client.force_login(self.user)
        with override_settings(EMAILBUILDER_LOCAL_AI_API_KEY='super-secret-endpoint-value'):
            response = self.client.get(self.url)
        self.assertNotIn('super-secret-endpoint-value', response.content.decode())


class CrossModulePlanDiagnosticsTests(SimpleTestCase):
    """D4-E3G §17 — record_cross_module_plan()/record_unresolved_target_
    references() feed real runtime events, never vanity metrics. Pure
    unit tests against the diagnostics module's own session-stats
    dict — never asserts on network/provider behavior."""

    def setUp(self):
        diagnostics.reset_session_stats_for_tests()

    def test_deterministic_plan_increments_deterministic_not_llm_assisted(self):
        diagnostics.record_cross_module_plan(operation_count=2, rejected_count=0, llm_assisted=False)
        stats = diagnostics.get_session_stats()
        self.assertEqual(stats['cross_module_plans'], 1)
        self.assertEqual(stats['deterministic_cross_module_plans'], 1)
        self.assertEqual(stats['llm_assisted_cross_module_plans'], 0)
        self.assertEqual(stats['plan_operations_generated'], 2)
        self.assertEqual(stats['plan_operations_rejected'], 0)

    def test_llm_assisted_plan_increments_llm_assisted_not_deterministic(self):
        diagnostics.record_cross_module_plan(operation_count=3, rejected_count=1, llm_assisted=True)
        stats = diagnostics.get_session_stats()
        self.assertEqual(stats['cross_module_plans'], 1)
        self.assertEqual(stats['deterministic_cross_module_plans'], 0)
        self.assertEqual(stats['llm_assisted_cross_module_plans'], 1)
        self.assertEqual(stats['plan_operations_generated'], 3)
        self.assertEqual(stats['plan_operations_rejected'], 1)

    def test_multiple_plans_accumulate(self):
        diagnostics.record_cross_module_plan(operation_count=2, rejected_count=0, llm_assisted=False)
        diagnostics.record_cross_module_plan(operation_count=2, rejected_count=1, llm_assisted=True)
        stats = diagnostics.get_session_stats()
        self.assertEqual(stats['cross_module_plans'], 2)
        self.assertEqual(stats['plan_operations_generated'], 4)
        self.assertEqual(stats['plan_operations_rejected'], 1)

    def test_unresolved_target_references_tracked_separately(self):
        diagnostics.record_unresolved_target_references()
        diagnostics.record_unresolved_target_references()
        stats = diagnostics.get_session_stats()
        self.assertEqual(stats['unresolved_target_references'], 2)
        self.assertEqual(stats['cross_module_plans'], 0)

    def test_reset_clears_every_new_counter(self):
        diagnostics.record_cross_module_plan(operation_count=1, rejected_count=1, llm_assisted=True)
        diagnostics.record_unresolved_target_references()
        diagnostics.reset_session_stats_for_tests()
        stats = diagnostics.get_session_stats()
        for key in (
            'cross_module_plans', 'deterministic_cross_module_plans', 'llm_assisted_cross_module_plans',
            'plan_operations_generated', 'plan_operations_rejected', 'unresolved_target_references',
        ):
            self.assertEqual(stats[key], 0)

    def test_never_raises_on_bad_input(self):
        diagnostics.record_cross_module_plan(operation_count=None, rejected_count=None, llm_assisted=False)
        diagnostics.record_cross_module_plan(operation_count='not-a-number', rejected_count=1, llm_assisted=True)
