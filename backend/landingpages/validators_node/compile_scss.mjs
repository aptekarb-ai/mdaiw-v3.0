// Controlled SCSS/indented-Sass compiler — invoked only by
// backend/landingpages/validation/node_bridge.py via a fixed, absolute
// script path. Reads exactly one JSON object from stdin, writes exactly
// one JSON document to stdout.
//
// Security contract (Sprint CSS-C):
//   - Uses sass.compileString() only — never compile()/compileAsync(),
//     which take a real filesystem path. compileString()'s entrypoint is
//     a virtual `data:` URL with no filesystem anchor, so Dart Sass's
//     default relative-import resolution is structurally incapable of
//     touching disk (verified empirically: an @import with no matching
//     custom importer fails cleanly with "Can't find stylesheet to
//     import", never a filesystem read).
//   - `loadPaths` is never passed — the only other way Dart Sass could
//     resolve a filesystem-relative import.
//   - The only import mechanism is `buildImporter()` below, a pure
//     in-memory dictionary lookup against `partials` — content Python
//     already read from the ownership-scoped storage provider before
//     this process ever started. This script never receives a
//     filesystem path for a partial, only its content.
//   - `canonicalize()` rejects any URL with a scheme (http:, file:,
//     pkg:, etc.), any absolute path, and any ".." segment outright —
//     Dart Sass then reports a clean compile error, never a crash.
//   - No custom Sass functions are ever registered — `functions` is
//     never populated from request input.
//   - Never executes or evaluates the compiled CSS.

import { pathToFileURL } from 'node:url';

import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { checkStructuralBalance, ENGINE_VERSION as CSS_ENGINE_VERSION, runValidationPipeline } from './css_engine.mjs';

const SASS_VERSION = '1.102.0';
const ENGINE_LABEL = 'dart-sass';
const ENGINE_VERSION = `sass@${SASS_VERSION};${CSS_ENGINE_VERSION}`;

const KNOWN_PROFILES = new Set(['standard', 'strict', 'legacy', 'experimental']);
const KNOWN_SYNTAXES = new Set(['scss', 'indented']);
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

// Only a bare relative module reference (no scheme, no absolute path, no
// ".." segment) may ever resolve — and only when it exactly names an
// entry in `partials`, which Python populated entirely from the current
// user's own already-ownership-filtered project assets. Everything else
// returns null, which Dart Sass reports as a normal "can't find
// stylesheet" compile error — never a crash, never a filesystem read.
function buildImporter(partials) {
  return {
    canonicalize(url) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null; // any scheme, including file:/http:/pkg: (sass: builtins are resolved by Dart Sass itself, before reaching custom importers)
      if (url.startsWith('/') || url.split('/').includes('..')) return null;
      const bare = url.replace(/^_/, '').replace(/\.(scss|sass)$/i, '');
      if (!Object.prototype.hasOwnProperty.call(partials, bare)) return null;
      return new URL(`mdaiw-partial:${encodeURIComponent(bare)}`);
    },
    load(canonicalUrl) {
      const bare = decodeURIComponent(canonicalUrl.href.replace('mdaiw-partial:', ''));
      return { contents: partials[bare] ?? '', syntax: 'scss' };
    },
  };
}

// Light, purely cosmetic normalization (capitalization + trailing period)
// — the original Dart Sass message text is fully preserved, never
// replaced or truncated.
function normalizeCompilerMessage(rawMessage) {
  const text = (rawMessage || '').trim();
  if (!text) return 'Compilation failed.';
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  return capitalized.endsWith('.') ? capitalized : `${capitalized}.`;
}

// A small, static, pattern-matched suggestion library keyed off common
// Dart Sass error phrasing — never a claim to have parsed the error
// programmatically, just a best-effort clarifying hint alongside the
// original (unmodified) compiler message.
function buildCompilerSuggestion(rawMessage) {
  const text = (rawMessage || '').toLowerCase();
  if (text.includes('undefined variable')) {
    return 'Define this variable before using it, or check for a typo in its name.';
  }
  if (text.includes('expected') && text.includes('expression')) {
    return 'Complete the expression — check for a missing value, operand, or operator.';
  }
  if (text.includes('indentation')) {
    return 'Check the indentation of this line against its parent selector or declaration.';
  }
  if (text.includes('unterminated') || text.includes('expected "') || text.includes("expected '")) {
    return 'Add the missing closing character for this block, string, or comment.';
  }
  if (text.includes('expected') && text.includes(';')) {
    return 'Add the missing semicolon ";" to close this declaration.';
  }
  return 'Review the syntax at this position — check for a missing character, unmatched brace, or invalid token.';
}

function compileErrorIssue(err, syntax) {
  const label = syntax === 'indented' ? 'sass' : 'scss';
  const start = err.span?.start;
  // Dart Sass's span line/column are 0-based; this codebase's convention
  // (and every other adapter's output) is 1-based.
  const line = start ? start.line + 1 : 1;
  const column = start ? start.column + 1 : 1;
  const rawMessage = err.sassMessage || (err.message ? err.message.split('\n')[0] : 'Compilation failed.');
  return {
    ruleId: `${label}:compile-error`,
    category: 'structure',
    severity: 'error',
    confidence: 'definite',
    message: normalizeCompilerMessage(rawMessage),
    suggestion: buildCompilerSuggestion(rawMessage),
    line,
    column,
    generatedLine: null,
    generatedColumn: null,
    codeExcerpt: '',
  };
}

// --- bounded supplemental recovery pass ---------------------------------
// Dart Sass, like Less, stops at the first fatal syntax error and remains
// the sole conformance authority — this is a best-effort, purely lexical
// scan of the ORIGINAL source (never executed, never evaluated) for
// obviously unbalanced braces/unterminated strings/comments elsewhere in
// the document, reusing the exact same lexical scanner already proven for
// LESS (see compile_less.mjs). It never claims completeness — see the
// disclaimer appended unconditionally below.

const SUPPLEMENTAL_MAX_SOURCE_LENGTH = 200_000; // defense-in-depth; the request body is already capped well below this server-side
const MAX_SUPPLEMENTAL_ISSUES = 20;

function underCompilerNamespace(issue, label) {
  const suffix = issue.ruleId.includes(':') ? issue.ruleId.split(':').pop() : issue.ruleId;
  return { ...issue, ruleId: `${label}:${suffix}` };
}

function runSupplementalRecovery(source, primaryIssue, label) {
  if (typeof source !== 'string' || source.length === 0 || source.length > SUPPLEMENTAL_MAX_SOURCE_LENGTH) {
    return [];
  }
  const collected = checkStructuralBalance(source).map((issue) => underCompilerNamespace(issue, label));
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

function recoveryLimitedNotice(primaryIssue, label) {
  return {
    ruleId: `${label}:recovery-limited`, category: 'structure', severity: 'info', confidence: 'possible',
    message: 'Compilation stopped at a blocking syntax error. Correct this issue and validate again to reveal any remaining compiler errors.',
    suggestion: '',
    line: primaryIssue.line, column: primaryIssue.column,
    generatedLine: null, generatedColumn: null, codeExcerpt: '',
  };
}

// Maps a 1-based (line, column) position in the *generated* CSS back to
// the original SCSS/Sass source via the compiler's own source map.
// Returns null when no mapping exists, OR when the mapped position
// belongs to an *imported partial* rather than the main document
// (traceMap.sources[0] is always the entrypoint — anything else is a
// `@use`/`@import`ed file with no corresponding open editor in this UI).
// The spec is explicit: never claim an exact original location when one
// isn't meaningfully available — a partial's own line number, presented
// as if it were a line in the document the developer is editing, would
// be actively misleading rather than merely imprecise.
function mapGeneratedPosition(traceMap, genLine, genColumn) {
  if (!traceMap) return null;
  const pos = originalPositionFor(traceMap, { line: genLine || 1, column: Math.max(0, (genColumn || 1) - 1) });
  if (pos.line == null) return null;
  if (traceMap.sources.length > 0 && pos.source !== traceMap.sources[0]) return null;
  return { line: pos.line, column: pos.column + 1 };
}

// Validator Worker + Subprocess Latency sprint — extracted so
// worker_server.mjs can call the same logic against an already-parsed
// request. The dynamic `import('sass')` below is resolved from Node's
// own module cache on every call after the first in a given process —
// free in the persistent worker, identical cost to today in the
// one-shot CLI path.
export async function handleScssCompilationRequest(request) {
  const startedAt = process.hrtime.bigint();

  // A dynamic import (rather than the static `import * as sass from
  // 'sass'` this replaces) lets a genuinely missing npm package be
  // caught here as a clean, controlled "engine unavailable" response —
  // a static import failure would instead crash the whole process
  // before any code ran, which node_bridge.py could only ever see as an
  // opaque non-zero exit and misreport as an internal engine failure
  // rather than what it actually is.
  let sass;
  try {
    sass = await import('sass');
  } catch {
    return buildFailure('SCSS_ENGINE_UNAVAILABLE', 'SCSS/Sass compilation engine is not installed.', startedAt);
  }

  const source = typeof request.source === 'string' ? request.source : '';
  const profile = typeof request.profile === 'string' ? request.profile : '';
  const syntax = KNOWN_SYNTAXES.has(request.syntax) ? request.syntax : 'scss';
  if (!KNOWN_PROFILES.has(profile)) {
    return buildFailure('SCSS_PROFILE_INVALID', `Unknown validation profile: ${JSON.stringify(profile)}.`, startedAt);
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
    compiled = sass.compileString(source, {
      syntax,
      style: 'expanded',
      sourceMap: true,
      sourceMapIncludeSources: false,
      importers: [buildImporter(partials)],
      quietDeps: true,
      // No `functions`, no `loadPaths` — never accepted from the request
      // (see module docstring).
    });
  } catch (err) {
    // Duck-typed rather than an instanceof/constructor-name check — Dart
    // Sass's compile exceptions are the only errors from this call that
    // carry a `.span`; a genuine engine failure (missing native binary,
    // out-of-memory, etc.) never has one and must not be misreported as
    // a normal compile error.
    if (err && err.span) {
      const label = syntax === 'indented' ? 'sass' : 'scss';
      const primaryIssue = compileErrorIssue(err, syntax);
      const supplementalIssues = runSupplementalRecovery(source, primaryIssue, label);
      const allIssues = [primaryIssue, ...supplementalIssues, recoveryLimitedNotice(primaryIssue, label)];
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
    return buildFailure('SCSS_ENGINE_FAILED', 'SCSS/Sass compilation could not be completed.', startedAt);
  }

  let pipelineResult;
  try {
    pipelineResult = await runValidationPipeline(compiled.css, profile, 'stylesheet');
  } catch {
    return buildFailure('SCSS_ENGINE_FAILED', 'Generated CSS validation could not be completed.', startedAt);
  }

  const traceMap = compiled.sourceMap ? new TraceMap(compiled.sourceMap) : null;
  const mapped = pipelineResult.issues.map((issue) => {
    const original = mapGeneratedPosition(traceMap, issue.line, issue.column);
    if (original) {
      return {
        ...issue,
        generatedLine: issue.line,
        generatedColumn: issue.column,
        line: original.line,
        column: original.column,
      };
    }
    return {
      ...issue,
      generatedLine: issue.line,
      generatedColumn: issue.column,
      confidence: 'possible',
      unmapped: true,
    };
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
    writeResult(buildFailure('SCSS_REQUEST_INVALID', 'The compilation request was not valid JSON.', startedAt));
    return;
  }

  writeResult(await handleScssCompilationRequest(request));
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
      error: { code: 'SCSS_ENGINE_FAILED', message: 'SCSS/Sass compilation could not be completed.' },
    }));
  });
}
