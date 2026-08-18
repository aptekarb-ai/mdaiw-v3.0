// Controlled CSS validation script — invoked only by
// backend/landingpages/validation/node_bridge.py via a fixed, absolute
// script path. Thin CLI wrapper around css_engine.mjs's shared pipeline
// (Sprint CSS-C extracted the pipeline itself so compile_scss.mjs can run
// the exact same validation against SCSS/Sass's generated CSS). Reads
// exactly one JSON object from stdin, writes exactly one JSON document to
// stdout. Never executes or evaluates the submitted CSS, never makes a
// network request.

import { pathToFileURL } from 'node:url';

import { ENGINE_LABEL, ENGINE_VERSION, KNOWN_CONTEXTS, runValidationPipeline } from './css_engine.mjs';

const KNOWN_PROFILES = new Set(['standard', 'strict', 'legacy', 'experimental']);
const DEFAULT_MAX_ISSUES = 500;
const HARD_MAX_ISSUES = 1000; // never trust a request-supplied value past this, regardless of source
const MAX_STDIN_BYTES = 5_000_000; // defense-in-depth; the real cap is enforced Python-side before this process even starts

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

// Validator Worker + Subprocess Latency sprint — the actual request
// handling, extracted from the CLI's stdin/stdout framing so a
// persistent worker (worker_server.mjs) can call the exact same logic
// against an ALREADY-PARSED request object, with the expensive imports
// above (css_engine.mjs -> stylelint/postcss) loaded once at process
// startup rather than once per request. `main()` below is now a thin
// CLI-only wrapper around this; behavior is unchanged for the existing
// one-shot subprocess path.
export async function handleCssValidationRequest(request) {
  const startedAt = process.hrtime.bigint();
  const css = typeof request.css === 'string' ? request.css : '';
  const profile = typeof request.profile === 'string' ? request.profile : '';
  if (!KNOWN_PROFILES.has(profile)) {
    return buildFailure('CSS_PROFILE_INVALID', `Unknown validation profile: ${JSON.stringify(profile)}.`, startedAt);
  }
  const requestedContext = typeof request.context === 'string' ? request.context : 'stylesheet';
  const context = KNOWN_CONTEXTS.has(requestedContext) ? requestedContext : 'stylesheet';
  const maxIssues = clampMaxIssues(request.options?.maxIssues);

  let issues, parseFailed;
  try {
    ({ issues, parseFailed } = await runValidationPipeline(css, profile, context));
  } catch {
    return buildFailure('CSS_ENGINE_FAILED', 'CSS validation could not be completed.', startedAt);
  }

  const truncated = issues.length > maxIssues;
  const limited = issues.slice(0, maxIssues);

  return {
    success: true,
    engine: ENGINE_LABEL,
    engineVersion: ENGINE_VERSION,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    issues: limited,
    truncated,
    truncatedCount: Math.max(0, issues.length - maxIssues),
    parseFailed,
  };
}

async function main() {
  const startedAt = process.hrtime.bigint();
  const raw = await readStdin();

  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    writeResult(buildFailure('CSS_REQUEST_INVALID', 'The validation request was not valid JSON.', startedAt));
    return;
  }

  writeResult(await handleCssValidationRequest(request));
}

function buildFailure(code, message, startedAt) {
  return {
    success: false,
    engine: ENGINE_LABEL,
    engineVersion: ENGINE_VERSION,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    issues: [],
    truncated: false,
    error: { code, message },
  };
}

function writeResult(result) {
  process.stdout.write(JSON.stringify(result));
}

// Validator Worker sprint — run the CLI entrypoint only when this file is
// executed directly (`node validate_css.mjs`), never when worker_server.mjs
// imports `handleCssValidationRequest` from it; otherwise every worker
// startup would ALSO spawn a stray stdin-reading `main()` per imported
// script.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Absolute last resort — never let a raw stack trace reach stdout.
    process.stdout.write(JSON.stringify({
      success: false,
      engine: ENGINE_LABEL,
      engineVersion: ENGINE_VERSION,
      durationMs: 0,
      issues: [],
      truncated: false,
      error: { code: 'CSS_ENGINE_FAILED', message: 'CSS validation could not be completed.' },
    }));
  });
}
