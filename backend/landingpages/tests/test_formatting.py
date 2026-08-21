"""AI Engineer Formatting + Documentation sprint — deterministic formatter
unit tests. No AI provider involved (spec section 20 — formatting is
never an LLM call); these exercise the real js-beautify-backed Node
bridge and the pure-Python AMPscript formatter directly."""

from django.test import TestCase

from ..fixes import formatting


class HtmlFormattingTests(TestCase):
    def test_reindents_nested_elements(self):
        result = formatting.format_html('<div><p>hi</p></div>')
        self.assertIsNotNone(result)
        self.assertIn('<div>\n  <p>hi</p>\n</div>', result)

    def test_empty_input_is_skipped(self):
        self.assertIsNone(formatting.format_html(''))
        self.assertIsNone(formatting.format_html('   '))

    def test_preserves_ampscript_block_delimiters_verbatim(self):
        html = (
            '%%[\nVAR @name\nSET @name = "x"\n]%%\n'
            '<!DOCTYPE html><html><head><title>T</title></head>'
            '<body><a href="%%=v(@name)=%%">Hi %%=v(@name)=%%</a></body></html>'
        )
        result = formatting.format_html(html)
        self.assertIsNotNone(result)
        self.assertIn('%%[\nVAR @name\nSET @name = "x"\n]%%', result)
        self.assertIn('href="%%=v(@name)=%%"', result)
        self.assertIn('Hi %%=v(@name)=%%', result)

    def test_idempotent_on_already_formatted_source(self):
        once = formatting.format_html('<div><p>hi</p></div>')
        twice = formatting.format_html(once)
        # Already-formatted input should format to itself (or None if
        # js-beautify judges it unchanged) — never oscillate.
        self.assertTrue(twice is None or twice == once)


class CssFormattingTests(TestCase):
    def test_reindents_declarations_without_reordering(self):
        result = formatting.format_css('.a{color:red;background:blue}', 'css')
        self.assertIsNotNone(result)
        self.assertIn('color: red', result)
        self.assertIn('background: blue', result)
        # Declaration order preserved — color still precedes background.
        self.assertLess(result.index('color'), result.index('background'))

    def test_scss_variables_and_nesting_survive(self):
        scss = '$brand: #002D38;\n.a{ &:hover{ color: $brand; } }'
        result = formatting.format_css(scss, 'scss')
        self.assertIsNotNone(result)
        self.assertIn('$brand', result)
        self.assertIn('&:hover', result)

    def test_indented_sass_is_left_unformatted(self):
        # No braces to beautify against — formatting indented Sass with a
        # brace-based beautifier would corrupt its whitespace-significant
        # syntax, so this is a deliberate no-op (spec section 7).
        self.assertIsNone(formatting.format_css('.a\n  color: red', 'sass'))

    def test_empty_input_is_skipped(self):
        self.assertIsNone(formatting.format_css('', 'css'))


class JavascriptFormattingTests(TestCase):
    def test_reindents_function_body(self):
        result = formatting.format_javascript('function f(a,b){return a+b;}')
        self.assertIsNotNone(result)
        self.assertIn('function f(a, b) {', result)

    def test_empty_input_is_skipped(self):
        self.assertIsNone(formatting.format_javascript(''))


class AmpscriptFormattingTests(TestCase):
    def test_indents_if_block_body_and_dedents_endif(self):
        source = '%%[\nVAR @name\nIF EMPTY(@name) THEN\nSET @name = "Guest"\nENDIF\n]%%\n'
        result = formatting.format_ampscript(source)
        self.assertIsNotNone(result)
        lines = result.split('\n')
        self.assertIn('IF EMPTY(@name) THEN', lines)
        self.assertIn('  SET @name = "Guest"', lines)
        self.assertIn('ENDIF', lines)

    def test_for_next_and_elseif_else_nesting(self):
        source = (
            '%%[\nFOR @i = 1 TO 3 DO\nIF @i == 1 THEN\nSET @x = 1\n'
            'ELSEIF @i == 2 THEN\nSET @x = 2\nELSE\nSET @x = 3\nENDIF\nNEXT @i\n]%%\n'
        )
        result = formatting.format_ampscript(source)
        self.assertIsNotNone(result)
        self.assertIn('  IF @i == 1 THEN', result)
        self.assertIn('    SET @x = 1', result)
        self.assertIn('  ELSEIF @i == 2 THEN', result)
        self.assertIn('  ELSE', result)
        self.assertIn('  ENDIF', result)
        self.assertIn('NEXT @i', result)

    def test_inline_output_expressions_outside_blocks_are_untouched(self):
        source = 'Hello %%=v(@name)=%%, welcome!'
        # No %%[ ... ]%% block at all — nothing to format.
        self.assertIsNone(formatting.format_ampscript(source))

    def test_malformed_unbalanced_delimiters_returns_none_rather_than_guess(self):
        self.assertIsNone(formatting.format_ampscript('%%[\nVAR @x\n'))  # missing ]%%

    def test_already_formatted_source_is_a_no_op(self):
        source = '%%[\nVAR @name\nIF EMPTY(@name) THEN\n  SET @name = "Guest"\nENDIF\n]%%\n'
        self.assertIsNone(formatting.format_ampscript(source))


class FormatAllSourcesTests(TestCase):
    def test_only_reports_files_that_actually_changed(self):
        sources = {
            'html': '<div><p>hi</p></div>', 'css': '.a{color:red}',
            'js': 'function f(a,b){return a+b;}', 'ampscript': '',
        }
        new_sources, changed = formatting.format_all_sources(sources, 'css')
        self.assertEqual(changed, {'html', 'css', 'js'})
        self.assertNotIn('ampscript', changed)
        for key in sources:
            self.assertIn(key, new_sources)

    def test_never_raises_and_leaves_untouched_on_full_empty_input(self):
        sources = {'html': '', 'css': '', 'js': '', 'ampscript': ''}
        new_sources, changed = formatting.format_all_sources(sources, 'css')
        self.assertEqual(changed, set())
        self.assertEqual(new_sources, sources)
