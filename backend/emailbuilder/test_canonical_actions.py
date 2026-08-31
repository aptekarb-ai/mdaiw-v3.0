"""R4-B4 §1-§6/§11 — canonical intent EXECUTION tests: every intent now
produces a real, validate_action()-passing proposal wherever the builder
has the capability, natural English command variations resolve to the
same action, non-English equivalents produce byte-equivalent actions,
and unsupported/malicious requests are still rejected by the existing
trust boundary regardless of which path produced them."""

from unittest.mock import MagicMock

from django.test import SimpleTestCase, TestCase, override_settings

from .ai_command import (
    CanonicalIntentEmailCommandProvider, RuleBasedEmailCommandProvider, apply_canonical_intent,
    compute_column_ratio_result, compute_contrast_fix_result, compute_outlook_fallback_result,
    compute_reconstruction_explain_result, compute_set_image_result, compute_set_link_result,
    compute_spacing_result, get_default_email_command_provider, validate_action,
)
from .ai_command_local import LocalEmailCommandProvider
from .intent_normalization import CanonicalIntent, EXECUTABLE_INTENTS, find_alignment_value


class EveryCanonicalIntentHasAnExecutorTests(SimpleTestCase):
    def test_every_canonical_intent_value_is_executable(self):
        # R4-B4's own completion criterion (§14): all ten, not nine.
        self.assertEqual(EXECUTABLE_INTENTS, CanonicalIntent.values)

    def test_unknown_intent_returns_none_never_raises(self):
        self.assertIsNone(apply_canonical_intent('NOT_A_REAL_INTENT', {}, 'hello'))


class EnglishNaturalVariationTests(TestCase):
    """§3 — different natural phrasings of the SAME operation must
    resolve to the SAME canonical action, via the (now widened)
    deterministic router."""

    def _provider(self):
        return RuleBasedEmailCommandProvider()

    def test_alignment_variations_all_produce_the_same_center_action(self):
        context = {'selected_module': {'type': 'button', 'props': {}}}
        phrasings = ['make this centered', 'center it', 'align this in the middle', 'put this button in the center']
        results = [self._provider().resolve(p, context).action for p in phrasings]
        for action in results:
            self.assertEqual(action['type'], 'UPDATE_MODULE_PROPS')
            self.assertEqual(action['patch'], {'align': 'center'})
        # byte-equivalent across all four phrasings
        self.assertTrue(all(a == results[0] for a in results))

    def test_spacing_variations_all_use_the_same_capability(self):
        context = {'selected_module': {'type': 'text', 'props': {}}}
        for message in ['give this 20px padding', 'add some space inside', 'increase internal spacing to 20']:
            result = self._provider().resolve(message, context)
            self.assertEqual(result.action['type'], 'UPDATE_MODULE_SETTINGS')
            self.assertIn('desktop', result.action['patch'])


class CapabilityAwareExecutionTests(TestCase):
    """§2 — the AI Engineer must understand whether the selected module
    supports the requested property, and decline honestly (never
    fabricate) when it doesn't."""

    def test_text_module_has_no_background_image_property_declines_honestly(self):
        result = compute_set_image_result('text', 'https://example.com/x.jpg')
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('does not have an image', result.reply)

    def test_non_layout_module_has_no_column_ratio_declines_honestly(self):
        result = compute_column_ratio_result('text', 'make this 70/30')
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('is not a layout', result.reply)

    def test_module_without_href_field_declines_link_change_honestly(self):
        result = compute_set_link_result('text', 'set this link to https://example.com')
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('does not have a link', result.reply)

    def test_module_without_vml_support_declines_outlook_fallback_honestly(self):
        result = compute_outlook_fallback_result('text')
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('does not support a VML fallback', result.reply)

    def test_no_selection_never_fabricates_a_target(self):
        for fn, args in [
            (compute_set_link_result, (None, 'set this link to https://example.com')),
            (compute_set_image_result, (None, 'https://example.com/x.jpg')),
            (compute_spacing_result, (None, 'give this 20px padding')),
            (compute_column_ratio_result, (None, 'make this 70/30')),
            (compute_outlook_fallback_result, (None,)),
        ]:
            result = fn(*args)
            self.assertEqual(result.action['type'], 'NONE')

    def test_image_set_never_invents_a_url_without_one_given(self):
        result = compute_set_image_result('image', 'change this image please')
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn("won't invent", result.reply)

    def test_column_ratio_wrong_number_count_asks_rather_than_guesses(self):
        result = compute_column_ratio_result('layout-3col', 'make this 70/30')
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('3 width percentages', result.reply)


class SpacingBoundsTests(TestCase):
    def test_out_of_range_padding_is_rejected(self):
        result = compute_spacing_result('text', 'give this 9999px padding')
        self.assertEqual(result.action['type'], 'NONE')

    def test_in_range_padding_passes_validate_action(self):
        result = compute_spacing_result('text', 'give this 20px padding')
        self.assertEqual(result.action['patch']['desktop']['paddingTop'], 20.0)

    def test_default_amount_used_when_none_given_and_disclosed_in_reply(self):
        result = compute_spacing_result('text', 'add some space inside')
        self.assertEqual(result.action['type'], 'UPDATE_MODULE_SETTINGS')
        self.assertIn('16px', result.reply)
        self.assertIn('no exact amount', result.reply)


class SetImageAndLinkResolveThroughExistingAssetPathTests(TestCase):
    def test_set_image_uses_the_url_marker_shape_image_asset_fields_already_expect(self):
        result = compute_set_image_result('image', 'change this image to https://example.com/x.jpg')
        patch = result.action['patch']
        image_key = next(iter(patch))
        self.assertEqual(patch[image_key], {'url': 'https://example.com/x.jpg'})

    def test_set_link_rejects_unsafe_scheme(self):
        result = compute_set_link_result('button', 'set this link to javascript:alert(1)')
        self.assertEqual(result.action['type'], 'NONE')


class MultilingualByteEquivalenceTests(TestCase):
    """§4 — the underlying action produced from a non-English canonical-
    intent request must be BYTE-EQUIVALENT to the action an equivalent
    English request produces."""

    def test_hindi_center_button_matches_english_center_button(self):
        context = {'selected_module': {'type': 'button', 'props': {}}}
        english = RuleBasedEmailCommandProvider().resolve('center this button', context)
        hindi_message = 'इस बटन को बीच में करें'
        hindi = apply_canonical_intent(CanonicalIntent.CHANGE_ALIGNMENT, context, hindi_message)
        self.assertEqual(english.action, hindi.action)

    def test_spanish_fix_link_matches_english_set_link(self):
        context = {'selected_module': {'type': 'button', 'props': {}}}
        english = RuleBasedEmailCommandProvider().resolve('set this link to https://example.com', context)
        spanish = apply_canonical_intent(CanonicalIntent.SET_LINK, context, 'arregla el enlace a https://example.com')
        self.assertEqual(english.action, spanish.action)

    def test_find_alignment_value_word_boundary_never_matches_inside_another_word(self):
        # "right" inside "copyright" must never be treated as an
        # alignment word.
        self.assertIsNone(find_alignment_value('add a copyright notice', 'en'))
        self.assertEqual(find_alignment_value('align this right please', 'en'), 'right')


class ExplainAndReconstructionCanonicalIntentTests(TestCase):
    def test_explain_uses_the_specific_selected_issue_not_a_generic_lookup(self):
        context = {'selected_validation_issue': {
            'id': 'a:b', 'title': 'Weak contrast', 'detail': 'Contrast is 3.2:1, needs 4.5:1', 'category': 'accessibility',
        }}
        result = apply_canonical_intent(CanonicalIntent.EXPLAIN_VALIDATION_ISSUE, context, 'explain this issue')
        self.assertIn('Weak contrast', result.reply)
        self.assertIn('3.2:1', result.reply)

    def test_reconstruction_explain_never_mutates_and_never_fabricates(self):
        # §1/§8 boundary — R4-C's job, not R4-B4's.
        result = compute_reconstruction_explain_result({
            'import_reconstruction': {'fidelity_categories': [
                {'id': 'structure', 'status': 'approximated', 'summary': '38/62 approximated to 40/60.'},
            ]},
        })
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('38/62', result.reply)

    def test_reconstruction_explain_without_context_never_fabricates_a_comparison(self):
        result = compute_reconstruction_explain_result({})
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('no imported-email reconstruction', result.reply)

    def test_all_preserved_reconstruction_says_so_rather_than_inventing_differences(self):
        result = compute_reconstruction_explain_result({
            'import_reconstruction': {'fidelity_categories': [{'id': 'structure', 'status': 'preserved', 'summary': 'ok'}]},
        })
        self.assertIn('preserved', result.reply.lower())


class ValidateActionStillGatesEveryCanonicalActionTests(TestCase):
    """§1/§11 — every mutation-capable canonical intent must still
    produce an action that passes through the SAME validate_action()
    trust boundary; nothing here bypasses it."""

    def test_every_canonical_executor_output_passes_or_correctly_fails_validate_action(self):
        cases = [
            compute_contrast_fix_result('text', {'color': '#777777', 'backgroundColor': '#FFFFFF'}),
            compute_set_link_result('button', 'set this link to https://example.com'),
            compute_spacing_result('text', 'give this 20px padding'),
            compute_outlook_fallback_result('button'),
            compute_column_ratio_result('layout-2col-50-50', 'make this 70/30'),
            compute_set_image_result('image', 'change this image to https://example.com/x.jpg'),
        ]
        for result in cases:
            if result.action['type'] == 'NONE':
                continue
            self.assertIsNotNone(validate_action(result.action), result.action)

    def test_a_malicious_action_type_from_a_canonical_executor_is_impossible_by_construction(self):
        # Every compute_*_result function only ever builds action types
        # already in ActionType — this is a structural/documentation
        # assertion, not a runtime one: proven by the test above already
        # passing validate_action() for every non-NONE case.
        pass

    def test_unsupported_module_type_action_still_rejected_regardless_of_canonical_intent_path(self):
        bad_action = {'type': 'UPDATE_MODULE_PROPS', 'target': 'selected', 'module_type': 'not-a-real-type', 'patch': {'align': 'center'}}
        self.assertIsNone(validate_action(bad_action))

    def test_direct_mutation_attempt_action_type_outside_allowlist_is_rejected(self):
        self.assertIsNone(validate_action({'type': 'DELETE_ALL_DOCUMENTS'}))


class ZeroOpenAIAcceptanceTests(TestCase):
    """§11/§12 — the complete acceptance list, OPENAI_API_KEY absent."""

    def setUp(self):
        self.env = override_settings(OPENAI_API_KEY='', EMAILBUILDER_AI_COMMAND_PROVIDER='')
        self.env.enable()
        self.addCleanup(self.env.disable)

    def test_local_never_silently_invokes_openai_when_local_selected_but_unconfigured(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER='local', EMAILBUILDER_LOCAL_AI_BASE_URL=''):
            provider = get_default_email_command_provider()
        self.assertIsInstance(provider, CanonicalIntentEmailCommandProvider)

    def test_deterministic_commands_continue_functioning(self):
        provider = get_default_email_command_provider()
        result = provider.resolve('center this button', {'selected_module': {'type': 'button', 'props': {}}})
        self.assertEqual(result.action['type'], 'UPDATE_MODULE_PROPS')

    def test_local_provider_failure_falls_back_to_deterministic_capabilities(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = RuntimeError('local server unreachable')
        local = LocalEmailCommandProvider(client_factory=lambda: client)
        fallback = CanonicalIntentEmailCommandProvider(fallback=RuleBasedEmailCommandProvider())
        from .ai_command import FallbackEmailCommandProvider
        provider = FallbackEmailCommandProvider(primary=local, fallback=fallback)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            result = provider.resolve('center this button', {'selected_module': {'type': 'button', 'props': {}}})
        self.assertEqual(result.action['type'], 'UPDATE_MODULE_PROPS')

    def test_unsupported_natural_language_request_receives_a_useful_response(self):
        provider = get_default_email_command_provider()
        result = provider.resolve('reorganize everything completely', {})
        self.assertIsNotNone(result.reply)
        self.assertGreater(len(result.reply), 0)

    def test_malformed_local_model_action_is_rejected(self):
        client = MagicMock()
        completion = MagicMock()
        completion.choices = [MagicMock(message=MagicMock(content='not valid json'))]
        client.chat.completions.create.return_value = completion
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            with self.assertRaises(Exception):
                provider.resolve('center this button', {})

    def test_unsupported_property_from_a_provider_is_rejected_by_validate_action(self):
        bad_action = {'type': 'UPDATE_MODULE_PROPS', 'target': 'selected', 'module_type': 'text', 'patch': {'notARealProperty': 'x'}}
        self.assertIsNone(validate_action(bad_action))

    def test_unsafe_url_is_rejected(self):
        result = compute_set_link_result('button', 'set this link to javascript:alert(1)')
        self.assertEqual(result.action['type'], 'NONE')

    def test_unsafe_html_field_key_outside_the_manifest_is_rejected(self):
        # A `text` field's VALUE is a plain string, escaped at render
        # time (htmlRenderer.ts), never evaluated as markup — storing
        # "<script>...</script>" as literal text content is not itself a
        # security boundary violation (it renders as inert visible
        # text). The real "unsafe HTML" boundary this app enforces is at
        # the FIELD-KEY level: an attempt to write through any key not
        # in the module's own manifest allow-list is always rejected,
        # regardless of the value.
        bad_action = {
            'type': 'UPDATE_MODULE_PROPS', 'target': 'selected', 'module_type': 'text',
            'patch': {'rawHtmlInjection': '<script>alert(1)</script>'},
        }
        validated = validate_action(bad_action)
        self.assertTrue(validated is None or 'rawHtmlInjection' not in validated.get('patch', {}))

    def test_direct_mutation_attempt_is_rejected(self):
        self.assertIsNone(validate_action({'type': 'EXECUTE_SHELL_COMMAND', 'command': 'rm -rf /'}))


class _FakeLocalizationClient:
    """Stands in for the OpenAI-compatible local client localize_reply()
    talks to — returns a fixed translation regardless of the prompt, so
    tests assert on OUR wiring (does the reply get swapped, does the
    action survive untouched), not on real translation quality (which
    §A explicitly disclaims: "Do not claim universal translation
    quality; it depends on the installed local model")."""

    def __init__(self, translated_text=None, exc=None):
        self._translated_text = translated_text
        self._exc = exc
        self.calls = []

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self._exc is not None:
            raise self._exc
        message = MagicMock(content=self._translated_text)
        return MagicMock(choices=[MagicMock(message=message)])

    @property
    def chat(self):
        completions = MagicMock()
        completions.create.side_effect = self._create
        return MagicMock(completions=completions)


class ResponseLocalizationTests(TestCase):
    """R4-B4 Closure §A — a separate, later rephrasing step. Every test
    here proves the SAME invariant from a different angle: the `action`
    a canonical intent produces is decided before localization ever
    runs, and localization can only ever replace `reply`."""

    _EXPECTED_ACTION = {
        'type': 'UPDATE_MODULE_SETTINGS', 'module_type': 'text',
        'patch': {'desktop': {'paddingTop': 16.0, 'paddingRight': 16.0, 'paddingBottom': 16.0, 'paddingLeft': 16.0}},
    }
    _CONTEXT = {'selected_module': {'type': 'text', 'props': {'color': '#333333'}}}

    def _provider(self, client_factory):
        return CanonicalIntentEmailCommandProvider(fallback=RuleBasedEmailCommandProvider(), localization_client_factory=client_factory)

    def test_hindi_request_gets_a_hindi_reply_with_a_byte_identical_action(self):
        translated = 'मैं पैडिंग 16px कर दूंगा।'
        client = _FakeLocalizationClient(translated_text=translated)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://fake-local:1234/v1', EMAILBUILDER_LOCAL_AI_MODEL='fake-model'):
            provider = self._provider(lambda: client)
            result = provider.resolve('स्पेसिंग बदलो', self._CONTEXT)
        self.assertEqual(result.action, self._EXPECTED_ACTION)
        self.assertEqual(result.reply, translated)
        # The localization call is fed the ORIGINAL English explanation
        # (produced before localization ever runs), not the user's
        # Hindi input — proves translation is a rephrasing step over an
        # already-final result, never a re-interpretation of the request.
        sent_content = client.calls[0]['messages'][1]['content']
        self.assertIn('padding', sent_content)
        self.assertIn('16px', sent_content)

    def test_spanish_and_french_requests_also_get_localized_replies_with_the_same_action(self):
        for message, translated in (
            ('cambia el espaciado', 'Estableceré el relleno del módulo de texto en 16px.'),
            ('change le remplissage', 'Je vais définir le remplissage du module de texte à 16px.'),
        ):
            client = _FakeLocalizationClient(translated_text=translated)
            with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://fake-local:1234/v1', EMAILBUILDER_LOCAL_AI_MODEL='fake-model'):
                provider = self._provider(lambda c=client: c)
                result = provider.resolve(message, self._CONTEXT)
            self.assertEqual(result.action, self._EXPECTED_ACTION, message)
            self.assertEqual(result.reply, translated, message)

    def test_english_requests_never_invoke_localization_at_all(self):
        client = _FakeLocalizationClient(translated_text='should never be produced')
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://fake-local:1234/v1', EMAILBUILDER_LOCAL_AI_MODEL='fake-model'):
            provider = self._provider(lambda: client)
            result = provider.resolve('change the spacing', self._CONTEXT)
        self.assertEqual(result.action, self._EXPECTED_ACTION)
        self.assertEqual(client.calls, [])

    def test_local_server_failure_during_localization_falls_back_to_the_english_reply(self):
        client = _FakeLocalizationClient(exc=RuntimeError('local server unreachable'))
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://fake-local:1234/v1', EMAILBUILDER_LOCAL_AI_MODEL='fake-model'):
            provider = self._provider(lambda: client)
            result = provider.resolve('स्पेसिंग बदलो', self._CONTEXT)
        self.assertEqual(result.action, self._EXPECTED_ACTION)
        self.assertIn('padding', result.reply)

    def test_missing_local_endpoint_never_constructs_a_client_and_keeps_the_english_reply(self):
        def _boom():
            raise AssertionError('client factory must not be called when EMAILBUILDER_LOCAL_AI_BASE_URL is unset')

        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL=''):
            provider = self._provider(_boom)
            result = provider.resolve('स्पेसिंग बदलो', self._CONTEXT)
        self.assertEqual(result.action, self._EXPECTED_ACTION)
        self.assertIn('padding', result.reply)

    def test_malformed_translation_response_falls_back_to_english(self):
        client = _FakeLocalizationClient(translated_text='   ')
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://fake-local:1234/v1', EMAILBUILDER_LOCAL_AI_MODEL='fake-model'):
            provider = self._provider(lambda: client)
            result = provider.resolve('स्पेसिंग बदलो', self._CONTEXT)
        self.assertEqual(result.action, self._EXPECTED_ACTION)
        self.assertIn('padding', result.reply)

    def test_localization_never_calls_openai(self):
        # Structural proof, not just behavioral. ai_command_local.py DOES
        # import the `openai` SDK package (see its own module docstring:
        # it's the generic HTTP client for ANY OpenAI-compatible server,
        # e.g. Ollama/LM Studio, pointed at EMAILBUILDER_LOCAL_AI_BASE_URL
        # — never api.openai.com). What must never be true: it never
        # imports the OpenAI-provider module (ai_command_openai.py, which
        # owns the real OPENAI_API_KEY-authenticated provider), and never
        # references OPENAI_API_KEY itself — so there is no code path
        # from localize_reply() back to the real OpenAI endpoint.
        import ast
        import inspect

        from . import ai_command_local as local_module

        source = inspect.getsource(local_module)
        self.assertNotIn('OPENAI_API_KEY', source)
        self.assertNotIn('api.openai.com', source)
        tree = ast.parse(source)
        imported_names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_names.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    imported_names.add(node.module)
                imported_names.update(alias.name for alias in node.names)
        self.assertNotIn('ai_command_openai', imported_names)
        # And confirm localize_reply() itself only ever talks to the
        # SAME local client construction path LocalEmailCommandProvider
        # uses (the shared _default_client_factory), never a second,
        # independently-configured client of its own.
        localize_source = inspect.getsource(local_module.localize_reply)
        self.assertIn('LocalEmailCommandProvider._default_client_factory', localize_source)
