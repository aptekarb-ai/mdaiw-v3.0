"""R4-B2 §14/§22 — skill registry tests. Pure unit tests, no DB needed."""

from django.test import SimpleTestCase

from .learning import is_valid_signature
from .skills import (
    SKILL_SIGNATURE_PREFIX, get_skill, is_skill_available, list_all_skills, list_available_skills,
)


class SkillRegistryTests(SimpleTestCase):
    def test_every_skill_has_a_unique_id(self):
        ids = [skill.id for skill in list_all_skills()]
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_skill_status_is_available_or_reserved(self):
        for skill in list_all_skills():
            self.assertIn(skill.status, ('available', 'reserved'))

    def test_get_skill_returns_none_for_unknown_id(self):
        self.assertIsNone(get_skill('not-a-real-skill'))

    def test_get_skill_returns_the_real_skill(self):
        skill = get_skill('fix-weak-contrast')
        self.assertIsNotNone(skill)
        self.assertEqual(skill.category, 'accessibility')

    def test_list_available_skills_excludes_reserved_ones(self):
        available_ids = {skill.id for skill in list_available_skills()}
        self.assertIn('fix-weak-contrast', available_ids)
        self.assertNotIn('reconstruct-button', available_ids)
        self.assertNotIn('reconstruct-typography', available_ids)
        self.assertNotIn('reconstruct-spacing', available_ids)

    def test_is_skill_available_true_only_for_available_status(self):
        self.assertTrue(is_skill_available('fix-weak-contrast'))
        self.assertFalse(is_skill_available('reconstruct-button'))
        self.assertFalse(is_skill_available('not-a-real-skill'))

    def test_reserved_skills_are_never_silently_treated_as_available(self):
        # Explicit regression guard for the exact invariant §14/§25 care
        # about: a reserved (not-yet-implemented) skill must never be
        # reachable through the "available" listing, even by accident.
        reserved = [skill for skill in list_all_skills() if skill.status == 'reserved']
        self.assertTrue(reserved)  # the reconstruct-* skills exist and ARE reserved
        available = list_available_skills()
        for skill in reserved:
            self.assertNotIn(skill, available)

    def test_every_skill_signature_is_a_valid_learning_signature(self):
        # Proves the skill:<id> signature shape (2 segments) survives
        # learning.py's SIGNATURE_PATTERN unchanged.
        for skill in list_all_skills():
            self.assertTrue(is_valid_signature(skill.signature), skill.signature)
            self.assertTrue(skill.signature.startswith(f'{SKILL_SIGNATURE_PREFIX}:'))
