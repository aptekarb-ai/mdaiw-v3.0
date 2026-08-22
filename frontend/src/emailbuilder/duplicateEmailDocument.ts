import { createEmailDocument, deleteEmailDocument, updateEmailDocument } from '../api/client';
import { cloneModuleWithNewId } from './moduleFactory';
import type { EmailDocumentContent } from './edm';
import type { CreateEmailDocumentInput, EmailDocument } from './types';

// Shared by duplicateEmailDocument (below) and Feature 13's
// saveEmailAsTemplate: both are "create a new EmailDocument row, then
// content-patch it" — no dedicated backend endpoint for either, same
// "reuse existing endpoints, don't add a feature-only model" constraint.
// A patch failure (e.g. the source content no longer passes today's
// validation) must not leave a silent empty row behind, so both callers
// get the same create-then-roll-back-on-failure behavior for free.
async function createDocumentWithContent(
  input: CreateEmailDocumentInput, content: EmailDocumentContent,
): Promise<EmailDocument> {
  const created = await createEmailDocument(input);
  try {
    return await updateEmailDocument(created.id, { content });
  } catch (error) {
    await deleteEmailDocument(created.id).catch(() => {
      // Best-effort cleanup — if the delete itself fails there is nothing
      // more this call can safely do; the original error is what the
      // caller needs to see either way.
    });
    throw error;
  }
}

// Dashboard "Duplicate" row action. Module/column/nested-module ids are
// regenerated via the SAME cloneModuleWithNewId the canvas already uses
// to duplicate a module or a layout-with-children in place — a full
// EmailDocument duplicate is just that, applied to every top-level
// module instead of one.
export async function duplicateEmailDocument(source: EmailDocument): Promise<EmailDocument> {
  const clonedModules = source.content.modules.map((module, index) => cloneModuleWithNewId(module, index));
  return createDocumentWithContent(
    { name: `Copy of ${source.name}`, platform: source.platform, width: source.width, start_type: source.start_type },
    { version: source.content.version, modules: clonedModules },
  );
}

// Feature 13 — Export/Deploy operation 6, "Save as template". Reuses the
// existing EmailStartType.TEMPLATE choice (already modeled on the backend
// for Feature 02's setup wizard "start from a template" option — this is
// simply the first feature that ever writes it) rather than introducing a
// separate Template model; a saved template is just an EmailDocument like
// any other, distinguished only by start_type, so "My Emails" already
// lists it and no new list/detail endpoint is needed. Same fresh-id
// cloning as duplicate — the template must not share module ids with the
// email it was saved from.
export async function saveEmailAsTemplate(source: EmailDocument, templateName: string): Promise<EmailDocument> {
  const clonedModules = source.content.modules.map((module, index) => cloneModuleWithNewId(module, index));
  return createDocumentWithContent(
    { name: templateName, platform: source.platform, width: source.width, start_type: 'template' },
    { version: source.content.version, modules: clonedModules },
  );
}
