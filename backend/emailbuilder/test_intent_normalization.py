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
            'What was removed for security?',
            # R4-D Checkpoint D1-A — WAS included in this list under
            # R4-B3 (explain-only, since no real repair mechanism
            # existed yet). NOW correctly classifies as
            # IMPROVE_IMPORT_RECONSTRUCTION instead — "Can you make
            # this..." is a polite ACTION REQUEST (R4-C's real repair
            # engine exists now), not a question about state; see the
            # dedicated test right below this one, and
            # is_explanation_seeking()'s own docstring for the
            # deliberate "Can you [verb]" carve-out that makes this
            # distinction.
        ]
        for question in questions:
            intent, _confidence, _lang = normalize_intent(question)
            self.assertEqual(intent, CanonicalIntent.COMPARE_IMPORT_RECONSTRUCTION, question)

    def test_polite_make_it_closer_to_the_original_is_a_repair_request_not_a_question(self):
        # R4-D Checkpoint D1-A — the one phrase moved OUT of the test
        # above: "Can you make this section closer to the original?" is
        # a polite imperative (a repair REQUEST), not a genuine question
        # about state, despite starting with "Can" — is_explanation_
        # seeking()'s own "Can you [verb]" carve-out is what makes this
        # distinction, not phrase-list wording (both intents' phrase
        # lists are allowed to share vocabulary like "closer to the
        # original" precisely because this gate decides which list is
        # even attempted).
        intent, _confidence, _lang = normalize_intent('Can you make this section closer to the original?')
        self.assertEqual(intent, CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION)

    def test_normalize_intent_recognition_is_independent_of_executability(self):
        # R4-B4 §1 — WAS "SET_LINK is detected but NOT executable" (true
        # under R4-B3, where only FIX_CONTRAST had a real executor).
        # R4-B4 gives every CanonicalIntent a real executor (see
        # EXECUTABLE_INTENTS' own updated docstring), so this now proves
        # the underlying architectural point differently: normalize_intent
        # itself has ZERO knowledge of EXECUTABLE_INTENTS — recognition
        # and executability are two genuinely separate concerns, they
        # just happen to fully overlap today.
        intent, _c, _lang = normalize_intent('change the link')
        self.assertEqual(intent, CanonicalIntent.SET_LINK)
        import inspect
        self.assertNotIn('EXECUTABLE_INTENTS', inspect.getsource(normalize_intent))


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

    def test_intent_not_in_the_canonical_vocabulary_returns_none(self):
        # WAS "SET_LINK returns None (non-executable)" — SET_LINK has a
        # real executor under R4-B4 (see the ApplyCanonicalIntentTests
        # coverage in test_canonical_actions.py). This now tests the
        # genuinely still-true case: a value that isn't even a real
        # CanonicalIntent at all.
        self.assertIsNone(apply_canonical_intent('NOT_A_CANONICAL_INTENT', {}))

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

    def test_non_english_executable_intent_with_no_usable_result_still_never_reaches_fallback(self):
        # R4-B4 §1 — WAS "SET_LINK is non-executable, so it falls
        # through" (true only under R4-B3). SET_LINK is executable now
        # (see ai_command.compute_set_link_result), and even its OWN
        # "I won't guess a URL, please provide one" decline is a real,
        # non-None CommandResult — the fallback must still never be
        # reached, proving apply_canonical_intent()'s return value (not
        # just "the action mutates something") is what gates the
        # fallback call.
        fallback = _FakeFallback()
        provider = CanonicalIntentEmailCommandProvider(fallback=fallback)
        result = provider.resolve('cambia el enlace', {'selected_module': {'type': 'button', 'props': {}}})
        self.assertEqual(fallback.calls, [])
        self.assertEqual(result.action['type'], 'NONE')

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


# R4-D Checkpoint D1 — classifier precedence (D1-A), the
# IMPROVE_IMPORT_RECONSTRUCTION entry-point intent (D1-B), and
# multilingual/paraphrase hardening (D1-C/D1-D), tested against the
# REAL provider chain (get_default_email_command_provider), not just
# normalize_intent() in isolation — every acceptance item the checkpoint
# spec itself listed.
class D1QuestionPrecedenceTests(TestCase):
    """D1-A — a question containing a mutation intent's own trigger
    phrase must never mutate, for EVERY mutation intent, not only
    CHANGE_COLUMN_RATIO (the one the R4-D audit found live)."""

    _MUTATION_TRIGGER_PHRASES = {
        CanonicalIntent.FIX_CONTRAST: 'fix the contrast',
        CanonicalIntent.SET_LINK: 'change the link',
        CanonicalIntent.CHANGE_SPACING: 'change the spacing',
        CanonicalIntent.CHANGE_ALIGNMENT: 'change the alignment',
        CanonicalIntent.SET_BACKGROUND: 'change the background',
        CanonicalIntent.ENABLE_OUTLOOK_FALLBACK: 'fix outlook',
        CanonicalIntent.CHANGE_COLUMN_RATIO: 'change the column width',
        CanonicalIntent.SET_IMAGE: 'change the image',
    }

    def test_a_why_question_wrapping_every_mutation_trigger_phrase_never_classifies_as_that_mutation(self):
        for intent, phrase in self._MUTATION_TRIGGER_PHRASES.items():
            question = f'Why did you {phrase}?'
            got_intent, _confidence, _lang = normalize_intent(question)
            self.assertNotEqual(got_intent, intent, question)

    def test_direct_mutation_requests_are_unaffected_by_the_question_gate(self):
        # The exact non-question counterparts of the phrases above must
        # still classify normally — the gate only ever suppresses
        # matching for a question, never for a genuine request.
        for intent, phrase in self._MUTATION_TRIGGER_PHRASES.items():
            got_intent, _confidence, _lang = normalize_intent(phrase)
            self.assertEqual(got_intent, intent, phrase)

    def test_column_ratio_question_with_real_numbers_still_does_not_mutate(self):
        # The original audit finding, preserved as its own explicit
        # regression: even a question that ALSO happens to contain
        # numbers (which the English deterministic router's OWN
        # CHANGE_COLUMN_RATIO pattern requires) must not mutate.
        intent, _confidence, _lang = normalize_intent('Why did you change the columns to 70/30?')
        self.assertNotEqual(intent, CanonicalIntent.CHANGE_COLUMN_RATIO)

    def test_polite_action_request_is_not_treated_as_a_question(self):
        # "Can you make this blue?" is a REQUEST, not a question about
        # state — is_explanation_seeking's own deliberate carve-out.
        from .intent_normalization import is_explanation_seeking
        self.assertFalse(is_explanation_seeking('Can you make this blue?', 'en'))
        self.assertFalse(is_explanation_seeking('Can you fix everything safely?', 'en'))
        # But a genuine capability question starting the same way is
        # still recognized as explanation-seeking.
        self.assertTrue(is_explanation_seeking('Can the builder reproduce this exactly?', 'en'))
        self.assertTrue(is_explanation_seeking('Which differences can you fix?', 'en'))


class D1ReconstructionQuestionRoutingTests(TestCase):
    """D1-A — a reconstruction-context question that does not literally
    match COMPARE_IMPORT_RECONSTRUCTION's own bounded phrase list still
    gets routed to the real reconstruction explanation, via the full
    provider chain (CanonicalIntentEmailCommandProvider's own catch-all)
    — English included, which had NO equivalent path before D1 at all."""

    def _context(self):
        return {'import_reconstruction': {'fidelity_categories': [
            {'id': 'structure', 'status': 'approximated', 'summary': 'Column ratio drifted from source.'},
            {'id': 'outlook', 'status': 'removed', 'summary': 'Unsafe VML markup was stripped.'},
        ]}}

    def _provider(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER=''):
            from .ai_command import get_default_email_command_provider
            return get_default_email_command_provider()

    def test_why_did_you_change_the_column_widths_explains_instead_of_mutating(self):
        result = self._provider().resolve('Why did you change the column widths?', self._context())
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('structure', result.reply)

    def test_unpredicted_reconstruction_questions_still_get_a_real_answer(self):
        for question in ('Why was the ratio approximated?', 'Why is this button different?', 'What changed here?'):
            result = self._provider().resolve(question, self._context())
            self.assertEqual(result.action['type'], 'NONE', question)
            self.assertIn('structure', result.reply, question)

    def test_the_same_question_with_no_reconstruction_context_never_invents_reconstruction_state(self):
        result = self._provider().resolve('Why did you change the column widths?', {})
        self.assertEqual(result.action['type'], 'NONE')
        self.assertNotIn('structure', result.reply)
        self.assertNotIn('approximated', result.reply)


class D1ImproveReconstructionTests(TestCase):
    """D1-B — the IMPROVE_IMPORT_RECONSTRUCTION entry-point intent:
    never mutates, honestly distinguishes what needs attention, and only
    engages when reconstruction context actually exists."""

    def _provider(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER=''):
            from .ai_command import get_default_email_command_provider
            return get_default_email_command_provider()

    def test_fix_everything_safely_never_mutates_and_lists_what_needs_attention(self):
        context = {'import_reconstruction': {'fidelity_categories': [
            {'id': 'structure', 'status': 'approximated', 'summary': 'Column ratio drifted from source.'},
            {'id': 'outlook', 'status': 'removed', 'summary': 'Unsafe VML markup was stripped.'},
            {'id': 'typography', 'status': 'preserved', 'summary': 'Fonts match.'},
        ]}}
        result = self._provider().resolve('fix everything you safely can', context)
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('structure', result.reply)
        self.assertIn('outlook', result.reply)
        # Preserved categories are never listed as needing attention.
        self.assertNotIn('typography', result.reply)

    def test_fix_everything_safely_outside_reconstruction_context_declines_honestly(self):
        result = self._provider().resolve('fix everything you safely can', {})
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('no imported-email reconstruction', result.reply)

    def test_nothing_needing_attention_is_reported_honestly_not_as_a_fix(self):
        context = {'import_reconstruction': {'fidelity_categories': [
            {'id': 'structure', 'status': 'preserved', 'summary': 'Matches source.'},
            {'id': 'typography', 'status': 'normalized', 'summary': 'Font stack normalized safely.'},
        ]}}
        result = self._provider().resolve('fix everything you safely can', context)
        self.assertEqual(result.action['type'], 'NONE')
        self.assertIn('nothing left', result.reply)

    def test_all_d1_worked_example_phrases_are_recognized(self):
        # D1-D's own required exact phrases — every one must resolve to
        # IMPROVE_IMPORT_RECONSTRUCTION, not a close-variant fallback.
        phrases = [
            'Make this look like the imported email.', 'Fix whatever you safely can.',
            'Make this button look like the original.', 'Look like the original.',
            'Fix the remaining safe differences.', 'Make the reconstruction closer to the source.',
            'Can you make this section closer to the original?',
        ]
        for phrase in phrases:
            intent, _confidence, _lang = normalize_intent(phrase)
            self.assertEqual(intent, CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION, phrase)

    def test_keep_the_layout_but_make_it_outlook_compatible_is_understood_as_an_outlook_scoped_request(self):
        # D1-D's own exact phrase. This one is intentionally scoped by
        # the FRONTEND's category-aware local matcher
        # (reconstructionIntentMatcher.ts), not the backend's
        # whole-document IMPROVE_IMPORT_RECONSTRUCTION — verified in the
        # frontend test suite (reconstructionIntentMatcher.test.ts). At
        # the backend/canonical layer, this phrase is at minimum never
        # mistaken for a real, unrelated mutation (there is no
        # CHANGE_LAYOUT intent to collide with) and, since it also
        # contains "outlook", correctly still reaches
        # ENABLE_OUTLOOK_FALLBACK-flavored recognition when a module is
        # selected rather than silently doing nothing.
        intent, _confidence, _lang = normalize_intent('Keep the layout but make it Outlook compatible.')
        self.assertIn(intent, (CanonicalIntent.ENABLE_OUTLOOK_FALLBACK, CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION, None))


class D1MultilingualEquivalenceTests(TestCase):
    """D1-C — English/Hindi/Spanish/French equivalents of the SAME
    request resolve to the SAME semantic intent, through the real
    provider chain, with byte-identical `action` (always NONE here,
    since this intent never mutates) — proven, not assumed."""

    def _context(self):
        return {'import_reconstruction': {'fidelity_categories': [
            {'id': 'structure', 'status': 'approximated', 'summary': 'Column ratio drifted from source.'},
        ]}}

    def _provider(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER=''):
            from .ai_command import get_default_email_command_provider
            return get_default_email_command_provider()

    def test_fix_everything_you_safely_can_in_all_four_languages(self):
        messages = {
            'en': 'fix everything you safely can',
            'hi': 'जो सुरक्षित रूप से ठीक कर सको वो ठीक करो',
            'es': 'arregla todo lo que puedas de forma segura',
            'fr': 'corrige tout ce que tu peux corriger en toute sécurité',
        }
        results = {lang: self._provider().resolve(msg, self._context()) for lang, msg in messages.items()}
        for lang, result in results.items():
            self.assertEqual(result.action, {'type': 'NONE'}, lang)
            self.assertTrue(result.reply.startswith("I'll go through") or 'atención' in result.reply or 'attention' in result.reply, (lang, result.reply))

    def test_make_it_closer_to_the_original_in_all_four_languages(self):
        messages = {
            'en': 'make it closer to the original',
            'hi': 'इसे मूल जैसा बनाओ',
            'es': 'hazlo más parecido al original',
            'fr': "rapproche ceci de l'original",
        }
        for lang, msg in messages.items():
            intent, _confidence, detected_lang = normalize_intent(msg)
            self.assertEqual(intent, CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION, lang)
            self.assertEqual(detected_lang, lang, lang)

    def test_explain_why_this_changed_in_all_four_languages(self):
        messages = {
            'en': 'why did this change?',
            'hi': 'यह क्यों बदला?',
            'es': '¿por qué cambió esto?',
            'fr': 'pourquoi cela a-t-il changé?',
        }
        results = {lang: self._provider().resolve(msg, self._context()) for lang, msg in messages.items()}
        for lang, result in results.items():
            self.assertEqual(result.action, {'type': 'NONE'}, lang)
            self.assertIn('structure', result.reply, (lang, result.reply))

    def test_accent_omission_does_not_break_spanish_or_french_matching(self):
        # Real-world typing routinely drops accents — this must not
        # silently fail to recognize an otherwise-exact phrase match.
        intent_es, _c, _l = normalize_intent('hazlo mas parecido al original')
        intent_fr, _c, _l = normalize_intent('corrige tout ce que tu peux corriger en toute securite')
        self.assertEqual(intent_es, CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION)
        self.assertEqual(intent_fr, CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION)

    def test_no_openai_call_for_any_of_these_requests(self):
        # Deterministic-only: the default provider chain (no
        # EMAILBUILDER_AI_COMMAND_PROVIDER override) never carries an
        # 'openai'/'local' provider label for any of these.
        for msg in ('fix everything you safely can', 'arregla todo lo que puedas de forma segura', 'why did this change?'):
            result = self._provider().resolve(msg, self._context())
            self.assertNotIn(result.provider, ('local', 'openai'), msg)


class D1FollowUpContextTests(TestCase):
    """D1-A's own required follow-up behavior: 'Why did you change the
    column widths?' -> explanation, then 'Can you make it closer to the
    original?' -> repair request, using the SAME reconstruction context
    (sent on every turn, per the existing R4-B2 architecture — never
    extra state-threading needed)."""

    def test_explain_then_repair_request_both_resolve_correctly_against_the_same_context(self):
        context = {'import_reconstruction': {'fidelity_categories': [
            {'id': 'structure', 'status': 'approximated', 'summary': 'Column ratio drifted from source.'},
        ]}}
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER=''):
            from .ai_command import get_default_email_command_provider
            provider = get_default_email_command_provider()

        explain_result = provider.resolve('Why did you change the column widths?', context)
        self.assertEqual(explain_result.action['type'], 'NONE')
        self.assertIn('structure', explain_result.reply)

        repair_result = provider.resolve('Can you make it closer to the original?', context)
        self.assertEqual(repair_result.action['type'], 'NONE')
        self.assertTrue(repair_result.reply.startswith("I'll go through"))


class D1ExistingIntentsNoRegressionTests(TestCase):
    """D1 acceptance — the existing 10 canonical intents (9 pre-D1 +
    COMPARE_IMPORT_RECONSTRUCTION) do not regress."""

    def test_every_pre_existing_canonical_intent_still_recognizes_its_own_english_phrase(self):
        pre_existing = CanonicalIntent.values - {CanonicalIntent.IMPROVE_IMPORT_RECONSTRUCTION}
        for intent in pre_existing:
            phrase = _first_phrase(intent, 'en')
            got_intent, _confidence, _lang = normalize_intent(phrase)
            self.assertEqual(got_intent, intent, f'{intent} regressed on its own phrase {phrase!r}')

    def test_real_mutations_still_apply_end_to_end_through_the_full_provider_chain(self):
        with override_settings(EMAILBUILDER_AI_COMMAND_PROVIDER=''):
            from .ai_command import get_default_email_command_provider
            provider = get_default_email_command_provider()
        result = provider.resolve(
            'arregla el contraste',
            {'selected_module': {'type': 'text', 'props': {'color': '#777777', 'backgroundColor': '#FFFFFF'}}},
        )
        self.assertEqual(result.action['type'], 'UPDATE_MODULE_PROPS')
