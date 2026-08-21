"""Verified Repair Memory closure spec, section 10 — user-isolation
review. Every recipe is run against fixtures containing DISTINCTIVE,
made-up "customer content" strings (business names, unique identifiers,
AMPscript-flavored values) that would never appear by coincidence, then
every persisted RepairKnowledgeRecord field — and the RecipeResult that
produced it — is checked for zero trace of that content. Proves the
generalized-facts-only claim empirically, not just by code inspection."""

from django.contrib.auth import get_user_model
from django.db.models import CharField, TextField
from django.test import TestCase

from ..fixes import repair_memory, verified_recipes
from ..models import RepairKnowledgeRecord
from ..report_builder import persist_validation_report

User = get_user_model()

# Deliberately weird/unique strings unlikely to ever appear in generated
# code, generic English, or this test file's own prose — if any of these
# turn up anywhere in a RepairKnowledgeRecord row, something leaked.
_SECRET_BUSINESS_NAME = 'ZorbaxWidgetCorp9981'
_SECRET_FONT_NAME = 'GloopFangDisplayZQ77'  # unrecognized on purpose — falls to AI, no recipe fires
_SECRET_FIELD_ID = 'qxzUniqueCustomerFieldId773'
_SECRET_VAR_NAME = 'zorbaxUserPayloadXQ99'


def _make_user(name='privacy_user'):
    return User.objects.create_user(username=name, password='pw12345!', email=f'{name}@example.com')


def _assert_field_never_contains_secret(record: RepairKnowledgeRecord, secret: str):
    for field in record._meta.get_fields():
        if not isinstance(field, (CharField, TextField)):
            continue
        value = getattr(record, field.name, None)
        if isinstance(value, str):
            assert secret not in value, f'{field.name!r} leaked customer content: {value!r}'


class RecipeOutputNeverContainsCustomerContentTests(TestCase):
    def setUp(self):
        self.user = _make_user()

    def _record(self, result, *, language, rule_id):
        context_signature = repair_memory.compute_context_signature(result.context_facts)
        return repair_memory.record_attempt_result(
            language=language, rule_id=rule_id, context_signature=context_signature,
            strategy_key=result.strategy_key, success=True, strategy_description=result.strategy_description,
        )

    def test_charset_recipe_never_leaks_page_content(self):
        html = (
            f'<!DOCTYPE html>\n<html lang="en"><head>\n'
            f'<meta name="description" content="{_SECRET_BUSINESS_NAME} landing page">\n'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f'<meta charset="UTF-8">\n<title>{_SECRET_BUSINESS_NAME}</title>\n</head>\n'
            f'<body><h1>{_SECRET_BUSINESS_NAME}</h1></body></html>\n'
        )
        report, _ = persist_validation_report(
            user=self.user, project=None, html=html, css='', js='', ts='', ampscript='',
            profile='standard', validation_scope='html', css_source_type='css',
        )
        issue = next(i for i in report.issues.all() if i.rule_id == 'charset-declared-late')
        result = verified_recipes.generate_recipe_result(issue, {'html': html, 'css': '', 'js': '', 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertNotIn(_SECRET_BUSINESS_NAME, str(result.context_facts))
        self.assertNotIn(_SECRET_BUSINESS_NAME, result.strategy_description)
        record = self._record(result, language='html', rule_id='charset-declared-late')
        _assert_field_never_contains_secret(record, _SECRET_BUSINESS_NAME)

    def test_font_family_recipe_never_leaks_the_unrecognized_font_name(self):
        css = f'body {{\n  font-family: {_SECRET_FONT_NAME};\n}}\n'
        report, _ = persist_validation_report(
            user=self.user, project=None, html='', css=css, js='', ts='', ampscript='',
            profile='standard', validation_scope='css', css_source_type='css',
        )
        issue = next(i for i in report.issues.all() if i.rule_id == 'stylelint:font-family-no-missing-generic-family-keyword')
        # Unrecognized font -> recipe correctly declines (never guesses);
        # nothing is ever written to memory for this attempt at all,
        # which is itself the strongest privacy property here.
        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': css, 'js': '', 'ampscript': ''}, 'css', 'standard')
        self.assertIsNone(result)

    def test_selector_recipe_never_leaks_the_field_id(self):
        html = (
            f'<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>T</title></head>'
            f'<body><input type="text" id="{_SECRET_FIELD_ID}Camel"></body></html>'
        )
        js = f'const el = document.getElementById("{_SECRET_FIELD_ID}camel");\nconsole.log(el);\n'
        report, _ = persist_validation_report(
            user=self.user, project=None, html=html, css='', js=js, ts='', ampscript='',
            profile='standard', validation_scope='complete', css_source_type='css',
        )
        issue = next(i for i in report.issues.all() if i.rule_id == 'mdaiw-lp/missing-selector-target')
        result = verified_recipes.generate_recipe_result(
            issue, {'html': html, 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard',
        )
        self.assertIsNotNone(result)
        # context_facts stores only a NORMALIZED (lowercased/stripped)
        # form of the id, and only for hashing — check the raw dict too.
        self.assertNotIn(_SECRET_FIELD_ID, str(result.context_facts))
        self.assertNotIn(_SECRET_FIELD_ID, result.strategy_description)
        record = self._record(result, language='javascript', rule_id='mdaiw-lp/missing-selector-target')
        _assert_field_never_contains_secret(record, _SECRET_FIELD_ID)
        _assert_field_never_contains_secret(record, _SECRET_FIELD_ID.lower())

    def test_innerhtml_recipe_never_leaks_the_variable_name(self):
        js = f'function show({_SECRET_VAR_NAME}) {{\n  result.innerHTML = {_SECRET_VAR_NAME};\n}}\n'
        report, _ = persist_validation_report(
            user=self.user, project=None, html='', css='', js=js, ts='', ampscript='',
            profile='standard', validation_scope='javascript', css_source_type='css',
        )
        issue = next(i for i in report.issues.all() if i.rule_id == 'mdaiw-security/innerhtml-assignment')
        result = verified_recipes.generate_recipe_result(issue, {'html': '', 'css': '', 'js': js, 'ampscript': ''}, 'css', 'standard')
        self.assertIsNotNone(result)
        self.assertNotIn(_SECRET_VAR_NAME, str(result.context_facts))
        self.assertNotIn(_SECRET_VAR_NAME, result.strategy_description)
        record = self._record(result, language='javascript', rule_id='mdaiw-security/innerhtml-assignment')
        _assert_field_never_contains_secret(record, _SECRET_VAR_NAME)
        # Every context_signature is exactly a sha256 hex digest —
        # structurally incapable of containing readable source text.
        self.assertEqual(len(record.context_signature), 64)
        self.assertTrue(all(c in '0123456789abcdef' for c in record.context_signature))
