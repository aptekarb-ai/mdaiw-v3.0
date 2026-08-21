// Controlled LESS/SCSS autofix script — invoked only by
// backend/landingpages/validation/node_bridge.py via a fixed, absolute
// script path. Thin CLI wrapper around css_engine.mjs's
// runStylelintAutofixForSource, editing the ORIGINAL preprocessor source
// directly (via postcss-less/postcss-scss custom syntax) rather than the
// compiled CSS — see css_engine.mjs's own comment for why. Indented Sass
// is deliberately not supported here (see the same comment). Reads
// exactly one JSON object from stdin, writes exactly one JSON document
// to stdout. Never executes or evaluates the submitted source, never
// makes a network request.

import { ENGINE_LABEL, ENGINE_VERSION, KNOWN_CONTEXTS, runStylelintAutofixForSource } from './css_engine.mjs';

const KNOWN_LANGUAGES = new Set(['less', 'scss']);
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
    writeResult(buildFailure('PREPROCESSOR_AUTOFIX_REQUEST_INVALID', 'The autofix request was not valid JSON.', startedAt));
    return;
  }

  const source = typeof request.source === 'string' ? request.source : '';
  const language = KNOWN_LANGUAGES.has(request.language) ? request.language : null;
  const requestedContext = typeof request.context === 'string' ? request.context : 'stylesheet';
  const context = KNOWN_CONTEXTS.has(requestedContext) ? requestedContext : 'stylesheet';

  if (!language) {
    writeResult(buildFailure('PREPROCESSOR_AUTOFIX_UNSUPPORTED_LANGUAGE', 'Only LESS and SCSS support source-level autofix.', startedAt));
    return;
  }

  let fixed;
  try {
    fixed = await runStylelintAutofixForSource(source, context, language);
  } catch {
    writeResult(buildFailure('PREPROCESSOR_AUTOFIX_ENGINE_FAILED', 'Preprocessor autofix could not be completed.', startedAt));
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
    error: { code: 'PREPROCESSOR_AUTOFIX_ENGINE_FAILED', message: 'Preprocessor autofix could not be completed.' },
  }));
});
