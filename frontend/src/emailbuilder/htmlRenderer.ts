import type { EmailDocumentContent } from './edm';
import { getModuleDefinition } from './moduleRegistry';

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
export function renderEmailBody(document: RenderableEmail): string {
  const modules = [...document.content.modules].sort((a, b) => a.order - b.order);
  const rows = modules
    .map((module) => {
      const definition = getModuleDefinition(module.type);
      if (!definition) return '';
      return `<tr><td>${definition.renderEmailHtml(module)}</td></tr>`;
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
    + `<body style="margin:0; padding:0; background-color:#F4F6F8;">\n${body}\n</body>\n`
    + '</html>'
  );
}
