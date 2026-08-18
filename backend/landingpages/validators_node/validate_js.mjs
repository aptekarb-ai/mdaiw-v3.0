// Controlled JavaScript validation script — invoked only by
// backend/landingpages/validation/node_bridge.py via a fixed, absolute
// script path. Thin CLI wrapper around js_engine.mjs's shared ESLint-backed
// pipeline. Reads exactly one JSON object from stdin, writes exactly one
// JSON document to stdout. Never executes or evaluates the submitted
// JavaScript (only parses and statically walks its AST via ESLint's
// bundled parser), never makes a network request, never reads a config
// file or a request-supplied plugin/parser path.

import { pathToFileURL } from 'node:url';

import { ENGINE_LABEL, ENGINE_VERSION, runValidationPipeline } from './js_engine.mjs';

const KNOWN_PROFILES = new Set(['standard', 'strict', 'legacy', 'experimental']);
const KNOWN_SOURCE_TYPES = new Set(['auto', 'script', 'module']);
const DEFAULT_MAX_ISSUES = 500;
const HARD_MAX_ISSUES = 1000; // never trust a request-supplied value past this, regardless of source
const MAX_STDIN_BYTES = 5_000_000; // defense-in-depth; the real cap is enforced Python-side before this process even starts
const MAX_KNOWN_IDS = 5000;

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

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return null;
  return value.filter((item) => typeof item === 'string').slice(0, MAX_KNOWN_IDS);
}

// Validator Worker + Subprocess Latency sprint — extracted so
// worker_server.mjs can call the same logic against an already-parsed
// request, with ESLint/js_engine.mjs's imports loaded once at worker
// startup instead of once per request.
export async function handleJsValidationRequest(request) {
  const startedAt = process.hrtime.bigint();
  const code = typeof request.js === 'string' ? request.js : '';
  const profile = typeof request.profile === 'string' ? request.profile : '';
  if (!KNOWN_PROFILES.has(profile)) {
    return buildFailure('JS_PROFILE_INVALID', `Unknown validation profile: ${JSON.stringify(profile)}.`, startedAt);
  }
  const requestedSourceType = typeof request.sourceType === 'string' ? request.sourceType : 'auto';
  const sourceType = KNOWN_SOURCE_TYPES.has(requestedSourceType) ? requestedSourceType : 'auto';
  const knownElementIds = sanitizeStringArray(request.knownElementIds);
  const duplicateIds = sanitizeStringArray(request.duplicateIds);
  const maxIssues = clampMaxIssues(request.options?.maxIssues);

  let issues, parseFailed, resolvedSourceType;
  try {
    ({ issues, parseFailed, sourceType: resolvedSourceType } = await runValidationPipeline(code, profile, {
      sourceType, knownElementIds, duplicateIds,
    }));
  } catch {
    return buildFailure('JS_ENGINE_FAILED', 'JavaScript validation could not be completed.', startedAt);
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
    sourceType: resolvedSourceType,
  };
}

async function main() {
  const startedAt = process.hrtime.bigint();
  const raw = await readStdin();

  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    writeResult(buildFailure('JS_REQUEST_INVALID', 'The validation request was not valid JSON.', startedAt));
    return;
  }

  writeResult(await handleJsValidationRequest(request));
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
      error: { code: 'JS_ENGINE_FAILED', message: 'JavaScript validation could not be completed.' },
    }));
  });
}
