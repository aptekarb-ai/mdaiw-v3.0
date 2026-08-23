import { describe, expect, it, vi } from 'vitest';
import { duplicateEmailDocument, saveEmailAsTemplate } from './duplicateEmailDocument';
import * as client from '../api/client';
import type { EmailDocument } from './types';

vi.mock('../api/client', () => ({
  createEmailDocument: vi.fn(),
  updateEmailDocument: vi.fn(),
  deleteEmailDocument: vi.fn(),
}));

function source(): EmailDocument {
  return {
    id: 1,
    name: 'Source Email',
    platform: 'sfmc',
    width: 650,
    start_type: 'blank',
    status: 'draft',
    content: {
      version: 1,
      modules: [
        { id: 'm-1', type: 'text', order: 0, props: { text: 'Hi' }, settings: {} as never },
        {
          id: 'layout-1',
          type: 'layout-2col-50-50',
          order: 1,
          props: { columnWidths: [50, 50] },
          settings: {} as never,
          columns: [
            { id: 'col-1', modules: [{ id: 'nested-1', type: 'button', order: 0, props: {}, settings: {} as never }], settings: {} as never },
            { id: 'col-2', modules: [], settings: {} as never },
          ],
        },
      ],
    },
    email_title: '',
    email_subject: '',
    favicon_url: '',
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
  };
}

describe('duplicateEmailDocument', () => {
  it('names the copy "Copy of <original name>" and carries platform/width/start_type', async () => {
    const created = { ...source(), id: 2, name: 'Copy of Source Email', content: { version: 1, modules: [] } };
    vi.mocked(client.createEmailDocument).mockResolvedValue(created);
    vi.mocked(client.updateEmailDocument).mockResolvedValue({ ...created, content: source().content });

    await duplicateEmailDocument(source());

    expect(client.createEmailDocument).toHaveBeenCalledWith({
      name: 'Copy of Source Email', platform: 'sfmc', width: 650, start_type: 'blank',
    });
  });

  it('regenerates every module id, including nested layout column/child ids', async () => {
    const created = { ...source(), id: 2, name: 'Copy of Source Email' };
    vi.mocked(client.createEmailDocument).mockResolvedValue(created);
    vi.mocked(client.updateEmailDocument).mockImplementation(async (_id, input) => ({ ...created, content: input.content! }));

    const result = await duplicateEmailDocument(source());

    const [topText, topLayout] = result.content.modules;
    expect(topText.id).not.toBe('m-1');
    expect(topLayout.id).not.toBe('layout-1');
    expect(topLayout.columns![0].id).not.toBe('col-1');
    expect(topLayout.columns![1].id).not.toBe('col-2');
    expect(topLayout.columns![0].modules[0].id).not.toBe('nested-1');
    // Structure/content is otherwise preserved.
    expect(topLayout.columns![0].modules[0].type).toBe('button');
    expect(topText.props).toEqual({ text: 'Hi' });
  });

  it('never mutates or re-saves the original source document', async () => {
    const original = source();
    const originalContentSnapshot = JSON.parse(JSON.stringify(original.content));
    const created = { ...original, id: 2, name: 'Copy of Source Email' };
    vi.mocked(client.createEmailDocument).mockResolvedValue(created);
    vi.mocked(client.updateEmailDocument).mockImplementation(async (_id, input) => ({ ...created, content: input.content! }));

    await duplicateEmailDocument(original);

    expect(client.updateEmailDocument).toHaveBeenCalledWith(2, expect.anything());
    expect(original.content).toEqual(originalContentSnapshot);
  });

  it('rolls back (deletes) the created row when the content patch fails', async () => {
    const created = { ...source(), id: 2, name: 'Copy of Source Email' };
    vi.mocked(client.createEmailDocument).mockResolvedValue(created);
    vi.mocked(client.updateEmailDocument).mockRejectedValue(new Error('patch failed'));
    vi.mocked(client.deleteEmailDocument).mockResolvedValue(undefined);

    await expect(duplicateEmailDocument(source())).rejects.toThrow('patch failed');

    expect(client.deleteEmailDocument).toHaveBeenCalledWith(2);
  });
});

describe('saveEmailAsTemplate', () => {
  it('creates a new document with start_type "template" and the given name', async () => {
    const created = { ...source(), id: 3, name: 'Summer Sale (Template)', start_type: 'template' as const };
    vi.mocked(client.createEmailDocument).mockResolvedValue(created);
    vi.mocked(client.updateEmailDocument).mockImplementation(async (_id, input) => ({ ...created, content: input.content! }));

    await saveEmailAsTemplate(source(), 'Summer Sale (Template)');

    expect(client.createEmailDocument).toHaveBeenCalledWith({
      name: 'Summer Sale (Template)', platform: 'sfmc', width: 650, start_type: 'template',
    });
  });

  it('regenerates every module id, same as duplicate', async () => {
    const created = { ...source(), id: 3, name: 'Template', start_type: 'template' as const };
    vi.mocked(client.createEmailDocument).mockResolvedValue(created);
    vi.mocked(client.updateEmailDocument).mockImplementation(async (_id, input) => ({ ...created, content: input.content! }));

    const result = await saveEmailAsTemplate(source(), 'Template');

    expect(result.content.modules[0].id).not.toBe('m-1');
    expect(result.content.modules[1].id).not.toBe('layout-1');
  });

  it('never mutates the original source document', async () => {
    const original = source();
    const originalContentSnapshot = JSON.parse(JSON.stringify(original.content));
    const created = { ...original, id: 3, name: 'Template', start_type: 'template' as const };
    vi.mocked(client.createEmailDocument).mockResolvedValue(created);
    vi.mocked(client.updateEmailDocument).mockImplementation(async (_id, input) => ({ ...created, content: input.content! }));

    await saveEmailAsTemplate(original, 'Template');

    expect(original.content).toEqual(originalContentSnapshot);
    expect(original.start_type).toBe('blank');
  });

  it('rolls back (deletes) the created row when the content patch fails', async () => {
    const created = { ...source(), id: 3, name: 'Template', start_type: 'template' as const };
    vi.mocked(client.createEmailDocument).mockResolvedValue(created);
    vi.mocked(client.updateEmailDocument).mockRejectedValue(new Error('patch failed'));
    vi.mocked(client.deleteEmailDocument).mockResolvedValue(undefined);

    await expect(saveEmailAsTemplate(source(), 'Template')).rejects.toThrow('patch failed');

    expect(client.deleteEmailDocument).toHaveBeenCalledWith(3);
  });
});
