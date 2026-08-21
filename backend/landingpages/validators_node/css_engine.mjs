// Shared CSS validation pipeline — extracted from validate_css.mjs
// (Sprint CSS-C) so compile_scss.mjs can run the exact same three-phase
// pipeline against SCSS/Sass's *generated* CSS without duplicating any
// of this logic. Never reads .stylelintrc / stylelint.config.js / any
// package-level config; never accepts a config path, plugin path, parser
// path, or JavaScript callback from its input. Never executes or
// evaluates the submitted CSS, never makes a network request.

import postcss from 'postcss';
import stylelint from 'stylelint';
import * as csstree from 'css-tree';
import postcssLess from 'postcss-less';
import postcssScss from 'postcss-scss';

// Tool-Grounded AI Engineer sprint, spec section 1/6 — LESS/SCSS autofix
// must edit the ORIGINAL preprocessor source, never the compiled CSS
// (source-mapping an autofix's structural edits back through a compiled
// artifact is not reliable). postcss-less/postcss-scss parse the
// preprocessor's own syntax (variables, mixins, nesting, `@each`, etc.)
// directly, so Stylelint's `fix: true` mode can run against it safely.
// Indented Sass is deliberately NOT included here: it has no comparably
// maintained official postcss custom-syntax package, and its syntax is
// whitespace-significant (see fixes/formatting.py's own long-standing
// refusal to run a brace-based beautifier against it) — autofixing it
// with an unofficial/stale parser would risk corrupting meaning, not
// just style, so this project declines rather than risk it.
const CUSTOM_SYNTAXES = { less: postcssLess, scss: postcssScss };

const POSTCSS_VERSION = '8.5.25';
const STYLELINT_VERSION = '17.14.1';
const CSSTREE_VERSION = '3.2.1';
export const ENGINE_LABEL = 'postcss-stylelint-csstree';
export const ENGINE_VERSION = `postcss@${POSTCSS_VERSION};stylelint@${STYLELINT_VERSION};css-tree@${CSSTREE_VERSION}`;

// At-rules that are valid, well-established modern CSS but may not yet be
// present in every bundled "known at-rules" dataset — never reported as
// invalid regardless of profile (Sprint 1D Part 3/Acceptance Case C).
const MODERN_AT_RULES = ['container', 'layer', 'property', 'scope', 'starting-style'];

// Used only for the 'legacy' profile's informational compatibility notice
// (never a syntax error) — see buildModernFeatureNotices().
const MODERN_FEATURE_SIGNATURES = {
  atRules: ['container', 'layer', 'scope', 'starting-style'],
  functions: ['color-mix', 'oklch', 'oklab', 'lab', 'lch', 'clamp', 'min', 'max'],
  values: ['subgrid'],
};

export const KNOWN_CONTEXTS = new Set(['stylesheet', 'declaration-list']);

export function excerptFor(sourceLines, line) {
  if (!line || line < 1 || line > sourceLines.length) return '';
  return sourceLines[line - 1].trim().slice(0, 200);
}

// `context` is a server-owned, fixed-vocabulary hint, never arbitrary
// caller-supplied config (see node_bridge.py::run_css_validation).
// 'declaration-list' is used for the synthetic single-selector wrapper
// built around an inline style="..." attribute's declarations — real
// inline styles are legitimately single-line with many declarations, so
// the stylesheet-formatting rule below would otherwise misfire on nearly
// every multi-declaration inline style.
// Tool-Grounded AI Engineer sprint — LESS's compiler does not preserve
// blank-line spacing between top-level rules/at-rules/declarations in
// its compiled-CSS output (verified directly: compiling
// ".a{color:red}\n\n.b{color:blue}" and ".a{color:red}\n.b{color:blue}"
// produces IDENTICAL output with no blank line either way), unlike Dart
// Sass's 'expanded' output style, which does insert one. Linting the
// COMPILED CSS for this "empty line before" rule family against LESS
// therefore reports a warning no edit to the LESS SOURCE can ever
// resolve — the compiler's own formatting convention decides it, not
// the author. Reporting an unfixable-via-source-edit warning here is
// exactly what previously sent "AI Fix Issues" into repeated, futile
// attempts against the same LESS formatting warning. Used only by
// compile_less.mjs's validation call — plain CSS and SCSS (whose
// Dart Sass output DOES preserve this spacing) keep reporting these
// rules normally, since for them the warning IS something the author's
// own source controls.
export const LESS_COMPILED_OUTPUT_UNFIXABLE_RULES = Object.freeze([
  'at-rule-empty-line-before',
  'comment-empty-line-before',
  'custom-property-empty-line-before',
  'declaration-empty-line-before',
  'rule-empty-line-before',
]);

export function buildStylelintConfig(context, ruleOverrides) {
  const rules = {
    'block-no-empty': true,
    'declaration-block-no-duplicate-properties': true,
    'declaration-no-important': true,
    'no-duplicate-selectors': true,
    'no-unknown-animations': true,
    'property-no-unknown': true,
    'at-rule-no-unknown': [true, { ignoreAtRules: MODERN_AT_RULES }],
    'function-no-unknown': true,
    'unit-no-unknown': true,
    'selector-max-specificity': '0,3,0',
  };
  if (context === 'declaration-list') {
    rules['declaration-block-single-line-max-declarations'] = null;
  }
  if (ruleOverrides) {
    for (const ruleName of ruleOverrides) rules[ruleName] = null;
  }
  return { extends: ['stylelint-config-standard'], defaultSeverity: 'warning', rules };
}

// --- custom AST-based post-processing -------------------------------------
// Only for concerns Stylelint's rule set doesn't reliably cover. Every
// function here walks the already-parsed AST — never a regex scan of the
// raw source — and returns issue objects in the same shape as the
// normalized Stylelint findings, merged by the caller.

function walkAncestorAtRuleNames(node) {
  const names = [];
  let current = node.parent;
  while (current) {
    if (current.type === 'atrule') names.push(current.name);
    current = current.parent;
  }
  return names;
}

function checkSecurityUrls(root) {
  const issues = [];
  function inspectUrlBearingValue(value, node, propertyLabel) {
    // Quoted url() content may legally contain parentheses (e.g. a
    // javascript: URL calling a function) — matched as a distinct
    // alternative from the unquoted form, which may not.
    const matches = [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^"'\s)][^)]*))\s*\)/gi)];
    for (const match of matches) {
      const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      const line = node.source?.start?.line ?? 1;
      const column = node.source?.start?.column ?? 1;
      if (/^javascript:/i.test(url)) {
        issues.push({
          ruleId: 'css-custom:unsafe-javascript-url', category: 'security', severity: 'error',
          confidence: 'definite', message: `"${propertyLabel}" uses a javascript: URL, a script-injection vector.`,
          suggestion: 'Remove the javascript: URL; CSS must never reference executable script.',
          line, column, relatedAttribute: propertyLabel,
        });
      } else if (/^data:/i.test(url) && url.length > 5000) {
        issues.push({
          ruleId: 'css-custom:large-data-url', category: 'performance', severity: 'warning',
          confidence: 'likely', message: `"${propertyLabel}" embeds a very large data: URL (${url.length} characters).`,
          suggestion: 'Consider referencing an external asset instead of a large inline data URL.',
          line, column, relatedAttribute: propertyLabel,
        });
      } else if (/^http:\/\//i.test(url)) {
        issues.push({
          ruleId: 'css-custom:insecure-external-url', category: 'security', severity: 'warning',
          confidence: 'possible', message: `"${propertyLabel}" references a non-HTTPS external URL.`,
          suggestion: 'Use an https:// URL for external resources.',
          line, column, relatedAttribute: propertyLabel,
        });
      }
    }
  }
  root.walkDecls((decl) => inspectUrlBearingValue(decl.value, decl, decl.prop));
  root.walkAtRules('import', (atRule) => inspectUrlBearingValue(atRule.params, atRule, '@import'));
  return issues;
}

function checkResponsiveFixedWidth(root) {
  const issues = [];
  const widthProps = new Set(['width', 'min-width', 'max-width']);
  root.walkDecls((decl) => {
    if (!widthProps.has(decl.prop.toLowerCase())) return;
    const match = /^(-?\d+(?:\.\d+)?)px$/.exec(decl.value.trim());
    if (!match) return;
    const pixels = parseFloat(match[1]);
    if (pixels <= 480) return;
    const ancestors = walkAncestorAtRuleNames(decl);
    if (ancestors.some((name) => name === 'media' || name === 'container')) return;
    const confidence = pixels > 768 ? 'likely' : 'possible';
    issues.push({
      ruleId: 'css-custom:responsive-fixed-width-risk', category: 'responsive', severity: 'warning',
      confidence,
      message: `"${decl.prop}: ${decl.value}" is a large fixed width with no surrounding @media/@container — it may overflow narrow viewports.`,
      suggestion: 'Use a relative unit, max-width with a smaller value, or add a responsive override.',
      line: decl.source?.start?.line ?? 1, column: decl.source?.start?.column ?? 1,
      relatedAttribute: decl.prop,
    });
  });
  return issues;
}

function checkFocusOutlineRemoved(root) {
  const issues = [];
  root.walkRules((rule) => {
    let outlineRemoved = null;
    let hasReplacement = false;
    rule.walkDecls((decl) => {
      if (decl.prop.toLowerCase() === 'outline' && /^(none|0)$/i.test(decl.value.trim())) {
        outlineRemoved = decl;
      }
      if (decl.prop.toLowerCase() === 'box-shadow' && !/^none$/i.test(decl.value.trim())) {
        hasReplacement = true;
      }
    });
    if (outlineRemoved && !hasReplacement) {
      issues.push({
        ruleId: 'css-custom:focus-outline-removed', category: 'accessibility', severity: 'warning',
        confidence: 'likely',
        message: `"outline: ${outlineRemoved.value}" removes the default focus indicator without a visible replacement (e.g. box-shadow).`,
        suggestion: 'Provide a visible focus replacement, such as box-shadow, when removing the default outline.',
        line: outlineRemoved.source?.start?.line ?? 1, column: outlineRemoved.source?.start?.column ?? 1,
        relatedAttribute: 'outline',
      });
    }
  });
  return issues;
}

function checkSmallFontSize(root) {
  const issues = [];
  root.walkDecls('font-size', (decl) => {
    const value = decl.value.trim();
    const pxMatch = /^(\d+(?:\.\d+)?)px$/.exec(value);
    const remOrEmMatch = /^(\d+(?:\.\d+)?)(rem|em)$/.exec(value);
    let approxPixels = null;
    let confidence = 'likely';
    if (pxMatch) {
      approxPixels = parseFloat(pxMatch[1]);
    } else if (remOrEmMatch) {
      approxPixels = parseFloat(remOrEmMatch[1]) * 16; // reasonable default-root-size approximation
      confidence = 'possible';
    }
    if (approxPixels !== null && approxPixels < 12) {
      issues.push({
        ruleId: 'css-custom:small-font-size', category: 'accessibility', severity: 'warning',
        confidence,
        message: `"font-size: ${value}" is very small (~${approxPixels}px) and may be hard to read.`,
        suggestion: 'Use at least 12px (or the equivalent relative unit) for body text.',
        line: decl.source?.start?.line ?? 1, column: decl.source?.start?.column ?? 1,
        relatedAttribute: 'font-size',
      });
    }
  });
  return issues;
}

function checkExtremeLineHeight(root) {
  const issues = [];
  root.walkDecls('line-height', (decl) => {
    const value = decl.value.trim();
    if (!/^\d+(\.\d+)?$/.test(value)) return; // only the reliable unitless-number case
    const number = parseFloat(value);
    if (number < 1.0 || number > 3) {
      issues.push({
        ruleId: 'css-custom:extreme-line-height', category: 'accessibility', severity: 'warning',
        confidence: 'possible',
        message: `"line-height: ${value}" is outside a typical readable range (1.0–3.0).`,
        suggestion: 'Use a line-height between about 1.2 and 2 for readable body text.',
        line: decl.source?.start?.line ?? 1, column: decl.source?.start?.column ?? 1,
        relatedAttribute: 'line-height',
      });
    }
  });
  return issues;
}

function checkTextClippingRisk(root) {
  const issues = [];
  root.walkRules((rule) => {
    let overflowHidden = null;
    let smallHeight = null;
    rule.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (prop === 'overflow' && /^hidden$/i.test(decl.value.trim())) overflowHidden = decl;
      if ((prop === 'height' || prop === 'max-height')) {
        const match = /^(\d+(?:\.\d+)?)px$/.exec(decl.value.trim());
        if (match && parseFloat(match[1]) <= 40) smallHeight = decl;
      }
    });
    if (overflowHidden && smallHeight) {
      issues.push({
        ruleId: 'css-custom:text-clipping-risk', category: 'accessibility', severity: 'warning',
        confidence: 'possible',
        message: `"overflow: hidden" combined with a small fixed height (${smallHeight.value}) risks clipping text content.`,
        suggestion: 'Use a larger or content-based height, or allow overflow so text is not cut off.',
        line: overflowHidden.source?.start?.line ?? 1, column: overflowHidden.source?.start?.column ?? 1,
        relatedAttribute: 'overflow',
      });
    }
  });
  return issues;
}

function checkMotionWithoutReducedMotion(root) {
  let hasReducedMotionQuery = false;
  let firstMotionDecl = null;
  root.walkAtRules('media', (atRule) => {
    if (/prefers-reduced-motion/i.test(atRule.params)) hasReducedMotionQuery = true;
  });
  root.walkDecls(/^(animation|transition)(-[a-z]+)?$/, (decl) => {
    if (!firstMotionDecl) firstMotionDecl = decl;
  });
  if (firstMotionDecl && !hasReducedMotionQuery) {
    return [{
      ruleId: 'css-custom:motion-without-reduced-motion', category: 'accessibility', severity: 'warning',
      confidence: 'possible',
      message: 'Animation/transition is used without an accompanying @media (prefers-reduced-motion: reduce) override.',
      suggestion: 'Add a @media (prefers-reduced-motion: reduce) block that disables or reduces motion.',
      line: firstMotionDecl.source?.start?.line ?? 1, column: firstMotionDecl.source?.start?.column ?? 1,
      relatedAttribute: firstMotionDecl.prop,
    }];
  }
  return [];
}

function checkSuspiciousZIndex(root) {
  const issues = [];
  root.walkDecls('z-index', (decl) => {
    const value = Number(decl.value.trim());
    if (!Number.isFinite(value)) return;
    if (Math.abs(value) > 9999) {
      issues.push({
        ruleId: 'css-custom:suspicious-z-index', category: 'syntax', severity: 'warning',
        confidence: 'likely',
        message: `"z-index: ${decl.value}" is an unusually extreme value.`,
        suggestion: 'Use a smaller, deliberately managed z-index scale.',
        line: decl.source?.start?.line ?? 1, column: decl.source?.start?.column ?? 1,
        relatedAttribute: 'z-index',
      });
    }
  });
  return issues;
}

function checkEmptyAtRuleCondition(root) {
  const issues = [];
  const requiresCondition = new Set(['media', 'supports', 'container']);
  root.walkAtRules((atRule) => {
    if (requiresCondition.has(atRule.name) && !atRule.params.trim()) {
      issues.push({
        ruleId: 'css-custom:empty-at-rule-condition', category: 'syntax', severity: 'error',
        confidence: 'definite',
        message: `"@${atRule.name}" is missing its required condition.`,
        suggestion: `Add a condition, for example "@${atRule.name} (min-width: 40rem)".`,
        line: atRule.source?.start?.line ?? 1, column: atRule.source?.start?.column ?? 1,
      });
    }
  });
  return issues;
}

function checkUnnamedKeyframes(root) {
  const issues = [];
  root.walkAtRules('keyframes', (atRule) => {
    if (!atRule.params.trim()) {
      issues.push({
        ruleId: 'css-custom:keyframes-missing-name', category: 'syntax', severity: 'error',
        confidence: 'definite',
        message: '"@keyframes" is missing its required animation name.',
        suggestion: 'Add a name, for example "@keyframes fade-in { ... }".',
        line: atRule.source?.start?.line ?? 1, column: atRule.source?.start?.column ?? 1,
      });
    }
  });
  return issues;
}

function checkNegativeInvalidDimensions(root) {
  const issues = [];
  const props = new Set([
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'font-size',
  ]);
  root.walkDecls((decl) => {
    const prop = decl.prop.toLowerCase();
    if (!props.has(prop)) return;
    const value = decl.value.trim();
    if (value.includes('var(') || value.includes('calc(')) return; // not statically evaluable
    if (/^-\d/.test(value)) {
      issues.push({
        ruleId: 'css-custom:negative-invalid-dimension', category: 'syntax', severity: 'error',
        confidence: 'definite',
        message: `"${decl.prop}: ${decl.value}" is negative, which is invalid for this property.`,
        suggestion: `Use a non-negative value for ${decl.prop}.`,
        line: decl.source?.start?.line ?? 1, column: decl.source?.start?.column ?? 1,
        relatedAttribute: decl.prop,
      });
    }
  });
  return issues;
}

function buildModernFeatureNotices(root, profile) {
  if (profile !== 'legacy') return [];
  const issues = [];
  const seen = new Set();
  function note(name, kind, node) {
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({
      ruleId: 'css-custom:modern-feature-compatibility-notice', category: 'syntax', severity: 'info',
      confidence: 'possible',
      message: `Uses modern CSS ${kind} "${name}", which may not be supported by older targeted browsers.`,
      suggestion: 'Verify support for this feature against the project\'s browser support target, or provide a fallback.',
      line: node.source?.start?.line ?? 1, column: node.source?.start?.column ?? 1,
    });
  }
  root.walkAtRules((atRule) => {
    if (MODERN_FEATURE_SIGNATURES.atRules.includes(atRule.name)) note(atRule.name, 'at-rule', atRule);
  });
  root.walkDecls((decl) => {
    for (const fn of MODERN_FEATURE_SIGNATURES.functions) {
      if (decl.value.includes(`${fn}(`)) note(fn, 'function', decl);
    }
    for (const val of MODERN_FEATURE_SIGNATURES.values) {
      if (decl.value.includes(val)) note(val, 'value', decl);
    }
  });
  return issues;
}

function runCustomChecks(root, profile) {
  return [
    ...checkSecurityUrls(root),
    ...checkResponsiveFixedWidth(root),
    ...checkFocusOutlineRemoved(root),
    ...checkSmallFontSize(root),
    ...checkExtremeLineHeight(root),
    ...checkTextClippingRisk(root),
    ...checkMotionWithoutReducedMotion(root),
    ...checkSuspiciousZIndex(root),
    ...checkNegativeInvalidDimensions(root),
    ...checkEmptyAtRuleCondition(root),
    ...checkUnnamedKeyframes(root),
    ...buildModernFeatureNotices(root, profile),
  ];
}

// --- structural balance check -----------------------------------------------
// Pure lexical scan for unmatched/unclosed braces, comments, and strings —
// deliberately independent of any CSS grammar/property knowledge, and
// independent of PostCSS/css-tree's own recovery, so it always produces a
// precise, deterministic diagnostic for exactly this class of defect
// regardless of what either parser makes of the rest of the document.

export function checkStructuralBalance(css) {
  const issues = [];
  const openStack = [];
  let line = 1;
  let column = 1;
  let i = 0;
  const n = css.length;

  function advance(ch) {
    if (ch === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  while (i < n) {
    const ch = css[i];

    if (ch === '/' && css[i + 1] === '*') {
      const startLine = line;
      const startColumn = column;
      advance(ch); i += 1;
      advance(css[i]); i += 1;
      let closed = false;
      while (i < n) {
        if (css[i] === '*' && css[i + 1] === '/') {
          advance(css[i]); i += 1;
          advance(css[i]); i += 1;
          closed = true;
          break;
        }
        advance(css[i]); i += 1;
      }
      if (!closed) {
        issues.push({
          ruleId: 'css-structure:unclosed-comment', category: 'structure', severity: 'error',
          confidence: 'definite', message: 'Comment is never closed with "*/".',
          suggestion: 'Add a closing "*/" for this comment.',
          line: startLine, column: startColumn,
        });
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const startLine = line;
      const startColumn = column;
      advance(ch); i += 1;
      let closed = false;
      while (i < n) {
        if (css[i] === '\\' && i + 1 < n) {
          advance(css[i]); i += 1;
          advance(css[i]); i += 1;
          continue;
        }
        if (css[i] === quote) {
          advance(css[i]); i += 1;
          closed = true;
          break;
        }
        if (css[i] === '\n') break; // an unescaped newline ends a CSS string — never legal
        advance(css[i]); i += 1;
      }
      if (!closed) {
        issues.push({
          ruleId: 'css-structure:unclosed-string', category: 'structure', severity: 'error',
          confidence: 'definite', message: `String starting with ${quote} is never closed.`,
          suggestion: `Add a closing ${quote} for this string.`,
          line: startLine, column: startColumn,
        });
      }
      continue;
    }

    if (ch === '{') {
      openStack.push({ line, column });
      advance(ch); i += 1;
      continue;
    }

    if (ch === '}') {
      if (openStack.length === 0) {
        issues.push({
          ruleId: 'css-structure:unmatched-closing-brace', category: 'structure', severity: 'error',
          confidence: 'definite', message: 'Unexpected "}" with no matching "{".',
          suggestion: 'Remove this "}", or add the missing "{" it was meant to close.',
          line, column,
        });
      } else {
        openStack.pop();
      }
      advance(ch); i += 1;
      continue;
    }

    advance(ch); i += 1;
  }

  for (const open of openStack) {
    issues.push({
      ruleId: 'css-structure:unclosed-block', category: 'structure', severity: 'error',
      confidence: 'definite', message: '"{" is never closed with a matching "}".',
      suggestion: 'Add a matching "}" to close this block.',
      line: open.line, column: open.column,
    });
  }

  return issues;
}

// --- structural + semantic analysis (css-tree) ------------------------------
// css-tree's parser recovers from most structural defects (a missing colon,
// a malformed declaration, an unsupported at-rule prelude) instead of
// aborting the whole document the way PostCSS's parser does — every error
// is reported via onParseError and parsing continues at the next safe
// boundary, so a single mistake never hides every other finding (see
// checkStructuralBalance above for the complementary brace/string/comment
// check, and the postcss/stylelint block in runValidationPipeline below,
// kept independent so a hard failure in either never removes the other's
// results).
//
// Property/value semantics are validated against css-tree's bundled,
// standards-derived grammar database (csstree.lexer) — never a hand-
// maintained property list. Vendor-prefixed properties css-tree's data
// doesn't recognize are reported as a compatibility notice, not a hard
// "unknown property" error, since real, valid vendor properties do exist
// outside any single bundled dataset.

const VENDOR_PREFIX_RE = /^-(webkit|moz|ms|o)-/i;

function describeValueMismatch(node, matchError) {
  const rawValueText = csstree.generate(node.value).replace(/\s+/g, ' ').trim();
  const valueText = rawValueText.length > 80 ? `${rawValueText.slice(0, 80)}…` : rawValueText;
  const syntaxLineMatch = /syntax:\s*(.+)/.exec(matchError.message || '');
  const expectedSyntax = syntaxLineMatch ? syntaxLineMatch[1].trim() : '';
  return {
    message: `"${node.property}: ${valueText}" is not a valid value for "${node.property}".`,
    suggestion: expectedSyntax ? `Expected: ${expectedSyntax}` : '',
  };
}

export function runStructuralAndSemanticAnalysis(css) {
  const issues = [];
  const parseErrors = [];

  let ast;
  try {
    ast = csstree.parse(css, {
      positions: true,
      onParseError: (error) => parseErrors.push(error),
    });
  } catch {
    // css-tree's recovering parser is not expected to throw for malformed
    // CSS (that's exactly what onParseError is for) — this only guards
    // against a genuine internal engine failure.
    return { issues: [], engineOk: false };
  }

  for (const error of parseErrors) {
    issues.push({
      ruleId: 'css-structure:parse-error', category: 'structure', severity: 'error',
      confidence: 'definite', message: error.rawMessage || error.message || 'CSS could not be parsed at this point.',
      suggestion: '',
      line: error.line || 1, column: error.column || 1,
    });
  }

  try {
    csstree.walk(ast, {
      visit: 'Declaration',
      enter(node) {
        const startLine = node.loc ? node.loc.start.line : 1;
        const startColumn = node.loc ? node.loc.start.column : 1;

        if (node.property.startsWith('--')) return; // custom properties accept any value, by spec

        // A value containing var(...) cannot be statically validated in
        // general — its substituted value isn't known until runtime, and
        // the lexer's grammar matching does not resolve custom-property
        // bindings, so it would otherwise report false mismatches for
        // entirely valid usage (e.g. "padding-inline: var(--space)").
        // Still worth knowing the property itself is real, so the
        // unknown-property check below still applies.
        const usesCustomPropertyValue = /\bvar\(/.test(csstree.generate(node.value));

        const known = Boolean(csstree.lexer.getProperty(node.property));
        if (!known) {
          if (VENDOR_PREFIX_RE.test(node.property)) {
            issues.push({
              ruleId: 'css-compatibility:unrecognized-vendor-property', category: 'compatibility', severity: 'info',
              confidence: 'possible',
              message: `"${node.property}" is a vendor-prefixed property not recognized by the validator's data set.`,
              suggestion: 'Verify browser support for this vendor-prefixed property.',
              line: startLine, column: startColumn,
            });
          } else {
            issues.push({
              ruleId: 'css-semantic:unknown-property', category: 'property', severity: 'error',
              confidence: 'definite', message: `Unknown property "${node.property}".`,
              suggestion: 'Check the property name for a typo.',
              line: startLine, column: startColumn,
            });
          }
          return;
        }

        if (usesCustomPropertyValue) return;

        const match = csstree.lexer.matchDeclaration(node);
        if (match.error) {
          const { message, suggestion } = describeValueMismatch(node, match.error);
          const errorLoc = match.error.loc;
          issues.push({
            ruleId: 'css-semantic:invalid-value', category: 'value', severity: 'error',
            confidence: 'definite', message, suggestion,
            line: errorLoc ? errorLoc.start.line : startLine,
            column: errorLoc ? errorLoc.start.column : startColumn,
          });
        }
      },
    });
  } catch {
    // A walk/lexer failure must not discard the parse-error findings
    // already collected above.
  }

  return { issues, engineOk: true };
}

// --- combined pipeline -------------------------------------------------------
// Runs all three phases and returns the untruncated, raw issue list (with
// codeExcerpt already applied) plus whether the PostCSS/Stylelint phase hit
// a hard parse failure (used by embedded-CSS batching — see
// embedded_css.py — and unrelated to phases 1–2's own recovery).

// AI Engineer Formatting + Documentation closure sprint, spec section 6 —
// rule-aware CSS autofix using stylelint's OWN `fix: true` mode against
// the EXACT SAME config this project's own validation already uses (see
// buildStylelintConfig above) — never a generic beautifier's guess at
// what a specific configured rule (e.g. `comment-empty-line-before`)
// wants. Returns the fixed source, or null if nothing changed / linting
// itself failed (never guesses a fix for unparseable CSS).
export async function runStylelintAutofix(css, context) {
  return runStylelintAutofixForSource(css, context, 'css');
}

// `sourceLanguage` in {'css','less','scss'} — 'less'/'scss' route through
// postcss-less/postcss-scss as stylelint's customSyntax so LESS/SCSS-only
// constructs parse correctly instead of erroring out of plain-CSS
// parsing. Rules without a real fixer (property-no-unknown,
// at-rule-no-unknown, function-no-unknown, unit-no-unknown, etc. — every
// rule this project's own buildStylelintConfig adds on top of
// stylelint-config-standard) can never change `result.code` in fix mode
// regardless of whether they report a LESS/SCSS-only construct as
// "unknown" — only rules with an actual fixer (almost entirely the
// formatting/layout rules in stylelint-config-standard, e.g.
// `rule-empty-line-before`) ever touch the output, so reusing the same
// config here is safe rather than requiring a hand-picked subset.
export async function runStylelintAutofixForSource(source, context, sourceLanguage) {
  try {
    const options = { code: source, config: buildStylelintConfig(context), fix: true };
    const customSyntax = CUSTOM_SYNTAXES[sourceLanguage];
    if (customSyntax) options.customSyntax = customSyntax;
    const result = await stylelint.lint(options);
    // stylelint's `code`-input fix mode returns the fixed source on the
    // top-level `code` property (NOT `output`, which is only populated
    // for `files`-based input) — verified directly against the
    // installed stylelint@17 API rather than assumed from older docs.
    if (typeof result.code !== 'string' || result.code === source) return null;
    return result.code;
  } catch {
    return null;
  }
}

export async function runValidationPipeline(css, profile, context, ruleOverrides) {
  const sourceLines = css.split('\n');
  const issues = checkStructuralBalance(css);

  const structural = runStructuralAndSemanticAnalysis(css);
  issues.push(...structural.issues);

  let parseFailed = false;
  try {
    const root = postcss.parse(css);

    const stylelintResult = await stylelint.lint({ code: css, config: buildStylelintConfig(context, ruleOverrides) });
    for (const fileResult of stylelintResult.results) {
      for (const warning of fileResult.warnings) {
        issues.push({
          ruleId: `stylelint:${warning.rule || 'unknown'}`,
          category: 'syntax',
          severity: warning.severity === 'error' ? 'error' : 'warning',
          confidence: 'definite',
          message: warning.text.replace(/\s*\([^)]*\)\s*$/, ''), // strip stylelint's trailing "(rule-name)"
          suggestion: '',
          line: warning.line ?? 1,
          column: warning.column ?? 1,
          endLine: warning.endLine ?? null,
          endColumn: warning.endColumn ?? null,
        });
      }
    }

    for (const issue of runCustomChecks(root, profile)) {
      issues.push({ ...issue, endLine: null, endColumn: null });
    }
  } catch (err) {
    if (err && err.name === 'CssSyntaxError') {
      // phases 1–2 above already produced the real diagnostics for this
      // document — this is recorded only as a signal for callers (e.g.
      // embedded-CSS batching) that need to know this phase contributed
      // nothing.
      parseFailed = true;
    } else {
      throw err;
    }
  }

  const withExcerpts = issues.map((issue) => ({ ...issue, codeExcerpt: excerptFor(sourceLines, issue.line) }));
  return { issues: withExcerpts, parseFailed };
}
