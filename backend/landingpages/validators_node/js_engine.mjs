// Shared JavaScript validation pipeline. Uses ESLint's low-level `Linter`
// class — deliberately NOT the `ESLint` class — because `Linter.verify()`
// takes its rule/config object entirely in-memory and never touches disk:
// no `.eslintrc`/`eslint.config.js` discovery, no resolving plugins or
// parsers from node_modules paths, no loading anything from the submitted
// source. Every rule this pipeline runs is either an ESLint core rule
// (`@eslint/js` recommended set, plus a few explicitly enabled core rules)
// or one of the project-owned custom rules defined below and registered
// directly as an in-memory plugin object — never a request-supplied path,
// package name, or callback. Submitted JavaScript is only ever parsed
// (via ESLint's bundled Espree parser) and walked as an AST; it is never
// executed, never passed to eval/Function/vm, and this module makes no
// network request.

import { Linter } from 'eslint';
import js from '@eslint/js';

const ESLINT_VERSION = '10.8.0';
const ESLINT_JS_VERSION = '10.0.1';
export const ENGINE_LABEL = 'eslint';
export const ENGINE_VERSION = `eslint@${ESLINT_VERSION};@eslint/js@${ESLINT_JS_VERSION}`;

export function excerptFor(sourceLines, line) {
  if (!line || line < 1 || line > sourceLines.length) return '';
  return sourceLines[line - 1].trim().slice(0, 200);
}

// A small, project-owned, read-only browser global list — never resolves
// against any external "globals" package or file. Deliberately excludes
// Node-only identifiers (require/module/exports/process/__dirname) so
// their use in submitted browser JavaScript is correctly flagged by
// no-undef rather than silently accepted.
const BROWSER_GLOBAL_NAMES = [
  'window', 'document', 'navigator', 'location', 'history', 'console',
  'fetch', 'Headers', 'Request', 'Response', 'AbortController', 'AbortSignal',
  'XMLHttpRequest', 'WebSocket', 'EventSource',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
  'localStorage', 'sessionStorage', 'indexedDB',
  'alert', 'confirm', 'prompt', 'atob', 'btoa',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent',
  'InputEvent', 'PointerEvent', 'TouchEvent', 'WheelEvent', 'DragEvent',
  'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement',
  'HTMLDocument', 'Document', 'DocumentFragment', 'ShadowRoot', 'CustomElementRegistry',
  'FormData', 'URL', 'URLSearchParams',
  'Promise', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect',
  'JSON', 'Math', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Date',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'EvalError',
  'ReferenceError', 'URIError', 'BigInt', 'globalThis', 'self', 'top', 'parent',
  'frames', 'performance', 'crypto', 'Blob', 'File', 'FileReader', 'FileList',
  'Image', 'Audio', 'Worker', 'ServiceWorker', 'SharedWorker', 'MessageChannel',
  'MessagePort', 'BroadcastChannel', 'IntersectionObserver', 'MutationObserver',
  'ResizeObserver', 'PerformanceObserver', 'CSS', 'CSSStyleSheet', 'getComputedStyle',
  'matchMedia', 'structuredClone', 'DOMParser', 'XMLSerializer', 'TextEncoder',
  'TextDecoder', 'Notification', 'geolocation', 'navigator',
];
const BROWSER_GLOBALS = Object.fromEntries(BROWSER_GLOBAL_NAMES.map((name) => [name, 'readonly']));

// --- shared AST helpers -----------------------------------------------------

function calleePropertyName(node) {
  if (!node || node.type !== 'MemberExpression') return null;
  if (node.computed) {
    return node.property.type === 'Literal' && typeof node.property.value === 'string'
      ? node.property.value
      : null;
  }
  return node.property.name || null;
}

function calleeObjectName(node) {
  if (!node || node.type !== 'MemberExpression') return null;
  return node.object.type === 'Identifier' ? node.object.name : null;
}

function isStringLiteral(node) {
  return Boolean(node) && node.type === 'Literal' && typeof node.value === 'string';
}

function containsLocationHashOrSearch(node) {
  // Best-effort textual/AST scan for `location.hash` / `location.search`
  // appearing anywhere inside `node` — a shallow, deliberately non-exhaustive
  // taint check (see module docstring in html_embedded_javascript.py — this
  // project never claims complete taint analysis).
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'MemberExpression') {
    const objectName = calleeObjectName(node);
    const propertyName = calleePropertyName(node);
    if (objectName === 'location' && (propertyName === 'hash' || propertyName === 'search')) return true;
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue; // avoid walking back up the tree / infinite loop
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === 'string' && containsLocationHashOrSearch(item)) return true;
      }
    } else if (value && typeof value.type === 'string' && containsLocationHashOrSearch(value)) {
      return true;
    }
  }
  return false;
}

function isDomQueryCall(node) {
  if (!node || node.type !== 'CallExpression') return false;
  const propertyName = calleePropertyName(node.callee);
  return propertyName === 'getElementById' || propertyName === 'querySelector';
}

// Correctness-pass sprint — shared by both missing-selector-target's
// guard-aware split and unchecked-selector-access: true when an
// Identifier reference is provably null-checked before any risky use —
// `el?.x` / `el?.()`, inside a `ChainExpression`, as the test of an
// `if`/ternary, or the left side of `&&`/`||` (including through a
// leading `!` negation, e.g. `if (!el) return; ... el.x`). Deliberately
// conservative: a guard shape this doesn't recognize is NOT treated as
// guarded (false negatives here just mean "still flagged," never a
// missed real risk).
function referenceIsGuarded(identifierNode) {
  const parent = identifierNode.parent;
  if (parent && parent.type === 'MemberExpression' && parent.optional && parent.object === identifierNode) return true;
  if (parent && parent.type === 'ChainExpression') return true;
  let current = identifierNode;
  for (let depth = 0; depth < 6 && current.parent; depth += 1) {
    const p = current.parent;
    if ((p.type === 'IfStatement' || p.type === 'ConditionalExpression') && p.test === current) return true;
    if (p.type === 'LogicalExpression' && (p.operator === '&&' || p.operator === '||') && p.left === current) return true;
    if (p.type === 'UnaryExpression' && p.operator === '!') { current = p; continue; }
    current = p;
  }
  return false;
}

// --- custom security rules (mdaiw-security/*) -------------------------------

const mdaiwSecurityPlugin = {
  rules: {
    'document-write': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          CallExpression(node) {
            const objectName = calleeObjectName(node.callee);
            const propertyName = calleePropertyName(node.callee);
            if (objectName === 'document' && (propertyName === 'write' || propertyName === 'writeln')) {
              context.report({ node, message: `"document.${propertyName}()" can inject unsanitized markup into the page and blocks streaming parsing.` });
            }
          },
        };
      },
    },
    'innerhtml-assignment': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          AssignmentExpression(node) {
            const propertyName = calleePropertyName(node.left);
            if (propertyName !== 'innerHTML' && propertyName !== 'outerHTML') return;
            const fromLocation = containsLocationHashOrSearch(node.right);
            const message = fromLocation
              ? `Assigning "${propertyName}" from "location.hash"/"location.search" without sanitization is a cross-site-scripting risk.`
              : `Assigning "${propertyName}" with unsanitized content is a cross-site-scripting risk.`;
            context.report({ node, message });
          },
        };
      },
    },
    'insert-adjacent-html': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          CallExpression(node) {
            if (calleePropertyName(node.callee) !== 'insertAdjacentHTML') return;
            context.report({ node, message: '"insertAdjacentHTML()" with unsanitized content is a cross-site-scripting risk.' });
          },
        };
      },
    },
    'dynamic-script-src': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        const scriptElementNames = new Set();
        return {
          CallExpression(node) {
            const objectName = calleeObjectName(node.callee);
            const propertyName = calleePropertyName(node.callee);
            if (objectName !== 'document' || propertyName !== 'createElement') return;
            const arg = node.arguments[0];
            if (!isStringLiteral(arg) || arg.value.toLowerCase() !== 'script') return;
            const declarator = node.parent && node.parent.type === 'VariableDeclarator' ? node.parent : null;
            if (declarator && declarator.id.type === 'Identifier') scriptElementNames.add(declarator.id.name);
          },
          AssignmentExpression(node) {
            if (calleePropertyName(node.left) !== 'src') return;
            const objectName = calleeObjectName(node.left);
            if (!objectName || !scriptElementNames.has(objectName)) return;
            if (isStringLiteral(node.right)) return; // a fixed literal src is not a dynamic-source risk
            context.report({ node, message: 'Assigning a dynamic value to a created <script> element\'s "src" can load untrusted code.' });
          },
        };
      },
    },
    'wildcard-postmessage': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          CallExpression(node) {
            if (calleePropertyName(node.callee) !== 'postMessage') return;
            const targetArg = node.arguments[1];
            if (targetArg && isStringLiteral(targetArg) && targetArg.value === '*') {
              context.report({ node, message: '"postMessage()" with a wildcard ("*") target origin can leak data to any page.' });
            }
          },
        };
      },
    },
    'unsafe-redirect': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        function reportIfDynamic(node, valueNode) {
          if (isStringLiteral(valueNode)) return;
          const fromLocation = containsLocationHashOrSearch(valueNode);
          const message = fromLocation
            ? 'Redirecting using a value derived from "location.hash"/"location.search" without validation is an open-redirect risk.'
            : 'Redirecting to a non-literal, unvalidated destination is an open-redirect risk.';
          context.report({ node, message });
        }
        return {
          AssignmentExpression(node) {
            const propertyName = calleePropertyName(node.left);
            const objectName = calleeObjectName(node.left);
            const isLocationAssign = (node.left.type === 'Identifier' && node.left.name === 'location')
              || (objectName === 'location' && propertyName === 'href')
              || (objectName === 'window' && propertyName === 'location');
            if (isLocationAssign) reportIfDynamic(node, node.right);
          },
          CallExpression(node) {
            const objectName = calleeObjectName(node.callee);
            const propertyName = calleePropertyName(node.callee);
            if (objectName === 'location' && (propertyName === 'assign' || propertyName === 'replace')) {
              reportIfDynamic(node, node.arguments[0]);
            }
          },
        };
      },
    },
    'hardcoded-secret': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        const secretNamePattern = /(api[_-]?key|secret|token|password|passwd|auth(orization)?)/i;
        function checkNameAndValue(nameNode, valueNode) {
          if (!isStringLiteral(valueNode) || valueNode.value.length < 8) return;
          const name = nameNode.type === 'Identifier' ? nameNode.name : (nameNode.value || '');
          if (typeof name === 'string' && secretNamePattern.test(name)) {
            context.report({ node: valueNode, message: `"${name}" looks like a hard-coded credential or token; secrets must not be embedded in client-side code.` });
          }
        }
        return {
          VariableDeclarator(node) {
            if (node.id.type === 'Identifier' && node.init) checkNameAndValue(node.id, node.init);
          },
          Property(node) {
            if (!node.computed) checkNameAndValue(node.key, node.value);
          },
          AssignmentExpression(node) {
            if (node.left.type === 'MemberExpression' && !node.left.computed) {
              checkNameAndValue(node.left.property, node.right);
            } else if (node.left.type === 'Identifier') {
              checkNameAndValue(node.left, node.right);
            }
          },
        };
      },
    },
    'prototype-pollution': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);
        return {
          AssignmentExpression(node) {
            const target = node.left;
            if (target.type !== 'MemberExpression' || !target.computed) return;
            if (!isStringLiteral(target.property)) return;
            if (dangerousKeys.has(target.property.value)) {
              context.report({ node: target, message: `Assigning to a dynamic "${target.property.value}" key can pollute the object prototype.` });
            }
          },
        };
      },
    },
    'untrusted-dynamic-import': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          ImportExpression(node) {
            if (!isStringLiteral(node.source)) {
              context.report({ node, message: 'Dynamic import() with a non-literal specifier can load an untrusted module path.' });
            }
          },
        };
      },
    },
    'mixed-content-url': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        return {
          Literal(node) {
            if (typeof node.value === 'string' && /^http:\/\//i.test(node.value)) {
              context.report({ node, message: `"${node.value}" references a resource over an insecure http:// connection.` });
            }
          },
        };
      },
    },
    'sensitive-storage': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        const sensitivePattern = /password|secret|token|ssn|social[-_]?security|credit[-_]?card|cvv|pin\b/i;
        return {
          CallExpression(node) {
            const objectName = calleeObjectName(node.callee);
            const propertyName = calleePropertyName(node.callee);
            if ((objectName !== 'localStorage' && objectName !== 'sessionStorage') || propertyName !== 'setItem') return;
            const keyArg = node.arguments[0];
            if (isStringLiteral(keyArg) && sensitivePattern.test(keyArg.value)) {
              context.report({ node, message: `Storing a value under the key "${keyArg.value}" in ${objectName} keeps sensitive-looking data in plain, persistent client storage.` });
            }
          },
        };
      },
    },
  },
};

// --- custom landing-page rules (mdaiw-lp/*) ---------------------------------

const mdaiwLpPlugin = {
  rules: {
    // Correctness-pass sprint — a selector referencing an id absent from
    // the HTML is only an ACTIONABLE finding when the code would actually
    // break on the resulting null (used inline/chained, e.g.
    // `document.getElementById("x").value`, or assigned to a variable
    // that has at least one UNGUARDED risky use). When the result is
    // assigned to a variable and EVERY use of that variable is already
    // null-checked (optional chaining, `if`/ternary, `&&`/`||` guard),
    // the code already intentionally handles absence — that case is
    // deferred entirely to the sibling 'optional-selector-target' rule
    // below, which reports it as informational, never as a repairable
    // warning (spec: never auto-fabricate HTML or rename a selector just
    // because a guarded-optional reference doesn't resolve).
    'missing-selector-target': {
      meta: { type: 'problem', schema: [{ type: 'object' }] },
      create(context) {
        const options = context.options[0] || {};
        if (!options.htmlContextAvailable) return {};
        const knownIds = new Set(options.knownElementIds || []);
        const duplicateIds = new Set(options.duplicateIds || []);
        const assignedUnknown = new Map(); // VariableDeclarator node -> {id, argNode}
        return {
          CallExpression(node) {
            const propertyName = calleePropertyName(node.callee);
            const arg = node.arguments[0];
            if (!isStringLiteral(arg)) return;
            let id = null;
            if (propertyName === 'getElementById') {
              id = arg.value;
            } else if (propertyName === 'querySelector' && /^#[A-Za-z][\w-]*$/.test(arg.value)) {
              id = arg.value.slice(1);
            }
            if (id === null) return;
            if (knownIds.has(id)) {
              if (duplicateIds.has(id)) {
                context.report({ node: arg, message: `The id "${id}" is used by more than one element in the HTML document; only the first match is selected.` });
              }
              return;
            }
            const parent = node.parent;
            if (parent && parent.type === 'VariableDeclarator' && parent.init === node) {
              // Deferred to Program:exit — whether this is reported here
              // (unsafe) or by the sibling optional-selector-target rule
              // (advisory) depends on how EVERY use of the assigned
              // variable behaves, which isn't known until the whole
              // program has been walked.
              assignedUnknown.set(parent, { id, argNode: arg });
              return;
            }
            // Not assigned to a variable — a direct/chained use
            // (`document.getElementById("x").value`, or passed straight
            // into another call) is unsafe regardless of guards, since
            // there is no variable a guard could even attach to.
            context.report({ node: arg, message: `No element with id "${id}" exists in the HTML document.` });
          },
          'Program:exit'() {
            if (assignedUnknown.size === 0) return;
            const scopeManager = context.sourceCode.scopeManager;
            for (const scope of scopeManager.scopes) {
              for (const variable of scope.variables) {
                const def = variable.defs[0];
                if (!def || def.type !== 'Variable' || !def.node) continue;
                const entry = assignedUnknown.get(def.node);
                if (!entry) continue;
                // Matches unchecked-selector-access's own established
                // heuristic below (`.some`, not `.every`): a ternary test
                // position (`el ? el.value : ...`), an `if (el)` test, or
                // the left side of `el && ...` is a DIFFERENT AST
                // occurrence of `el` than the one actually used inside
                // the guarded branch — per-reference guard detection
                // alone can never see that the branch's own `el.value`
                // is only reachable when the guard already succeeded.
                // Requiring just ONE occurrence to show guard shape (not
                // literally every occurrence) is what correctly resolves
                // `el ? el.value : "Guest"` / `if (el) { el.value }` /
                // `el && (el.value = ...)`, not just `el?.value`.
                const usageRefs = variable.references.filter((ref) => !ref.init);
                const guardedEnough = usageRefs.length > 0 && usageRefs.some((ref) => referenceIsGuarded(ref.identifier));
                if (guardedEnough) continue; // reported by optional-selector-target instead
                context.report({ node: entry.argNode, message: `No element with id "${entry.id}" exists in the HTML document.` });
              }
            }
          },
        };
      },
    },
    // The advisory counterpart to missing-selector-target above — same
    // detection, opposite conclusion: every use of the assigned variable
    // is already null-checked, so this is an intentionally optional DOM
    // target, not a defect. Reported at 'info' severity (see
    // runValidationPipeline's explicit severity override for this exact
    // rule_id — ESLint itself has no native info level) so it lands in
    // issues_advisory_total, never issues_requires_input_total, and is
    // never offered to AI Fix Issues as something to repair.
    'optional-selector-target': {
      meta: { type: 'suggestion', schema: [{ type: 'object' }] },
      create(context) {
        const options = context.options[0] || {};
        if (!options.htmlContextAvailable) return {};
        const knownIds = new Set(options.knownElementIds || []);
        const assignedUnknown = new Map();
        return {
          CallExpression(node) {
            const propertyName = calleePropertyName(node.callee);
            const arg = node.arguments[0];
            if (!isStringLiteral(arg)) return;
            let id = null;
            if (propertyName === 'getElementById') {
              id = arg.value;
            } else if (propertyName === 'querySelector' && /^#[A-Za-z][\w-]*$/.test(arg.value)) {
              id = arg.value.slice(1);
            }
            if (id === null || knownIds.has(id)) return;
            const parent = node.parent;
            if (parent && parent.type === 'VariableDeclarator' && parent.init === node) {
              assignedUnknown.set(parent, { id, argNode: arg });
            }
          },
          'Program:exit'() {
            if (assignedUnknown.size === 0) return;
            const scopeManager = context.sourceCode.scopeManager;
            for (const scope of scopeManager.scopes) {
              for (const variable of scope.variables) {
                const def = variable.defs[0];
                if (!def || def.type !== 'Variable' || !def.node) continue;
                const entry = assignedUnknown.get(def.node);
                if (!entry) continue;
                // Mirror image of missing-selector-target's own
                // guardedEnough check above — the two rules must use the
                // exact same predicate (`.some`, not `.every`) so every
                // finding is reported by exactly one of them, never both
                // and never neither.
                const usageRefs = variable.references.filter((ref) => !ref.init);
                const guardedEnough = usageRefs.length > 0 && usageRefs.some((ref) => referenceIsGuarded(ref.identifier));
                if (!guardedEnough) continue; // reported by missing-selector-target instead
                context.report({
                  node: entry.argNode,
                  message: `No element with id "${entry.id}" exists in the HTML document, but "${variable.name}" is null-checked before use — this is an optional DOM target, not a technical error.`,
                });
              }
            }
          },
        };
      },
    },
    'unchecked-selector-access': {
      meta: { type: 'problem', schema: [] },
      create(context) {
        function isRiskyUse(identifierNode) {
          const p = identifierNode.parent;
          return Boolean(p) && (p.type === 'MemberExpression' || p.type === 'CallExpression') && !p.optional
            && !(p.type === 'MemberExpression' && p.object !== identifierNode);
        }
        return {
          'Program:exit'() {
            const scopeManager = context.sourceCode.scopeManager;
            const reported = new Set();
            for (const scope of scopeManager.scopes) {
              for (const variable of scope.variables) {
                if (reported.has(variable)) continue;
                const def = variable.defs[0];
                if (!def || def.type !== 'Variable' || !def.node || def.node.type !== 'VariableDeclarator') continue;
                if (!isDomQueryCall(def.node.init)) continue;
                const usageRefs = variable.references.filter((ref) => !ref.init);
                if (usageRefs.length === 0) continue;
                if (usageRefs.some((ref) => referenceIsGuarded(ref.identifier))) continue;
                const risky = usageRefs.find((ref) => isRiskyUse(ref.identifier));
                if (!risky) continue;
                reported.add(variable);
                context.report({
                  node: risky.identifier,
                  message: `"${variable.name}" may be null when the selector matches nothing; check it before use (e.g. "if (${variable.name}) { ... }" or "${variable.name}?."). `,
                });
              }
            }
          },
        };
      },
    },
  },
};

// --- rule metadata: ruleId -> {category, confidence, suggestion} -----------

const SECURITY_BUILTIN_RULES = new Set(['no-eval', 'no-new-func', 'no-implied-eval', 'no-script-url']);
const QUALITY_HINT_RULES = new Set(['no-fallthrough', 'no-shadow', 'no-unused-expressions', 'complexity']);

const CUSTOM_RULE_META = {
  'mdaiw-security/document-write': { suggestion: 'Update the DOM via safe APIs (textContent, createElement, or a sanitized template) instead of document.write().' },
  'mdaiw-security/innerhtml-assignment': { suggestion: 'Sanitize the content first, or use textContent for plain text.' },
  'mdaiw-security/insert-adjacent-html': { suggestion: 'Sanitize the content first, or build DOM nodes with createElement instead.' },
  'mdaiw-security/dynamic-script-src': { category: 'security', confidence: 'likely', suggestion: 'Load scripts only from a fixed, trusted, literal URL.' },
  'mdaiw-security/wildcard-postmessage': { suggestion: 'Specify the exact expected origin instead of "*".' },
  'mdaiw-security/unsafe-redirect': { category: 'security', confidence: 'possible', suggestion: 'Validate the destination against an allowlist before redirecting.' },
  'mdaiw-security/hardcoded-secret': { category: 'security', confidence: 'possible', suggestion: 'Move secrets to a server-side configuration; never ship them in client-side JavaScript.' },
  'mdaiw-security/prototype-pollution': { suggestion: 'Use a Map, or validate the key against an allowlist before assignment.' },
  'mdaiw-security/untrusted-dynamic-import': { category: 'security', confidence: 'possible', suggestion: 'Import from a fixed, literal module specifier.' },
  'mdaiw-security/mixed-content-url': { category: 'security', confidence: 'possible', suggestion: 'Use an https:// URL for this resource.' },
  'mdaiw-security/sensitive-storage': { category: 'security', confidence: 'possible', suggestion: 'Avoid storing sensitive values in client-side storage; use a secure, server-managed session instead.' },
  'mdaiw-lp/missing-selector-target': { category: 'value', confidence: 'likely', suggestion: 'Correct the selector, or add the missing element to the HTML.' },
  'mdaiw-lp/optional-selector-target': {
    category: 'value', confidence: 'likely',
    suggestion: 'This id is intentionally optional (every use is null-checked) — no action required unless the fallback behavior itself needs to change.',
  },
  'mdaiw-lp/unchecked-selector-access': { category: 'value', confidence: 'possible', suggestion: 'Guard the access with an if-check or optional chaining.' },
};

function getRuleMeta(ruleId) {
  if (!ruleId) return { category: 'syntax', confidence: 'definite', suggestion: '' };
  const custom = CUSTOM_RULE_META[ruleId];
  if (custom) {
    return { category: custom.category || 'security', confidence: custom.confidence || 'definite', suggestion: custom.suggestion || '' };
  }
  if (SECURITY_BUILTIN_RULES.has(ruleId)) return { category: 'security', confidence: 'definite', suggestion: '' };
  if (QUALITY_HINT_RULES.has(ruleId)) return { category: 'syntax', confidence: 'likely', suggestion: '' };
  return { category: 'syntax', confidence: 'definite', suggestion: '' };
}

// --- profile-only informational compatibility notices (legacy profile) -----

const MODERN_FEATURE_PATTERNS = [
  { name: 'optional chaining ("?.")', re: /\?\./ },
  { name: 'nullish coalescing ("??")', re: /\?\?/ },
  { name: 'class private fields ("#name")', re: /#[A-Za-z_]\w*\s*[=;(]/ },
  { name: 'top-level await', re: /^\s*await\s/m },
];

function buildModernFeatureNotices(code, profile) {
  if (profile !== 'legacy') return [];
  const issues = [];
  for (const { name, re } of MODERN_FEATURE_PATTERNS) {
    const match = re.exec(code);
    if (!match) continue;
    const line = code.slice(0, match.index).split('\n').length;
    issues.push({
      ruleId: 'mdaiw-compat:modern-feature-notice', category: 'compatibility', severity: 'info', confidence: 'possible',
      message: `Uses modern JavaScript feature ${name}, which may not be supported by older targeted browsers/engines.`,
      suggestion: 'Verify support for this feature against the project\'s browser support target, or provide a fallback/transpilation step.',
      line, column: 1, endLine: null, endColumn: null,
    });
  }
  return issues;
}

// --- sourceType auto-detection -----------------------------------------------

function detectSourceType(code) {
  return /^\s*(import|export)\b/m.test(code) ? 'module' : 'script';
}

// --- config assembly ---------------------------------------------------------

function buildConfig(profile, sourceType, knownElementIds, duplicateIds) {
  const htmlContextAvailable = Array.isArray(knownElementIds);
  const rules = {
    'no-unused-expressions': 'warn',
    'no-shadow': 'warn',
    'no-implied-eval': 'error',
    'no-script-url': 'error',
    'no-eval': 'error',
    'no-new-func': 'error',
    'mdaiw-security/document-write': 'warn',
    'mdaiw-security/innerhtml-assignment': 'error',
    'mdaiw-security/insert-adjacent-html': 'error',
    'mdaiw-security/dynamic-script-src': 'warn',
    'mdaiw-security/wildcard-postmessage': 'error',
    'mdaiw-security/unsafe-redirect': 'warn',
    'mdaiw-security/hardcoded-secret': 'warn',
    'mdaiw-security/prototype-pollution': 'error',
    'mdaiw-security/untrusted-dynamic-import': 'warn',
    'mdaiw-security/mixed-content-url': 'warn',
    'mdaiw-security/sensitive-storage': 'warn',
    'mdaiw-lp/unchecked-selector-access': 'warn',
    'mdaiw-lp/missing-selector-target': htmlContextAvailable
      ? ['warn', { knownElementIds, duplicateIds: duplicateIds || [], htmlContextAvailable: true }]
      : 'off',
    // Correctness-pass sprint — configured 'warn' here purely so ESLint
    // actually runs the rule; runValidationPipeline below force-maps
    // ITS OWN messages (and only its own) to severity 'info' regardless
    // of this level, since ESLint itself has no native info severity.
    'mdaiw-lp/optional-selector-target': htmlContextAvailable
      ? ['warn', { knownElementIds, htmlContextAvailable: true }]
      : 'off',
  };
  if (profile === 'strict') {
    rules['no-shadow'] = 'error';
    rules.complexity = ['warn', 15];
  }

  return [
    js.configs.recommended,
    {
      plugins: { 'mdaiw-security': mdaiwSecurityPlugin, 'mdaiw-lp': mdaiwLpPlugin },
      languageOptions: { ecmaVersion: 'latest', sourceType, globals: BROWSER_GLOBALS },
      rules,
    },
  ];
}

// Tool-Grounded AI Engineer sprint, spec section 3/7 — ESLint's own
// `verifyAndFix` using the EXACT SAME config runValidationPipeline
// already uses, run BEFORE any AI proposal is requested for a JS issue.
// Only rules with a real ESLint fixer ever change anything (e.g.
// `no-extra-semi` from @eslint/js's recommended set); none of this
// project's own security/logic rules register a fixer, so this can never
// silently "fix" a security finding by guessing. Returns the fixed
// source, or null if nothing changed / linting itself failed.
export function runEslintAutofix(code, profile, options = {}) {
  try {
    const sourceType = options.sourceType === 'module' || options.sourceType === 'script'
      ? options.sourceType
      : detectSourceType(code);
    const knownElementIds = Array.isArray(options.knownElementIds) ? options.knownElementIds : null;
    const duplicateIds = Array.isArray(options.duplicateIds) ? options.duplicateIds : null;
    const linter = new Linter();
    const config = buildConfig(profile, sourceType, knownElementIds, duplicateIds);
    const result = linter.verifyAndFix(code, config, { filename: 'source.js' });
    if (!result || typeof result.output !== 'string' || result.output === code) return null;
    return result.output;
  } catch {
    return null;
  }
}

// --- combined pipeline -------------------------------------------------------

export async function runValidationPipeline(code, profile, options = {}) {
  const sourceType = options.sourceType === 'module' || options.sourceType === 'script'
    ? options.sourceType
    : detectSourceType(code);
  const knownElementIds = Array.isArray(options.knownElementIds) ? options.knownElementIds : null;
  const duplicateIds = Array.isArray(options.duplicateIds) ? options.duplicateIds : null;

  const linter = new Linter();
  const config = buildConfig(profile, sourceType, knownElementIds, duplicateIds);
  const sourceLines = code.split('\n');

  let messages;
  try {
    messages = linter.verify(code, config, { filename: 'source.js' });
  } catch {
    // A genuine internal engine failure (never expected for merely
    // malformed JavaScript — that's what a fatal parse message is for).
    return { issues: [], parseFailed: true, sourceType };
  }

  const issues = [];
  let parseFailed = false;
  for (const rawMessage of messages) {
    if (rawMessage.fatal) {
      parseFailed = true;
      issues.push({
        ruleId: 'javascript:parse-error', category: 'syntax', severity: 'error', confidence: 'definite',
        message: rawMessage.message, suggestion: '',
        line: rawMessage.line || 1, column: rawMessage.column || 1, endLine: null, endColumn: null,
      });
      continue;
    }
    const meta = getRuleMeta(rawMessage.ruleId);
    // Correctness-pass sprint — ESLint's own severity is binary
    // (warn/error), but 'mdaiw-lp/optional-selector-target' represents an
    // intentionally-handled, non-actionable finding (a guarded-optional
    // DOM reference), which this project reports as 'info' regardless of
    // the ESLint config level that merely turns the rule on.
    const severity = rawMessage.ruleId === 'mdaiw-lp/optional-selector-target'
      ? 'info'
      : (rawMessage.severity === 2 ? 'error' : 'warning');
    issues.push({
      ruleId: rawMessage.ruleId || 'javascript:unknown',
      category: meta.category,
      severity,
      confidence: meta.confidence,
      message: rawMessage.message,
      suggestion: meta.suggestion,
      line: rawMessage.line || 1,
      column: rawMessage.column || 1,
      endLine: rawMessage.endLine ?? null,
      endColumn: rawMessage.endColumn ?? null,
    });
  }

  issues.push(...buildModernFeatureNotices(code, profile));

  const withExcerpts = issues.map((issue) => ({ ...issue, codeExcerpt: excerptFor(sourceLines, issue.line) }));
  return { issues: withExcerpts, parseFailed, sourceType };
}
