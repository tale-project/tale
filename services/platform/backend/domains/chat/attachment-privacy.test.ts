// @vitest-environment node
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  modelFacingUserMessage,
  readableTurnAttachments,
  validateTurnAttachments,
} from '../../core/chat/turn_action.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { chatShimHandlers } from './shim.ts';

const { viewerForUser, resolveFileReadAccess } = vi.hoisted(() => ({
  viewerForUser: vi.fn(),
  resolveFileReadAccess: vi.fn(),
}));
vi.mock('../files/access.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../files/access.ts')>()),
  viewerForUser,
  resolveFileReadAccess,
}));

const attachment = {
  fileId: 'foreign',
  fileName: 'secret.wav',
  fileType: 'audio/wav',
  fileSize: 1,
};
const parts = [
  { type: 'text' as const, text: 'Summarize' },
  {
    type: 'attachment' as const,
    fileId: attachment.fileId,
    name: attachment.fileName,
    mediaType: attachment.fileType,
    sizeBytes: 1,
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  viewerForUser.mockResolvedValue({
    organizationId: 'org_1',
    userId: 'reader',
    role: 'member',
    teamIds: [],
  });
  resolveFileReadAccess.mockResolvedValue(false);
});

describe('attachment model boundary', () => {
  it('drops a foreign audio ref from history before transcript lookup', async () => {
    const lookup = vi.fn().mockResolvedValue({
      transcriptionStatus: 'completed',
      transcript: 'PRIVATE_SENTINEL',
    });
    const ctx = createCtxShim({
      'file_metadata/internal_queries:filterStorageIdsReadable': async () => [],
      'file_metadata/internal_queries:getByStorageId': lookup,
    });
    const message = await modelFacingUserMessage(ctx, 'org_1', 'reader', parts);
    expect(message.parts).toEqual([{ type: 'text', text: 'Summarize' }]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('keeps readable audio and supplies the reader to metadata lookup', async () => {
    const lookup = vi.fn().mockResolvedValue({
      transcriptionStatus: 'completed',
      transcript: 'OWN_SENTINEL',
    });
    const ctx = createCtxShim({
      'file_metadata/internal_queries:filterStorageIdsReadable': async () => [
        'foreign',
      ],
      'file_metadata/internal_queries:getByStorageId': lookup,
    });
    expect(
      JSON.stringify(
        await modelFacingUserMessage(ctx, 'org_1', 'reader', parts),
      ),
    ).toContain('OWN_SENTINEL');
    expect(lookup).toHaveBeenCalledWith({
      organizationId: 'org_1',
      userId: 'reader',
      storageId: 'foreign',
    });
  });

  it('filters regenerated refs under the current reader and keeps the direct gate strict', async () => {
    const gate = vi.fn().mockResolvedValue([]);
    const ctx = createCtxShim({
      'file_metadata/internal_queries:filterStorageIdsReadable': gate,
    });
    expect(
      await readableTurnAttachments(ctx, 'org_1', 'reader', [attachment]),
    ).toEqual([]);
    expect(
      await validateTurnAttachments(ctx, 'org_1', 'reader', [attachment]),
    ).toContain('was not found');
    expect(gate).toHaveBeenCalledWith({
      organizationId: 'org_1',
      userId: 'reader',
      storageIds: ['foreign'],
    });
  });

  it('does not start indexing when readability is revoked between the history gate and metadata read', async () => {
    const queue = vi.fn();
    const ctx = createCtxShim({
      'file_metadata/internal_queries:filterStorageIdsReadable': async () => [
        'foreign',
      ],
      'file_metadata/internal_queries:getByStorageId': async () => null,
      'file_metadata/internal_mutations:queueRagIndexIfUnstarted': queue,
    });
    await modelFacingUserMessage(ctx, 'org_1', 'reader', [
      parts[0],
      { ...parts[1], mediaType: 'application/pdf' },
    ]);
    expect(queue).not.toHaveBeenCalled();
  });

  it('never queues indexing for an unreadable document in history', async () => {
    const queue = vi.fn();
    const ctx = createCtxShim({
      'file_metadata/internal_queries:filterStorageIdsReadable': async () => [],
      'file_metadata/internal_queries:getByStorageId': async () => null,
      'file_metadata/internal_mutations:queueRagIndexIfUnstarted': queue,
    });
    await modelFacingUserMessage(ctx, 'org_1', 'reader', [
      parts[0],
      { ...parts[1], mediaType: 'application/pdf' },
    ]);
    expect(queue).not.toHaveBeenCalled();
  });
});

describe('chat metadata reader', () => {
  const row = {
    id: 'f',
    organizationId: 'org_1',
    storageId: 'foreign',
    uploadedBy: 'other',
    documentId: null,
    threadId: null,
    conversationId: null,
    transcript: 'PRIVATE_SENTINEL',
    transcriptionStatus: 'completed',
  };
  function query() {
    const statements: Array<{ text: string; values: unknown[] }> = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({ text: strings.join('?'), values });
      return Promise.resolve([row]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this handler only uses the SQL tag
    const handler = chatShimHandlers(tag as unknown as Sql)[
      'file_metadata/internal_queries:getByStorageId'
    ];
    if (!handler) throw new Error('metadata handler missing');
    return { handler, statements };
  }
  it('refuses another uploader’s unbound transcript even in the same org', async () => {
    const { handler, statements } = query();
    expect(
      await handler({
        organizationId: 'org_1',
        userId: 'reader',
        storageId: 'foreign',
      }),
    ).toBeNull();
    expect(resolveFileReadAccess).toHaveBeenCalled();
    expect(statements[0]?.text).toContain('org_id =');
    expect(statements[0]?.text).toContain('lifecycle_status');
    expect(statements[0]?.values).toEqual(['org_1', 'foreign']);
  });
  it('admits a reader-approved file and refuses missing reader identity', async () => {
    const { handler, statements } = query();
    expect(await handler({ storageId: 'foreign' })).toBeNull();
    expect(statements).toEqual([]);
    resolveFileReadAccess.mockResolvedValue(true);
    expect(
      await handler({
        organizationId: 'org_1',
        userId: 'reader',
        storageId: 'foreign',
      }),
    ).toMatchObject({ transcript: 'PRIVATE_SENTINEL' });
  });
});
