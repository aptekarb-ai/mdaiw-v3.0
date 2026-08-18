"""AI Engineer Formatting + Documentation sprint — documentation-pass
unit tests. Uses a SCRIPTED fake provider (no real network call, this
project's established torture-fixture pattern) since the point under
test is the deterministic add-only-comments safety net, not the model's
own reasoning."""

from django.test import TestCase

from ..ai_review.provider import DocumentationResult
from ..fixes import documentation


class VerifyAddOnlyCommentsTests(TestCase):
    def test_pure_single_line_comment_insertion_is_accepted(self):
        original = 'function f() {\n  return 1;\n}\n'
        candidate = '// Returns a constant used elsewhere for X reasons.\nfunction f() {\n  return 1;\n}\n'
        self.assertTrue(documentation._verify_add_only_comments('javascript', original, candidate))

    def test_identical_source_is_rejected_as_a_no_op(self):
        original = 'function f() { return 1; }\n'
        self.assertFalse(documentation._verify_add_only_comments('javascript', original, original))

    def test_altering_an_existing_line_is_rejected(self):
        original = 'function f() {\n  return 1;\n}\n'
        candidate = 'function f() {\n  return 2; // changed the value\n}\n'
        self.assertFalse(documentation._verify_add_only_comments('javascript', original, candidate))

    def test_removing_an_existing_line_is_rejected(self):
        original = 'function f() {\n  return 1;\n}\n'
        candidate = 'function f() {\n}\n'
        self.assertFalse(documentation._verify_add_only_comments('javascript', original, candidate))

    def test_inserted_non_comment_line_is_rejected(self):
        original = 'function f() {\n  return 1;\n}\n'
        candidate = 'function f() {\n  console.log("debug");\n  return 1;\n}\n'
        self.assertFalse(documentation._verify_add_only_comments('javascript', original, candidate))

    def test_multiline_comment_block_is_rejected_fails_closed(self):
        # A deliberate, disclosed scope limitation — this MVP safety net
        # only accepts single-line, self-contained comment insertions.
        original = 'function f() {\n  return 1;\n}\n'
        candidate = 'function f() {\n  /* This\n     spans\n     lines */\n  return 1;\n}\n'
        self.assertFalse(documentation._verify_add_only_comments('javascript', original, candidate))

    def test_html_comment_insertion_is_accepted(self):
        original = '<div>\n  <form></form>\n</div>\n'
        candidate = '<div>\n  <!-- Primary lead-capture form -->\n  <form></form>\n</div>\n'
        self.assertTrue(documentation._verify_add_only_comments('html', original, candidate))

    def test_css_block_comment_insertion_is_accepted(self):
        original = '.a {\n  color: red;\n}\n'
        candidate = '.a {\n  /* Keep contrast AA-compliant against the dark header. */\n  color: red;\n}\n'
        self.assertTrue(documentation._verify_add_only_comments('css', original, candidate))

    def test_ampscript_block_comment_insertion_is_accepted(self):
        original = '%%[\nVAR @name\n]%%\n'
        candidate = '%%[\n/* Treat the request parameter as untrusted input before rendering it. */\nVAR @name\n]%%\n'
        self.assertTrue(documentation._verify_add_only_comments('ampscript', original, candidate))

    # --- Closure spec: trailing same-line comment attachment -----------

    def test_css_trailing_comment_is_attached_to_its_declaration(self):
        original = '.a {\n  background-color: blue;\n  font-family: Arial, sans-serif;\n}\n'
        candidate = (
            '.a {\n  background-color: blue; /* Corrected property */\n'
            '  font-family: Arial, sans-serif; /* Added generic font fallback */\n}\n'
        )
        self.assertTrue(documentation._verify_add_only_comments('css', original, candidate))

    def test_css_trailing_comment_never_produces_a_standalone_comment_line(self):
        # The exact regression this closure sprint targets — a candidate
        # that pushes the comment onto its OWN line is still accepted
        # (it's the pre-existing standalone-insert shape), but a
        # candidate that does BOTH (standalone AND a code change) for
        # the same statement is rejected: code must stay byte-identical.
        original = '.a {\n  background-color: blue;\n}\n'
        candidate = '.a {\n  background-color: blue ; /* Corrected property */\n}\n'  # extra space before ';'
        self.assertFalse(documentation._verify_add_only_comments('css', original, candidate))

    def test_javascript_trailing_line_comment_is_attached(self):
        original = 'element.textContent = value;\n'
        candidate = 'element.textContent = value; // Render dynamic content as text to avoid HTML interpretation.\n'
        self.assertTrue(documentation._verify_add_only_comments('javascript', original, candidate))

    def test_ampscript_trailing_comment_is_attached(self):
        original = '%%[\nSET @name = AttributeValue("FirstName")\n]%%\n'
        candidate = '%%[\nSET @name = AttributeValue("FirstName") /* Read personalization value */\n]%%\n'
        self.assertTrue(documentation._verify_add_only_comments('ampscript', original, candidate))

    def test_html_trailing_comment_is_never_accepted(self):
        # Spec section 4 — HTML never gets a forced same-line comment,
        # even though the shape would otherwise qualify.
        original = '<form></form>\n'
        candidate = '<form></form> <!-- Primary lead-capture form -->\n'
        self.assertFalse(documentation._verify_add_only_comments('html', original, candidate))

    def test_idempotent_second_run_cannot_double_comment_an_already_commented_line(self):
        # Spec section 6 — Run 1's output becomes Run 2's input; Run 2
        # must never be allowed to attach a SECOND trailing comment.
        already_commented = '.a {\n  background-color: blue; /* Preserve brand background. */\n}\n'
        doubled = (
            '.a {\n  background-color: blue; /* Preserve brand background. */ '
            '/* Preserve brand background. */\n}\n'
        )
        self.assertFalse(documentation._verify_add_only_comments('css', already_commented, doubled))

    def test_mixed_standalone_and_trailing_comments_in_one_candidate_is_accepted(self):
        original = 'function f(a, b) {\n  const x = validate(a);\n  return x + b;\n}\n'
        candidate = (
            'function f(a, b) {\n'
            '  // Treat the first argument as untrusted before use.\n'
            '  const x = validate(a);\n'
            '  return x + b; // Combine the validated value with the raw second argument.\n'
            '}\n'
        )
        self.assertTrue(documentation._verify_add_only_comments('javascript', original, candidate))


class _ScriptedDocumentationProvider:
    """Returns a fixed DocumentationResult per file_key, or raises
    AIReviewUnavailable if the key isn't in `responses`."""

    def __init__(self, responses):
        self._responses = responses

    def suggest_documentation(self, request):
        if request.file_key not in self._responses:
            from ..ai_review.provider import AIReviewUnavailable

            raise AIReviewUnavailable('not scripted for this file')
        return self._responses[request.file_key]


class ApplyDocumentationPassTests(TestCase):
    def test_no_provider_leaves_sources_untouched(self):
        sources = {'html': '<div></div>', 'css': '', 'js': '', 'ampscript': ''}
        new_sources, documented = documentation.apply_documentation_pass(
            sources, 'css', None, 'rl-1', provider=None,
        )
        self.assertEqual(documented, set())
        self.assertEqual(new_sources, sources)

    def test_comments_needed_false_is_a_valid_no_op(self):
        sources = {'html': '<div><p>hi</p></div>', 'css': '', 'js': '', 'ampscript': ''}
        provider = _ScriptedDocumentationProvider({
            'html': DocumentationResult(documented_source=None, explanation='Nothing non-obvious here.'),
        })
        new_sources, documented = documentation.apply_documentation_pass(sources, 'css', None, 'rl-1', provider=provider)
        self.assertEqual(documented, set())
        self.assertEqual(new_sources['html'], sources['html'])

    def test_a_verified_add_only_candidate_is_adopted(self):
        html = '<div>\n  <form></form>\n</div>\n'
        commented = '<div>\n  <!-- Primary lead-capture form -->\n  <form></form>\n</div>\n'
        sources = {'html': html, 'css': '', 'js': '', 'ampscript': ''}
        provider = _ScriptedDocumentationProvider({
            'html': DocumentationResult(documented_source=commented, comments_added=1, explanation='Documented the form.'),
        })
        new_sources, documented = documentation.apply_documentation_pass(sources, 'css', None, 'rl-1', provider=provider)
        self.assertEqual(documented, {'html'})
        self.assertEqual(new_sources['html'], commented)

    def test_a_candidate_that_alters_existing_code_is_rejected(self):
        js = 'function f() {\n  return 1;\n}\n'
        tampered = 'function f() {\n  return 2; // an actual code change disguised as documentation\n}\n'
        sources = {'html': '', 'css': '', 'js': js, 'ampscript': ''}
        provider = _ScriptedDocumentationProvider({
            'js': DocumentationResult(documented_source=tampered, comments_added=1, explanation='...'),
        })
        new_sources, documented = documentation.apply_documentation_pass(sources, 'css', None, 'rl-1', provider=provider)
        self.assertEqual(documented, set())
        self.assertEqual(new_sources['js'], js)

    def test_provider_unavailable_for_one_file_does_not_block_another(self):
        sources = {'html': '<div>\n  <form></form>\n</div>\n', 'css': '', 'js': 'function f(){return 1;}\n', 'ampscript': ''}
        provider = _ScriptedDocumentationProvider({
            'html': DocumentationResult(
                documented_source='<div>\n  <!-- Primary lead-capture form -->\n  <form></form>\n</div>\n',
                comments_added=1, explanation='...',
            ),
        })
        new_sources, documented = documentation.apply_documentation_pass(sources, 'css', None, 'rl-1', provider=provider)
        self.assertEqual(documented, {'html'})
        self.assertEqual(new_sources['js'], sources['js'])
