// Controlled CSS autofix script — invoked only by
// backend/landingpages/validation/node_bridge.py via a fixed, absolute
// script path. Thin CLI wrapper around css_engine.mjs's
// runStylelintAutofix — rule-aware autofix using the EXACT SAME
// stylelint config this project's own CSS validation already uses.
// Reads exactly one JSON object from stdin, writes exactly one JSON
// document to stdout. Never executes or evaluates the submitted CSS,
// never makes a network request.

import { ENGINE_LABEL, ENGINE_VERSION, KNOWN_CONTEXTS, runStylelintAutofix } from './css_engine.mjs';

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
    writeResult(buildFailure('CSS_AUTOFIX_REQUEST_INVALID', 'The autofix request was not valid JSON.', startedAt));
    return;
  }

  const css = typeof request.css === 'string' ? request.css : '';
  const requestedContext = typeof request.context === 'string' ? request.context : 'stylesheet';
  const context = KNOWN_CONTEXTS.has(requestedContext) ? requestedContext : 'stylesheet';

  let fixed;
  try {
    fixed = await runStylelintAutofix(css, context);
  } catch {
    writeResult(buildFailure('CSS_AUTOFIX_ENGINE_FAILED', 'CSS autofix could not be completed.', startedAt));
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
    error: { code: 'CSS_AUTOFIX_ENGINE_FAILED', message: 'CSS autofix could not be completed.' },
  }));
});
