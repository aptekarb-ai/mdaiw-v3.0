// Controlled deterministic formatting script — invoked only by
// backend/landingpages/validation/node_bridge.py via a fixed, absolute
// script path. Thin CLI wrapper around js-beautify (html-beautify,
// css-beautify, js-beautify): whitespace/indentation/brace normalization
// only — never reorders declarations, never rewrites logic, never
// executes or evaluates the submitted source. Reads exactly one JSON
// object from stdin, writes exactly one JSON document to stdout.

import jsBeautifyPkg from 'js-beautify';

const { html: htmlBeautify, css: cssBeautify, js: jsBeautify } = jsBeautifyPkg;

const KNOWN_LANGUAGES = new Set(['html', 'css', 'scss', 'less', 'javascript']);
const MAX_STDIN_BYTES = 5_000_000;
const ENGINE_LABEL = 'mdaiw-format-engine';
const ENGINE_VERSION = 1;

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

// Purely whitespace/indentation-level normalization — no plugin,
// no AST-rewriting, no declaration/attribute reordering, matching the
// project spec's "preserve behavior, do not reorder" requirement.
const BEAUTIFY_OPTIONS = {
  indent_size: 2,
  indent_char: ' ',
  preserve_newlines: true,
  max_preserve_newlines: 2,
  wrap_line_length: 0,
  end_with_newline: true,
};

function formatSource(language, source) {
  switch (language) {
    case 'html':
      return htmlBeautify(source, { ...BEAUTIFY_OPTIONS, indent_inner_html: false, extra_liners: [] });
    case 'css':
    case 'scss':
    case 'less':
      return cssBeautify(source, BEAUTIFY_OPTIONS);
    case 'javascript':
      return jsBeautify(source, { ...BEAUTIFY_OPTIONS, brace_style: 'collapse' });
    default:
      throw new Error('unreachable');
  }
}

async function main() {
  const startedAt = process.hrtime.bigint();
  const raw = await readStdin();

  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    writeResult(buildFailure('FORMAT_REQUEST_INVALID', 'The formatting request was not valid JSON.', startedAt));
    return;
  }

  const language = typeof request.language === 'string' ? request.language : '';
  const source = typeof request.source === 'string' ? request.source : '';
  if (!KNOWN_LANGUAGES.has(language)) {
    writeResult(buildFailure('FORMAT_LANGUAGE_INVALID', `Unknown formatting language: ${JSON.stringify(language)}.`, startedAt));
    return;
  }

  let formatted;
  try {
    formatted = formatSource(language, source);
  } catch {
    writeResult(buildFailure('FORMAT_ENGINE_FAILED', 'Formatting could not be completed.', startedAt));
    return;
  }

  writeResult({
    success: true,
    engine: ENGINE_LABEL,
    engineVersion: ENGINE_VERSION,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    formatted,
  });
}

function buildFailure(code, message, startedAt) {
  return {
    success: false,
    engine: ENGINE_LABEL,
    engineVersion: ENGINE_VERSION,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    formatted: null,
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
    formatted: null,
    error: { code: 'FORMAT_ENGINE_FAILED', message: 'Formatting could not be completed.' },
  }));
});
