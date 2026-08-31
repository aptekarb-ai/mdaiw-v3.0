"""R4-B3 §C/§I — bounded planner tests."""

from django.test import SimpleTestCase

from .planner import EmailAIPlan, PlanStep, STEP_KINDS, build_plan


class PlanStepTests(SimpleTestCase):
    def test_unknown_step_kind_rejected(self):
        with self.assertRaises(ValueError):
            PlanStep(kind='not-a-real-kind', description='x')

    def test_every_registered_kind_constructs(self):
        for kind in STEP_KINDS:
            PlanStep(kind=kind, description='x')


class BuildPlanTests(SimpleTestCase):
    def test_reconstruction_comparison_request_with_context_produces_full_plan(self):
        plan = build_plan('why is this different from the import', context={
            'import_reconstruction': {'document_width': 700}, 'selected_module': {'type': 'hero-image-cta'},
        })
        self.assertFalse(plan.needs_clarification)
        self.assertGreater(len(plan.steps), 5)
        kinds = [s.kind for s in plan.steps]
        self.assertIn('compare_typography', kinds)
        self.assertIn('compare_spacing', kinds)
        self.assertIn('identify_repairable_differences', kinds)
        # never a real action at this checkpoint
        self.assertEqual(plan.proposed_actions, ())

    def test_reconstruction_request_without_context_asks_for_clarification_instead_of_fabricating(self):
        plan = build_plan('compare to the original', context={})
        self.assertTrue(plan.needs_clarification)
        self.assertEqual(plan.steps, ())

    def test_contrast_fix_request_produces_a_short_plan(self):
        plan = build_plan('fix the contrast', context={'selected_module': {'type': 'text'}})
        self.assertFalse(plan.needs_clarification)
        self.assertIn('compute_contrast_fix', [s.kind for s in plan.steps])

    def test_unrecognized_message_needs_clarification(self):
        plan = build_plan('asdkjqwoe', context={})
        self.assertTrue(plan.needs_clarification)
        self.assertEqual(plan.confidence, 0.0)

    def test_deterministic_same_input_same_plan(self):
        context = {'selected_module': {'type': 'button'}}
        plan_a = build_plan('fix the contrast', context)
        plan_b = build_plan('fix the contrast', context)
        self.assertEqual(plan_a, plan_b)

    def test_as_context_lines_is_bounded_and_readable(self):
        plan = build_plan('why is this different from the import', context={'import_reconstruction': {}})
        lines = plan.as_context_lines()
        self.assertIsInstance(lines, list)
        self.assertTrue(all(isinstance(line, str) for line in lines))
        self.assertLess(len(lines), 20)

    def test_never_raises_on_malformed_context(self):
        self.assertIsInstance(build_plan('fix the contrast', context=None), EmailAIPlan)
        self.assertIsInstance(build_plan('fix the contrast', context={'selected_module': 'not-a-dict'}), EmailAIPlan)

    def test_never_proposes_actions_directly_r4c_boundary(self):
        # Explicit invariant check for the R4-B3/R4-C boundary: no matter
        # the input, this module never produces a real action.
        for message in ['fix the contrast', 'why is this different from the import', 'add a button']:
            plan = build_plan(message, context={'import_reconstruction': {}, 'selected_module': {'type': 'text'}})
            self.assertEqual(plan.proposed_actions, ())
