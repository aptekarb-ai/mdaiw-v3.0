"""R4-B3 §D/§I/§J — bounded tool loop tests: execute_tool_call() unit
tests plus end-to-end loop behavior (cap enforcement, malicious/unknown
tool rejection, no extra network calls) for both providers."""

import json
from unittest.mock import MagicMock

from django.test import TestCase, override_settings

from .ai_command import MAX_TOOL_LOOP_ITERATIONS, READ_TOOL_NAMES, execute_tool_call
from .ai_command_local import LocalEmailCommandProvider
from .ai_command_openai import OpenAIEmailCommandProvider


class ExecuteToolCallTests(TestCase):
    def test_unknown_tool_name_returns_none(self):
        self.assertIsNone(execute_tool_call('DELETE_EVERYTHING', {}, {}))
        self.assertIsNone(execute_tool_call('RUN_SHELL_COMMAND', {}, {}))
        self.assertIsNone(execute_tool_call('', {}, {}))

    def test_get_selected_module_returns_only_what_was_already_in_context(self):
        context = {'selected_module': {'type': 'button', 'props': {'href': 'https://example.com'}}}
        result = execute_tool_call('GET_SELECTED_MODULE', {}, context)
        self.assertEqual(result, {'selected_module': context['selected_module']})

    def test_get_module_capabilities_returns_bounded_field_list(self):
        result = execute_tool_call('GET_MODULE_CAPABILITIES', {'module_type': 'text'}, {})
        self.assertEqual(result['module_type'], 'text')
        self.assertIsInstance(result['editable_fields'], list)
        self.assertTrue(all(isinstance(f, str) for f in result['editable_fields']))

    def test_get_module_capabilities_unknown_type_returns_empty_list_not_error(self):
        result = execute_tool_call('GET_MODULE_CAPABILITIES', {'module_type': 'not-a-real-type'}, {})
        self.assertEqual(result['editable_fields'], [])

    def test_get_import_reconstruction_returns_only_the_already_bounded_blob(self):
        recon = {'document_width': 700, 'fidelity_categories': []}
        result = execute_tool_call('GET_IMPORT_RECONSTRUCTION', {}, {'import_reconstruction': recon})
        self.assertEqual(result, {'import_reconstruction': recon})

    def test_compare_reconstruction_never_fabricates_categories(self):
        result = execute_tool_call('COMPARE_RECONSTRUCTION', {}, {})
        self.assertEqual(result, {'fidelity_categories': []})

    def test_malformed_args_never_raises(self):
        for tool in READ_TOOL_NAMES:
            execute_tool_call(tool, None, {})
            execute_tool_call(tool, 'not-a-dict', None)

    def test_every_read_tool_name_is_handled(self):
        # No name in the whitelist may silently fall through to the
        # "unknown -> None" branch — every one must have a real handler.
        for tool in READ_TOOL_NAMES:
            self.assertIsNotNone(execute_tool_call(tool, {}, {'selected_module': None}))

    def test_get_document_summary_carries_document_summary_when_supplied(self):
        # D4-E3I §3 — document_summary is a SEPARATE parameter, never a
        # safe_context key (see execute_tool_call's own docstring on why
        # — it must never inflate the always-sent context JSON).
        summary = {'module_count': 2, 'module_types': ['hero-text-only', 'button']}
        result = execute_tool_call('GET_DOCUMENT_SUMMARY', {}, {'platform': 'generic'}, document_summary=summary)
        self.assertEqual(result['document_summary'], summary)
        self.assertEqual(result['platform'], 'generic')

    def test_get_document_summary_key_always_present_even_when_none(self):
        result = execute_tool_call('GET_DOCUMENT_SUMMARY', {}, {})
        self.assertIn('document_summary', result)
        self.assertIsNone(result['document_summary'])

    def test_document_summary_never_leaks_into_other_tool_results(self):
        summary = {'module_count': 1, 'module_types': ['button']}
        result = execute_tool_call('GET_SELECTED_MODULE', {}, {'selected_module': None}, document_summary=summary)
        self.assertNotIn('document_summary', result)


class BuildSafeDocumentSummaryTests(TestCase):
    """D4-E3I §3 — _build_safe_document_summary() in BOTH provider
    modules (structurally identical, per-provider-file posture, same as
    every other safe-context builder)."""

    def test_filters_unrecognized_module_types_never_raises(self):
        from .ai_command_local import _build_safe_document_summary as local_build
        from .ai_command_openai import _build_safe_document_summary as openai_build

        raw = {'module_count': 3, 'module_types': ['hero-text-only', 'not-a-real-type', 'button']}
        for build in (local_build, openai_build):
            safe = build(raw)
            self.assertEqual(safe['module_types'], ['hero-text-only', 'button'])
            self.assertEqual(safe['module_count'], 3)

    def test_malformed_input_returns_none(self):
        from .ai_command_local import _build_safe_document_summary as local_build

        self.assertIsNone(local_build(None))
        self.assertIsNone(local_build('not-a-dict'))
        self.assertIsNone(local_build({'module_types': 'not-a-list'}))

    def test_bounded_to_sixty_modules(self):
        from .ai_command_local import _build_safe_document_summary as local_build

        raw = {'module_count': 100, 'module_types': ['button'] * 100}
        safe = local_build(raw)
        self.assertEqual(len(safe['module_types']), 60)

    def test_negative_or_missing_module_count_falls_back_to_len(self):
        from .ai_command_local import _build_safe_document_summary as local_build

        safe = local_build({'module_count': -1, 'module_types': ['button', 'hero-text-only']})
        self.assertEqual(safe['module_count'], 2)


def _fake_completion(payload):
    completion = MagicMock()
    completion.choices = [MagicMock(message=MagicMock(content=json.dumps(payload)))]
    return completion


def _response(reply='', confidence=0.0, tool_call=None):
    return {
        'reply': reply, 'confidence': confidence,
        'action': {
            'type': 'NONE', 'target': None, 'module_type': None, 'modules': None, 'patch': None,
            'enabled': None, 'css': None, 'value': None, 'url': None, 'items': None,
        },
        'tool_call': tool_call,
    }


class LocalProviderToolLoopTests(TestCase):
    def test_one_tool_call_then_a_final_answer_takes_exactly_two_requests(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = [
            _fake_completion(_response(tool_call={'name': 'GET_SELECTED_MODULE', 'args': {}})),
            _fake_completion(_response(reply='final answer', confidence=0.9)),
        ]
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            result = provider.resolve('what is selected', {'selected_module': {'type': 'text', 'props': {}}})
        self.assertEqual(result.reply, 'final answer')
        self.assertEqual(client.chat.completions.create.call_count, 2)

    def test_no_tool_call_takes_exactly_one_request_unchanged_from_pre_r4b3_behavior(self):
        client = MagicMock()
        client.chat.completions.create.return_value = _fake_completion(_response(reply='ok', confidence=0.9))
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            provider.resolve('add a button', {})
        self.assertEqual(client.chat.completions.create.call_count, 1)

    def test_iteration_cap_is_enforced_never_infinite_loops(self):
        # The model asks for a tool EVERY single time — the loop must
        # still terminate at MAX_TOOL_LOOP_ITERATIONS requests, never more.
        client = MagicMock()
        client.chat.completions.create.return_value = _fake_completion(
            _response(tool_call={'name': 'GET_SELECTED_MODULE', 'args': {}}),
        )
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            result = provider.resolve('what is selected', {})
        self.assertEqual(client.chat.completions.create.call_count, MAX_TOOL_LOOP_ITERATIONS)
        self.assertEqual(result.action['type'], 'NONE')  # degrades safely, never crashes

    def test_unknown_tool_name_from_the_model_is_never_executed_and_stops_the_loop(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = [
            _fake_completion(_response(reply='I tried something odd', tool_call={'name': 'DELETE_ALL_EMAILS', 'args': {}})),
        ]
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            result = provider.resolve('do something', {})
        # Treated as "no valid tool call" -> loop stops after 1 request,
        # answers with whatever reply/action came back — never executes
        # the bogus tool, never raises.
        self.assertEqual(client.chat.completions.create.call_count, 1)
        self.assertEqual(result.reply, 'I tried something odd')

    def test_a_write_style_tool_name_is_rejected_the_same_way_as_any_unknown_name(self):
        # PROPOSE_MODULE_PATCH / PROPOSE_DOCUMENT_PATCH are explicitly
        # NOT in READ_TOOL_NAMES (§D: "Write-side operations should
        # remain proposal generators only" — i.e. the existing `action`
        # field, never a tool_call) — proves the schema/loop can never
        # be used to smuggle a mutating call through the tool mechanism.
        self.assertNotIn('PROPOSE_MODULE_PATCH', READ_TOOL_NAMES)
        self.assertNotIn('PROPOSE_DOCUMENT_PATCH', READ_TOOL_NAMES)
        self.assertNotIn('PROPOSE_EMAIL_SETTINGS_PATCH', READ_TOOL_NAMES)
        client = MagicMock()
        client.chat.completions.create.side_effect = [
            _fake_completion(_response(reply='trying to mutate', tool_call={'name': 'PROPOSE_MODULE_PATCH', 'args': {}})),
        ]
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            provider.resolve('do something', {})
        self.assertEqual(client.chat.completions.create.call_count, 1)

    def test_tool_result_is_never_larger_than_the_context_already_sent(self):
        # Privacy/bounded-ness — the tool result can only ever echo back
        # data already present in safe_context, never something new.
        client = MagicMock()
        client.chat.completions.create.side_effect = [
            _fake_completion(_response(tool_call={'name': 'GET_IMPORT_RECONSTRUCTION', 'args': {}})),
            _fake_completion(_response(reply='done', confidence=0.5)),
        ]
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            provider.resolve('what changed', {'import_reconstruction': None})
        second_call_messages = client.chat.completions.create.call_args_list[1].kwargs['messages']
        tool_result_message = next(m for m in second_call_messages if m['role'] == 'system' and 'Tool result' in m['content'])
        self.assertIn('"import_reconstruction": null', tool_result_message['content'])


class OpenAIProviderToolLoopTests(TestCase):
    def test_one_tool_call_then_a_final_answer_takes_exactly_two_requests(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = [
            _fake_completion(_response(tool_call={'name': 'GET_SELECTED_MODULE', 'args': {}})),
            _fake_completion(_response(reply='final answer', confidence=0.9)),
        ]
        provider = OpenAIEmailCommandProvider(client_factory=lambda: client)
        with override_settings(OPENAI_API_KEY='sk-test'):
            result = provider.resolve('what is selected', {'selected_module': {'type': 'text', 'props': {}}})
        self.assertEqual(result.reply, 'final answer')
        self.assertEqual(client.chat.completions.create.call_count, 2)

    def test_iteration_cap_is_enforced(self):
        client = MagicMock()
        client.chat.completions.create.return_value = _fake_completion(
            _response(tool_call={'name': 'GET_SELECTED_MODULE', 'args': {}}),
        )
        provider = OpenAIEmailCommandProvider(client_factory=lambda: client)
        with override_settings(OPENAI_API_KEY='sk-test'):
            result = provider.resolve('what is selected', {})
        self.assertEqual(client.chat.completions.create.call_count, MAX_TOOL_LOOP_ITERATIONS)
        self.assertEqual(result.action['type'], 'NONE')
