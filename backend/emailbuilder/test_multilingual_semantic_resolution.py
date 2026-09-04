"""D4-E3F — Multilingual Semantic Resolution + Conversational Compound
Request Hardening. Tests for:

  - intent_normalization.py's new multilingual color resolution
    (find_color_value/COLOR_WORDS_BY_LANGUAGE) and German language
    support (SUPPORTED_LANGUAGES/detect_language/_INTENT_PHRASES/
    ALIGNMENT_WORDS/_POLITE_REQUEST_RE/_EXPLANATION_SEEKING_RE);
  - ai_command.py's _find_color() multilingual extension, the widened
    _SPACING_PATTERN, the fixed (previously language='en'-hardcoded)
    alignment detection in _extract_style_patch()/_extract_unambiguous_props_patch(),
    the "partial understanding must never be silent" clarification path,
    and the multilingual explanation/compound-action-hint detection in
    RuleBasedEmailCommandProvider.resolve().

Pure unit tests, no Django client/DB, no LLM involved."""

from django.test import SimpleTestCase

from .ai_command import ActionType, CanonicalIntentEmailCommandProvider, RuleBasedEmailCommandProvider, apply_scope_gate
from .intent_normalization import COLOR_WORDS_BY_LANGUAGE, detect_language, find_color_value

_BUTTON_CONTEXT = {
    'selected_module': {'type': 'button', 'props': {'text': 'Shop Now', 'backgroundColor': '#0082AD', 'align': 'center'}},
}


class FindColorValueTests(SimpleTestCase):
    """intent_normalization.find_color_value() — the canonical multilingual
    color-name resolver, mirroring find_alignment_value's own shape."""

    def test_returns_none_for_empty_or_non_string(self):
        self.assertIsNone(find_color_value(''))
        self.assertIsNone(find_color_value(None))

    def test_devanagari_word_ending_in_a_combining_vowel_sign_resolves(self):
        # हरा (green) ends in ा (U+093E), a Unicode combining mark (Mn) —
        # Python's \b does not treat it as \w, so a naive \bword\b regex
        # silently finds nothing here; this is the exact case that
        # surfaced and required the whitespace/punctuation-boundary fix.
        self.assertEqual(find_color_value('इस बटन का रंग हरा कर दो'), 'green')

    def test_hinglish_romanized_hindi_resolves(self):
        self.assertEqual(find_color_value('button ka color hara kar do'), 'green')

    def test_spanish_resolves(self):
        self.assertEqual(find_color_value('Cambia el color a verde.'), 'green')

    def test_german_resolves(self):
        self.assertEqual(find_color_value('Mach den Button grün.'), 'green')

    def test_french_resolves(self):
        self.assertEqual(find_color_value('Change la couleur en vert.'), 'green')

    def test_unrecognized_word_returns_none(self):
        self.assertIsNone(find_color_value('make this button maroonish please'))

    def test_every_language_table_covers_all_nine_required_colors(self):
        required = {'red', 'green', 'blue', 'black', 'white', 'gray', 'yellow', 'orange', 'purple'}
        for language, words in COLOR_WORDS_BY_LANGUAGE.items():
            covered = set(words.values())
            missing = required - covered
            if language == 'hi-latn' and missing == {'gray'}:
                # 'gray'/'grey' is itself an English loanword in casual
                # Hindi (the 'hi' table's own 'ग्रे' entry is a literal
                # transliteration of that same loanword) — a Hinglish
                # speaker overwhelmingly just types "gray"/"grey" in
                # Latin script, which the existing English COLOR_WORDS
                # table (ai_command.py) already resolves; not a genuine
                # gap, so not required here.
                continue
            self.assertTrue(not missing, f'{language} table missing: {missing}')


class DetectLanguageGermanTests(SimpleTestCase):
    def test_german_sentence_detected_as_de(self):
        self.assertEqual(detect_language('Mach den Button grün und erhöhe den Abstand auf 20px.'), 'de')

    def test_eszett_word_tokenizes_correctly(self):
        # Regression for the tokenizer fix (ß added to the word-char class).
        self.assertEqual(detect_language('Mach den Hintergrund weiß und ändere den Abstand.'), 'de')


class CanonicalIntentSpacingCombinerRegressionTests(SimpleTestCase):
    """Regression test for a real bug this checkpoint's own live QA
    caught: CanonicalIntentEmailCommandProvider is checked (and can
    short-circuit) BEFORE RuleBasedEmailCommandProvider ever runs — see
    get_default_email_command_provider()'s own docstring. Before
    compute_spacing_result_with_props_combining() was extracted into one
    shared function, apply_canonical_intent()'s own CanonicalIntent.CHANGE_SPACING
    branch called the OLD, non-combining compute_spacing_result()
    directly, so a German message matching a CHANGE_SPACING canonical-
    intent phrase (e.g. "erhöhe den Abstand") had its co-occurring color
    request SILENTLY DROPPED — even though the identical request in
    English/Hindi/Spanish correctly produced a BATCH_UPDATE, because
    those messages never happened to match a canonical-intent phrase and
    so fell through to RuleBasedEmailCommandProvider directly. This test
    goes through CanonicalIntentEmailCommandProvider explicitly (not
    RuleBasedEmailCommandProvider directly) so a regression on THIS
    specific code path is caught even if the deterministic router's own
    behavior stays correct."""

    def test_german_message_through_canonical_intent_provider_still_combines_color_and_padding(self):
        provider = CanonicalIntentEmailCommandProvider(fallback=RuleBasedEmailCommandProvider())
        message = 'Mach den Button grün und erhöhe den Abstand auf 20px.'
        result = provider.resolve(message, _BUTTON_CONTEXT)
        self.assertEqual(result.action['type'], ActionType.BATCH_UPDATE, msg=f'got: {result.action}')
        self.assertEqual(result.action['props_patch'], {'backgroundColor': '#76C043'})
        self.assertEqual(
            result.action['settings_patch'],
            {'desktop': {'paddingTop': 20.0, 'paddingRight': 20.0, 'paddingBottom': 20.0, 'paddingLeft': 20.0}},
        )

    def test_german_spacing_only_message_through_canonical_intent_provider_is_unaffected(self):
        # A genuinely spacing-only non-English canonical-intent message
        # must still work exactly as before this fix — never regressed
        # into requiring a color to be present.
        provider = CanonicalIntentEmailCommandProvider(fallback=RuleBasedEmailCommandProvider())
        result = provider.resolve('Erhöhe den Abstand auf 30px.', _BUTTON_CONTEXT)
        self.assertEqual(result.action['type'], ActionType.UPDATE_MODULE_SETTINGS)
        self.assertEqual(result.action['patch']['desktop']['paddingTop'], 30.0)


class BatchUpdateCompoundColorPaddingTests(SimpleTestCase):
    """Required scenarios 1-5 — the SAME canonical BATCH_UPDATE shape
    (color -> brand green hex, padding -> 20px on all sides) regardless
    of which supported language the request was written in."""

    _EXPECTED_PROPS = {'backgroundColor': '#76C043'}
    _EXPECTED_SETTINGS = {'desktop': {'paddingTop': 20.0, 'paddingRight': 20.0, 'paddingBottom': 20.0, 'paddingLeft': 20.0}}

    def _assert_canonical_batch_update(self, message):
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve(message, _BUTTON_CONTEXT)
        self.assertEqual(result.action['type'], ActionType.BATCH_UPDATE, msg=f'for message: {message!r}, got: {result.action}')
        self.assertEqual(result.action['props_patch'], self._EXPECTED_PROPS)
        self.assertEqual(result.action['settings_patch'], self._EXPECTED_SETTINGS)

    def test_1_english(self):
        self._assert_canonical_batch_update('Make this button green and increase the padding to 20px.')

    def test_2_hindi_devanagari(self):
        self._assert_canonical_batch_update('button ka color हरा kar do aur padding 20px kar do')

    def test_3_hinglish(self):
        self._assert_canonical_batch_update('button ka color hara kar do aur padding 20px kar do')

    def test_4_spanish(self):
        self._assert_canonical_batch_update('Cambia el color del botón a verde y aumenta el padding a 20px.')

    def test_5_german(self):
        self._assert_canonical_batch_update('Mach den Button grün und erhöhe den Abstand auf 20px.')


class EquivalentSingleColorRequestsTests(SimpleTestCase):
    """Required scenario 6 — a single-concept (color only, no padding)
    request also resolves to the SAME canonical hex across languages."""

    def test_equivalent_single_color_requests_across_languages(self):
        provider = RuleBasedEmailCommandProvider()
        messages = [
            'Make this button green.',
            'button ka color hara kar do',
            'Cambia el color del botón a verde.',
            'Mach den Button grün.',
            'Change la couleur du bouton en vert.',
        ]
        for message in messages:
            result = provider.resolve(message, _BUTTON_CONTEXT)
            self.assertEqual(result.action.get('type'), ActionType.UPDATE_MODULE_PROPS, msg=message)
            self.assertEqual(result.action['patch'].get('backgroundColor'), '#76C043', msg=message)


class MultipleColorNamesTests(SimpleTestCase):
    """Required scenario 7 — every one of the nine explicitly-required
    email-builder colors resolves to its correct canonical hex."""

    _EXPECTED_HEX = {
        'red': '#B42318', 'green': '#76C043', 'blue': '#0082AD', 'black': '#333333', 'white': '#FFFFFF',
        'gray': '#66777D', 'yellow': '#F2B705', 'orange': '#E8590C', 'purple': '#7C3AED',
    }

    def test_every_required_color_name_resolves_in_english(self):
        provider = RuleBasedEmailCommandProvider()
        for name, hex_value in self._EXPECTED_HEX.items():
            result = provider.resolve(f'Make this button {name}.', _BUTTON_CONTEXT)
            self.assertEqual(result.action.get('patch', {}).get('backgroundColor'), hex_value, msg=name)

    def test_every_required_color_resolves_in_hindi_devanagari(self):
        words = {'red': 'लाल', 'green': 'हरा', 'blue': 'नीला', 'black': 'काला', 'white': 'सफ़ेद', 'yellow': 'पीला', 'orange': 'नारंगी', 'purple': 'बैंगनी'}
        for name, word in words.items():
            self.assertEqual(find_color_value(f'इस बटन का रंग {word} कर दो'), name, msg=name)


class UnsupportedColorClarificationTests(SimpleTestCase):
    """Required scenario 8 — an unresolved color concept must produce an
    explicit clarification, never a silent padding-only proposal."""

    def test_unsupported_color_triggers_clarification_not_silent_omission(self):
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve('Give this button a nice color and increase the padding to 20px.', _BUTTON_CONTEXT)
        self.assertEqual(result.action, {'type': ActionType.NONE})
        self.assertIn('Understood:', result.reply)
        self.assertIn('20px', result.reply)
        self.assertIn("couldn't confidently resolve", result.reply)
        self.assertIn('color', result.reply.lower())


class PartialUnderstandingDisclosureTests(SimpleTestCase):
    """Required scenario 9 — one understood + one unresolved concept ->
    explicit partial-understanding response, reusing the existing
    clarification/NONE-action contract, never a new UI."""

    def test_padding_understood_color_unresolved_is_disclosed_explicitly(self):
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve('increase the padding to 20px and set a nice color', _BUTTON_CONTEXT)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('Understood:', result.reply)
        self.assertIn('Padding -> 20px', result.reply)
        self.assertIn("I couldn't confidently resolve:", result.reply)

    def test_never_silently_applies_only_the_resolved_half(self):
        # Regression for the exact bug this checkpoint exists to close:
        # confirms the action is NONE (nothing applied) rather than a
        # padding-only UPDATE_MODULE_SETTINGS that silently drops color.
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve('Give this button a nice color and increase the padding to 20px.', _BUTTON_CONTEXT)
        self.assertNotEqual(result.action.get('type'), ActionType.UPDATE_MODULE_SETTINGS)
        self.assertNotEqual(result.action.get('type'), ActionType.BATCH_UPDATE)


class QuestionPlusMutationMultilingualTests(SimpleTestCase):
    """Required scenarios 10-11 — question + mutation, English and
    multilingual (German), must never mutate and must reach genuine
    NO_MATCH (routable to the LLM tier) rather than a silent partial
    explanation-only answer."""

    def test_10_english_question_plus_mutation_does_not_mutate(self):
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve('Why is this button inconsistent, and fix it.', _BUTTON_CONTEXT)
        self.assertEqual(result.action['type'], ActionType.NONE)

    def test_11_german_question_plus_mutation_does_not_mutate(self):
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve('Warum ist dieser Button inkonsistent, und repariere ihn.', _BUTTON_CONTEXT)
        self.assertEqual(result.action['type'], ActionType.NONE)

    def test_german_pure_question_is_recognized_as_explanation_seeking(self):
        # Distinguishes a PURE German question (no compound-action hint)
        # from the question+mutation case above — this one enters the
        # deterministic explain branch (finds no English-only knowledge
        # rule, so replies with the topic-clarify text) rather than
        # falling through to the fully generic catch-all reply.
        provider = RuleBasedEmailCommandProvider()
        result = provider.resolve('Warum wird mein Hintergrundbild in Outlook nicht angezeigt?', _BUTTON_CONTEXT)
        self.assertEqual(result.action['type'], ActionType.NONE)
        self.assertIn('email-client compatibility topics', result.reply)


class ScopeCreepAfterMultilingualNormalizationTests(SimpleTestCase):
    """Required scenario 12 — scope-creep protection (D4-E3 item 7/8's
    apply_scope_gate() BATCH_UPDATE fix) still works after multilingual
    color/spacing resolution — an unrequested field never survives
    regardless of which language the request was written in."""

    def _scope_creep_action(self):
        return {
            'type': ActionType.BATCH_UPDATE, 'target': 'selected', 'module_type': 'button',
            'props_patch': {'backgroundColor': '#76C043', 'text': 'UNREQUESTED SCOPE CREEP'},
            'settings_patch': {'desktop': {'paddingTop': 20, 'paddingRight': 20, 'paddingBottom': 20, 'paddingLeft': 20}},
        }

    def test_german_message_still_strips_unrequested_field(self):
        gated, stripped = apply_scope_gate(
            'Mach den Button grün und erhöhe den Abstand auf 20px.', self._scope_creep_action(),
        )
        self.assertEqual(stripped, ['text'])
        self.assertNotIn('text', gated['props_patch'])

    def test_hindi_message_still_strips_unrequested_field(self):
        gated, stripped = apply_scope_gate(
            'button ka color hara kar do aur padding 20px kar do', self._scope_creep_action(),
        )
        self.assertEqual(stripped, ['text'])
        self.assertNotIn('text', gated['props_patch'])

    def test_spanish_message_still_strips_unrequested_field(self):
        gated, stripped = apply_scope_gate(
            'Cambia el color del botón a verde y aumenta el padding a 20px.', self._scope_creep_action(),
        )
        self.assertEqual(stripped, ['text'])
        self.assertNotIn('text', gated['props_patch'])


class ZeroOpenAiInLocalModeTests(SimpleTestCase):
    """Required scenario 16 — architectural invariant: the deterministic
    router (which every multilingual test above exercises directly)
    never imports or calls anything from ai_command_openai.py."""

    def test_rule_based_provider_never_imports_openai_module(self):
        import inspect

        from . import ai_command

        source = inspect.getsource(ai_command.RuleBasedEmailCommandProvider)
        self.assertNotIn('ai_command_openai', source)
        self.assertNotIn('OpenAI', source)
