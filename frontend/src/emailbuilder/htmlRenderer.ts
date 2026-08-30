import type { EmailColumn, EmailDocumentContent, EmailModule } from './edm';
import {
  renderModuleWithOuterStructure, resolveModuleDefinition, resolveNestedModuleParentPlaceholder,
  wrapModuleComment,
} from './registryCore';
import { renderEmailHead } from './emailHead';

export interface RenderableEmail {
  width: number;
  content: EmailDocumentContent;
  // Email Document Standards Sub-phase 1 — optional so every EXISTING
  // caller/test (CodeEditorPanel, PreviewStudioPanel, ExportDeployDialog,
  // htmlRenderer.test.ts) keeps compiling unchanged; '' matches today's
  // always-empty-title baseline exactly, so omitting these is a
  // zero-behavior-change default, not a silent feature loss.
  title?: string;
  faviconUrl?: string;
  // Sub-phase 2 — same zero-behavior-change-when-omitted convention as
  // title/faviconUrl above (see emailHead.ts's EmailHeadOptions docstring
  // for why resetCssEnabled defaults false HERE despite defaulting true
  // at the EmailDocument model layer).
  resetCssEnabled?: boolean;
  customCssEnabled?: boolean;
  customCss?: string;
  // Module-4 E4 — document-level DEFAULT for the per-module
  // settings.outlookVml opt-in. Same zero-behavior-change-when-omitted
  // convention as every field above: omitted/false reproduces today's
  // exact existing behavior (a module renders VML only if IT explicitly
  // set outlookVml). Resolution happens once, here, via
  // resolveOutlookVmlDefaults below — never inside any of the 11+ catalog
  // files that already read `settings.outlookVml`, so this stays a single,
  // additive change instead of threading a new parameter through every
  // module definition's renderEmailHtml.
  outlookVml?: boolean;
}

// A module's OWN explicit settings.outlookVml (set today only via the AI
// Engineer's APPLY_VML_PATTERN/APPLY_OUTLOOK_WRAPPER actions) always wins;
// otherwise it falls back to the document-level default. Recurses one
// level into layout columns — the same nesting depth every other
// module-tree walk in this app assumes (see emailValidation.ts's
// flattenModules). Returns new module objects (never mutates the real,
// possibly-still-live EDM tree the caller passed in).
function resolveOutlookVmlDefaults(modules: EmailModule[], documentDefault: boolean): EmailModule[] {
  if (!documentDefault) return modules;
  const resolveOne = (module: EmailModule): EmailModule => {
    const resolved: EmailModule = module.settings.outlookVml === undefined
      ? { ...module, settings: { ...module.settings, outlookVml: true } }
      : module;
    if (!resolved.columns) return resolved;
    return {
      ...resolved,
      columns: (resolved.columns as EmailColumn[]).map((column) => ({
        ...column,
        modules: column.modules.map(resolveOne),
      })),
    };
  };
  return modules.map(resolveOne);
}

// The first email renderer layer: Email Document Model -> email-safe HTML
// string. Table-first throughout, role="presentation" on layout tables,
// no structural divs, no script, all user text/URLs escaped/sanitized by
// each module definition's own renderEmailHtml(). Platform-specific
// scripting (AMPScript/Marketo tokens/HubL/...) is not implemented here —
// that is a future platform-adapter layer.
//
// Left/right OUTER spacing (settings.outerSpacing) is applied uniformly
// around every module's own HTML — not inside each module definition —
// via the single centralized renderModuleWithOuterStructure, so all 53+
// built-ins (and any future one) get it for free, whether top-level
// (here) or nested inside a Layout column (layoutCatalog.tsx uses the
// exact same function).
export function renderEmailBody(document: RenderableEmail): string {
  const modules = resolveOutlookVmlDefaults(
    [...document.content.modules].sort((a, b) => a.order - b.order),
    document.outlookVml ?? false,
  );
  // Sub-phase 3, items 7/8 — every top-level module gets a deterministic
  // `MODULE-N: LABEL` comment, N assigned strictly from this sorted
  // render-order position (never from module.type, never persisted —
  // recomputed fresh on every render, so duplicate/delete/reorder always
  // renumbers correctly for free). A layout module's own nested-module
  // comments come back from renderModuleWithOuterStructure still
  // carrying the MODULE-__PARENT__.N placeholder (layoutCatalog.tsx has
  // no way to know its own top-level number) — resolved to the real
  // MODULE-N here, the one place that DOES know it.
  const rows = modules
    .map((module, index) => {
      const number = String(index + 1);
      const definition = resolveModuleDefinition(module.type);
      const rendered = resolveNestedModuleParentPlaceholder(
        renderModuleWithOuterStructure(module, document.width), number,
      );
      const commented = wrapModuleComment(rendered, `${number}: ${(definition?.label ?? module.type).toUpperCase()}`);
      return `<tr><td>${commented}</td></tr>`;
    })
    .join('');

  // Hybrid/fluid width strategy (04_Email_HTML_Rules.md: "explicit widths,
  // max-width strategy, and safe fallbacks"). Outlook's Word rendering
  // engine ignores CSS max-width entirely and only respects the HTML width
  // attribute, so it gets its own fixed-${document.width}px table via an
  // MSO conditional comment — a plain, inert HTML comment to every other
  // client (never executed, never a <script>, never parsed as markup by
  // them), so genuinely invisible outside Outlook. Everyone else renders
  // the one real table beneath it: width="100%" with max-width in CSS, so
  // the email actually shrinks to fit a narrow viewport instead of forcing
  // horizontal scroll — the fixed HTML width="${document.width}" this
  // table carried previously made "max-width" a no-op (width == max-width
  // always resolved to the fixed value, never fluid).
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F6F8;">'
    + '<tr><td align="center">'
    + `<!--[if mso]><table role="presentation" width="${document.width}" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->`
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
    + `style="width:100%; max-width:${document.width}px; background-color:#FFFFFF;">`
    + rows
    + '</table>'
    + '<!--[if mso]></td></tr></table><![endif]-->'
    + '</td></tr>'
    + '</table>'
  );
}

export function renderEmailDocument(document: RenderableEmail): string {
  const body = renderEmailBody(document);
  const head = renderEmailHead({
    title: document.title ?? '',
    faviconUrl: document.faviconUrl ?? '',
    content: document.content,
    resetCssEnabled: document.resetCssEnabled,
    customCssEnabled: document.customCssEnabled,
    customCss: document.customCss,
  });
  return (
    '<!doctype html>\n'
    // xmlns:v/xmlns:o (VML/Office) — Email Document Standards Sub-phase 1.
    // The canonical XHTML namespace is UNCHANGED (still http://, never
    // https://). Namespaces only — actual VML markup generation (ghost
    // tables, VML buttons/backgrounds) is a later Feature 14 Repair
    // Engine phase, not this slice.
    + '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">\n'
    + '<head>\n'
    + head
    + '</head>\n'
    // No margin/padding reset on <body> — background-color matches the
    // outer wrapper table exactly, so any client-default body margin is
    // visually seamless without a CSS margin declaration anywhere in the
    // generated document.
    + `<body style="background-color:#F4F6F8;">\n${body}\n</body>\n`
    + '</html>'
  );
}
