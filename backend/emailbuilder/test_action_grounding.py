"""D4-E1/D4-E2/D4-E3 — tests for the shared, provider-agnostic grounding/
repair/scope-gate helpers added to ai_command.py: build_active_target_context()
(D4-E1 item 2, extended by D4-E2 items 2/3), describe_action_validation_failure()
(item 5), apply_scope_gate() (item 6), the D4-E3 BATCH_UPDATE compound-request
action, and the D4-E3 item 6 question-vs-question+mutation routing fix.
Pure unit tests, no Django client/DB, no LLM involved."""

from django.test import SimpleTestCase

from . import ai_command
from .ai_command import (
    ActionType, CanonicalIntentEmailCommandProvider, RuleBasedEmailCommandProvider, apply_scope_gate,
    apply_semantic_consistency_gate, build_active_target_context, describe_action_validation_failure,
    resolve_asset_references, validate_action,
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


class MultiModuleUpdateActionTests(SimpleTestCase):
    """D4-E3G — MULTI_MODULE_UPDATE: validate_action()/describe_action_
    validation_failure()'s new branches. Every operation is constructed
    directly (the shape a resolved-targets-aware LLM tier would propose
    after client-side reference resolution already vouched for each
    target_module_id), mirroring BatchUpdateActionTests's own style."""

    def test_two_operations_across_different_module_types_both_survive(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {'target_module_id': 'mod-hero-1', 'module_type': 'hero-text-only', 'props_patch': {'align': 'center'}, 'settings_patch': None},
                {'target_module_id': 'mod-button-1', 'module_type': 'button', 'props_patch': {'backgroundColor': '#76C043'}, 'settings_patch': None},
            ],
        }
        validated = validate_action(action)
        self.assertEqual(validated['type'], ActionType.MULTI_MODULE_UPDATE)
        self.assertEqual(len(validated['operations']), 2)
        self.assertEqual({op['target_module_id'] for op in validated['operations']}, {'mod-hero-1', 'mod-button-1'})

    def test_operation_missing_target_module_id_is_dropped_others_survive(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {'target_module_id': '', 'module_type': 'button', 'props_patch': {'backgroundColor': '#76C043'}, 'settings_patch': None},
                {'target_module_id': 'mod-text-1', 'module_type': 'text', 'props_patch': {'align': 'center'}, 'settings_patch': None},
            ],
        }
        validated = validate_action(action)
        self.assertEqual(len(validated['operations']), 1)
        self.assertEqual(validated['operations'][0]['target_module_id'], 'mod-text-1')

    def test_operation_with_unreal_module_type_is_dropped(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {'target_module_id': 'mod-1', 'module_type': 'not-a-real-type', 'props_patch': {'x': 'y'}, 'settings_patch': None},
            ],
        }
        self.assertEqual(validate_action(action), {'type': ActionType.NONE})

    def test_operation_with_both_halves_empty_is_dropped(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {'target_module_id': 'mod-button-1', 'module_type': 'button', 'props_patch': None, 'settings_patch': None},
            ],
        }
        self.assertEqual(validate_action(action), {'type': ActionType.NONE})

    def test_all_operations_invalid_reduces_to_none(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {'target_module_id': '', 'module_type': 'button', 'props_patch': {'backgroundColor': '#76C043'}, 'settings_patch': None},
            ],
        }
        self.assertEqual(validate_action(action), {'type': ActionType.NONE})

    def test_empty_operations_list_reduces_to_none(self):
        self.assertEqual(validate_action({'type': ActionType.MULTI_MODULE_UPDATE, 'operations': []}), {'type': ActionType.NONE})

    def test_operations_beyond_the_bound_are_dropped_not_silently_expanded(self):
        operations = [
            {'target_module_id': f'mod-{i}', 'module_type': 'button', 'props_patch': {'backgroundColor': '#76C043'}, 'settings_patch': None}
            for i in range(ai_command.MAX_MULTI_MODULE_OPERATIONS + 3)
        ]
        validated = validate_action({'type': ActionType.MULTI_MODULE_UPDATE, 'operations': operations})
        self.assertEqual(len(validated['operations']), ai_command.MAX_MULTI_MODULE_OPERATIONS)

    def test_invalid_props_field_stripped_per_operation_via_existing_validators(self):
        # An operation whose props_patch mixes one real and one nonexistent
        # field for that module_type must have ONLY the nonexistent field
        # dropped — reuses _validate_patch unchanged, never a second,
        # parallel validator.
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {'target_module_id': 'mod-button-1', 'module_type': 'button', 'props_patch': {'backgroundColor': '#76C043', 'notARealField': 'x'}, 'settings_patch': None},
            ],
        }
        validated = validate_action(action)
        self.assertEqual(validated['operations'][0]['props_patch'], {'backgroundColor': '#76C043'})

    def test_describe_validation_failure_names_multi_module_update_fields(self):
        action = {'type': ActionType.MULTI_MODULE_UPDATE, 'operations': []}
        message = describe_action_validation_failure(action, None)
        self.assertIn('MULTI_MODULE_UPDATE', message)
        self.assertIn('target_module_id', message)


class MultiModuleUpdateScopeGateTests(SimpleTestCase):
    """D4-E3G §15 — each MULTI_MODULE_UPDATE operation must be
    independently scope-gated: a whole-message concept set applied
    uniformly would fail to catch a scope-creeping field on an operation
    whose OWN referenced phrase never asked for it."""

    def test_each_operation_gated_against_its_own_segment(self):
        # The message overall mentions both size and color, but the hero
        # segment only asked for size — a color field slipped onto the
        # hero operation must be stripped, while the CTA operation's own
        # (legitimately requested) color field survives untouched.
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {
                    'target_module_id': 'mod-hero-1', 'module_type': 'hero-text-only',
                    'props_patch': {'headingSize': 'small', 'backgroundColor': '#76C043'}, 'settings_patch': None,
                },
                {
                    'target_module_id': 'mod-button-1', 'module_type': 'button',
                    'props_patch': {'backgroundColor': '#76C043'}, 'settings_patch': None,
                },
            ],
        }
        target_segments = {
            'mod-hero-1': 'make the hero heading smaller',
            'mod-button-1': 'make the CTA green',
        }
        gated, stripped = apply_scope_gate(
            'make the hero heading smaller and the CTA green', action, target_segments=target_segments,
        )
        hero_op = next(op for op in gated['operations'] if op['target_module_id'] == 'mod-hero-1')
        button_op = next(op for op in gated['operations'] if op['target_module_id'] == 'mod-button-1')
        self.assertNotIn('backgroundColor', hero_op['props_patch'])
        self.assertIn('headingSize', hero_op['props_patch'])
        self.assertEqual(button_op['props_patch'], {'backgroundColor': '#76C043'})
        self.assertIn('backgroundColor', stripped)

    def test_no_target_segments_falls_back_to_whole_message_conservatively(self):
        # Without segments, both size and color are "requested somewhere"
        # in the whole message, so nothing is stripped from either
        # operation — strictly conservative, not incorrect, and exactly
        # the documented fallback behavior.
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {
                    'target_module_id': 'mod-hero-1', 'module_type': 'hero-text-only',
                    'props_patch': {'headingSize': 'small', 'backgroundColor': '#76C043'}, 'settings_patch': None,
                },
            ],
        }
        gated, stripped = apply_scope_gate('make the hero heading smaller and the CTA green', action)
        self.assertEqual(gated, action)
        self.assertEqual(stripped, [])

    def test_operation_with_no_segment_entry_falls_back_to_whole_message(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {
                    'target_module_id': 'mod-footer-1', 'module_type': 'footer-simple-legal',
                    'props_patch': {'align': 'center'}, 'settings_patch': None,
                },
            ],
        }
        # target_segments has no entry at all for mod-footer-1 — falls
        # back to the whole message, which does mention alignment, so
        # nothing is stripped.
        gated, stripped = apply_scope_gate(
            'center the footer text', action, target_segments={'mod-other-1': 'something else entirely'},
        )
        self.assertEqual(gated, action)
        self.assertEqual(stripped, [])

    def test_scope_creep_field_injected_into_one_operation_only_strips_that_field(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {
                    'target_module_id': 'mod-button-1', 'module_type': 'button',
                    'props_patch': {'backgroundColor': '#76C043', 'text': 'UNREQUESTED SCOPE CREEP'}, 'settings_patch': None,
                },
            ],
        }
        target_segments = {'mod-button-1': 'make the CTA green'}
        gated, stripped = apply_scope_gate('make the CTA green', action, target_segments=target_segments)
        button_op = gated['operations'][0]
        self.assertNotIn('text', button_op['props_patch'])
        self.assertIn('backgroundColor', button_op['props_patch'])
        self.assertIn('text', stripped)

    def test_non_dict_action_passes_through(self):
        self.assertEqual(apply_scope_gate('anything', None), (None, []))

    def test_empty_operations_passes_through_unchanged(self):
        action = {'type': ActionType.MULTI_MODULE_UPDATE, 'operations': []}
        gated, stripped = apply_scope_gate('anything', action)
        self.assertEqual(gated, action)
        self.assertEqual(stripped, [])


class MultiModuleUpdateSemanticConsistencyGateTests(SimpleTestCase):
    """D4-E3G — apply_semantic_consistency_gate()'s MULTI_MODULE_UPDATE
    branch: an explicit value named for ONE operation's own segment must
    never bleed into correcting a different operation's patch."""

    def test_explicit_padding_value_only_corrects_the_operation_it_was_named_for(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {
                    'target_module_id': 'mod-footer-1', 'module_type': 'footer-simple-legal',
                    'props_patch': None,
                    'settings_patch': {'desktop': {'paddingTop': 8, 'paddingRight': 8, 'paddingBottom': 8, 'paddingLeft': 8}},
                },
                {
                    'target_module_id': 'mod-hero-1', 'module_type': 'hero-text-only',
                    'props_patch': None,
                    'settings_patch': {'desktop': {'paddingTop': 8, 'paddingRight': 8, 'paddingBottom': 8, 'paddingLeft': 8}},
                },
            ],
        }
        target_segments = {
            'mod-footer-1': 'set the footer padding to 20px',
            'mod-hero-1': 'center the hero text',
        }
        corrected, corrections = apply_semantic_consistency_gate(
            'set the footer padding to 20px and center the hero text', action, target_segments=target_segments,
        )
        footer_op = next(op for op in corrected['operations'] if op['target_module_id'] == 'mod-footer-1')
        hero_op = next(op for op in corrected['operations'] if op['target_module_id'] == 'mod-hero-1')
        self.assertEqual(footer_op['settings_patch']['desktop']['paddingTop'], 20)
        self.assertEqual(hero_op['settings_patch']['desktop']['paddingTop'], 8)  # untouched — its own segment named no explicit px value
        self.assertTrue(corrections)

    def test_no_corrections_needed_returns_action_unchanged(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {'target_module_id': 'mod-button-1', 'module_type': 'button', 'props_patch': {'backgroundColor': '#76C043'}, 'settings_patch': None},
            ],
        }
        corrected, corrections = apply_semantic_consistency_gate('make the CTA green', action)
        self.assertEqual(corrected, action)
        self.assertEqual(corrections, [])


class MultiModuleUpdateAssetResolutionTests(SimpleTestCase):
    """D4-E3G — resolve_asset_references()'s MULTI_MODULE_UPDATE branch:
    each operation's props_patch is checked/resolved independently,
    reusing _patch_has_asset_marker/_resolve_patch_assets unchanged."""

    def test_no_asset_marker_anywhere_passes_through_unchanged_without_touching_request(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {'target_module_id': 'mod-button-1', 'module_type': 'button', 'props_patch': {'backgroundColor': '#76C043'}, 'settings_patch': None},
            ],
        }
        # object() has no asset-lookup capability at all — proves the
        # function never touches `request` unless an asset marker is
        # actually present in at least one operation's patch.
        self.assertEqual(resolve_asset_references(action, object()), action)

    def test_non_dict_operation_entries_pass_through_untouched(self):
        action = {'type': ActionType.MULTI_MODULE_UPDATE, 'operations': ['not-a-dict']}
        resolved = resolve_asset_references(action, object())
        self.assertEqual(resolved['operations'], ['not-a-dict'])

    def test_empty_operations_passes_through(self):
        action = {'type': ActionType.MULTI_MODULE_UPDATE, 'operations': []}
        self.assertEqual(resolve_asset_references(action, object()), action)


class CrossModuleGuardTests(SimpleTestCase):
    """D4-E3G, updated by the hardening pass — CanonicalIntentEmailCommandProvider's
    own cross-module guard: 2+ resolved_targets must NEVER reach the
    single-module fallback chain (canonical-intent OR
    RuleBasedEmailCommandProvider) — it routes exclusively through
    build_deterministic_multi_module_plan() first, and falls to genuine
    NO_MATCH (-> LLM tier) only when that planner finds literally nothing
    classifiable anywhere. See that provider's own docstring for why this
    is the one choke point every production request passes through
    (get_default_email_command_provider always wraps
    RuleBasedEmailCommandProvider in this class)."""

    def _provider(self):
        return CanonicalIntentEmailCommandProvider(fallback=RuleBasedEmailCommandProvider())

    def _resolved_targets(self):
        return [
            {'id': 'mod-hero-1', 'type': 'hero-text-only', 'label': 'the hero', 'matched_phrase': 'the hero heading smaller'},
            {'id': 'mod-button-1', 'type': 'button', 'label': 'the button', 'matched_phrase': 'the CTA green'},
        ]

    def test_two_or_more_resolved_targets_never_reach_the_single_module_chain(self):
        # hero has no font-size capability at all (verified against the
        # real manifest — see build_deterministic_multi_module_plan's own
        # tests), so this specific pair is a PARTIAL plan: the button half
        # resolves, the hero half is a genuine capability gap. The guard's
        # job is proven here by what it does NOT do: it never falls
        # through to a single-module UPDATE_MODULE_PROPS/BATCH_UPDATE
        # mutation, and it answers with a REAL deterministic clarification
        # (never the generic _CLARIFY_REPLY _is_no_match_result() keys
        # off of — that would incorrectly send this to the LLM tier when
        # the deterministic planner already had a confident, complete
        # answer: "partially understood, here's exactly what and why").
        context = {
            'selected_module': {'type': 'button', 'props': {'text': 'Shop Now', 'backgroundColor': '#0082AD'}},
            'resolved_targets': self._resolved_targets(),
        }
        result = self._provider().resolve('make the hero heading smaller and the CTA green', context)
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertFalse(ai_command._is_no_match_result(result))
        self.assertIn('backgroundColor', result.reply)
        self.assertIn('size', result.reply)

    def test_fully_resolvable_cross_module_message_produces_zero_llm_multi_module_update(self):
        # The positive case: both targets fully resolve deterministically
        # -> a real MULTI_MODULE_UPDATE, confidently answered, never
        # routed to the LLM tier (is_no_match_result is False).
        context = {
            'selected_module': {'type': 'button', 'props': {'text': 'Shop Now', 'backgroundColor': '#0082AD'}},
            'resolved_targets': [
                {'id': 'mod-button-1', 'type': 'button', 'label': 'the first button', 'matched_phrase': 'make the first CTA green'},
                {'id': 'mod-hero-1', 'type': 'hero-text-only', 'label': 'the hero', 'matched_phrase': 'increase the spacing below the hero'},
            ],
        }
        result = self._provider().resolve('make the first CTA green and increase the spacing below the hero', context)
        self.assertEqual(result.action['type'], ActionType.MULTI_MODULE_UPDATE)
        self.assertEqual(len(result.action['operations']), 2)
        self.assertFalse(ai_command._is_no_match_result(result))

    def test_a_message_that_would_otherwise_deterministically_match_still_no_matches(self):
        # "make this button green" alone would normally deterministically
        # resolve to UPDATE_MODULE_PROPS against the selected module — the
        # guard must still win when 2+ resolved_targets are present, even
        # though the message text itself looks like an ordinary
        # single-module color request.
        context = {
            'selected_module': {'type': 'button', 'props': {'text': 'Shop Now', 'backgroundColor': '#0082AD'}},
            'resolved_targets': self._resolved_targets(),
        }
        result = self._provider().resolve('make this button green', context)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertNotEqual(result.action.get('type'), ActionType.UPDATE_MODULE_PROPS)

    def test_zero_or_one_resolved_targets_leaves_deterministic_chain_unaffected(self):
        context = {'selected_module': {'type': 'button', 'props': {'text': 'Shop Now', 'backgroundColor': '#0082AD'}}}
        result = self._provider().resolve('make this button green', context)
        self.assertEqual(result.action['type'], ActionType.UPDATE_MODULE_PROPS)

        context_with_one = {**context, 'resolved_targets': self._resolved_targets()[:1]}
        result_one = self._provider().resolve('make this button green', context_with_one)
        self.assertEqual(result_one.action['type'], ActionType.UPDATE_MODULE_PROPS)

    def test_malformed_resolved_targets_never_raises_and_never_trips_the_guard(self):
        context = {
            'selected_module': {'type': 'button', 'props': {'text': 'Shop Now', 'backgroundColor': '#0082AD'}},
            'resolved_targets': 'not-a-list',
        }
        result = self._provider().resolve('make this button green', context)
        self.assertEqual(result.action['type'], ActionType.UPDATE_MODULE_PROPS)


def _target(id_, type_, label, phrase, props=None):
    return {'id': id_, 'type': type_, 'label': label, 'matched_phrase': phrase, 'props': props or {}}


class DeterministicMultiModulePlannerTests(SimpleTestCase):
    """D4-E3G hardening — build_deterministic_multi_module_plan()/
    _command_result_from_multi_module_plan(): the "deterministic first"
    cross-module planner. Every test here proves either a REAL 0-LLM
    MULTI_MODULE_UPDATE, or an honest, non-silent clarification — never a
    partial plan disguised as a complete one. Ground-truth capability
    facts used below (confirmed against the real module_capabilities
    manifest during this checkpoint's own audit): hero/footer module
    types have NO font-size field of any kind; footer types have NO
    color-family field at all (only `align`); button/text types have
    `fontSize`."""

    def test_returns_none_when_fewer_than_two_targets(self):
        self.assertIsNone(ai_command.build_deterministic_multi_module_plan('make this green', [_target('m1', 'button', 'b', 'x')]))
        self.assertIsNone(ai_command.build_deterministic_multi_module_plan('make this green', []))

    def test_returns_none_when_not_even_one_target_has_a_classifiable_concept(self):
        # "match the other CTA" names no concept this planner's keyword
        # tables recognize at all — genuine semantic reasoning territory,
        # correctly punted to the LLM tier (caller's job, not this
        # function's — it just returns None).
        targets = [
            _target('hero1', 'hero-text-only', 'the hero', 'why is this inconsistent'),
            _target('btn1', 'button', 'the button', 'make it match the other CTA'),
        ]
        self.assertIsNone(ai_command.build_deterministic_multi_module_plan('why is this inconsistent, make it match the other CTA', targets))

    def test_explain_wording_never_triggers_an_unrequested_mutation(self):
        # A REAL bug this hardening pass's own live QA caught: "Explain
        # the Outlook SPACING issue in these sections" mentions "spacing"
        # only as the noun naming what is being diagnosed — the OLD
        # (pre-fix) planner silently proposed a default-16px padding
        # mutation nobody asked for. Must now return None entirely (no
        # classifiable concept anywhere — "fix what can safely be fixed"
        # names no concept either) so the caller routes to genuine
        # semantic reasoning instead.
        targets = [
            _target('hero1', 'hero-text-only', 'the hero', 'Explain the Outlook spacing issue in these sections'),
            _target('footer1', 'footer-simple-legal', 'the footer', 'fix what can safely be fixed'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'Explain the Outlook spacing issue in these sections and fix what can safely be fixed', targets,
        )
        self.assertIsNone(plan)

    def test_explain_plus_genuine_compound_action_hint_still_resolves(self):
        # The other half of the same distinction: "Why is this button
        # inconsistent, AND FIX IT" (a real compound-action hint) must
        # still be treated as a genuine mutation request when the
        # concept itself IS classifiable — proven here with an explicit
        # color word so the fix lands deterministically.
        targets = [
            _target('hero1', 'hero-text-only', 'the hero', 'why is this section inconsistent'),
            _target('btn1', 'button', 'the button', 'why is this button green, and make it blue'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'why is this section inconsistent and why is this button green, and make it blue', targets,
        )
        self.assertIsNotNone(plan)
        button_entry = next((t for t in plan['per_target'] if t['target_module_id'] == 'btn1'), None)
        self.assertIsNotNone(button_entry)
        self.assertIn('color', button_entry['resolved_concepts'])

    def test_b_first_cta_green_and_spacing_below_hero_fully_resolves(self):
        targets = [
            _target('btn1', 'button', 'the first button', 'make the first CTA green'),
            _target('hero1', 'hero-text-only', 'the hero', 'increase the spacing below the hero'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'make the first CTA green and increase the spacing below the hero', targets,
        )
        self.assertIsNotNone(plan)
        self.assertTrue(plan['fully_understood'])
        self.assertEqual(len(plan['operations']), 2)
        by_id = {op['target_module_id']: op for op in plan['operations']}
        self.assertEqual(by_id['btn1']['props_patch'], {'backgroundColor': '#76C043'})
        self.assertIsNone(by_id['btn1']['settings_patch'])
        self.assertIsNone(by_id['hero1']['props_patch'])
        self.assertEqual(by_id['hero1']['settings_patch']['desktop']['paddingTop'], 16.0)

    def test_c_both_cta_buttons_blue_fully_resolves(self):
        segment = 'change both CTA buttons to blue'
        targets = [
            _target('btn1', 'button', 'the first button', segment),
            _target('btn2', 'button', 'the second button', segment),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(segment, targets)
        self.assertTrue(plan['fully_understood'])
        self.assertEqual(len(plan['operations']), 2)
        self.assertTrue(all(op['props_patch'] == {'backgroundColor': '#0082AD'} for op in plan['operations']))

    def test_d_center_footer_text_and_hero_spacing_fully_resolves(self):
        # The exact false-positive this hardening pass found and fixed:
        # "footer TEXT" is a noun naming the footer's content, not a
        # request to CHANGE the text — must never block this plan.
        targets = [
            _target('footer1', 'footer-simple-legal', 'the footer', 'center the footer text'),
            _target('hero1', 'hero-text-only', 'the hero', 'increase the spacing below the hero'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'center the footer text and increase the spacing below the hero', targets,
        )
        self.assertTrue(plan['fully_understood'])
        by_id = {op['target_module_id']: op for op in plan['operations']}
        self.assertEqual(by_id['footer1']['props_patch'], {'align': 'center'})

    def test_e_same_to_second_cta_propagates_only_the_resolved_concept(self):
        targets = [
            _target('btn1', 'button', 'the first button', 'make the first CTA green'),
            _target('btn2', 'button', 'the second button', 'do the same to the second CTA'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'make the first CTA green and do the same to the second CTA', targets,
        )
        self.assertTrue(plan['fully_understood'])
        by_id = {op['target_module_id']: op for op in plan['operations']}
        self.assertEqual(by_id['btn1']['props_patch'], {'backgroundColor': '#76C043'})
        self.assertEqual(by_id['btn2']['props_patch'], {'backgroundColor': '#76C043'})
        self.assertIsNone(by_id['btn2']['settings_patch'])

    def test_same_with_no_preceding_resolution_is_unresolved_not_silently_skipped(self):
        # "do the same" with nothing real before it in the plan to copy —
        # must surface as unresolved, never silently produce zero
        # operations for a target the user explicitly named.
        targets = [
            _target('hero1', 'hero-text-only', 'the hero', 'do the same to the hero'),
            _target('btn1', 'button', 'the button', 'make it green'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan('do the same to the hero and make it green', targets)
        self.assertIsNotNone(plan)
        hero_entry = next(t for t in plan['per_target'] if t['target_module_id'] == 'hero1')
        self.assertIn('same-as-reference', hero_entry['unresolved_concepts'])
        self.assertFalse(plan['fully_understood'])

    def test_f_first_green_second_blue_fully_resolves_independently(self):
        targets = [
            _target('btn1', 'button', 'the first button', 'make the first button green'),
            _target('btn2', 'button', 'the second button', 'the second button blue'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan('make the first button green and the second button blue', targets)
        self.assertTrue(plan['fully_understood'])
        by_id = {op['target_module_id']: op for op in plan['operations']}
        self.assertEqual(by_id['btn1']['props_patch'], {'backgroundColor': '#76C043'})
        self.assertEqual(by_id['btn2']['props_patch'], {'backgroundColor': '#0082AD'})

    def test_a_hero_heading_smaller_is_a_genuine_capability_gap_never_silently_dropped(self):
        # Ground truth (verified against module_capabilities directly):
        # no hero module type has ANY font-size-family field. This is a
        # real, honest capability gap, not a planner defect — the CTA
        # half still resolves, but the whole plan must clarify rather
        # than silently apply only the button half.
        targets = [
            _target('hero1', 'hero-text-only', 'the hero', 'make the hero heading smaller'),
            _target('btn1', 'button', 'the button', 'make the CTA green'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan('make the hero heading smaller and make the CTA green', targets)
        self.assertIsNotNone(plan)
        self.assertFalse(plan['fully_understood'])
        hero_entry = next(t for t in plan['per_target'] if t['target_module_id'] == 'hero1')
        self.assertIn('size', hero_entry['unresolved_concepts'])
        button_entry = next(t for t in plan['per_target'] if t['target_module_id'] == 'btn1')
        self.assertEqual(button_entry['unresolved_concepts'], [])

        result = ai_command._command_result_from_multi_module_plan(plan)
        self.assertEqual(result.action['type'], ActionType.NONE)
        # Never silently drops the understood button half either — both
        # facts are visible in the reply.
        self.assertIn('backgroundColor', result.reply)
        self.assertIn('size', result.reply)
        self.assertIn('support', result.reply.lower())

    def test_malformed_and_unreal_entries_are_skipped_never_crash(self):
        targets = [
            'not-a-dict',
            {'id': '', 'type': 'button', 'label': 'x', 'matched_phrase': 'make it green'},
            {'id': 'm1', 'type': 'not-a-real-type', 'label': 'x', 'matched_phrase': 'make it green'},
            _target('btn1', 'button', 'the button', 'make it green'),
            _target('btn2', 'button', 'the other button', 'make it blue'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan('make it green, make it blue', targets)
        self.assertIsNotNone(plan)
        self.assertEqual(len(plan['operations']), 2)

    def test_operations_are_already_validate_action_clean(self):
        # The planner's own output must survive an UNCHANGED, independent
        # pass through validate_action() (the same re-check every action
        # from every provider gets in views.py) — proves it never needs a
        # second, looser validation path.
        targets = [
            _target('btn1', 'button', 'the first button', 'make the first CTA green'),
            _target('hero1', 'hero-text-only', 'the hero', 'increase the spacing below the hero'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'make the first CTA green and increase the spacing below the hero', targets,
        )
        action = {'type': ActionType.MULTI_MODULE_UPDATE, 'operations': plan['operations']}
        revalidated = validate_action(action)
        self.assertEqual(revalidated, action)

    def test_command_result_never_offers_apply_for_a_partial_plan(self):
        targets = [
            _target('hero1', 'hero-text-only', 'the hero', 'make the hero heading smaller'),
            _target('btn1', 'button', 'the button', 'make the CTA green'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan('make the hero heading smaller and make the CTA green', targets)
        result = ai_command._command_result_from_multi_module_plan(plan)
        self.assertNotEqual(result.action['type'], ActionType.MULTI_MODULE_UPDATE)

    def test_full_plan_never_double_counts_cross_module_plans_itself(self):
        # views.py is the ONE place cross_module_plans/plan_operations_
        # generated/rejected are recorded (see EmailAICommandViewTests'
        # own end-to-end test in tests.py for proof they DO increment
        # there) — _command_result_from_multi_module_plan must NEVER also
        # record them itself, or every deterministic plan would be
        # double-counted (recorded once here, once again in views.py,
        # since this function's CommandResult always reaches that same
        # post-validate_action() code path).
        from . import local_ai_diagnostics

        local_ai_diagnostics.reset_session_stats_for_tests()
        targets = [
            _target('btn1', 'button', 'the first button', 'make the first CTA green'),
            _target('hero1', 'hero-text-only', 'the hero', 'increase the spacing below the hero'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'make the first CTA green and increase the spacing below the hero', targets,
        )
        result = ai_command._command_result_from_multi_module_plan(plan)
        self.assertEqual(result.action['type'], ActionType.MULTI_MODULE_UPDATE)
        stats = local_ai_diagnostics.get_session_stats()
        self.assertEqual(stats['cross_module_plans'], 0)
        self.assertEqual(stats['plan_operations_generated'], 0)

    def test_partial_plan_diagnostics_recorded_as_unsupported_not_scope_creep(self):
        from . import local_ai_diagnostics

        local_ai_diagnostics.reset_session_stats_for_tests()
        targets = [
            _target('hero1', 'hero-text-only', 'the hero', 'make the hero heading smaller'),
            _target('btn1', 'button', 'the button', 'make the CTA green'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan('make the hero heading smaller and make the CTA green', targets)
        ai_command._command_result_from_multi_module_plan(plan)
        stats = local_ai_diagnostics.get_session_stats()
        self.assertEqual(stats['user_requested_unsupported_operations'], 1)
        self.assertEqual(stats['scope_creep_operations_stripped'], 0)
        self.assertEqual(stats['cross_module_plans'], 0)


class DeterministicMultiModulePlannerMultilingualTests(SimpleTestCase):
    """D4-E3G hardening §11 — the SAME deterministic planner, fed
    per-target segments in Hindi/Hinglish/Spanish/German, must produce an
    EQUIVALENT fully-resolved plan to the English case — never a second,
    per-language implementation (color/align/spacing resolution already
    reuse the D4-E3F canonical multilingual layer; this proves the planner
    built on top of them inherits that coverage, not just the single-
    module path)."""

    def test_hindi_first_cta_green_and_hero_spacing(self):
        targets = [
            _target('hero1', 'hero-text-only', 'hero', 'Hero ke neeche spacing badhao'),
            _target('btn1', 'button', 'button', 'first CTA green kar do'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'Hero ke neeche spacing badhao aur first CTA green kar do', targets,
        )
        self.assertIsNotNone(plan)
        self.assertTrue(plan['fully_understood'])
        self.assertEqual(len(plan['operations']), 2)

    def test_hinglish_first_cta_and_20px_hero_spacing(self):
        targets = [
            _target('btn1', 'button', 'button', 'First CTA ko green karo'),
            _target('hero1', 'hero-text-only', 'hero', 'hero ke neeche 20px space add karo'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'First CTA ko green karo aur hero ke neeche 20px space add karo', targets,
        )
        self.assertTrue(plan['fully_understood'])
        by_id = {op['target_module_id']: op for op in plan['operations']}
        self.assertEqual(by_id['hero1']['settings_patch']['desktop']['paddingTop'], 20.0)

    def test_spanish_primer_boton_verde_y_espacio_hero(self):
        targets = [
            _target('btn1', 'button', 'button', 'Cambia el primer botón a verde'),
            _target('hero1', 'hero-text-only', 'hero', 'aumenta el espacio debajo del hero'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'Cambia el primer botón a verde y aumenta el espacio debajo del hero', targets,
        )
        self.assertTrue(plan['fully_understood'])
        by_id = {op['target_module_id']: op for op in plan['operations']}
        self.assertEqual(by_id['btn1']['props_patch'], {'backgroundColor': '#76C043'})

    def test_german_ersten_cta_gruen_und_abstand_hero(self):
        targets = [
            _target('btn1', 'button', 'button', 'Mach den ersten CTA grün'),
            _target('hero1', 'hero-text-only', 'hero', 'vergrößere den Abstand unter dem Hero'),
        ]
        plan = ai_command.build_deterministic_multi_module_plan(
            'Mach den ersten CTA grün und vergrößere den Abstand unter dem Hero', targets,
        )
        self.assertTrue(plan['fully_understood'])
        by_id = {op['target_module_id']: op for op in plan['operations']}
        self.assertEqual(by_id['btn1']['props_patch'], {'backgroundColor': '#76C043'})
        self.assertEqual(by_id['hero1']['settings_patch']['desktop']['paddingTop'], 16.0)


class NegativeConstraintScopeGateTests(SimpleTestCase):
    """D4-E3H item 4 — "keep the text as it is" / "don't change the
    image" / "only change the padding" (the exact three phrasings named
    in the D4-E3H spec's own §4 list). apply_scope_gate() must honor
    these EXPLICIT exclusions/exhaustive-inclusions, not just positive
    concept mentions — see _requested_concepts_with_constraints()'s own
    docstring for the exact contract."""

    def test_keep_the_text_as_it_is_strips_text_even_though_mentioned(self):
        action = {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'button',
            'patch': {'backgroundColor': '#76C043', 'text': 'Buy Now'},
        }
        gated, stripped = apply_scope_gate('make this button green, but keep the text as it is', action)
        self.assertEqual(gated['patch'], {'backgroundColor': '#76C043'})
        self.assertIn('text', stripped)

    def test_dont_change_the_image_strips_image_field(self):
        action = {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'hero-image-cta',
            'patch': {'backgroundColor': '#76C043', 'imageSrc': {'assetId': 1}},
        }
        gated, stripped = apply_scope_gate("make it green, don't change the image", action)
        self.assertNotIn('imageSrc', gated['patch'])
        self.assertIn('imageSrc', stripped)

    def test_only_change_the_padding_empties_the_unrelated_props_half(self):
        action = {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': 'button',
            'props_patch': {'backgroundColor': '#76C043'},
            'settings_patch': {'desktop': {'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20}},
        }
        gated, stripped = apply_scope_gate('only change the padding, the color looks fine', action)
        self.assertIsNone(gated['props_patch'])
        self.assertEqual(gated['settings_patch']['desktop']['paddingTop'], 20)
        self.assertIn('backgroundColor', stripped)

    def test_only_change_the_padding_on_a_single_patch_action_can_empty_it_to_none(self):
        # If the ONLY requested concept isn't even in this patch at all,
        # the honest outcome is an invalidated action (patch -> None),
        # not silently keeping an unrelated field — validate_action()
        # re-checks this exact shape at the view layer regardless.
        action = {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'button',
            'patch': {'backgroundColor': '#76C043'},
        }
        gated, stripped = apply_scope_gate('only change the padding', action)
        self.assertIsNone(gated['patch'])
        self.assertIn('backgroundColor', stripped)

    def test_negative_constraint_never_affects_an_unrelated_ordinary_request(self):
        action = {
            'type': ActionType.UPDATE_MODULE_PROPS, 'target': 'selected', 'module_type': 'button',
            'patch': {'backgroundColor': '#76C043'},
        }
        gated, stripped = apply_scope_gate('make this button green', action)
        self.assertEqual(gated, action)
        self.assertEqual(stripped, [])

    def test_negative_constraint_applies_per_operation_in_multi_module_update(self):
        action = {
            'type': ActionType.MULTI_MODULE_UPDATE,
            'operations': [
                {
                    'target_module_id': 'mod-button-1', 'module_type': 'button',
                    'props_patch': {'backgroundColor': '#76C043', 'text': 'Buy Now'}, 'settings_patch': None,
                },
            ],
        }
        target_segments = {'mod-button-1': 'make the CTA green, keep the text as it is'}
        gated, stripped = apply_scope_gate(
            'make the CTA green, keep the text as it is', action, target_segments=target_segments,
        )
        op = gated['operations'][0]
        self.assertEqual(op['props_patch'], {'backgroundColor': '#76C043'})
        self.assertIn('text', stripped)

    def test_requested_concepts_with_constraints_unclassifiable_word_ignored(self):
        requested, strict = ai_command._requested_concepts_with_constraints('only change the whatchamacallit')
        self.assertEqual(requested, set())
        self.assertFalse(strict)


class InsertClauseBoundaryTests(SimpleTestCase):
    """D4-E3H — a real bug found via this checkpoint's own live QA:
    "Add a countdown timer and also make the button green." silently
    inserted an EMPTY button module (matching "button" from the unrelated
    mutation clause) and dropped the color request entirely — never
    honestly declining the unsupported "countdown timer". Fixed by
    bounding module-type matching to the text before a mutation-verb
    clause boundary, when one is present."""

    def test_unsupported_insert_target_with_trailing_mutation_clause_declines_honestly(self):
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve(
            'Add a countdown timer and also make the button green.', {'selected_module': {'type': 'button', 'props': {}}},
        )
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertNotIn('button', str(result.action))

    def test_legitimate_two_type_multi_insert_is_unaffected(self):
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve('add a button and a divider', {})
        self.assertEqual(result.action['type'], ActionType.INSERT_MODULE)
        self.assertEqual({m['module_type'] for m in result.action['modules']}, {'button', 'divider'})

    def test_legitimate_multi_insert_with_different_types_is_unaffected(self):
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve('add a text module and an image module', {})
        self.assertEqual(result.action['type'], ActionType.INSERT_MODULE)
        self.assertEqual({m['module_type'] for m in result.action['modules']}, {'text', 'image'})

    def test_insert_search_window_only_trims_when_a_real_boundary_exists(self):
        self.assertEqual(ai_command._insert_search_window('add a button and a divider'), 'add a button and a divider')
        trimmed = ai_command._insert_search_window('add a countdown timer and also make the button green')
        self.assertNotIn('button', trimmed)
        self.assertIn('countdown timer', trimmed)
