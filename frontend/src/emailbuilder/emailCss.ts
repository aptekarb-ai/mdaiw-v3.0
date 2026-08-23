// Email Document Standards Sub-phase 2 — Reset CSS + Custom CSS.
//
// Everything that RENDERS CSS into the generated email HTML lives here
// (the actual Reset CSS text, and the comment-wrapped <style> blocks) —
// this is the ONLY place either exists, consumed by emailHead.ts, which
// every surface (Visual/Preview, Code, Preview Studio, Validation,
// Export) already shares via renderEmailDocument(). Nothing server-side
// ever renders an email document (Preview/Code/Export all run entirely
// client-side), so the backend has no counterpart to BUILTIN_RESET_CSS —
// see backend/emailbuilder/custom_css_security.py's module docstring.
//
// The Custom CSS SECURITY validator below IS mirrored server-side
// (custom_css_security.py) — the frontend copy exists only for
// immediate UI feedback (Monaco markers, disabling Save); the backend
// copy is the final, authoritative persistence-layer gate. Keep the two
// pattern lists in sync if either changes.

// ---------------------------------------------------------------------
// Built-in Reset CSS
// ---------------------------------------------------------------------
//
// Audited rule-by-rule against the originally supplied legacy boilerplate
// rather than copied verbatim (approved decision). Every rule below
// targets an element this renderer actually emits somewhere across the
// 53-type module registry — see the omission notes for what was
// deliberately left out and why.
//
// KEPT (all approved categories, item A):
//   - -webkit/-ms-text-size-adjust: ONE consistent value (100%), never a
//     second, contradictory declaration elsewhere.
//   - body margin/padding normalization, plus the standard
//     width/height:100% !important full-bleed rule several webmail
//     clients need to avoid partial-width rendering.
//   - table border-collapse/border-spacing normalization.
//   - mso-table-lspace/mso-table-rspace:0 (Outlook/Word engine cell
//     spacing) — table AND td, matching every table this renderer emits.
//   - img border/outline/text-decoration reset, -ms-interpolation-mode:
//     bicubic (IE/Edge legacy image scaling), display:block (removes the
//     inline-image baseline gap).
//   - p { margin: 0 } — <p> is genuinely emitted by 8+ module families
//     (Text, Hero, Header, Content, Product, Social, Footer, CTA).
//
// DELIBERATELY OMITTED (documented, not silently dropped):
//   - Any hard-coded link color (e.g. the common "#006379" boilerplate
//     value, or the Gmail `u + #body a` downlevel technique that would
//     require one). This app has no stable, configured "default link
//     color" concept to derive from yet, and every module that renders
//     an <a> already sets its OWN explicit inline color — a reset rule
//     here would either invent an arbitrary brand color (explicitly
//     rejected) or silently fight a module's real inline color. Revisit
//     if/when a document-level default link color setting exists.
//   - h1–h6 / ul,ol,li normalization. No module in the current 53-type
//     registry renders a heading or list tag (Text renders <p>/<div>
//     with fully explicit inline typography) — a reset rule for markup
//     the renderer never produces is dead CSS. Revisit if a
//     List/Heading module type is ever added.
//   - A global font-family fallback stack. Every module already sets an
//     explicit inline font-family per instance (see registryCore.tsx's
//     fontStackFor) — inline styles always win, so a reset-level
//     font-family rule could never actually apply; it would be pure
//     dead weight, not "safety."
//   - The Outlook `tr{font-size:0;line-height:0;}` spacer-row hack —
//     that is a targeted, SCOPED marker class (Sub-phase 3's dedicated
//     spacer mechanism), never a blanket rule here: applied globally it
//     would corrupt any real text row that happens to sit in a <tr>.
export const BUILTIN_RESET_CSS = `body, table, td, p, a {
  -webkit-text-size-adjust: 100%;
  -ms-text-size-adjust: 100%;
}
body {
  margin: 0;
  padding: 0;
  width: 100% !important;
  height: 100% !important;
}
table, td {
  mso-table-lspace: 0pt;
  mso-table-rspace: 0pt;
}
table {
  border-collapse: collapse;
  border-spacing: 0;
}
img {
  border: 0;
  outline: none;
  text-decoration: none;
  -ms-interpolation-mode: bicubic;
  display: block;
}
p {
  margin: 0;
}`;

const RESET_CSS_START = '/*=========================\n       EMAIL RESET CSS - START\n=========================*/';
const RESET_CSS_END = '/*======= EMAIL RESET CSS - ENDS =======*/';
const CUSTOM_CSS_START = '/*=========================\n       CUSTOM CSS - START\n=========================*/';
const CUSTOM_CSS_END = '/*======= CUSTOM CSS - ENDS =======*/';

export function renderResetCssBlock(): string {
  return `<style type="text/css">\n${RESET_CSS_START}\n${BUILTIN_RESET_CSS}\n${RESET_CSS_END}\n</style>\n`;
}

// Renders nothing when disabled or empty — item K: "Do not emit the
// Custom CSS block if disabled or empty." The CALLER (emailHead.ts)
// decides whether custom_css_enabled gates this at all; this function
// itself only guards against an enabled-but-empty value.
export function renderCustomCssBlock(css: string): string {
  const trimmed = css.trim();
  if (!trimmed) return '';
  return `<style type="text/css">\n${CUSTOM_CSS_START}\n${trimmed}\n${CUSTOM_CSS_END}\n</style>\n`;
}

// ---------------------------------------------------------------------
// Custom CSS security validator (frontend copy — see module docstring)
// ---------------------------------------------------------------------

export const MAX_CUSTOM_CSS_LENGTH = 20000;

// NORMALIZATION STRATEGY (closure item 3) — mirrors
// backend/emailbuilder/custom_css_security.py's
// _normalize_for_security_scan() exactly. Every pattern below is matched
// against the NORMALIZED string, never the raw one. This undoes ONLY the
// specific encodings a real browser's CSS engine would ALSO undo before
// interpreting a value — never more, so a rule can neither be tricked
// into a false positive a browser wouldn't execute, nor bypassed by an
// encoding a browser WOULD execute:
//   1. CSS numeric escapes (`\XX..X`, 1-6 hex digits, optional one
//      trailing whitespace char) decoded to the literal character, e.g.
//      `\6a` -> "j" — every engine honors this, so `j\61vascript:` is
//      exactly as dangerous as `javascript:` and is now caught
//      identically.
//   2. Any other backslash-escaped character decoded to that literal
//      character (`\<` -> `<`, `\:` -> `:`, ...).
//   3. CSS comments (`/* ... */`) removed — historically exploitable to
//      split a dangerous token (`java/**/script:`) in legacy engines.
//   4. C0/DEL control characters removed (the historical
//      `java\0script:` NUL-byte trick).
//   5. Case-folded to lowercase.
// Deliberately NOT done: collapsing ordinary whitespace between intact
// words — a literal space inserted mid-keyword isn't something any real
// CSS engine reinterprets back into a working scheme, so "fixing" that
// would only invite false positives without closing a genuine bypass.
// The HTML-breakout patterns (`</style`, `<script`, `<!--`, `-->`, the
// generic embedded-tag pattern) are HTML-parser-level vectors, not
// CSS-engine ones, so they gain no coverage from this normalization —
// and lose none either, since none of steps 1-5 touches their spelling.
function normalizeForSecurityScan(css: string): string {
  let normalized = css.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_match, hex: string) => {
    try {
      return String.fromCodePoint(parseInt(hex, 16));
    } catch {
      return '';
    }
  });
  normalized = normalized.replace(/\\(.)/g, '$1');
  normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');
  // eslint-disable-next-line no-control-regex -- deliberately matching C0/DEL control characters (see docstring above)
  normalized = normalized.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return normalized.toLowerCase();
}

interface BreakoutPattern {
  pattern: RegExp;
  description: string;
}

// Every message is written for a NORMALIZED (already-lowercased) match,
// so patterns no longer need the `i` flag — case is already folded away
// by normalizeForSecurityScan before these ever run.
const BREAKOUT_PATTERNS: BreakoutPattern[] = [
  { pattern: /<\/\s*style/, description: 'a "</style" tag (style-element breakout)' },
  { pattern: /<\s*script/, description: 'a "<script" tag' },
  { pattern: /<!--/, description: 'an HTML comment open ("<!--")' },
  { pattern: /-->/, description: 'an HTML comment close ("-->")' },
  { pattern: /javascript\s*:/, description: 'a "javascript:" URL scheme' },
  { pattern: /vbscript\s*:/, description: 'a "vbscript:" URL scheme' },
  { pattern: /expression\s*\(/, description: 'a legacy IE CSS expression() call' },
  { pattern: /behavior\s*:/, description: 'a legacy IE "behavior:" binding' },
  { pattern: /-moz-binding\s*:/, description: 'a "-moz-binding:" XBL binding' },
  { pattern: /@import\b/, description: 'an "@import" rule (external stylesheets cannot be vetted)' },
  // Item 2 — data: URLs are disallowed entirely (no data:image/
  // exception). The Asset Manager / owned HTTP(S) assets are the
  // supported path for images.
  { pattern: /data\s*:/, description: 'a "data:" URL scheme (use the Asset Manager or an https:// URL instead)' },
  { pattern: /<\s*[a-zA-Z][a-zA-Z0-9]*[\s/>]/, description: 'an embedded HTML tag' },
];

export interface CustomCssValidationResult {
  valid: boolean;
  errors: string[];
}

// Mirrors backend/emailbuilder/custom_css_security.py's
// validate_custom_css_security() exactly (same normalization, same
// patterns, same rejection messages) — used for immediate Monaco error
// markers and to disable Save client-side; the backend call on PATCH is
// still authoritative.
export function validateCustomCss(css: string): CustomCssValidationResult {
  const errors: string[] = [];
  if (css.length > MAX_CUSTOM_CSS_LENGTH) {
    errors.push(`Custom CSS is too long (maximum ${MAX_CUSTOM_CSS_LENGTH} characters).`);
  }
  const normalized = normalizeForSecurityScan(css);
  for (const { pattern, description } of BREAKOUT_PATTERNS) {
    if (pattern.test(normalized)) {
      errors.push(`Custom CSS must not contain ${description}.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------
// Non-blocking structural-selector compatibility warnings (item E)
// ---------------------------------------------------------------------
//
// Heuristic, regex-based — not a full CSS parser. Flags the common,
// genuinely risky case (a bare/global element selector for a
// structural tag combined with a compatibility-sensitive declaration)
// and intentionally says nothing about deeply nested/complex selectors
// it cannot reliably parse. Never blocks Save — see DocumentSettingsDialog,
// which shows these as advisory only. Exported so Sub-phase 4's
// Validation Center can reuse the exact same detector rather than a
// second, possibly-divergent implementation (item J).

const STRUCTURAL_SELECTOR_TAGS = ['html', 'body', 'table', 'tbody', 'tr', 'td', 'img'];
const RISKY_DECLARATION_PROPERTIES = [
  'display', 'position', 'float', 'width', 'max-width', 'border-collapse', 'border-spacing',
  'mso-table-lspace', 'mso-table-rspace', 'line-height',
];

const OUTLOOK_SENSITIVE_PROPERTIES = new Set([
  'border-collapse', 'border-spacing', 'mso-table-lspace', 'mso-table-rspace',
]);

export interface CustomCssWarning {
  selector: string;
  property: string;
  message: string;
  affectedClients: string;
}

// Removes every top-level @-rule block (its selector-equivalent AND its
// body) before the flat-rule scan below runs — a selector inside an
// @media block is deliberately NOT flagged, since a scoped mobile-only
// override of `table{width:100%}` is exactly the kind of legitimate,
// intentional override item E says not to forbid. Handles both
// brace-bodied at-rules (@media {...}, @font-face {...}) and
// semicolon-terminated ones (@import ...;). Not a full CSS parser — this
// is a depth-counting scanner, not a tokenizer/AST, so it does not
// understand strings/comments that happen to contain "{"/"}"/";" (email
// Custom CSS in practice does not need that level of rigor for an
// advisory, non-blocking warning).
function stripAtRuleBlocks(css: string): string {
  let result = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '@') {
      const nextBrace = css.indexOf('{', i);
      const nextSemicolon = css.indexOf(';', i);
      if (nextSemicolon !== -1 && (nextBrace === -1 || nextSemicolon < nextBrace)) {
        i = nextSemicolon + 1;
        continue;
      }
      if (nextBrace === -1) {
        result += css.slice(i);
        break;
      }
      let depth = 1;
      let j = nextBrace + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      i = j;
      continue;
    }
    result += css[i];
    i += 1;
  }
  return result;
}

// Splits the (@-rule-stripped) CSS into top-level flat rule blocks.
const RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;

function isBareStructuralSelector(selectorPart: string): string | null {
  const trimmed = selectorPart.trim().toLowerCase();
  // Only a bare tag name (optionally with a pseudo-class, e.g. "td:hover")
  // counts — "td.my-class" or "#id td" or "[data-x] td" target a scoped
  // subset, not every such element in the document, so they are not
  // flagged.
  const bareMatch = /^([a-z]+)(:[a-z-]+)?$/.exec(trimmed);
  if (!bareMatch) return null;
  const tag = bareMatch[1];
  return STRUCTURAL_SELECTOR_TAGS.includes(tag) ? tag : null;
}

export function detectCustomCssWarnings(css: string): CustomCssWarning[] {
  const warnings: CustomCssWarning[] = [];
  const withoutAtRules = stripAtRuleBlocks(css);
  let match: RegExpExecArray | null;
  RULE_PATTERN.lastIndex = 0;
  while ((match = RULE_PATTERN.exec(withoutAtRules)) !== null) {
    const [, selectorList, body] = match;

    const selectors = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
    for (const selector of selectors) {
      const tag = isBareStructuralSelector(selector);
      if (!tag) continue;

      for (const property of RISKY_DECLARATION_PROPERTIES) {
        const propertyPattern = new RegExp(`(^|;|\\{)\\s*${property}\\s*:`, 'i');
        if (!propertyPattern.test(`;${body}`)) continue;
        const affectedClients = OUTLOOK_SENSITIVE_PROPERTIES.has(property)
          ? 'Outlook Desktop (Word rendering engine)'
          : 'most email clients (layout/rendering-sensitive property)';
        warnings.push({
          selector: tag,
          property,
          message: `Custom CSS sets "${property}" on every <${tag}> element, which may affect ${affectedClients}. This is allowed — review that it is intentional.`,
          affectedClients,
        });
      }
    }
  }
  return warnings;
}
