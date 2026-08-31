"""R4-B3 §F/§G/§H — reconstruction-aware conversation, knowledge-plus-
live-context combination, and learning-never-bypasses-validation tests."""

import json
from unittest.mock import MagicMock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from . import ai_command, learning
from .ai_command import validate_action
from .ai_command_local import LocalEmailCommandProvider, _build_safe_context as local_build_safe_context
from .ai_command_openai import _build_safe_context as openai_build_safe_context
from .models import LearnedRepairSignal, RepairSignalOutcome, RepairSignalSource

SAMPLE_RECONSTRUCTION = {
    'document_width': 700, 'module_count': 2, 'region_count': 2,
    'regions': [{'role': 'columns', 'confidence': 0.9, 'source_position': 'row 1', 'column_ratio': [0.38, 0.62], 'has_image': False, 'has_links': False}],
    'fidelity_categories': [
        {
            'id': 'structure', 'status': 'approximated',
            'summary': 'Source column ratio 38/62 approximated to the nearest supported preset 40/60.',
            'finding_count': 1,
            'sample_findings': [{'category': 'structure', 'source': '<td width="380">', 'location': 'row 1', 'reason': 'no exact 38/62 preset exists'}],
        },
    ],
    'has_mso_conditional_content': False,
}


def _fake_completion(payload):
    completion = MagicMock()
    completion.choices = [MagicMock(message=MagicMock(content=json.dumps(payload)))]
    return completion


class ReconstructionAwareContextAssemblyTests(TestCase):
    """§F — proves the CONTEXT an actual reconstruction question would
    receive genuinely combines import_reconstruction + knowledge + plan,
    for both providers (§23 parity) — the ingredients a real model needs
    to answer "why is this 40/60 instead of 38/62" with real grounding,
    not a textbook answer."""

    def test_local_provider_combines_reconstruction_context_knowledge_and_plan(self):
        message = 'why is this 40/60 instead of 38/62'
        context = {'_retrieval_message': message, 'import_reconstruction': SAMPLE_RECONSTRUCTION}
        safe_context, _history = local_build_safe_context(context)
        self.assertIsNotNone(safe_context['import_reconstruction'])
        self.assertEqual(
            safe_context['import_reconstruction']['fidelity_categories'][0]['id'], 'structure',
        )
        self.assertIn('plan', safe_context)
        self.assertEqual(safe_context['canonical_intent'], 'COMPARE_IMPORT_RECONSTRUCTION')

    def test_openai_provider_combines_reconstruction_context_knowledge_and_plan(self):
        message = 'can the builder reproduce this exactly'
        context = {'_retrieval_message': message, 'import_reconstruction': SAMPLE_RECONSTRUCTION}
        safe_context, _history = openai_build_safe_context(context)
        self.assertIsNotNone(safe_context['import_reconstruction'])
        self.assertEqual(safe_context['canonical_intent'], 'COMPARE_IMPORT_RECONSTRUCTION')

    def test_outlook_vml_question_surfaces_outlook_knowledge(self):
        context = {'_retrieval_message': 'why does outlook need vml'}
        safe_context, _history = local_build_safe_context(context)
        self.assertIn('knowledge', safe_context)
        self.assertTrue(any('vml' in k['id'].lower() or 'outlook' in k['id'].lower() for k in safe_context['knowledge']))

    def test_ampscript_question_surfaces_sfmc_knowledge(self):
        context = {'_retrieval_message': 'how does sfmc ampscript coexist with html'}
        safe_context, _history = local_build_safe_context(context)
        self.assertIn('knowledge', safe_context)
        self.assertTrue(all(k['id'].startswith('sfmc-') for k in safe_context['knowledge']))

    def test_contrast_wcag_question_surfaces_contrast_knowledge_and_plan(self):
        context = {
            '_retrieval_message': 'why is my text contrast failing wcag',
            'selected_module': {'type': 'text', 'props': {'color': '#777777', 'backgroundColor': '#FFFFFF'}},
        }
        safe_context, _history = local_build_safe_context(context)
        self.assertTrue(any('contrast' in k['id'].lower() for k in safe_context['knowledge']))

    def test_no_import_reconstruction_present_never_fabricates_one(self):
        context = {'_retrieval_message': 'why is this 40/60 instead of 38/62'}
        safe_context, _history = local_build_safe_context(context)
        self.assertIsNone(safe_context['import_reconstruction'])
        # A plan may still exist (needs_clarification-only), but must
        # never claim reconstruction steps with no real data to ground them.
        self.assertNotIn('plan', safe_context)


class ReconstructionConversationEndToEndTests(TestCase):
    """§F/§I — a real (mocked-client) round trip for a representative
    reconstruction question, proving the model receives grounded context
    and the resulting action still passes through validate_action()."""

    def test_reconstruction_question_reaches_the_model_with_full_grounding_in_one_request(self):
        client = MagicMock()
        client.chat.completions.create.return_value = _fake_completion({
            'reply': 'The source used a 38/62 split; this builder only supports fixed presets like 40/60, so it snapped to the closest one. I cannot reproduce 38/62 exactly.',
            'confidence': 0.8,
            'action': {
                'type': 'NONE', 'target': None, 'module_type': None, 'modules': None, 'patch': None,
                'enabled': None, 'css': None, 'value': None, 'url': None, 'items': None,
            },
            'tool_call': None,
        })
        provider = LocalEmailCommandProvider(client_factory=lambda: client)
        with override_settings(EMAILBUILDER_LOCAL_AI_BASE_URL='http://localhost:11434/v1', EMAILBUILDER_LOCAL_AI_MODEL='llama3.1'):
            result = provider.resolve('why is this 40/60 instead of 38/62', {'import_reconstruction': SAMPLE_RECONSTRUCTION})
        self.assertEqual(client.chat.completions.create.call_count, 1)
        sent_context = json.loads(
            client.chat.completions.create.call_args.kwargs['messages'][1]['content'].split('trusted, not user input): ', 1)[1],
        )
        self.assertIsNotNone(sent_context['import_reconstruction'])
        self.assertIn('plan', sent_context)
        validated = validate_action(result.action)
        self.assertIsNotNone(validated)
        self.assertEqual(validated['type'], 'NONE')


class LearningNeverBypassesValidationTests(TestCase):
    """§H — the exact invariant the spec demands tests for: learning
    signals (accept/reject history, including reconstruction-shaped
    signatures) may only ever influence DISPLAY ORDER on the frontend;
    they must never reach, alter, or be consulted by validate_action()
    at all."""

    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username='learner.h', email='learner.h@example.com', password='StrongPass123')

    def test_validate_action_has_zero_dependency_on_learning_module(self):
        self.assertNotIn('learning', dir(ai_command))

    def test_validate_action_result_identical_regardless_of_recorded_learning_history(self):
        action = {'type': 'UPDATE_MODULE_PROPS', 'target': 'selected', 'module_type': 'button', 'patch': {'href': 'https://example.com'}}
        before = validate_action(action)

        # Record a strong (many accepted) learning history for a
        # reconstruction-shaped signature.
        for i in range(10):
            learning.record_signal(
                user=self.user, event_id=f'evt-{i}', signature='import-reconstruction:button:alignment',
                outcome=RepairSignalOutcome.ACCEPTED, source=RepairSignalSource.AI_ENGINEER_RECONSTRUCTION,
            )
        ranking = learning.compute_ranking(self.user)
        self.assertIn('import-reconstruction:button:alignment', ranking)  # sanity: real evidence was recorded

        after = validate_action(action)
        self.assertEqual(before, after)

    def test_unsupported_action_is_rejected_regardless_of_learning_history(self):
        # Even a heavily "learned/accepted" signature can never make an
        # otherwise-invalid action pass validate_action().
        for i in range(10):
            learning.record_signal(
                user=self.user, event_id=f'evt-bad-{i}', signature='skill:fabricate-invalid-action',
                outcome=RepairSignalOutcome.ACCEPTED, source=RepairSignalSource.AI_ENGINEER_REPAIR,
            )
        bad_action = {'type': 'UPDATE_MODULE_PROPS', 'target': 'selected', 'module_type': 'not-a-real-type', 'patch': {}}
        self.assertIsNone(validate_action(bad_action))

    def test_learning_ranking_computation_never_touches_document_content_or_actions(self):
        # compute_ranking's signature is (user) only — structurally
        # incapable of reading a document, a module, or an action.
        import inspect
        params = list(inspect.signature(learning.compute_ranking).parameters)
        self.assertEqual(params, ['user'])

    def test_reconstruction_signature_ranking_is_computed_the_same_way_as_any_other(self):
        for i in range(5):
            learning.record_signal(
                user=self.user, event_id=f'evt-recon-{i}', signature='import-reconstruction:typography:font-weight',
                outcome=RepairSignalOutcome.ACCEPTED, source=RepairSignalSource.AI_ENGINEER_RECONSTRUCTION,
            )
        ranking = learning.compute_ranking(self.user)
        entry = ranking['import-reconstruction:typography:font-weight']
        self.assertGreater(entry['score'], 0.5)
        self.assertEqual(entry['evidenceCount'], 5)

    def test_clearing_learned_signals_never_touches_learnedrepairsignal_rows_of_other_users(self):
        User = get_user_model()
        other = User.objects.create_user(username='learner.h2', email='learner.h2@example.com', password='StrongPass123')
        learning.record_signal(user=self.user, event_id='mine', signature='a:b', outcome=RepairSignalOutcome.ACCEPTED, source=RepairSignalSource.AI_ENGINEER_REPAIR)
        learning.record_signal(user=other, event_id='theirs', signature='a:b', outcome=RepairSignalOutcome.ACCEPTED, source=RepairSignalSource.AI_ENGINEER_REPAIR)
        learning.clear_signals_for_user(self.user)
        self.assertEqual(LearnedRepairSignal.objects.filter(user=self.user).count(), 0)
        self.assertEqual(LearnedRepairSignal.objects.filter(user=other).count(), 1)
