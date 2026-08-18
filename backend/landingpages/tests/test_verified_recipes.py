"""Verified Repair Knowledge sprint — direct unit tests for the three
structural recipe functions in fixes/verified_recipes.py, isolated from
the full autonomous repair loop (see test_iterative_fix.py for the
wired-in fast-path/negative-memory behavior). Every issue used here is a
REAL persisted ValidationIssue produced by persist_validation_report, so
fingerprints/offsets are genuine, never hand-crafted."""

from django.contrib.auth import get_user_model
from django.test import TestCase

from ..fixes import apply_patches_to_source, repair_memory, verified_recipes
from ..report_builder import persist_validation_report
from ..security_verifier import introduces_new_dangerous_sink

User = get_user_model()


def _make_user(name='recipe_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


def _validate(user, *, html='', css='', js='', ampscript='', validation_scope='html', css_source_type='css'):
    report, _result = persist_validation_report(
        user=user, project=None, html=html, css=css, js=js, ts='', ampscript=ampscript,
        profile='standard', validation_scope=validation_scope, css_source_type=css_source_type,
    )
    return report


def _issue_by_rule(report, rule_id):
    for issue in report.issues.all():
        if issue.rule_id == rule_id:
            return issue
    return None


class CharsetDeclaredLateRecipeTests(TestCase):
    def setUp(self):
        self.user = _make_user('charset_user')

    def test_moves_the_existing_charset_to_the_first_head_child_and_the_issue_disappears(self):
        html = (
            '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
            '<meta name="description" content="d">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta charset="UTF-8">\n<title>T</title>\n</head>\n<body><p>hi</p></body>\n</html>\n'
        )
        report = _validate(self.user, html=html)
        issue = _issue_by_rule(report, 'charset-declared-late')
        self.assertIsNotNone(issue, 'fixture must actually raise charset-declared-late')

        result = verified_recipes.generate_recipe_result(issue, {'html': html, 'css': '', 'js': '', 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertEqual(result.strategy_key, 'move-existing-charset-to-head-start')

        new_html, patch_results = apply_patches_to_source(html, result.patches)
        self.assertIsNotNone(new_html)
        self.assertTrue(all(r.status == 'applied' for r in patch_results))
        # Exactly one charset meta still present — never duplicated.
        self.assertEqual(new_html.count('meta charset'), 1)
        self.assertEqual(new_html.count('<head'), 1)

        revalidated = _validate(self.user, html=new_html)
        self.assertIsNone(_issue_by_rule(revalidated, 'charset-declared-late'))

    def test_returns_none_when_two_head_elements_exist_rather_than_guessing(self):
        html = (
            '<!DOCTYPE html>\n<html><head><title>A</title><meta charset="utf-8"></head>'
            '<head><meta name="description" content="d"></head><body>x</body></html>'
        )
        report = _validate(self.user, html=html)
        issue = _issue_by_rule(report, 'charset-declared-late')
        if issue is None:
            self.skipTest('fixture did not raise charset-declared-late for this malformed shape')
        result = verified_recipes.generate_recipe_result(issue, {'html': html, 'css': '', 'js': '', 'ampscript': ''}, 'css', 'standard')
        self.assertIsNone(result)


class GenericFontFamilyRecipeTests(TestCase):
    def setUp(self):
        self.user = _make_user('font_user')

    def test_appends_sans_serif_for_a_known_font_and_the_warning_disappears(self):
        css = 'body {\n  font-family: Arial;\n  color: #333;\n}\n'
        report = _validate(self.user, css=css, validation_scope='css')
        issue = _issue_by_rule(report, 'stylelint:font-family-no-missing-generic-family-keyword')
        self.assertIsNotNone(issue, 'fixture must actually raise the generic-family warning')

        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': css, 'js': '', 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertEqual(result.strategy_key, 'append-known-generic-family')
        self.assertEqual(result.context_facts['generic_family'], 'sans-serif')

        new_css, patch_results = apply_patches_to_source(css, result.patches)
        self.assertIsNotNone(new_css)
        self.assertTrue(all(r.status == 'applied' for r in patch_results))
        self.assertIn('Arial, sans-serif', new_css)

        revalidated = _validate(self.user, css=new_css, validation_scope='css')
        self.assertIsNone(_issue_by_rule(revalidated, 'stylelint:font-family-no-missing-generic-family-keyword'))

    def test_does_not_guess_for_an_unrecognized_font_name(self):
        css = 'body {\n  font-family: SomeBespokeCorporateFont;\n}\n'
        report = _validate(self.user, css=css, validation_scope='css')
        issue = _issue_by_rule(report, 'stylelint:font-family-no-missing-generic-family-keyword')
        self.assertIsNotNone(issue)
        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': css, 'js': '', 'ampscript': ''}, 'css', 'standard')
        self.assertIsNone(result)


class MissingSelectorTargetRecipeTests(TestCase):
    def setUp(self):
        self.user = _make_user('selector_user')

    def test_rewrites_selector_to_a_pure_formatting_variant_of_an_existing_id(self):
        html = (
            '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>T</title></head>'
            '<body><input type="text" id="userName"></body></html>'
        )
        js = 'const el = document.getElementById("username");\nconsole.log(el);\n'
        report = _validate(self.user, html=html, js=js, validation_scope='complete')
        issue = _issue_by_rule(report, 'mdaiw-lp/missing-selector-target')
        self.assertIsNotNone(issue, 'fixture must actually raise missing-selector-target')
        self.assertEqual(issue.source_context, 'standalone-javascript')

        result = verified_recipes.generate_recipe_result(
            issue, {'html': html, 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard',
        )
        self.assertIsNotNone(result)
        self.assertEqual(result.strategy_key, 'rename-selector-to-existing-equivalent-id')

        new_js, patch_results = apply_patches_to_source(js, result.patches)
        self.assertIsNotNone(new_js)
        self.assertTrue(all(r.status == 'applied' for r in patch_results))
        self.assertIn('getElementById("userName")', new_js)

        revalidated = _validate(self.user, html=html, js=new_js, validation_scope='complete')
        self.assertIsNone(_issue_by_rule(revalidated, 'mdaiw-lp/missing-selector-target'))

    def test_does_not_fabricate_an_element_when_no_equivalent_id_exists(self):
        html = '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>T</title></head><body></body></html>'
        js = 'const el = document.getElementById("username");\nconsole.log(el);\n'
        report = _validate(self.user, html=html, js=js, validation_scope='complete')
        issue = _issue_by_rule(report, 'mdaiw-lp/missing-selector-target')
        self.assertIsNotNone(issue)
        result = verified_recipes.generate_recipe_result(
            issue, {'html': html, 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard',
        )
        self.assertIsNone(result)


class SecureInnerHtmlRecipeTests(TestCase):
    def setUp(self):
        self.user = _make_user('innerhtml_user')

    def test_clears_content_with_replacechildren_instead_of_empty_innerhtml(self):
        js = 'function reset() {\n  result.innerHTML = "";\n}\n'
        report = _validate(self.user, js=js, validation_scope='javascript')
        issue = _issue_by_rule(report, 'mdaiw-security/innerhtml-assignment')
        self.assertIsNotNone(issue, 'fixture must actually raise the unsafe-innerHTML finding')

        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertEqual(result.strategy_key, 'innerhtml-clear-to-replacechildren')

        new_js, patch_results = apply_patches_to_source(js, result.patches)
        self.assertIsNotNone(new_js)
        self.assertTrue(all(r.status == 'applied' for r in patch_results))
        self.assertIn('result.replaceChildren();', new_js)

        revalidated = _validate(self.user, js=new_js, validation_scope='javascript')
        self.assertIsNone(_issue_by_rule(revalidated, 'mdaiw-security/innerhtml-assignment'))

    def test_rewrites_plain_dynamic_text_to_textcontent(self):
        js = 'function greet(name) {\n  result.innerHTML = name;\n}\n'
        report = _validate(self.user, js=js, validation_scope='javascript')
        issue = _issue_by_rule(report, 'mdaiw-security/innerhtml-assignment')
        self.assertIsNotNone(issue)

        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertEqual(result.strategy_key, 'innerhtml-dynamic-text-to-textcontent')

        new_js, patch_results = apply_patches_to_source(js, result.patches)
        self.assertIsNotNone(new_js)
        self.assertTrue(all(r.status == 'applied' for r in patch_results))
        self.assertIn('result.textContent = name;', new_js)

        revalidated = _validate(self.user, js=new_js, validation_scope='javascript')
        self.assertIsNone(_issue_by_rule(revalidated, 'mdaiw-security/innerhtml-assignment'))

    def test_reconstructs_a_single_known_simple_tag_wrapping_one_interpolation_with_dom_apis(self):
        # Closure spec section 4's own example — reconstruct with real
        # DOM APIs instead of flattening to plain text (which would
        # silently drop the intended <p> markup) or leaving it unsafe.
        js = 'function render(userInput) {\n  container.innerHTML = `<p>${userInput}</p>`;\n}\n'
        report = _validate(self.user, js=js, validation_scope='javascript')
        issue = _issue_by_rule(report, 'mdaiw-security/innerhtml-assignment')
        self.assertIsNotNone(issue)

        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertEqual(result.strategy_key, 'innerhtml-simple-markup-to-dom-construction')

        new_js, patch_results = apply_patches_to_source(js, result.patches)
        self.assertIsNotNone(new_js)
        self.assertTrue(all(r.status == 'applied' for r in patch_results))
        self.assertIn('document.createElement("p")', new_js)
        self.assertIn('paragraph.textContent = userInput;', new_js)
        self.assertIn('container.replaceChildren(paragraph);', new_js)
        self.assertNotIn('innerHTML', new_js)

        revalidated = _validate(self.user, js=new_js, validation_scope='javascript')
        self.assertIsNone(_issue_by_rule(revalidated, 'mdaiw-security/innerhtml-assignment'))
        # No new dangerous sink of any kind was introduced.
        self.assertEqual(introduces_new_dangerous_sink(js, new_js), [])

    def test_does_not_reconstruct_markup_with_attributes(self):
        js = 'function render(url) {\n  container.innerHTML = `<a href="${url}">Link</a>`;\n}\n'
        report = _validate(self.user, js=js, validation_scope='javascript')
        issue = _issue_by_rule(report, 'mdaiw-security/innerhtml-assignment')
        self.assertIsNotNone(issue)
        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard')
        self.assertIsNone(result, 'attribute-bearing markup must be left to AI Engineer reasoning, never guessed at')

    def test_does_not_reconstruct_nested_markup(self):
        js = 'function render(text) {\n  container.innerHTML = `<div><strong>${text}</strong></div>`;\n}\n'
        report = _validate(self.user, js=js, validation_scope='javascript')
        issue = _issue_by_rule(report, 'mdaiw-security/innerhtml-assignment')
        self.assertIsNotNone(issue)
        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard')
        self.assertIsNone(result, 'nested markup must be left to AI Engineer reasoning, never guessed at')

    def test_does_not_reconstruct_an_unlisted_tag(self):
        js = 'function render(text) {\n  container.innerHTML = `<table>${text}</table>`;\n}\n'
        report = _validate(self.user, js=js, validation_scope='javascript')
        issue = _issue_by_rule(report, 'mdaiw-security/innerhtml-assignment')
        self.assertIsNotNone(issue)
        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard')
        self.assertIsNone(result, 'table is not in the known-safe simple-tag set')

    def test_never_touches_outerhtml(self):
        js = 'function replace() {\n  el.outerHTML = "<span>x</span>";\n}\n'
        report = _validate(self.user, js=js, validation_scope='javascript')
        issue = _issue_by_rule(report, 'mdaiw-security/innerhtml-assignment')
        self.assertIsNotNone(issue)
        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard')
        self.assertIsNone(result, 'textContent/replaceChildren are not behavior-equivalent for outerHTML')


class EmbeddedScriptSecureDomRepairTests(TestCase):
    """Closure spec sections 2/3/8 — the SAME recipes, applied to an
    HTML-embedded <script> block, mapping the local JS fix back to exact
    HTML offsets without corrupting anything around it."""

    def setUp(self):
        self.user = _make_user('embedded_user')

    def test_clears_content_inside_an_embedded_script_without_corrupting_surrounding_html(self):
        html = (
            '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>T</title></head>\n'
            '<body>\n<p>Before script.</p>\n<script>\nfunction reset() {\n  result.innerHTML = "";\n}\n</script>\n'
            '<p>After script.</p>\n</body></html>\n'
        )
        report = _validate(self.user, html=html, validation_scope='html')
        issue = _issue_by_rule(report, 'mdaiw-security/innerhtml-assignment')
        self.assertIsNotNone(issue, 'fixture must actually raise the embedded unsafe-innerHTML finding')
        self.assertEqual(issue.source_context, 'html-script-block')

        result = verified_recipes.generate_recipe_result(issue, {'html': html, 'css': '', 'js': '', 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertEqual(result.strategy_key, 'innerhtml-clear-to-replacechildren')
        self.assertEqual(result.patches[0].file, 'html')

        new_html, patch_results = apply_patches_to_source(html, result.patches)
        self.assertIsNotNone(new_html)
        self.assertTrue(all(r.status == 'applied' for r in patch_results))
        self.assertIn('result.replaceChildren();', new_html)
        # Everything outside the script block is byte-for-byte untouched.
        self.assertIn('<p>Before script.</p>', new_html)
        self.assertIn('<p>After script.</p>', new_html)
        self.assertIn('<title>T</title>', new_html)

        revalidated = _validate(self.user, html=new_html, validation_scope='html')
        self.assertIsNone(_issue_by_rule(revalidated, 'mdaiw-security/innerhtml-assignment'))

    def test_rewrites_plain_dynamic_text_inside_an_embedded_script(self):
        html = (
            '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>T</title></head>\n'
            '<body>\n<script>\nfunction greet(name) {\n  result.innerHTML = name;\n}\n</script>\n</body></html>\n'
        )
        report = _validate(self.user, html=html, validation_scope='html')
        issue = _issue_by_rule(report, 'mdaiw-security/innerhtml-assignment')
        self.assertIsNotNone(issue)

        result = verified_recipes.generate_recipe_result(issue, {'html': html, 'css': '', 'js': '', 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertEqual(result.strategy_key, 'innerhtml-dynamic-text-to-textcontent')

        new_html, patch_results = apply_patches_to_source(html, result.patches)
        self.assertIsNotNone(new_html)
        self.assertTrue(all(r.status == 'applied' for r in patch_results))
        self.assertIn('result.textContent = name;', new_html)

        revalidated = _validate(self.user, html=new_html, validation_scope='html')
        self.assertIsNone(_issue_by_rule(revalidated, 'mdaiw-security/innerhtml-assignment'))

    def test_rewrites_selector_inside_an_embedded_script_to_an_existing_equivalent_id(self):
        html = (
            '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>T</title></head>\n'
            '<body>\n<input type="text" id="userName">\n'
            '<script>\nconst el = document.getElementById("username");\nconsole.log(el);\n</script>\n'
            '</body></html>\n'
        )
        report = _validate(self.user, html=html, validation_scope='html')
        issue = _issue_by_rule(report, 'mdaiw-lp/missing-selector-target')
        self.assertIsNotNone(issue, 'fixture must actually raise the embedded missing-selector-target finding')
        self.assertEqual(issue.source_context, 'html-script-block')

        result = verified_recipes.generate_recipe_result(issue, {'html': html, 'css': '', 'js': '', 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertEqual(result.strategy_key, 'rename-selector-to-existing-equivalent-id')
        self.assertEqual(result.patches[0].file, 'html')

        new_html, patch_results = apply_patches_to_source(html, result.patches)
        self.assertIsNotNone(new_html)
        self.assertTrue(all(r.status == 'applied' for r in patch_results))
        self.assertIn('getElementById("userName")', new_html)
        self.assertIn('<input type="text" id="userName">', new_html)

        revalidated = _validate(self.user, html=new_html, validation_scope='html')
        self.assertIsNone(_issue_by_rule(revalidated, 'mdaiw-lp/missing-selector-target'))

    def test_standalone_and_embedded_success_share_the_same_verified_repair_memory_row(self):
        # Closure spec section 8 — a strategy learned in one context must
        # be reusable in the other, sharing the SAME ledger row (never
        # two incompatible recipe families).
        standalone_js = 'function reset() {\n  result.innerHTML = "";\n}\n'
        standalone_report = _validate(self.user, js=standalone_js, validation_scope='javascript')
        standalone_issue = _issue_by_rule(standalone_report, 'mdaiw-security/innerhtml-assignment')
        standalone_result = verified_recipes.generate_recipe_result(
            standalone_issue, {'html': '', 'css': '', 'js': standalone_js, 'ampscript': ''}, 'css', 'standard',
        )

        embedded_html = (
            '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>T</title></head>\n'
            '<body>\n<script>\nfunction reset() {\n  panel.innerHTML = "";\n}\n</script>\n</body></html>\n'
        )
        embedded_report = _validate(self.user, html=embedded_html, validation_scope='html')
        embedded_issue = _issue_by_rule(embedded_report, 'mdaiw-security/innerhtml-assignment')
        embedded_result = verified_recipes.generate_recipe_result(
            embedded_issue, {'html': embedded_html, 'css': '', 'js': '', 'ampscript': ''}, 'css', 'standard',
        )

        self.assertEqual(standalone_result.strategy_key, embedded_result.strategy_key)
        self.assertEqual(standalone_result.context_facts, embedded_result.context_facts)
        standalone_signature = repair_memory.compute_context_signature(standalone_result.context_facts)
        embedded_signature = repair_memory.compute_context_signature(embedded_result.context_facts)
        self.assertEqual(standalone_signature, embedded_signature)
