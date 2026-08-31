"""R4-B2 §13/§22 — knowledge retrieval relevance, exclusion, and budget
tests. Pure unit tests over retrieve_relevant_knowledge(); no Django
client/DB needed, but kept under the app's test discovery path
(emailbuilder/knowledge/tests_retrieval.py) so `manage.py test` picks it
up automatically like every other emailbuilder test module."""

from django.test import SimpleTestCase

from .retrieval import DEFAULT_MAX_CHARS, DEFAULT_MAX_RULES, retrieve_relevant_knowledge


class RetrievalRelevanceTests(SimpleTestCase):
    def test_outlook_question_returns_outlook_rules_only(self):
        results = retrieve_relevant_knowledge('Will this render correctly in Classic Outlook with VML?')
        self.assertTrue(results)
        on_topic_terms = ('outlook', 'vml', 'mso', 'word rendering', 'word engine')
        for entry in results:
            haystack = entry['id'].lower() + entry['title'].lower() + entry['description'].lower()
            self.assertTrue(any(term in haystack for term in on_topic_terms), entry['id'])

    def test_contrast_question_surfaces_the_contrast_rule(self):
        results = retrieve_relevant_knowledge('This heading does not have enough contrast')
        ids = [r['id'] for r in results]
        self.assertIn('email-accessibility-wcag-contrast', ids)

    def test_ampscript_question_surfaces_sfmc_rules_only(self):
        results = retrieve_relevant_knowledge('What is AMPScript and can we use it here?')
        self.assertTrue(results)
        for entry in results:
            self.assertTrue(entry['id'].startswith('sfmc-'))

    def test_pure_mutation_command_returns_nothing(self):
        # "add a button" alone, with no topical Outlook/VML/contrast/SFMC
        # wording, must not drag in an unrelated knowledge snippet just
        # because "button" appears somewhere in the knowledge base.
        results = retrieve_relevant_knowledge('add a button')
        # Zero or the one genuinely on-topic bulletproof-button rule are
        # both acceptable outcomes here; what must NEVER happen is an
        # unrelated rule (SFMC, dark-mode, accessibility, ...) appearing.
        for entry in results:
            self.assertIn('button', entry['id'])

    def test_generic_incidental_word_overlap_never_surfaces_a_rule_alone(self):
        # "design"/"become"/"desktop" are real words that appear inside
        # rule descriptions, but sharing exactly one of them with an
        # unrelated message must never be enough to surface that rule.
        results = retrieve_relevant_knowledge('Why did the imported design become 40/60?')
        self.assertEqual(results, [])

    def test_ambiguous_generic_word_does_not_falsely_match_unrelated_rule(self):
        # "desktop" alone is topically ambiguous (responsive-breakpoint
        # desktop vs. "Classic Outlook desktop app") — must not surface
        # an Outlook rule purely off that one shared, overloaded word.
        results = retrieve_relevant_knowledge('Make the mobile version tighter but keep desktop unchanged')
        self.assertEqual(results, [])

    def test_empty_message_and_no_context_hints_returns_nothing(self):
        self.assertEqual(retrieve_relevant_knowledge(''), [])
        self.assertEqual(retrieve_relevant_knowledge('   '), [])

    def test_context_platform_hint_alone_can_surface_platform_rules(self):
        # A platform hint contributes a real score boost — combined with
        # even a generic message, an SFMC-scoped conversation should
        # still be able to surface SFMC knowledge.
        results = retrieve_relevant_knowledge(
            'can you explain how personalization works',
            context={'platform': 'sfmc'},
        )
        ids = [r['id'] for r in results]
        self.assertTrue(any(rule_id.startswith('sfmc-') for rule_id in ids))

    def test_validation_issue_category_hint_biases_toward_that_category(self):
        results = retrieve_relevant_knowledge(
            'can you fix this',
            context={'selected_validation_issue': {'category': 'outlook'}},
        )
        for entry in results:
            self.assertIn('outlook', entry['id'].lower() + entry['title'].lower())


class RetrievalBudgetTests(SimpleTestCase):
    def test_never_exceeds_max_rules(self):
        # A broad, multi-topic message likely to score against many rules.
        results = retrieve_relevant_knowledge(
            'outlook vml contrast dark mode responsive gmail accessibility images fonts',
            max_rules=3,
        )
        self.assertLessEqual(len(results), 3)

    def test_never_exceeds_max_chars_budget(self):
        results = retrieve_relevant_knowledge(
            'outlook vml contrast dark mode responsive gmail accessibility images fonts links buttons',
            max_rules=50, max_chars=300,
        )
        total = sum(len(r['title']) + len(r['description']) for r in results)
        self.assertLessEqual(total, 300 + 300)  # first entry over budget is still allowed in; nothing after it

    def test_default_bounds_are_sane(self):
        self.assertGreater(DEFAULT_MAX_RULES, 0)
        self.assertLessEqual(DEFAULT_MAX_RULES, 10)
        self.assertGreater(DEFAULT_MAX_CHARS, 0)

    def test_result_entries_never_carry_raw_knowledge_rule_fields(self):
        # Wire-safety — only id/title/description ever leave this
        # function; never detection/source/references/confidence/etc.
        results = retrieve_relevant_knowledge('Will this render correctly in Classic Outlook with VML?')
        for entry in results:
            self.assertEqual(set(entry.keys()), {'id', 'title', 'description'})
