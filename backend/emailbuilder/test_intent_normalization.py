"""R4-B3 §A/§I — canonical intent + language detection tests."""

from django.test import SimpleTestCase, TestCase, override_settings

from .ai_command import CanonicalIntentEmailCommandProvider, EmailCommandProvider, apply_canonical_intent
from .intent_normalization import CanonicalIntent, EXECUTABLE_INTENTS, detect_language, normalize_intent


class DetectLanguageTests(SimpleTestCase):
    def test_english_default(self):
        self.assertEqual(detect_language('add a button please'), 'en')

    def test_hindi_devanagari(self):
        self.assertEqual(detect_language('कंट्रास्ट ठीक करो'), 'hi')

    def test_spanish_stopwords(self):
        self.assertEqual(detect_language('cambia el enlace por favor'), 'es')

    def test_french_stopwords(self):
        self.assertEqual(detect_language('change le lien pour le bouton'), 'fr')

    def test_empty_defaults_to_english(self):
        self.assertEqual(detect_language(''), 'en')
        self.assertEqual(detect_language(None), 'en')

    def test_mixed_language_still_returns_a_supported_language(self):
        # Mixed English/Spanish — must never crash, must return one of
        # the supported languages (not necessarily a specific one).
        from .intent_normalization import SUPPORTED_LANGUAGES
        result = detect_language('please cambia el fondo to blue')
        self.assertIn(result, SUPPORTED_LANGUAGES)


class NormalizeIntentTests(SimpleTestCase):
    def test_english_fix_contrast(self):
        intent, confidence, language = normalize_intent('fix the contrast')
        self.assertEqual(intent, CanonicalIntent.FIX_CONTRAST)
        self.assertGreater(confidence, 0)
        self.assertEqual(language, 'en')

    def test_spanish_fix_contrast(self):
        intent, _confidence, language = normalize_intent('arregla el contraste')
        self.assertEqual(intent, CanonicalIntent.FIX_CONTRAST)
        self.assertEqual(language, 'es')

    def test_french_fix_contrast(self):
        intent, _confidence, language = normalize_intent('corrige le contraste')
        self.assertEqual(intent, CanonicalIntent.FIX_CONTRAST)
        self.assertEqual(language, 'fr')

    def test_hindi_fix_contrast(self):
        intent, _confidence, language = normalize_intent('कंट्रास्ट ठीक करो')
        self.assertEqual(intent, CanonicalIntent.FIX_CONTRAST)
        self.assertEqual(language, 'hi')

    def test_unmatched_message_returns_none_intent(self):
        intent, confidence, _language = normalize_intent('add a divider please')
        self.assertIsNone(intent)
        self.assertEqual(confidence, 0.0)

    def test_empty_message(self):
        intent, confidence, language = normalize_intent('')
        self.assertIsNone(intent)
        self.assertEqual(confidence, 0.0)
        self.assertEqual(language, 'en')

    def test_every_canonical_intent_has_at_least_one_english_phrase(self):
        for intent in CanonicalIntent.values:
            intent2, _c, _lang = normalize_intent(_first_phrase(intent, 'en'))
            self.assertEqual(intent2, intent, f'{intent} did not round-trip from its own English phrase')

    def test_every_r4b3_spec_f_example_question_classifies_as_compare_import_reconstruction(self):
        # R4-B3 §F's own verbatim example questions — every one must
        # recognize as this canonical intent, in English, curly-quote
        # apostrophes included exactly as the spec itself used them.
        questions = [
            'What changed during import?', 'Why is this 40/60 instead of 38/62?',
            'Which differences can you fix?', 'Why was this removed?',
            'Can the builder reproduce this exactly?',
            # Curly apostrophe (U+2019) built via chr() rather than a
            # literal character in this file — this environment's Python
            # source decoder does not reliably round-trip a literal
            # U+2019 embedded directly in a .py file (verified
            # independently: normalize_intent() correctly treats a real
            # U+2019 identically to a straight apostrophe when the string
            # value itself is correct — see intent_normalization.py's own
            # curly-quote normalization line; the bug is specific to how
            # THIS source file gets decoded, not to the classification
            # logic itself).
            'Why doesn' + chr(0x2019) + 't this look like the original?', 'What was normalized?',
            'What was removed for security?', 'Can you make this section closer to the original?',
        ]
        for question in questions:
            intent, _confidence, _lang = normalize_intent(question)
            self.assertEqual(intent, CanonicalIntent.COMPARE_IMPORT_RECONSTRUCTION, question)

    def test_language_recognized_regardless_of_whether_the_intent_is_executable(self):
        # SET_LINK is detected (a real canonical intent) but NOT in
        # EXECUTABLE_INTENTS — normalize_intent must still recognize it.
        intent, _c, _lang = normalize_intent('change the link')
        self.assertEqual(intent, CanonicalIntent.SET_LINK)
        self.assertNotIn(CanonicalIntent.SET_LINK, EXECUTABLE_INTENTS)


def _first_phrase(intent, language):
    from .intent_normalization import _INTENT_PHRASES  # noqa: SLF001 - test-only introspection
    return _INTENT_PHRASES[intent][language][0]


class ApplyCanonicalIntentTests(TestCase):
    def test_fix_contrast_produces_the_same_action_shape_as_the_english_path(self):
        context = {'selected_module': {'type': 'text', 'props': {'color': '#777777', 'backgroundColor': '#FFFFFF'}}}
        result = apply_canonical_intent(CanonicalIntent.FIX_CONTRAST, context)
        self.assertEqual(result.action['type'], 'UPDATE_MODULE_PROPS')
        self.assertIn('color', result.action['patch'])

    def test_fix_contrast_with_no_selection_declines_safely(self):
        result = apply_canonical_intent(CanonicalIntent.FIX_CONTRAST, {})
        self.assertEqual(result.action['type'], 'NONE')

    def test_non_executable_intent_returns_none(self):
        self.assertIsNone(apply_canonical_intent(CanonicalIntent.SET_LINK, {}))

    def test_malformed_context_never_raises(self):
        self.assertIsNotNone(apply_canonical_intent(CanonicalIntent.FIX_CONTRAST, None))
        self.assertIsNotNone(apply_canonical_intent(CanonicalIntent.FIX_CONTRAST, {'selected_module': 'not-a-dict'}))


class _FakeFallback(EmailCommandProvider):
    def __init__(self):
        self.calls = []

    def resolve(self, message, context):
        from .ai_command import ActionType, CommandResult
        self.calls.append(message)
        return CommandResult(reply='fallback reply', action={'type': ActionType.NONE}, confidence=0.0)


class CanonicalIntentEmailCommandProviderTests(TestCase):
    def test_non_english_executable_intent_bypasses_the_fallback_entirely(self):
        fallback = _FakeFallback()
        provider = CanonicalIntentEmailCommandProvider(fallback=fallback)
        context = {'selected_module': {'type': 'text', 'props': {'color': '#777777', 'backgroundColor': '#FFFFFF'}}}
        result = provider.resolve('arregla el contraste', context)
        self.assertEqual(result.action['type'], 'UPDATE_MODULE_PROPS')
        self.assertEqual(fallback.calls, [])  # never reached — proves the bypass, not just "it works"

    def test_english_message_always_reaches_the_fallback_unchanged(self):
        # English input must behave EXACTLY as if this wrapper did not
        # exist (R4-B2's own instruction: "do not redesign") — the
        # existing English-pattern RuleBasedEmailCommandProvider branch
        # already handles "fix the contrast" itself; this wrapper only
        # ever intercepts for language != 'en'.
        fallback = _FakeFallback()
        provider = CanonicalIntentEmailCommandProvider(fallback=fallback)
        provider.resolve('fix the contrast', {'selected_module': {'type': 'text', 'props': {}}})
        self.assertEqual(fallback.calls, ['fix the contrast'])

    def test_non_english_non_executable_intent_falls_through_to_fallback(self):
        fallback = _FakeFallback()
        provider = CanonicalIntentEmailCommandProvider(fallback=fallback)
        provider.resolve('cambia el enlace', {})
        self.assertEqual(fallback.calls, ['cambia el enlace'])

    def test_non_english_unmatched_message_falls_through_to_fallback(self):
        fallback = _FakeFallback()
        provider = CanonicalIntentEmailCommandProvider(fallback=fallback)
        provider.resolve('esto no coincide con nada', {})
        self.assertEqual(fallback.calls, ['esto no coincide con nada'])


class ProviderChainIntegrationTests(TestCase):
    def test_default_provider_chain_executes_spanish_contrast_fix_deterministically(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER=''):
            from .ai_command import get_default_email_command_provider
            provider = get_default_email_command_provider()
            result = provider.resolve(
                'arregla el contraste',
                {'selected_module': {'type': 'text', 'props': {'color': '#777777', 'backgroundColor': '#FFFFFF'}}},
            )
        self.assertEqual(result.action['type'], 'UPDATE_MODULE_PROPS')
        # Never routed through any AI provider label — genuinely
        # deterministic, exactly like the English path.
        self.assertNotIn(result.provider, ('local', 'openai'))
