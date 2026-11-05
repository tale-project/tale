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

  it('names a readable image, its stored type and size, and its ref, which its pixels do not carry [CHAT-R31] [CHAT-R49]', async () => {
    const ctx = createCtxShim({
      'file_metadata/internal_queries:filterStorageIdsReadable': async () => [
        'foreign',
      ],
      // The store's row, not the size the message part claims (1 byte).
      'file_metadata/internal_queries:getByStorageId': async () => ({
        fileName: 'photo.png',
        contentType: 'image/png',
        size: 910_746,
      }),
    });
    const message = await modelFacingUserMessage(ctx, 'org_1', 'reader', [
      parts[0],
      { ...parts[1], name: 'photo.png', mediaType: 'image/png' },
    ]);
    // A tool that starts from a file (generate_image's inputImages) takes it
    // by this ref; without it a model guessed "image1.jpg" (2026-10-27).
    expect(message.parts).toContainEqual({
      type: 'text',
      text: expect.stringContaining(
        '"photo.png" (image/png, 889.4 KB, 910,746 bytes; ref: foreign)',
      ),
    });
    expect(message.parts).toContainEqual(
      expect.objectContaining({ type: 'attachment', fileId: 'foreign' }),
    );
  });

  it('never names the ref of an image the reader may not read [CHAT-R31]', async () => {
    const ctx = createCtxShim({
      'file_metadata/internal_queries:filterStorageIdsReadable': async () => [],
    });
    const message = await modelFacingUserMessage(ctx, 'org_1', 'reader', [
      parts[0],
      { ...parts[1], name: 'photo.png', mediaType: 'image/png' },
    ]);
    expect(JSON.stringify(message)).not.toContain('foreign');
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

describe('what the model is told about an attached document [CHAT-R48]', () => {
  const pdfParts = [
    { type: 'text' as const, text: 'Summarize' },
    {
      type: 'attachment' as const,
      fileId: 's3:tale/acme/report',
      name: 'report.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 1,
    },
  ] as const;

  async function appendixFor(row: Record<string, unknown>): Promise<string> {
    const queue = vi.fn();
    const ctx = createCtxShim({
      'file_metadata/internal_queries:filterStorageIdsReadable': async () => [
        's3:tale/acme/report',
      ],
      'file_metadata/internal_queries:getByStorageId': async () => ({
        fileName: 'report.pdf',
        contentType: 'application/pdf',
        size: 24_359,
        ...row,
      }),
      'file_metadata/internal_mutations:queueRagIndexIfUnstarted': queue,
    });
    const message = await modelFacingUserMessage(
      ctx,
      'org_1',
      'reader',
      pdfParts,
    );
    expect(queue).not.toHaveBeenCalled();
    return message.parts
      .map((part) => ('text' in part ? part.text : ''))
      .join('\n');
  }

  const FETCH = 'read it with rag_fetch (ref: s3:tale/acme/report)';

  it.each([
    ['its index is complete', { ragStatus: 'completed' }],
    ['its read is ready', { textStatus: 'ready', ragStatus: 'queued' }],
    [
      'its read is ready and its index failed on the embedding server',
      {
        textStatus: 'ready',
        ragStatus: 'failed',
        ragErrorCode: 'embedding_upstream',
      },
    ],
    // A message waits for its documents' reads; a read still to come is a
    // file from before reads existed, read when it is fetched.
    [
      'its read is still to come',
      { textStatus: 'queued', ragStatus: 'queued' },
    ],
    [
      'it is from before reads existed',
      { ragStatus: 'failed', ragErrorCode: 'embedding_upstream' },
    ],
    // A scan that could not run at the index decided nothing; a read that
    // checked the text since has the word.
    [
      'a read checked it after its index could not scan it',
      {
        textStatus: 'ready',
        ragStatus: 'failed',
        ragErrorCode: 'pii_scan_failed',
      },
    ],
  ])('sends the model to rag_fetch when %s', async (_label, row) => {
    const text = await appendixFor(row);
    expect(text).toContain(FETCH);
    // Its stored type and size ride along [CHAT-R49].
    expect(text).toContain('"report.pdf" (application/pdf, 23.8 KB');
  });

  it.each([
    ['its read refused it', { textStatus: 'refused', ragStatus: 'queued' }],
    [
      'its index refused it',
      { ragStatus: 'failed', ragErrorCode: 'secret_detected' },
    ],
  ])(
    'gives no ref for a document the organization refused when %s',
    async (_label, row) => {
      const text = await appendixFor(row);
      expect(text).toContain('secret scan or PII policy refuses its content');
      expect(text).not.toContain('s3:tale/acme/report');
    },
  );

  it('says a document left to its index can be read once that index is built', async () => {
    const text = await appendixFor({
      textStatus: 'deferred',
      ragStatus: 'running',
    });
    expect(text).toContain('can be read only once its index is built');
    expect(text).not.toContain(FETCH);
  });

  it.each([
    [
      'its read found no text',
      { textStatus: 'unreadable', ragStatus: 'queued' },
    ],
    [
      'only its index could serve it, and the index failed',
      {
        textStatus: 'deferred',
        ragStatus: 'failed',
        ragErrorCode: 'embedding_upstream',
      },
    ],
    ['no extractor reads it', { ragStatus: 'unsupported' }],
  ])(
    'is honest that a document cannot be read when %s',
    async (_label, row) => {
      const text = await appendixFor(row);
      expect(text).toContain(
        'its content is not machine-readable in this chat',
      );
      expect(text).not.toContain(FETCH);
    },
  );
});
