"""D4-E1/D4-E2 — tests for the shared, provider-agnostic grounding/repair/
scope-gate helpers added to ai_command.py: build_active_target_context()
(D4-E1 item 2, extended by D4-E2 items 2/3), describe_action_validation_failure()
(item 5), apply_scope_gate() (item 6). Pure unit tests, no Django client/DB,
no LLM involved."""

from django.test import SimpleTestCase

from . import ai_command
from .ai_command import ActionType, apply_scope_gate, build_active_target_context, describe_action_validation_failure, validate_action


class ActiveTargetContextTests(SimpleTestCase):
    def test_unknown_module_type_returns_none(self):
        self.assertIsNone(build_active_target_context('not-a-real-type'))

    def test_none_module_type_returns_none(self):
        self.assertIsNone(build_active_target_context(None))

    def test_button_contract_lists_real_editable_props(self):
        contract = build_active_target_context('button')
        self.assertEqual(contract['module_type'], 'button')
        keys = {f['key'] for f in contract['editable_props']}
        self.assertIn('text', keys)
        self.assertNotIn('content', keys)  # the exact hallucination this item targets
        self.assertTrue(contract['every_action_requires_user_apply'])

    def test_color_field_reports_its_value_type(self):
        contract = build_active_target_context('button')
        color_fields = [f for f in contract['editable_props'] if f['value_type'] == 'color']
        self.assertTrue(color_fields)

    def test_field_without_options_never_carries_an_allowed_values_key(self):
        # The real manifest currently has zero 'select'-typed fields
        # (confirmed live) — this asserts the shape stays honest either
        # way: no options -> no fabricated allowed_values key.
        contract = build_active_target_context('button')
        for field in contract['editable_props']:
            if field['value_type'] != 'select':
                self.assertNotIn('allowed_values', field)

    def test_module_id_and_selected_flag_are_carried_through(self):
        contract = build_active_target_context('button', module_id='mod-42')
        self.assertEqual(contract['module_id'], 'mod-42')
        self.assertTrue(contract['selected'])

    def test_module_id_defaults_to_none(self):
        contract = build_active_target_context('button')
        self.assertIsNone(contract['module_id'])

    def test_supported_actions_include_base_props_action(self):
        contract = build_active_target_context('button')
        self.assertIn(ActionType.UPDATE_MODULE_PROPS, contract['supported_actions'])

    def test_editable_settings_use_dotted_keys_for_nested_desktop_fields(self):
        contract = build_active_target_context('button')
        dotted = [f['key'] for f in contract['editable_settings'] if f['key'].startswith('desktop.')]
        self.assertTrue(dotted)
        if any(k == 'desktop.paddingTop' for k in dotted):
            self.assertIn(ActionType.UPDATE_MODULE_SETTINGS, contract['supported_actions'])


class ValidationFailureDescriptionTests(SimpleTestCase):
    def test_returns_none_when_validation_actually_succeeded(self):
        self.assertIsNone(describe_action_validation_failure({'type': ActionType.NONE}, {'type': ActionType.NONE}))

    def test_invented_action_type_reports_valid_types(self):
        action = {'type': 'REPLACE_UNSUPPORTED_PROPERTY_TYPO', 'module_type': 'button', 'patch': {}}
        message = describe_action_validation_failure(action, None)
        self.assertIn('not a valid action type', message)
        self.assertIn('UPDATE_MODULE_PROPS', message)

    def test_wrong_field_name_names_the_real_field(self):
        action = {'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'button', 'patch': {'content': 'Shop Now'}}
        message = describe_action_validation_failure(action, None)
        self.assertIn('content', message)
        self.assertIn('text', message)  # the real field name must be named explicitly
        self.assertIn('button', message)

    def test_unknown_module_type_reported(self):
        action = {'type': ActionType.UPDATE_MODULE_PROPS, 'module_type': 'not-a-real-type', 'patch': {'text': 'x'}}
        message = describe_action_validation_failure(action, None)
        self.assertIn('not a real module type', message)

    def test_never_raises_on_malformed_action(self):
        self.assertIsInstance(describe_action_validation_failure(None, None), str)
        self.assertIsInstance(describe_action_validation_failure('not-a-dict', None), str)
        self.assertIsInstance(describe_action_validation_failure({}, None), str)


class ScopeGateTests(SimpleTestCase):
    def test_color_only_request_strips_unrequested_text_change(self):
        action = {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'button',
            'patch': {'backgroundColor': '#B42318', 'text': 'Ir a la tienda'},
        }
        gated, stripped = apply_scope_gate('Change the button color to red.', action)
        self.assertEqual(gated['patch'], {'backgroundColor': '#B42318'})
        self.assertEqual(stripped, ['text'])

    def test_no_classifiable_concept_leaves_patch_untouched(self):
        action = {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'button',
            'patch': {'backgroundColor': '#B42318', 'text': 'Ir a la tienda'},
        }
        gated, stripped = apply_scope_gate('Make this better.', action)
        self.assertEqual(gated, action)
        self.assertEqual(stripped, [])

    def test_multi_concept_request_keeps_all_requested_fields(self):
        action = {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'button',
            'patch': {'backgroundColor': '#B42318', 'text': 'Buy now'},
        }
        gated, stripped = apply_scope_gate('Change the button color to red and update the text to say Buy now.', action)
        self.assertEqual(gated['patch'], {'backgroundColor': '#B42318', 'text': 'Buy now'})
        self.assertEqual(stripped, [])

    def test_stripping_everything_conservatively_passes_through_unchanged(self):
        action = {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'button',
            'patch': {'text': 'Buy now'},
        }
        gated, stripped = apply_scope_gate('Change the background color.', action)
        # 'text' concept != 'color' concept -> would strip everything ->
        # conservative pass-through instead.
        self.assertEqual(gated, action)
        self.assertEqual(stripped, [])

    def test_non_patch_action_types_pass_through_unchanged(self):
        action = {'type': ActionType.DELETE_MODULE, 'target': 'selected'}
        gated, stripped = apply_scope_gate('Delete this button please.', action)
        self.assertEqual(gated, action)
        self.assertEqual(stripped, [])

    def test_unclassifiable_field_key_is_never_stripped(self):
        action = {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'button',
            'patch': {'backgroundColor': '#B42318', 'someWeirdUnclassifiableKey': 'x'},
        }
        gated, stripped = apply_scope_gate('Change the button color to red.', action)
        self.assertIn('someWeirdUnclassifiableKey', gated['patch'])
        self.assertNotIn('someWeirdUnclassifiableKey', stripped)

    def test_real_validated_action_end_to_end_scope_gate(self):
        # Mirrors the exact live-QA finding: model changed color AND text
        # when only color was requested; validate_action() alone cannot
        # know the user's intent, but apply_scope_gate() can.
        raw_action = {
            'type': 'UPDATE_MODULE_PROPS', 'target': 'selected', 'module_type': 'button',
            'patch': {'backgroundColor': 'red', 'text': 'Ir a la tienda'},
        }
        validated = validate_action(raw_action)
        self.assertIsNotNone(validated)
        self.assertIn('text', validated['patch'])  # validate_action alone keeps it (both are legal fields)
        gated, stripped = apply_scope_gate('Cambia el color del botón a rojo.', validated)
        self.assertNotIn('text', gated['patch'])
        self.assertIn('backgroundColor', gated['patch'])
        self.assertEqual(stripped, ['text'])
