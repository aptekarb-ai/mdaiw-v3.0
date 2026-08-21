"""fixes/regions.py — same-region COMPATIBLE-insertion merging. AI Engineer
Autonomous Repair sprint, spec section 2/4/7/25: several findings that each
want to insert new content at the identical anchor (e.g. missing charset +
viewport + meta description all inserting right after the same literal
"<head>" text) must become ONE coherent patch, not N proposals excluding
each other as "conflicts". Genuine same-range REWRITE conflicts (two
different replacements of the anchor's own content) must NOT be merged."""

from django.test import SimpleTestCase

from ..fixes.catalogue import Patch
from ..fixes.regions import merge_compatible_insertions


def _patch(fix_id, *, file='html', start=0, end=6, original='<head>', replacement, issue_id=1, risk='low', confidence='definite', description=''):
    return Patch(
        fix_id=fix_id, issue_id=issue_id, fingerprint=f'fp-{fix_id}', language='html', source_context='',
        file=file, start_offset=start, end_offset=end, start_line=1, start_column=1, end_line=1, end_column=1,
        original_text=original, replacement_text=replacement, description=description, risk=risk, confidence=confidence,
    )


class MergeCompatibleInsertionsTests(SimpleTestCase):
    def test_three_same_anchor_additive_insertions_merge_into_one_patch(self):
        patches = [
            _patch('a', replacement='<head>\n<meta charset="UTF-8">', issue_id=1, description='Add charset.'),
            _patch('b', replacement='<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">', issue_id=2, description='Add viewport.'),
            _patch('c', replacement='<head>\n<meta name="description" content="A page.">', issue_id=3, description='Add description.'),
        ]
        merged, consumed, merges = merge_compatible_insertions(patches)

        self.assertEqual(consumed, {'a', 'b', 'c'})
        self.assertEqual(len(merged), 1)
        self.assertEqual(len(merges), 1)
        combined = merged[0]
        self.assertIn('<head>', combined.replacement_text)
        self.assertIn('charset', combined.replacement_text)
        self.assertIn('viewport', combined.replacement_text)
        self.assertIn('description', combined.replacement_text)
        self.assertNotIn(combined.fix_id, {'a', 'b', 'c'})

    def test_charset_is_ordered_before_viewport_and_description(self):
        patches = [
            _patch('desc', replacement='<head>\n<meta name="description" content="A page.">'),
            _patch('viewport', replacement='<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">'),
            _patch('charset', replacement='<head>\n<meta charset="UTF-8">'),
        ]
        merged, _consumed, _merges = merge_compatible_insertions(patches)
        combined_text = merged[0].replacement_text
        self.assertLess(combined_text.index('charset'), combined_text.index('viewport'))
        self.assertLess(combined_text.index('viewport'), combined_text.index('description'))

    def test_single_proposal_at_an_anchor_is_left_untouched(self):
        patches = [_patch('a', replacement='<head>\n<meta charset="UTF-8">')]
        merged, consumed, merges = merge_compatible_insertions(patches)
        self.assertEqual(merged, patches)
        self.assertEqual(consumed, set())
        self.assertEqual(merges, [])

    def test_true_rewrite_conflict_is_not_merged(self):
        """Two DIFFERENT replacements of the anchor's own content (not
        additive — the anchor text itself would be replaced with something
        else, not preserved-plus-extra) must be left alone for the
        conflict detector, never silently merged."""
        patches = [
            _patch('a', original='<html>', end=6, replacement='<html data-x="1">'),
            _patch('b', original='<html>', end=6, replacement='<html data-y="2">'),
        ]
        merged, consumed, merges = merge_compatible_insertions(patches)
        self.assertEqual(consumed, set())
        self.assertEqual(merges, [])
        self.assertEqual({p.fix_id for p in merged}, {'a', 'b'})

    def test_exact_duplicate_addition_is_dropped_not_treated_as_a_conflict(self):
        patches = [
            _patch('a', replacement='<head>\n<meta charset="UTF-8">'),
            _patch('b', replacement='<head>\n<meta charset="UTF-8">'),
            _patch('c', replacement='<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">'),
        ]
        merged, consumed, merges = merge_compatible_insertions(patches)
        self.assertEqual(len(merged), 1)
        self.assertEqual(consumed, {'a', 'b', 'c'})
        self.assertEqual(merged[0].replacement_text.count('charset'), 1)

    def test_different_files_never_merge_together(self):
        patches = [
            _patch('a', file='html', replacement='<head>\n<meta charset="UTF-8">'),
            _patch('b', file='css', replacement='<head>\n<meta name="viewport" content="x">'),
        ]
        merged, consumed, merges = merge_compatible_insertions(patches)
        self.assertEqual(consumed, set())
        self.assertEqual(merges, [])

    def test_merged_patch_uses_worst_risk_and_worst_confidence(self):
        patches = [
            _patch('a', replacement='<head>\n<meta charset="UTF-8">', risk='low', confidence='definite'),
            _patch('b', replacement='<head>\n<meta name="viewport" content="x">', risk='medium', confidence='possible'),
        ]
        merged, _consumed, _merges = merge_compatible_insertions(patches)
        self.assertEqual(merged[0].risk, 'medium')
        self.assertEqual(merged[0].confidence, 'possible')

    def test_before_and_after_insertions_both_preserve_the_anchor(self):
        patches = [
            _patch('a', replacement='<head>\n<meta charset="UTF-8">'),  # after: appended following <head>
            _patch('b', replacement='<!-- generated -->\n<head>'),  # before: comment prepended ahead of <head>
        ]
        merged, consumed, merges = merge_compatible_insertions(patches)
        self.assertEqual(consumed, {'a', 'b'})
        combined = merged[0].replacement_text
        self.assertIn('<!-- generated -->', combined)
        self.assertIn('charset', combined)
        self.assertTrue(combined.startswith('<!-- generated -->'))

    def test_a_mis_scoped_proposal_nesting_another_html_tag_is_never_merged(self):
        # Source-Repair Integrity sprint — the exact live-reproduced bug:
        # a missing-lang proposal anchored on the same "<head>" text as
        # three legitimate metadata insertions, but its own "addition" was
        # a second, nested "<html lang=\"en\">" start tag. Merging it in
        # produced a real, live-observed duplicate-<html>-inside-<head>
        # corruption. It must never be folded into the merge — the other
        # three legitimate members still merge together.
        patches = [
            _patch('charset', replacement='<head>\n<meta charset="UTF-8">'),
            _patch('viewport', replacement='<head>\n<meta name="viewport" content="width=device-width, initial-scale=1">'),
            _patch('description', replacement='<head>\n<meta name="description" content="A page.">'),
            _patch('bad-lang', replacement='<head>\n<html lang="en">'),
        ]
        merged, consumed, merges = merge_compatible_insertions(patches)

        self.assertEqual(consumed, {'charset', 'viewport', 'description'})
        self.assertNotIn('bad-lang', consumed)
        self.assertEqual(len(merges), 1)
        combined = merges[0][0].replacement_text
        self.assertNotIn('<html', combined)
        self.assertIn('charset', combined)
        self.assertIn('viewport', combined)
        self.assertIn('description', combined)
        # The disqualified proposal survives untouched, landing back in
        # `merged` alongside the synthesized patch — same-range conflict
        # detection (run separately, downstream of this function) is what
        # ultimately excludes it from auto-apply.
        untouched_ids = {p.fix_id for p in merged} - {merges[0][0].fix_id}
        self.assertEqual(untouched_ids, {'bad-lang'})

    def test_a_mis_scoped_head_nested_proposal_is_also_disqualified(self):
        patches = [
            _patch('charset', replacement='<head>\n<meta charset="UTF-8">'),
            _patch('bad-head', replacement='<head>\n<head profile="x">'),
        ]
        merged, consumed, merges = merge_compatible_insertions(patches)
        self.assertEqual(consumed, set())
        self.assertEqual(merges, [])
        self.assertEqual({p.fix_id for p in merged}, {'charset', 'bad-head'})
