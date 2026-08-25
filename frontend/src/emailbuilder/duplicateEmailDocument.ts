import { createEmailDocument, deleteEmailDocument, updateEmailDocument } from '../api/client';
import { cloneModuleWithNewId } from './moduleFactory';
import type { CreateEmailDocumentInput, EmailDocument, EmailPlatform, UpdateEmailDocumentInput } from './types';
import type { EmailModule } from './edm';
import type { ApiError } from '../types/auth';

// Shared by duplicateEmailDocument, Feature 13's saveEmailAsTemplate, and
// Phase B's createEmailDocumentFromTemplate (below): all three are
// "create a new EmailDocument row, then patch it" — no dedicated backend
// endpoint for any of them, same "reuse existing endpoints, don't add a
// feature-only model" constraint. A patch failure (e.g. the source
// content no longer passes today's validation, or the chosen name loses a
// uniqueness race — see backend EmailDocumentViewSet's IntegrityError
// handling) must not leave a silent empty/orphan row behind, so every
// caller gets the same create-then-roll-back-on-failure behavior for
// free. `patch` is a general UpdateEmailDocumentInput (not just
// `content`) so a caller can seed content and document settings in one
// atomic-from-the-caller's-perspective create+patch pair rather than two
// separate PATCH round-trips.
async function createDocumentWithContent(
  input: CreateEmailDocumentInput, patch: UpdateEmailDocumentInput,
): Promise<EmailDocument> {
  const created = await createEmailDocument(input);
  try {
    return await updateEmailDocument(created.id, patch);
  } catch (error) {
    await deleteEmailDocument(created.id).catch(() => {
      // Best-effort cleanup — if the delete itself fails there is nothing
      // more this call can safely do; the original error is what the
      // caller needs to see either way.
    });
    throw error;
  }
}

function isNameCollisionError(error: unknown): boolean {
  return Array.isArray((error as ApiError)?.errors?.name);
}

const MAX_UNIQUE_NAME_ATTEMPTS = 50;

// Phase B (naming-invariant regression fix) — duplicateEmailDocument and
// saveEmailAsTemplate both auto-generate their name ("Copy of X", "X
// (Template)") rather than taking user-typed input, so per the approved
// naming-safety decision it's correct for THEM (and only them — never
// createEmailDocumentFromTemplate, whose name is user-typed/editable) to
// silently retry with a numbered suffix on a collision instead of
// surfacing an error for something the user never typed. Retries only on
// an actual name-collision response (error.errors.name) from
// createEmailDocument — a content/patch failure is a different problem a
// new name can't fix, so that still propagates via
// createDocumentWithContent's own rollback path unchanged.
async function createDocumentWithContentAndUniqueName(
  baseName: string,
  restInput: Omit<CreateEmailDocumentInput, 'name'>,
  patch: UpdateEmailDocumentInput,
): Promise<EmailDocument> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_UNIQUE_NAME_ATTEMPTS; attempt += 1) {
    const name = attempt === 1 ? baseName : `${baseName} (${attempt})`;
    try {
      return await createDocumentWithContent({ ...restInput, name }, patch);
    } catch (error) {
      lastError = error;
      if (!isNameCollisionError(error)) throw error;
    }
  }
  throw lastError;
}

// Dashboard "Duplicate" row action. Module/column/nested-module ids are
// regenerated via the SAME cloneModuleWithNewId the canvas already uses
// to duplicate a module or a layout-with-children in place — a full
// EmailDocument duplicate is just that, applied to every top-level
// module instead of one. Unlike createEmailDocumentFromTemplate below,
// this intentionally keeps the source's own start_type (a duplicate of a
// template is still a template; a duplicate of a normal email is still a
// normal email) — it is a literal copy, not a "start a new email from
// this" operation.
export async function duplicateEmailDocument(source: EmailDocument): Promise<EmailDocument> {
  const clonedModules = source.content.modules.map((module, index) => cloneModuleWithNewId(module, index));
  return createDocumentWithContentAndUniqueName(
    `Copy of ${source.name}`,
    { platform: source.platform, width: source.width, start_type: source.start_type },
    { content: { version: source.content.version, modules: clonedModules } },
  );
}

// Feature 13 — Export/Deploy operation 6, "Save as template". Reuses the
// existing EmailStartType.TEMPLATE choice (already modeled on the backend
// for Feature 02's setup wizard "start from a template" option — this is
// simply the first feature that ever writes it) rather than introducing a
// separate Template model; a saved template is just an EmailDocument like
// any other, distinguished only by start_type, so "My Emails"/Templates
// already lists it and no new list/detail endpoint is needed. Same
// fresh-id cloning as duplicate — the template must not share module ids
// with the email it was saved from. `templateName` is currently always
// auto-generated by its sole caller (ExportDeployDialog's one-click "Save
// as Template" button, `${document.name} (Template)`, no text input) —
// see createDocumentWithContentAndUniqueName's comment for why that makes
// silent-suffix-on-collision the correct behavior here too.
export async function saveEmailAsTemplate(source: EmailDocument, templateName: string): Promise<EmailDocument> {
  const clonedModules = source.content.modules.map((module, index) => cloneModuleWithNewId(module, index));
  return createDocumentWithContentAndUniqueName(
    templateName,
    { platform: source.platform, width: source.width, start_type: 'template' },
    { content: { version: source.content.version, modules: clonedModules } },
  );
}

// Phase B (Template Experience) — "create from template": Dashboard
// "Choose Template", Create Email's "Template" start type, and the
// Templates page's "Use this template" row action all funnel here. The
// source template is only ever read, never written — createDocumentWithContent
// always creates a brand-new row and patches THAT row's id, so the
// source's own row (content, name, timestamps, everything) is untouched.
//
// Field-copy matrix (every EmailDocument field, decided explicitly):
//   COPIED — part of the template's reusable design/configuration:
//     platform, width, content/modules (fresh ids via cloneModuleWithNewId,
//     same as duplicateEmailDocument/saveEmailAsTemplate above),
//     email_title, email_subject, favicon_url, reset_css_enabled,
//     custom_css_enabled, custom_css.
//   NOT COPIED — identity/lifecycle fields, or fields that must reflect
//   the NEW document rather than the source:
//     id, created_at, updated_at, status — always server-assigned/fresh.
//     name — the caller supplies a new, unique (per backend constraint)
//       name; never derived from the source without the user choosing it.
//     start_type — hardcoded 'blank' here, deliberately NOT copied from
//       the source (which is always 'template'): the destination is a
//       normal email, not another template, so it must not appear in the
//       Templates list itself.
export async function createEmailDocumentFromTemplate(source: EmailDocument, name: string): Promise<EmailDocument> {
  const clonedModules = source.content.modules.map((module, index) => cloneModuleWithNewId(module, index));
  return createDocumentWithContent(
    { name, platform: source.platform, width: source.width, start_type: 'blank' },
    {
      content: { version: source.content.version, modules: clonedModules },
      email_title: source.email_title,
      email_subject: source.email_subject,
      favicon_url: source.favicon_url,
      reset_css_enabled: source.reset_css_enabled,
      custom_css_enabled: source.custom_css_enabled,
      custom_css: source.custom_css,
    },
  );
}

// Phase C (Import HTML) — Dashboard "Import HTML" and Create Email's
// "Template" start type both hand off to the shared ImportHtmlPage,
// which parses/sanitizes/maps the pasted or uploaded HTML entirely
// client-side (htmlImportParser.ts/htmlImportSanitize.ts/
// htmlImportMapper.ts — no network activity during that step) and only
// reaches the network here, exactly like createEmailDocumentFromTemplate
// above: create with a user-typed, uniqueness-checked name, then PATCH
// the mapped content in — same createDocumentWithContent rollback path,
// same start_type='html' (the enum value that already existed for
// exactly this), same "name is user-typed, never silently suffixed"
// rule (a collision surfaces as a real field error, it is not retried).
export async function createEmailDocumentFromImportedHtml(
  name: string, platform: EmailPlatform, width: number, modules: EmailModule[], emailTitle: string,
): Promise<EmailDocument> {
  return createDocumentWithContent(
    { name, platform, width, start_type: 'html' },
    {
      content: { version: 1, modules },
      ...(emailTitle ? { email_title: emailTitle } : {}),
    },
  );
}
