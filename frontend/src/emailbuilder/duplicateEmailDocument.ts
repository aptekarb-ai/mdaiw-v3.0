import { createEmailDocument, deleteEmailDocument, updateEmailDocument } from '../api/client';
import { cloneModuleWithNewId } from './moduleFactory';
import type { EmailDocument } from './types';

// Dashboard "Duplicate" row action. No dedicated backend endpoint —
// composed from the two existing EmailDocument verbs (create, then a
// content-only patch), matching the "reuse existing endpoints, don't add
// a dashboard-only model" constraint. Module/column/nested-module ids are
// regenerated via the SAME cloneModuleWithNewId the canvas already uses
// to duplicate a module or a layout-with-children in place — a full
// EmailDocument duplicate is just that, applied to every top-level
// module instead of one.
export async function duplicateEmailDocument(source: EmailDocument): Promise<EmailDocument> {
  const created = await createEmailDocument({
    name: `Copy of ${source.name}`,
    platform: source.platform,
    width: source.width,
    start_type: source.start_type,
  });

  const clonedModules = source.content.modules.map((module, index) => cloneModuleWithNewId(module, index));

  // create() and this content patch are two separate requests (no
  // dedicated duplicate endpoint — see this file's top comment), so a
  // patch failure (e.g. the source document holds content that no longer
  // passes today's validation, such as an old data: URL now rejected by
  // sanitizeUrl) must not leave a silent empty "Copy of …" row behind.
  // Roll the created row back and surface the original error.
  try {
    return await updateEmailDocument(created.id, {
      content: { version: source.content.version, modules: clonedModules },
    });
  } catch (error) {
    await deleteEmailDocument(created.id).catch(() => {
      // Best-effort cleanup — if the delete itself fails there is nothing
      // more this call can safely do; the original error is what the
      // caller needs to see either way.
    });
    throw error;
  }
}
