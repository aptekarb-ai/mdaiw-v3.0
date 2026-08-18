// Controlled LESS compiler — invoked only by
// backend/landingpages/validation/node_bridge.py via a fixed, absolute
// script path. Reads exactly one JSON object from stdin, writes exactly
// one JSON document to stdout.
//
// Security contract (Sprint CSS-D):
//   - `javascriptEnabled` is never set to true, never accepted from the
//     request — inline JS (`` `expr` ``) is rejected by Less itself with
//     a clean compile error (verified empirically: this is Less's
//     default behaviour even when the option is omitted entirely).
//   - Less's *default* import resolution is NOT filesystem-safe by
//     default the way Dart Sass's compileString() is — verified
//     empirically that an unqualified `@import` attempts real relative-
//     to-cwd file resolution (and an npm://-scheme lookup) unless
//     replaced. ControlledFileManager below is registered as a plugin
//     and unconditionally claims every import (`supports()` always
//     returns true), so the risky default file managers never run at
//     all. It resolves only from `partials` — an in-memory dictionary
//     Python already built from ownership-scoped storage reads, never a
//     real filesystem path.
//   - No `paths` (include directories), no user-supplied `plugins`, no
//     custom functions, ever accepted from the request.
//   - Never executes or evaluates the compiled CSS.

import { pathToFileURL } from 'node:url';

import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import {
  checkStructuralBalance, ENGINE_VERSION as CSS_ENGINE_VERSION,
  LESS_COMPILED_OUTPUT_UNFIXABLE_RULES, runValidationPipeline,
} from './css_engine.mjs';

// Pinned to match package.json exactly (see css_engine.mjs's own
// POSTCSS_VERSION/STYLELINT_VERSION for the same convention) — no longer
// runtime-introspected from `less.version`, since `less` itself is now
// loaded via dynamic import() inside main() (see there for why).
const LESS_VERSION = '4.8.1';
const ENGINE_LABEL = 'less-compiler';
const ENGINE_VERSION = `less@${LESS_VERSION};${CSS_ENGINE_VERSION}`;

const KNOWN_PROFILES = new Set(['standard', 'strict', 'legacy', 'experimental']);
const DEFAULT_MAX_ISSUES = 500;
const HARD_MAX_ISSUES = 1000;
const MAX_STDIN_BYTES = 5_000_000; // defense-in-depth; the real cap is enforced Python-side before this process even starts
const MAX_PARTIALS = 20;
const MAX_PARTIAL_BYTES = 200_000;

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    process.stdin.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_STDIN_BYTES) {
        reject(new Error('stdin exceeded maximum size'));
        process.stdin.pause();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

function clampMaxIssues(requested) {
  const value = Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_MAX_ISSUES;
  return Math.min(value, HARD_MAX_ISSUES);
}

// Claims every import (`supports()` always true) so Less's own default
// file managers — which attempt real relative-to-cwd filesystem access
// and npm://-scheme package resolution — never get a chance to run.
// Resolves only from `partials`; any scheme, absolute path, ".."
// segment, or unrecognized name is rejected outright by returning a
// clean File-type error, never a filesystem read.
//
// A factory rather than a top-level class declaration — extending
// `less.FileManager` requires `less` to already be loaded, and `less` is
// now resolved via dynamic import() inside main() (see there), not a
// static module-top-level import, so the class can only be built once
// that import has actually resolved.
function buildControlledFileManagerClass(lessModule) {
  return class ControlledFileManager extends lessModule.FileManager {
    constructor(partials) {
      super();
      this._partials = partials;
    }

    supports() {
      return true;
    }

    supportsSync() {
      return false; // force the async loadFile() path below for every request
    }

    loadFile(filename) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(filename)) {
        return Promise.reject({ type: 'File', message: `'${filename}' could not be resolved.` });
      }
      if (filename.startsWith('/') || filename.split('/').includes('..')) {
        return Promise.reject({ type: 'File', message: `'${filename}' could not be resolved.` });
      }
      const bare = filename.replace(/^_/, '').replace(/\.less$/i, '');
      if (!Object.prototype.hasOwnProperty.call(this._partials, bare)) {
        return Promise.reject({ type: 'File', message: `'${filename}' could not be resolved.` });
      }
      return Promise.resolve({ contents: this._partials[bare], filename: `mdaiw-partial:${bare}` });
    }
  };
}

function buildImportPlugin(lessModule, partials) {
  const ControlledFileManager = buildControlledFileManagerClass(lessModule);
  return {
    install(lessInstance, pluginManager) {
      pluginManager.addFileManager(new ControlledFileManager(partials));
    },
  };
}

// Light, purely cosmetic normalization (capitalization + trailing period) —
// the original Less message text is fully preserved, never replaced or
// truncated. Less error objects never carry a real filesystem path in
// `.message` for a controlled/virtual compile (see module docstring).
function normalizeCompilerMessage(rawMessage) {
  const text = (rawMessage || '').trim();
  if (!text) return 'Compilation failed.';
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  return capitalized.endsWith('.') ? capitalized : `${capitalized}.`;
}

// A small, static, pattern-matched suggestion library keyed off common
// Less compiler error phrasing — never a claim to have parsed the error
// programmatically, just a best-effort clarifying hint alongside the
// original (unmodified) compiler message.
function buildCompilerSuggestion(rawMessage) {
  const text = (rawMessage || '').toLowerCase();
  if (text.includes('javascript')) {
    return 'Remove the JavaScript expression; LESS variables must use plain values, not executable script.';
  }
  if (/unrecognised input|unexpected token|unrecognized input/.test(text)) {
    return 'Remove the unexpected token and verify that nested rules and the parent block have matching closing braces.';
  }
  if (text.includes('variable') && (text.includes('undefined') || text.includes('not defined'))) {
    return 'Define this variable before using it, or check for a typo in its name.';
  }
  if (text.includes('unclosed') || text.includes('missing closing') || (text.includes('missing') && text.includes('}'))) {
    return 'Add the missing closing character for this block, string, or comment.';
  }
  if (text.includes('expected') && text.includes(';')) {
    return 'Add the missing semicolon ";" to close this declaration.';
  }
  return 'Review the LESS syntax at this position — check for a missing character, unmatched brace, or invalid token.';
}

function compileErrorIssue(err) {
  const rawMessage = (err && err.message) ? String(err.message) : 'Compilation failed.';
  return {
    ruleId: 'less:compile-error',
    category: 'structure',
    severity: 'error',
    confidence: 'definite',
    message: normalizeCompilerMessage(rawMessage),
    suggestion: buildCompilerSuggestion(rawMessage),
    line: err && err.line ? err.line : 1,
    column: err && err.column ? err.column : 1,
    generatedLine: null,
    generatedColumn: null,
    codeExcerpt: '',
  };
}

// --- bounded supplemental recovery pass ---------------------------------
// The official Less compiler stops at the first fatal syntax error — it
// remains the sole conformance authority; nothing here re-implements or
// overrides its verdict. This pass is a best-effort, purely lexical/
// regex-based scan of the ORIGINAL LESS source (never executed, never
// evaluated) for a small set of statically-obvious independent problems
// that a developer would otherwise have to fix one at a time across
// repeated validate-fix-validate cycles. It never claims completeness —
// see the 'less:recovery-limited' disclaimer appended unconditionally
// below.

const SUPPLEMENTAL_MAX_SOURCE_LENGTH = 200_000; // defense-in-depth; the request body is already capped well below this server-side
const MAX_SUPPLEMENTAL_ISSUES = 20;

// At-rule / mixin-parameter keywords that legitimately start with '@' but
// are never a variable reference — excluded from the undefined-variable
// heuristic so they are never misreported.
const KNOWN_AT_KEYWORDS = new Set([
  'media', 'import', 'charset', 'supports', 'keyframes', 'font-face', 'page',
  'namespace', 'document', 'plugin', 'arguments', 'rest', 'viewport', 'counter-style',
]);

function lineAndColumnAt(source, index) {
  const upTo = source.slice(0, Math.max(0, index));
  const line = upTo.split('\n').length;
  const lastNewline = upTo.lastIndexOf('\n');
  const column = index - lastNewline;
  return { line, column: Math.max(1, column) };
}

function checkIncompleteVariableDeclarations(source) {
  const issues = [];
  const re = /@([A-Za-z_-][\w-]*)\s*:\s*[;}]/g;
  let match;
  while ((match = re.exec(source))) {
    const { line, column } = lineAndColumnAt(source, match.index);
    issues.push({
      ruleId: 'less:incomplete-variable-declaration', category: 'structure', severity: 'error',
      confidence: 'likely',
      message: `Variable "@${match[1]}" has no value.`,
      suggestion: `Provide a value for "@${match[1]}", or remove the declaration.`,
      line, column, generatedLine: null, generatedColumn: null, codeExcerpt: '',
    });
  }
  return issues;
}

function checkUndefinedVariables(source) {
  const declared = new Set();
  const declRe = /@([A-Za-z_-][\w-]*)\s*:/g;
  let declMatch;
  while ((declMatch = declRe.exec(source))) declared.add(declMatch[1]);

  // Mixin parameters (`.rounded(@radius) { ... }`) and mixin-call/guard
  // arguments (`.rounded(@r); when (@r > 0)`) are declarations/bindings
  // too, even though they never use "@name:" syntax — any "@name" inside
  // *any* parentheses counts as bound, so a mixin's own parameter is never
  // misreported as an undefined variable.
  const paramRe = /\(([^()]*)\)/g;
  let paramMatch;
  while ((paramMatch = paramRe.exec(source))) {
    const nameRe = /@([A-Za-z_-][\w-]*)/g;
    let nameMatch;
    while ((nameMatch = nameRe.exec(paramMatch[1]))) declared.add(nameMatch[1]);
  }

  const issues = [];
  const seen = new Set();
  const useRe = /@([A-Za-z_-][\w-]*)\b(?!\s*:)/g;
  let match;
  while ((match = useRe.exec(source))) {
    const name = match[1];
    if (declared.has(name) || KNOWN_AT_KEYWORDS.has(name.toLowerCase()) || seen.has(name)) continue;
    seen.add(name);
    const { line, column } = lineAndColumnAt(source, match.index);
    issues.push({
      ruleId: 'less:possibly-undefined-variable', category: 'value', severity: 'warning',
      confidence: 'possible',
      message: `"@${name}" is used but no matching "@${name}: ..." declaration was found in this source.`,
      suggestion: `Declare "@${name}" before using it, or check for a typo. It may also come from an imported file not shown here.`,
      line, column, generatedLine: null, generatedColumn: null, codeExcerpt: '',
    });
  }
  return issues;
}

function checkMixinCallPunctuation(source) {
  const issues = [];
  source.split('\n').forEach((lineText, index) => {
    const missingCloseParen = /^[ \t]*\.[\w-]+\([^()]*;[ \t]*$/.exec(lineText);
    if (missingCloseParen) {
      issues.push({
        ruleId: 'less:invalid-mixin-call-punctuation', category: 'structure', severity: 'error',
        confidence: 'likely',
        message: 'This mixin call is missing its closing ")".',
        suggestion: 'Add the missing ")" before the ";" to close the mixin call.',
        line: index + 1, column: Math.max(1, lineText.search(/\S/) + 1),
        generatedLine: null, generatedColumn: null, codeExcerpt: '',
      });
      return;
    }
    const trailingComma = /\.[\w-]+\([^()]*,\s*\)/.exec(lineText);
    if (trailingComma) {
      issues.push({
        ruleId: 'less:trailing-comma-in-mixin-call', category: 'structure', severity: 'warning',
        confidence: 'likely',
        message: 'This mixin call has a trailing comma before its closing ")".',
        suggestion: 'Remove the trailing comma from the mixin call arguments.',
        line: index + 1, column: trailingComma.index + 1,
        generatedLine: null, generatedColumn: null, codeExcerpt: '',
      });
    }
  });
  return issues;
}

function checkStrayTrailingTokens(source) {
  const issues = [];
  const strayRe = /[;}][ \t]*([~^$`])[ \t]*$/;
  source.split('\n').forEach((lineText, index) => {
    const match = strayRe.exec(lineText);
    if (match) {
      issues.push({
        ruleId: 'less:stray-trailing-token', category: 'structure', severity: 'error',
        confidence: 'possible',
        message: `Unexpected token "${match[1]}" at the end of this line.`,
        suggestion: 'Remove the unexpected token and verify that nested rules and the parent block have matching closing braces.',
        line: index + 1, column: match.index + 1,
        generatedLine: null, generatedColumn: null, codeExcerpt: '',
      });
    }
  });
  return issues;
}

function checkMissingSemicolons(source) {
  const issues = [];
  const lines = source.split('\n');
  // Only the statically unambiguous case: a plain "property: value" line
  // with no trailing ";"/"{"/","/comment, immediately followed (skipping
  // blank lines) by a line that clearly starts a fresh declaration or
  // closes the current block.
  const declarationRe = /^[ \t]*[A-Za-z-][\w-]*\s*:\s*[^;{}]+[^\s;{},]$/;
  const nextStartsFreshRe = /^[ \t]*(\}|[A-Za-z.#&:][\w-]*\s*:|[.#&:A-Za-z0-9[])/;
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!declarationRe.test(lines[index])) continue;
    let nextIndex = index + 1;
    while (nextIndex < lines.length && lines[nextIndex].trim() === '') nextIndex += 1;
    if (nextIndex >= lines.length || !nextStartsFreshRe.test(lines[nextIndex])) continue;
    issues.push({
      ruleId: 'less:missing-semicolon', category: 'structure', severity: 'error',
      confidence: 'possible',
      message: 'This declaration is missing its closing ";".',
      suggestion: 'Add a ";" at the end of this declaration.',
      line: index + 1, column: lines[index].length + 1,
      generatedLine: null, generatedColumn: null, codeExcerpt: '',
    });
  }
  return issues;
}

// Renames every supplemental finding's ruleId under the 'less:' namespace
// (checkStructuralBalance's own findings come back as 'css-structure:...')
// so every issue produced during a FAILED compilation shares one
// consistent source_engine identity ('less') once normalized Python-side —
// distinct from a successfully-compiled document's generated-CSS findings,
// which keep their own stylelint/postcss/css-custom engine identity. See
// css_less.py's docstring and ValidationIssueCard.tsx's
// isPreprocessorOwnDiagnostic check.
function underLessNamespace(issue) {
  const suffix = issue.ruleId.includes(':') ? issue.ruleId.split(':').pop() : issue.ruleId;
  return { ...issue, ruleId: `less:${suffix}` };
}

function runSupplementalRecovery(source, primaryIssue) {
  if (typeof source !== 'string' || source.length === 0 || source.length > SUPPLEMENTAL_MAX_SOURCE_LENGTH) {
    return [];
  }

  const collected = [
    ...checkStructuralBalance(source),
    ...checkIncompleteVariableDeclarations(source),
    ...checkUndefinedVariables(source),
    ...checkMixinCallPunctuation(source),
    ...checkStrayTrailingTokens(source),
    ...checkMissingSemicolons(source),
  ].map(underLessNamespace);

  // Deduplicate against the primary compiler error: the compiler already
  // told the user about whatever is on its own line — a supplemental
  // finding on that exact line would just repeat it. Distinct lines are
  // always kept, including multiple distinct supplemental findings on the
  // same line as each other.
  const withoutPrimaryLine = collected.filter((issue) => issue.line !== primaryIssue.line);

  const seenKeys = new Set();
  const unique = [];
  for (const issue of withoutPrimaryLine) {
    const key = `${issue.ruleId}:${issue.line}:${issue.column}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    unique.push(issue);
  }
  return unique.slice(0, MAX_SUPPLEMENTAL_ISSUES);
}

function recoveryLimitedNotice(primaryIssue) {
  return {
    ruleId: 'less:recovery-limited', category: 'structure', severity: 'info', confidence: 'possible',
    message: 'Compilation stopped at a blocking syntax error. Correct this issue and validate again to reveal any remaining compiler errors.',
    suggestion: '',
    line: primaryIssue.line, column: primaryIssue.column,
    generatedLine: null, generatedColumn: null, codeExcerpt: '',
  };
}

// Maps a 1-based (line, column) position in the *generated* CSS back to
// the original LESS source via the compiler's own source map. Returns
// null when no mapping exists, or when the mapped position belongs to a
// source other than the main document (see module docstring — Less
// collapses imports into a single "input" source in practice, but this
// guard is kept for defense-in-depth and parity with compile_scss.mjs).
function mapGeneratedPosition(traceMap, genLine, genColumn) {
  if (!traceMap) return null;
  const pos = originalPositionFor(traceMap, { line: genLine || 1, column: Math.max(0, (genColumn || 1) - 1) });
  if (pos.line == null) return null;
  if (traceMap.sources.length > 0 && pos.source !== traceMap.sources[0]) return null;
  return { line: pos.line, column: pos.column + 1 };
}

// Validator Worker + Subprocess Latency sprint — extracted so
// worker_server.mjs can call the same logic against an already-parsed
// request. The dynamic `import('less')` resolves from Node's own module
// cache on every call after the first in a given process.
export async function handleLessCompilationRequest(request) {
  const startedAt = process.hrtime.bigint();

  // Dynamic import (rather than a static `import less from 'less'`) lets
  // a genuinely missing npm package be caught here as a clean, controlled
  // "engine unavailable" response — a static import failure would instead
  // crash the whole process before any code ran, which node_bridge.py
  // could only ever see as an opaque non-zero exit and misreport as an
  // internal engine failure rather than what it actually is.
  let less;
  try {
    less = (await import('less')).default;
  } catch {
    return buildFailure('LESS_ENGINE_UNAVAILABLE', 'LESS compilation engine is not installed.', startedAt);
  }

  const source = typeof request.source === 'string' ? request.source : '';
  const profile = typeof request.profile === 'string' ? request.profile : '';
  if (!KNOWN_PROFILES.has(profile)) {
    return buildFailure('LESS_PROFILE_INVALID', `Unknown validation profile: ${JSON.stringify(profile)}.`, startedAt);
  }

  const rawPartials = request.partials && typeof request.partials === 'object' ? request.partials : {};
  const partialNames = Object.keys(rawPartials).slice(0, MAX_PARTIALS);
  const partials = {};
  for (const name of partialNames) {
    const content = rawPartials[name];
    if (typeof content === 'string') {
      partials[name] = content.slice(0, MAX_PARTIAL_BYTES);
    }
  }

  const maxIssues = clampMaxIssues(request.options?.maxIssues);

  let compiled;
  try {
    compiled = await less.render(source, {
      javascriptEnabled: false,
      sourceMap: {},
      plugins: [buildImportPlugin(less, partials)],
      // No `paths`, no request-supplied `plugins`, no `filename` pointing
      // at a real path — never accepted from the request.
    });
  } catch (err) {
    const primaryIssue = compileErrorIssue(err);
    const supplementalIssues = runSupplementalRecovery(source, primaryIssue);
    const allIssues = [primaryIssue, ...supplementalIssues, recoveryLimitedNotice(primaryIssue)];
    const truncated = allIssues.length > maxIssues;
    const limited = allIssues.slice(0, maxIssues);
    return {
      success: true,
      compiled: false,
      engine: ENGINE_LABEL,
      engineVersion: ENGINE_VERSION,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      css: null,
      issues: limited,
      truncated,
      truncatedCount: Math.max(0, allIssues.length - maxIssues),
    };
  }

  let pipelineResult;
  try {
    pipelineResult = await runValidationPipeline(
      compiled.css, profile, 'stylesheet', LESS_COMPILED_OUTPUT_UNFIXABLE_RULES,
    );
  } catch {
    return buildFailure('LESS_ENGINE_FAILED', 'Generated CSS validation could not be completed.', startedAt);
  }

  let traceMap = null;
  if (compiled.map) {
    try {
      traceMap = new TraceMap(JSON.parse(compiled.map));
    } catch {
      traceMap = null; // malformed/missing source map — every finding falls back to the unmapped path below
    }
  }

  const mapped = pipelineResult.issues.map((issue) => {
    const original = mapGeneratedPosition(traceMap, issue.line, issue.column);
    if (original) {
      return { ...issue, generatedLine: issue.line, generatedColumn: issue.column, line: original.line, column: original.column };
    }
    return { ...issue, generatedLine: issue.line, generatedColumn: issue.column, confidence: 'possible', unmapped: true };
  });

  const truncated = mapped.length > maxIssues;
  const limited = mapped.slice(0, maxIssues);

  return {
    success: true,
    compiled: true,
    engine: ENGINE_LABEL,
    engineVersion: ENGINE_VERSION,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    css: compiled.css,
    issues: limited,
    truncated,
    truncatedCount: Math.max(0, mapped.length - maxIssues),
  };
}

async function main() {
  const startedAt = process.hrtime.bigint();
  const raw = await readStdin();

  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    writeResult(buildFailure('LESS_REQUEST_INVALID', 'The compilation request was not valid JSON.', startedAt));
    return;
  }

  writeResult(await handleLessCompilationRequest(request));
}

function buildFailure(code, message, startedAt) {
  return {
    success: false,
    engine: ENGINE_LABEL,
    engineVersion: ENGINE_VERSION,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    compiled: false,
    css: null,
    issues: [],
    truncated: false,
    error: { code, message },
  };
}

function writeResult(result) {
  process.stdout.write(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Absolute last resort — never let a raw stack trace reach stdout.
    process.stdout.write(JSON.stringify({
      success: false,
      engine: ENGINE_LABEL,
      engineVersion: ENGINE_VERSION,
      durationMs: 0,
      compiled: false,
      css: null,
      issues: [],
      truncated: false,
      error: { code: 'LESS_ENGINE_FAILED', message: 'LESS compilation could not be completed.' },
    }));
  });
}
