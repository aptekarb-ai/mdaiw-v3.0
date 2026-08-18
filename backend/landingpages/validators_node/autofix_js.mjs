// Controlled JavaScript autofix script — invoked only by
// backend/landingpages/validation/node_bridge.py via a fixed, absolute
// script path. Thin CLI wrapper around js_engine.mjs's runEslintAutofix —
// rule-aware autofix using the EXACT SAME ESLint config this project's
// own JS validation already uses. Reads exactly one JSON object from
// stdin, writes exactly one JSON document to stdout. Never executes or
// evaluates the submitted JavaScript, never makes a network request.

import { ENGINE_LABEL, ENGINE_VERSION, runEslintAutofix } from './js_engine.mjs';

const KNOWN_PROFILES = new Set(['standard', 'strict', 'legacy', 'experimental']);
const KNOWN_SOURCE_TYPES = new Set(['auto', 'script', 'module']);
const MAX_STDIN_BYTES = 5_000_000;

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

async function main() {
  const startedAt = process.hrtime.bigint();
  const raw = await readStdin();

  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    writeResult(buildFailure('JS_AUTOFIX_REQUEST_INVALID', 'The autofix request was not valid JSON.', startedAt));
    return;
  }

  const js = typeof request.js === 'string' ? request.js : '';
  const profile = KNOWN_PROFILES.has(request.profile) ? request.profile : 'standard';
  const sourceType = KNOWN_SOURCE_TYPES.has(request.sourceType) ? request.sourceType : 'auto';

  let fixed;
  try {
    fixed = runEslintAutofix(js, profile, { sourceType: sourceType === 'auto' ? undefined : sourceType });
  } catch {
    writeResult(buildFailure('JS_AUTOFIX_ENGINE_FAILED', 'JavaScript autofix could not be completed.', startedAt));
    return;
  }

  writeResult({
    success: true,
    engine: ENGINE_LABEL,
    engineVersion: ENGINE_VERSION,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    fixed,
  });
}

function buildFailure(code, message, startedAt) {
  return {
    success: false,
    engine: ENGINE_LABEL,
    engineVersion: ENGINE_VERSION,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    fixed: null,
    error: { code, message },
  };
}

function writeResult(result) {
  process.stdout.write(JSON.stringify(result));
}

main().catch(() => {
  process.stdout.write(JSON.stringify({
    success: false,
    engine: ENGINE_LABEL,
    engineVersion: ENGINE_VERSION,
    durationMs: 0,
    fixed: null,
    error: { code: 'JS_AUTOFIX_ENGINE_FAILED', message: 'JavaScript autofix could not be completed.' },
  }));
});
