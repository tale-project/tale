// @vitest-environment node

/**
 * Indexing a file is the spend of whoever the file is for: its uploader,
 * else the creator of the document holding it, in that document's project
 * (or the project the file was added in). A usage limit that binds
 * them parks the file — `failed` with `usage_limit`, which the hourly pass
 * resumes — before a byte is read, or as soon as a request is refused
 * mid-way; it never fails the job into its retries.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  embedderForOrg,
  EmbeddingBudgetExceeded,
} from '../../core/knowledge/embedding.ts';
import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import { RAG_ERROR_USAGE_LIMIT } from '../../core/knowledge/rag_error_codes.ts';
import { s3GetObjectBytes } from '../../core/lib/storage/object_store.ts';
import { directCallBlocked } from '../governance/direct-calls.ts';
import { indexUploadedFile } from './service.ts';

vi.mock('../../core/knowledge/indexing.ts', () => ({
  indexWholeDocument: vi.fn(),
  markCorpusIndexingFailed: vi.fn(async () => undefined),
}));
vi.mock('../../core/knowledge/embedding.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/embedding.ts')
  >()),
  embedderForOrg: vi.fn(async () => ({ dimensions: 3 })),
}));
vi.mock('../../core/knowledge/connection.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/connection.ts')
  >()),
  readOrgEmbeddingConfig: vi.fn(async () => ({
    providerSlug: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 3,
  })),
}));
vi.mock('../../core/knowledge/pool.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/knowledge/pool.ts')>()),
  getKnowledgePoolForOrg: vi.fn(async () => ({})),
  resolveOrgUrl: vi.fn(async () => 'postgres://knowledge.example/acme'),
}));
vi.mock('../../core/knowledge/dimensions.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/dimensions.ts')
  >()),
  pinDimensions: vi.fn(async () => undefined),
}));
vi.mock('../../core/lib/storage/object_store.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/lib/storage/object_store.ts')
  >()),
  s3GetObjectBytes: vi.fn(async () => Buffer.from('Refund policy: 30 days.')),
}));
vi.mock('../../lib/object-store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/object-store.ts')>()),
  locateOrgObjectStore: vi.fn(async () => ({ bucket: 'tale-blobs' })),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx: vi.fn(),
}));
vi.mock('../governance/direct-calls.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../governance/direct-calls.ts')>()),
  directCallBlocked: vi.fn(async () => null),
}));

interface Query {
  text: string;
  values: unknown[];
}

/** Who acts in the organization: a member, never `workflow`. */
const MEMBERS = new Set(['drive-owner', 'user-1']);

/** The file being indexed, the document holding it (by default a synced
 * drive's), and the chat it names. */
function fakeSql(
  log: Query[],
  options: {
    file?: Record<string, unknown>;
    doc?: { createdBy: string | null; projectId: string | null } | null;
    thread?: { owner: string; projectId: string | null };
  } = {},
): Sql {
  const doc =
    options.doc === undefined
      ? { createdBy: 'drive-owner', projectId: 'p-1' }
      : options.doc;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    if (text.includes('FROM app.file_metadata WHERE id')) {
      return Promise.resolve([
        {
          organizationId: 'org-1',
          storageRef: 's3:org-1/blob-1',
          fileName: 'refunds.txt',
          contentType: 'text/plain',
          documentId: 'doc-1',
          skipRagIndexing: null,
          uploadedBy: null,
          projectId: null,
          threadId: null,
          ...options.file,
        },
      ]);
    }
    if (text.includes('AS "createdBy"')) {
      return Promise.resolve(doc === null ? [] : [doc]);
    }
    if (text.includes('FROM "member"')) {
      // organizationId, userId: only the people acting in the organization.
      const userId = values[1];
      return Promise.resolve(
        typeof userId === 'string' && MEMBERS.has(userId)
          ? [
              {
                id: `m-${userId}`,
                organizationId: 'org-1',
                userId,
                role: 'member',
              },
            ]
          : [],
      );
    }
    if (text.includes('FROM app.thread_metadata')) {
      // thread_id, org_id, the uploader: only the owner's chat answers.
      const thread = options.thread;
      return Promise.resolve(
        thread !== undefined && values[2] === thread.owner
          ? [{ projectId: thread.projectId }]
          : [],
      );
    }
    if (text.includes('FROM "organization"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    if (text.includes('AS "corpusLive"')) {
      return Promise.resolve([
        { ref: 's3:org-1/blob-1', corpusLive: true, blobLive: true },
      ]);
    }
    if (text.includes('UPDATE app.file_metadata')) {
      return Promise.resolve([{ orgId: 'org-1' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { unsafe: (t: string) => t }) as unknown as Sql;
}

/** The last `rag_status` write's bound values. */
const lastStatusWrite = (log: Query[]): unknown[] =>
  log.findLast((q) => q.text.includes('UPDATE app.file_metadata'))?.values ??
  [];

const CAP = {
  scope: 'project' as const,
  projectId: 'p-1',
  code: 'COST_LIMIT' as const,
  period: 'monthly' as const,
  used: 100,
  limit: 100,
  reason: 'x',
  resetsAt: Date.UTC(2026, 10, 1),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('indexUploadedFile at a usage limit', () => {
  it('books a synced file to its document’s creator and project [GOV-R14]', async () => {
    vi.mocked(indexWholeDocument).mockResolvedValue({ chunks: 1 } as never);
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log), 'file-1');

    expect(directCallBlocked).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      subject: {
        userId: 'drive-owner',
        agentSlug: '__embedding__',
        projectIds: ['p-1'],
      },
      // Asked as its first request will be: a cent and a chunk's tokens.
      worstCase: { cents: 1, tokens: 1_024 },
    });
    expect(embedderForOrg).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ meter: expect.any(Object) }),
    );
  });

  it.each([
    [
      'the project named when it was registered in a new chat',
      { projectId: 'p-new' },
      undefined,
      ['p-new'],
    ],
    [
      'the project of the uploader’s own chat',
      { threadId: 'thread-1' },
      { owner: 'user-1', projectId: 'p-chat' },
      ['p-chat'],
    ],
    [
      'no project for a chat the uploader does not own',
      { threadId: 'thread-1' },
      { owner: 'someone-else', projectId: 'p-chat' },
      undefined,
    ],
  ])(
    'indexes a chat attachment as its uploader’s spend, in %s [GOV-R14]',
    async (_label, file, thread, projectIds) => {
      vi.mocked(indexWholeDocument).mockResolvedValue({ chunks: 1 } as never);
      await indexUploadedFile(
        fakeSql([], {
          file: { documentId: null, uploadedBy: 'user-1', ...file },
          doc: null,
          ...(thread !== undefined ? { thread } : {}),
        }),
        'file-1',
      );

      expect(directCallBlocked).toHaveBeenCalledWith(expect.anything(), {
        organizationId: 'org-1',
        subject: {
          userId: 'user-1',
          agentSlug: '__embedding__',
          ...(projectIds !== undefined ? { projectIds } : {}),
        },
        worstCase: { cents: 1, tokens: 1_024 },
      });
    },
  );

  it('books a document an automation filed to automations, never to a person named “workflow”', async () => {
    vi.mocked(indexWholeDocument).mockResolvedValue({ chunks: 1 } as never);
    await indexUploadedFile(
      fakeSql([], {
        file: { uploadedBy: 'workflow' },
        doc: { createdBy: 'workflow', projectId: null },
      }),
      'file-1',
    );

    expect(directCallBlocked).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subject: { userId: '__automation__', agentSlug: '__embedding__' },
      }),
    );
  });

  it('parks the file before a byte is read when a limit binds its indexing [GOV-R4] [KNOW-R17]', async () => {
    vi.mocked(directCallBlocked).mockResolvedValueOnce(CAP);
    const log: Query[] = [];
    await indexUploadedFile(fakeSql(log), 'file-1');

    expect(s3GetObjectBytes).not.toHaveBeenCalled();
    expect(embedderForOrg).not.toHaveBeenCalled();
    const write = lastStatusWrite(log);
    expect(write).toContain('failed');
    expect(write).toContain(RAG_ERROR_USAGE_LIMIT);
    expect(
      write.some(
        (value) =>
          typeof value === 'string' &&
          value.endsWith(
            'Indexing resumes by itself once the limit allows it.',
          ),
      ),
    ).toBe(true);
  });

  it('parks the file when a request is refused mid-way, without failing the job', async () => {
    vi.mocked(indexWholeDocument).mockRejectedValueOnce(
      new EmbeddingBudgetExceeded('Usage limit reached.', CAP.resetsAt, CAP),
    );
    const log: Query[] = [];
    await expect(
      indexUploadedFile(fakeSql(log), 'file-1'),
    ).resolves.toBeUndefined();

    const write = lastStatusWrite(log);
    expect(write).toContain('failed');
    expect(write).toContain(RAG_ERROR_USAGE_LIMIT);
  });
});
