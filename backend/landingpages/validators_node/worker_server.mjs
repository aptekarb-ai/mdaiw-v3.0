// Validator Worker + Subprocess Latency sprint — a long-lived Node
// process that keeps ESLint/Stylelint/PostCSS/Dart-Sass/Less loaded in
// memory across many validation requests, instead of re-importing them
// (the dominant cost — see the profiling in this sprint's final report)
// on every single call. Spawned and owned by
// backend/landingpages/validation/node_worker_pool.py; never invoked
// directly by anything else, and never receives anything from a request
// body that Python hasn't already validated the shape of.
//
// SECURITY CONTRACT (spec section 3/22):
//   - This process NEVER executes, evaluates, or requires submitted
//     source. Every operation below is a thin pass-through to the SAME
//     handleXRequest() functions the existing one-shot CLI scripts already
//     use (validate_css.mjs, validate_js.mjs, compile_scss.mjs,
//     compile_less.mjs) — imported here, not reimplemented, so this
//     worker can never drift from those scripts' own security posture
//     (no eval, no vm, no filesystem-path compilation, no network access
//     — see each module's own docstring for its specific guarantees).
//   - The wire protocol is newline-delimited JSON on stdin/stdout only —
//     no HTTP listener, no TCP/network socket, nothing reachable from
//     outside this OS process's own parent (which starts it with a fixed
//     argv and a minimal explicit environment, exactly like every other
//     subprocess in this project — see node_bridge.py/java_bridge.py).
//   - Every request is wrapped in its own try/catch; a single malformed
//     or oversized request can never crash the worker or leak into the
//     next request's response.
//   - No per-request state persists — every operation receives its own
//     complete, self-contained request object and returns a fresh
//     result; nothing here caches source, an intermediate AST, or a
//     result keyed on customer content (that caching already exists,
//     source-hash-keyed, on the PYTHON side — see bridge_cache.py — so
//     it survives a worker restart and isn't duplicated/drifted here).

import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

import { handleCssValidationRequest } from './validate_css.mjs';
import { handleJsValidationRequest } from './validate_js.mjs';
import { handleScssCompilationRequest } from './compile_scss.mjs';
import { handleLessCompilationRequest } from './compile_less.mjs';

const MAX_LINE_BYTES = 5_000_000; // mirrors each script's own MAX_STDIN_BYTES

const OPERATIONS = {
  'css-validate': handleCssValidationRequest,
  'js-validate': handleJsValidationRequest,
  'scss-compile': handleScssCompilationRequest,
  'less-compile': handleLessCompilationRequest,
};

function writeLine(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleLine(line) {
  let envelope;
  try {
    envelope = JSON.parse(line);
  } catch {
    // No request_id available — nothing safe to correlate this to; the
    // Python side treats an unparseable line as a protocol-corruption
    // event and restarts this worker (spec section 5).
    writeLine({ request_id: null, ok: false, error: { code: 'PROTOCOL_INVALID', message: 'Request line was not valid JSON.' } });
    return;
  }

  const requestId = typeof envelope.request_id === 'string' ? envelope.request_id : null;
  const operation = typeof envelope.operation === 'string' ? envelope.operation : '';

  if (operation === 'ping') {
    writeLine({ request_id: requestId, ok: true, result: { pong: true, pid: process.pid } });
    return;
  }

  const handler = OPERATIONS[operation];
  if (!handler) {
    writeLine({ request_id: requestId, ok: false, error: { code: 'OPERATION_UNKNOWN', message: `Unknown operation: ${JSON.stringify(operation)}.` } });
    return;
  }

  const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  try {
    const result = await handler(payload);
    writeLine({ request_id: requestId, ok: true, result });
  } catch {
    // A handler function is already internally try/catch'd for every
    // engine-level failure it knows about (see each handleXRequest's own
    // buildFailure() branches) — reaching HERE means something entirely
    // unanticipated happened. Never let it crash the worker or leak a
    // stack trace; report it as a clean per-request failure and keep
    // serving the next request.
    writeLine({ request_id: requestId, ok: false, error: { code: 'HANDLER_FAILED', message: 'This request could not be completed.' } });
  }
}

function main() {
  const rl = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
  // A strict promise chain, not a bare `void handleLine(line)` per event —
  // if two request lines arrive back-to-back (buffered together in one
  // TCP/pipe read), an unchained async call would let the SECOND request's
  // handler start before the first one's `await` chain finished, running
  // two validations genuinely concurrently inside one process. See
  // node_worker_pool.py's docstring for why that's specifically avoided:
  // ESLint/Stylelint are not documented as safe for overlapping calls
  // sharing their global module-level caches, and this project does not
  // guess about that — every line is fully processed, in arrival order,
  // before the next one's handler starts.
  let queue = Promise.resolve();
  rl.on('line', (line) => {
    if (Buffer.byteLength(line, 'utf-8') > MAX_LINE_BYTES) {
      writeLine({ request_id: null, ok: false, error: { code: 'REQUEST_TOO_LARGE', message: 'Request exceeded the maximum size.' } });
      return;
    }
    queue = queue.then(() => handleLine(line)).catch(() => {});
  });
  rl.on('close', () => {
    process.exit(0);
  });
  // Ready signal — the Python pool manager's startup handshake waits for
  // exactly one line on stdout before considering this worker healthy;
  // this also doubles as proof the (potentially slow) validator imports
  // above have already finished, not merely that the process spawned.
  writeLine({ request_id: null, ok: true, result: { ready: true, pid: process.pid } });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
