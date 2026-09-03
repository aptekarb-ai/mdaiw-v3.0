"""D4-E1/D4-E2/D4-E3 — tests for the shared, provider-agnostic grounding/
repair/scope-gate helpers added to ai_command.py: build_active_target_context()
(D4-E1 item 2, extended by D4-E2 items 2/3), describe_action_validation_failure()
(item 5), apply_scope_gate() (item 6), the D4-E3 BATCH_UPDATE compound-request
action, and the D4-E3 item 6 question-vs-question+mutation routing fix.
Pure unit tests, no Django client/DB, no LLM involved."""

from django.test import SimpleTestCase

from . import ai_command
from .ai_command import (
    ActionType, RuleBasedEmailCommandProvider, apply_scope_gate, apply_semantic_consistency_gate,
    build_active_target_context, describe_action_validation_failure, resolve_asset_references, validate_action,
)


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


class BatchUpdateActionTests(SimpleTestCase):
    """D4-E3 item 7/8 — the compound-request action type: a props patch
    AND a settings patch for the same selected module, in one action."""

    def test_validate_action_accepts_both_halves(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'module_type': 'button',
            'props_patch': {'backgroundColor': '#76C043'},
            'settings_patch': {'desktop': {'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20}},
        }
        validated = validate_action(action)
        self.assertIsNotNone(validated)
        self.assertEqual(validated['type'], ActionType.BATCH_UPDATE)
        self.assertEqual(validated['target'], 'selected')
        self.assertEqual(validated['props_patch'], {'backgroundColor': '#76C043'})
        self.assertEqual(validated['settings_patch']['desktop']['paddingTop'], 20)

    def test_validate_action_drops_invalid_props_field_keeps_settings(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'module_type': 'button',
            'props_patch': {'notARealField': 'x'},
            'settings_patch': {'desktop': {'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20}},
        }
        validated = validate_action(action)
        self.assertIsNotNone(validated)
        self.assertIsNone(validated['props_patch'])
        self.assertIsNotNone(validated['settings_patch'])

    def test_validate_action_rejects_when_both_halves_empty(self):
        action = {'type': ActionType.BATCH_UPDATE, 'module_type': 'button', 'props_patch': None, 'settings_patch': None}
        validated = validate_action(action)
        self.assertEqual(validated, {'type': ActionType.NONE})

    def test_validate_action_rejects_unknown_module_type(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'module_type': 'not-a-real-type',
            'props_patch': {'backgroundColor': '#76C043'}, 'settings_patch': None,
        }
        self.assertIsNone(validate_action(action))

    def test_semantic_gate_corrects_both_halves_independently(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': 'button',
            'props_patch': {'backgroundColor': 'red'},
            'settings_patch': {'desktop': {'paddingTop': 10, 'paddingRight': 10, 'paddingBottom': 10, 'paddingLeft': 10}},
        }
        corrected, corrections = apply_semantic_consistency_gate(
            'make this button green and set the padding to 24px', action,
        )
        self.assertEqual(corrected['props_patch']['backgroundColor'], '#76C043')
        self.assertEqual(corrected['settings_patch']['desktop']['paddingTop'], 24)
        self.assertEqual(len(corrections), 2)

    def test_describe_validation_failure_names_batch_update_fields(self):
        action = {'type': ActionType.BATCH_UPDATE, 'module_type': 'button', 'props_patch': {'notReal': 'x'}, 'settings_patch': None}
        # Simulate what the repair loop sees: a raw action that failed re-validation.
        message = describe_action_validation_failure(action, None)
        self.assertIn('BATCH_UPDATE', message)
        self.assertIn('text', message)  # a real button field name, for grounding

    def test_resolve_asset_references_passthrough_when_no_asset_marker(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': 'button',
            'props_patch': {'backgroundColor': '#76C043'}, 'settings_patch': None,
        }
        # No image_asset-valued field in props_patch -> returns unchanged
        # without ever touching `request` (never raises on a bare object()).
        self.assertEqual(resolve_asset_references(action, object()), action)

    def test_deterministic_router_combines_color_and_padding_into_batch_update(self):
        provider = RuleBasedEmailCommandProvider()
        context = {'selected_module': {'type': 'button', 'props': {'text': 'Shop Now', 'backgroundColor': '#0082AD'}}}
        result = provider.resolve('make this button green and increase the padding to 20px', context)
        self.assertEqual(result.action['type'], ActionType.BATCH_UPDATE)
        self.assertEqual(result.action['props_patch']['backgroundColor'], '#76C043')
        self.assertEqual(result.action['settings_patch']['desktop']['paddingTop'], 20)

    def test_deterministic_router_spacing_only_message_still_returns_plain_settings_action(self):
        # No color/align/text/size signal in the message -> the existing,
        # unmodified compute_spacing_result() path, never BATCH_UPDATE.
        provider = RuleBasedEmailCommandProvider()
        context = {'selected_module': {'type': 'button', 'props': {'text': 'Shop Now', 'backgroundColor': '#0082AD'}}}
        result = provider.resolve('increase the padding to 20px', context)
        self.assertEqual(result.action['type'], ActionType.UPDATE_MODULE_SETTINGS)


class BatchUpdateScopeGateTests(SimpleTestCase):
    """D4-E3 scope-gate hardening — closes the confirmed gap where a
    BATCH_UPDATE proposed by the LLM tier bypassed apply_scope_gate()
    entirely (it carries props_patch/settings_patch, never `patch`, so
    the pre-fix type-check tuple + `action.get('patch')` read silently
    no-opped on it). Every test here constructs the action directly
    (the shape an LLM tier would propose after passing validate_action())
    rather than going through a provider, so these are pinned to the gate
    function's OWN contract, independent of routing."""

    _BUTTON_MODULE_TYPE = 'button'

    def test_props_only_unrequested_field_is_stripped(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': self._BUTTON_MODULE_TYPE,
            'props_patch': {'backgroundColor': '#76C043', 'align': 'left'}, 'settings_patch': None,
        }
        gated, stripped = apply_scope_gate('Make this button green.', action)
        self.assertEqual(gated['props_patch'], {'backgroundColor': '#76C043'})
        self.assertIsNone(gated['settings_patch'])
        self.assertEqual(stripped, ['align'])

    def test_settings_only_unrequested_field_is_stripped(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': self._BUTTON_MODULE_TYPE,
            'props_patch': None,
            'settings_patch': {'desktop': {
                'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20,
                'visibility': 'hideMobile',
            }},
        }
        gated, stripped = apply_scope_gate('Increase the padding to 20px.', action)
        self.assertIsNone(gated['props_patch'])
        self.assertNotIn('visibility', gated['settings_patch']['desktop'])
        self.assertEqual(gated['settings_patch']['desktop']['paddingTop'], 20)
        self.assertIn('visibility', stripped)

    def test_props_plus_settings_compound_request_keeps_both_requested_halves(self):
        # The exact worked example from this checkpoint's requirements:
        # "Make this button green and increase the padding to 20px" must
        # keep the requested color AND the requested padding, and strip
        # nothing that was actually asked for.
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': self._BUTTON_MODULE_TYPE,
            'props_patch': {'backgroundColor': '#76C043'},
            'settings_patch': {'desktop': {'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20}},
        }
        gated, stripped = apply_scope_gate('Make this button green and increase the padding to 20px', action)
        self.assertEqual(gated['props_patch'], {'backgroundColor': '#76C043'})
        self.assertEqual(gated['settings_patch']['desktop']['paddingTop'], 20)
        self.assertEqual(stripped, [])

    def test_unrelated_text_field_never_survives_a_color_and_padding_request(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': self._BUTTON_MODULE_TYPE,
            'props_patch': {'backgroundColor': '#76C043', 'text': 'UNREQUESTED SCOPE CREEP'},
            'settings_patch': {'desktop': {'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20}},
        }
        gated, stripped = apply_scope_gate('Make this button green and increase the padding to 20px', action)
        self.assertNotIn('text', gated['props_patch'])
        self.assertIn('text', stripped)

    def test_unrelated_align_field_never_survives(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': self._BUTTON_MODULE_TYPE,
            'props_patch': {'backgroundColor': '#76C043', 'align': 'right'}, 'settings_patch': None,
        }
        gated, stripped = apply_scope_gate('Make this button green.', action)
        self.assertNotIn('align', gated['props_patch'])
        self.assertIn('align', stripped)

    def test_unrelated_url_field_never_survives(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': self._BUTTON_MODULE_TYPE,
            'props_patch': {'backgroundColor': '#76C043', 'href': 'https://example.com/unrequested'},
            'settings_patch': None,
        }
        gated, stripped = apply_scope_gate('Make this button green.', action)
        self.assertNotIn('href', gated['props_patch'])
        self.assertIn('href', stripped)

    def test_unrelated_visibility_field_never_survives(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': self._BUTTON_MODULE_TYPE,
            'props_patch': None,
            'settings_patch': {'desktop': {'paddingTop': 20, 'visibility': 'hideDesktop'}},
        }
        gated, stripped = apply_scope_gate('Increase the padding to 20px.', action)
        self.assertNotIn('visibility', gated['settings_patch']['desktop'])
        self.assertIn('visibility', stripped)

    def test_no_classifiable_concept_leaves_batch_update_untouched(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': self._BUTTON_MODULE_TYPE,
            'props_patch': {'backgroundColor': '#76C043', 'text': 'x'},
            'settings_patch': {'desktop': {'paddingTop': 20}},
        }
        gated, stripped = apply_scope_gate('Make this better.', action)
        self.assertEqual(gated, action)
        self.assertEqual(stripped, [])

    def test_stripping_a_whole_half_to_empty_conservatively_keeps_that_half(self):
        # Mirrors the pre-existing single-patch "would empty entirely ->
        # pass through unchanged" guard, now shared via _scope_gate_patch:
        # a props_patch containing ONLY an off-topic field, with a
        # genuinely different concept requested, is kept as-is rather
        # than emptied to {} (over-aggressive stripping is worse than an
        # occasional extra field surviving when the signal is this weak).
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': self._BUTTON_MODULE_TYPE,
            'props_patch': {'text': 'Buy now'},
            'settings_patch': {'desktop': {'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20}},
        }
        gated, stripped = apply_scope_gate('Increase the padding to 20px.', action)
        self.assertEqual(gated['props_patch'], {'text': 'Buy now'})
        self.assertEqual(stripped, [])

    def test_llm_authored_and_deterministic_batch_update_get_identical_gate_treatment(self):
        # The gate function itself has no notion of "which provider built
        # this action" — same dict shape in, same filtering logic, same
        # result, regardless of whether RuleBasedEmailCommandProvider or
        # an LLM tier constructed it. Proven here by feeding the gate the
        # SAME action twice; the deterministic router's own combiner is
        # additionally verified elsewhere (BatchUpdateActionTests) to
        # never emit an unrequested field in the first place (safety by
        # construction, on top of this shared runtime gate).
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': self._BUTTON_MODULE_TYPE,
            'props_patch': {'backgroundColor': '#76C043', 'text': 'scope creep'}, 'settings_patch': None,
        }
        first_gated, first_stripped = apply_scope_gate('Make this button green.', dict(action))
        second_gated, second_stripped = apply_scope_gate('Make this button green.', dict(action))
        self.assertEqual(first_gated, second_gated)
        self.assertEqual(first_stripped, second_stripped)
        self.assertNotIn('text', first_gated['props_patch'])

    def test_deterministic_batch_update_combiner_never_emits_an_unrequested_field(self):
        # Safety-by-construction check for the deterministic path (see
        # apply_scope_gate() module-level call sites — RuleBasedEmailCommandProvider
        # itself is never routed through the runtime gate, same
        # architecture as every other deterministic action type; its own
        # extraction helper, _extract_unambiguous_props_patch, only ever
        # includes a field the message's own signal actually matched).
        provider = RuleBasedEmailCommandProvider()
        context = {'selected_module': {'type': self._BUTTON_MODULE_TYPE, 'props': {'text': 'Shop Now', 'backgroundColor': '#0082AD'}}}
        result = provider.resolve('make this button green and increase the padding to 20px', context)
        self.assertEqual(result.action['type'], ActionType.BATCH_UPDATE)
        self.assertEqual(set(result.action['props_patch'].keys()), {'backgroundColor'})
        # Running the (redundant-by-construction, but now-available)
        # runtime gate over the deterministic result confirms it strips
        # nothing — proof the deterministic path already satisfies the
        # gate's own rules without needing to be routed through it.
        gated, stripped = apply_scope_gate('make this button green and increase the padding to 20px', result.action)
        self.assertEqual(gated, result.action)
        self.assertEqual(stripped, [])


class QuestionVsQuestionPlusMutationTests(SimpleTestCase):
    """D4-E3 item 6 — a pure question must never mutate; a question
    genuinely joined to a mutation request ("and fix/change/...") must
    not be silently answered as if the mutation half didn't exist — it
    must reach NO_MATCH so the LLM tier can handle both halves together."""

    def test_pure_explain_question_is_unaffected_still_answered_deterministically(self):
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve('Why does Gmail clip my email?', {})
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('Gmail', result.reply)
        self.assertNotEqual(result.confidence, 0.0)

    def test_compound_question_and_fix_falls_through_to_no_match(self):
        provider = RuleBasedEmailCommandProvider()
        context = {'selected_module': {'type': 'button', 'props': {'text': 'Shop Now', 'backgroundColor': '#0082AD'}}}
        result = provider.resolve('Why is this button inconsistent, and fix it.', context)
        # Never the confident, action-dropping explanation reply — must be
        # the generic NO_MATCH clarify text, which DeterministicFirstEmailCommandProvider
        # recognizes as "route to the LLM tier."
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertEqual(result.confidence, 0.2)

    def test_established_false_positive_guard_still_holds(self):
        # The exact D4-E2 worked example: must NOT be treated as a
        # compound question+mutation request just because "change" appears
        # in the sentence — _COMPOUND_ACTION_HINT_PATTERN requires the
        # literal "and <verb>" construction, absent here.
        self.assertIsNone(ai_command._COMPOUND_ACTION_HINT_PATTERN.search('why did you change the column widths?'))
