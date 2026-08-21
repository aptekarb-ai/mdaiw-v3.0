import type { EmailDocumentContent } from './edm';
import { resolveOuterSpacing } from './edm';
import { getModuleDefinition } from './moduleRegistry';
import { wrapWithOuterSpacing } from './registryCore';

export interface RenderableEmail {
  width: number;
  content: EmailDocumentContent;
}

// The first email renderer layer: Email Document Model -> email-safe HTML
// string. Table-first throughout, role="presentation" on layout tables,
// no structural divs, no script, all user text/URLs escaped/sanitized by
// each module definition's own renderEmailHtml(). Platform-specific
// scripting (AMPScript/Marketo tokens/HubL/...) is not implemented here —
// that is a future platform-adapter layer.
//
// Left/right OUTER spacing (settings.outerSpacing) is applied HERE, once,
// uniformly around every module's own HTML — not inside each module
// definition — so all 53+ built-ins (and any future one) get it for
// free. See registryCore.ts's wrapWithOuterSpacing.
export function renderEmailBody(document: RenderableEmail): string {
  const modules = [...document.content.modules].sort((a, b) => a.order - b.order);
  const rows = modules
    .map((module) => {
      const definition = getModuleDefinition(module.type);
      if (!definition) return '';
      // Desktop is the source of truth for today's single static HTML
      // export — see edm.ts's EmailModuleSettings docstring. The
      // resolver (not this call site) is where mobile-inheritance logic
      // lives, so Feature 07 can call it with 'mobile' without touching
      // this file.
      const resolvedOuterSpacing = resolveOuterSpacing(module.settings, 'desktop');
      const bodyHtml = wrapWithOuterSpacing(definition.renderEmailHtml(module), resolvedOuterSpacing);
      return `<tr><td>${bodyHtml}</td></tr>`;
    })
    .join('');

  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F6F8;">'
    + '<tr><td align="center">'
    + `<table role="presentation" width="${document.width}" cellpadding="0" cellspacing="0" border="0" `
    + `style="width:${document.width}px; max-width:${document.width}px; background-color:#FFFFFF;">`
    + rows
    + '</table>'
    + '</td></tr>'
    + '</table>'
  );
}

export function renderEmailDocument(document: RenderableEmail): string {
  const body = renderEmailBody(document);
  return (
    '<!doctype html>\n'
    + '<html xmlns="http://www.w3.org/1999/xhtml">\n'
    + '<head>\n'
    + '<meta charset="utf-8" />\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n'
    + '<meta http-equiv="X-UA-Compatible" content="IE=edge" />\n'
    + '<title></title>\n'
    + '</head>\n'
    // No margin/padding reset on <body> — background-color matches the
    // outer wrapper table exactly, so any client-default body margin is
    // visually seamless without a CSS margin declaration anywhere in the
    // generated document.
    + `<body style="background-color:#F4F6F8;">\n${body}\n</body>\n`
    + '</html>'
  );
}
