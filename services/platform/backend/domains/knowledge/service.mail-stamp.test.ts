// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import { getKnowledgePoolForOrg } from '../../core/knowledge/pool.ts';
import {
  emailedAttachmentConversation,
  indexUploadedFile,
  reconcileMailAttachmentStamps,
} from './service.ts';

/**
 * An emailed attachment's corpus row carries the conversation it arrived on:
 * stamped by the indexer, and backfilled onto the rows indexed before it did.
 * The stamp is what keeps the row out of every door that does not wrap mail
 * (the corpus pre-filter) and what tells the chat tools to label and wrap it
 * as mail; the retrievable filter decides it from the file row either way.
 */

vi.mock('../../core/knowledge/indexing.ts', () => ({
  indexWholeDocument: vi.fn(),
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
  s3GetObjectBytes: vi.fn(async () =>
    Buffer.from('My CV: ten years in sales.'),
  ),
}));
vi.mock('../../lib/object-store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/object-store.ts')>()),
  locateOrgObjectStore: vi.fn(async () => ({ bucket: 'tale-blobs' })),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

interface Query {
  text: string;
  values: unknown[];
}

const REF = 's3:org-1/mail/cv.txt';

/** The app database: one file row, bound as the fixture says, alive. */
function fakeSql(
  log: Query[],
  file: { documentId: string | null; conversationId: string | null },
): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    if (text.includes('FROM app.file_metadata WHERE id')) {
      return Promise.resolve([
        {
          organizationId: 'org-1',
          storageRef: REF,
          fileName: 'cv.txt',
          contentType: 'text/plain',
          skipRagIndexing: null,
          ...file,
        },
      ]);
    }
    if (text.includes('FROM "organization"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    if (text.includes('AS "corpusLive"')) {
      return Promise.resolve([{ ref: REF, corpusLive: true, blobLive: true }]);
    }
    if (text.includes('FROM app.documents WHERE id')) {
      return Promise.resolve([
        {
          teamId: null,
          teamTags: ['team-a'],
          projectId: null,
          folderId: null,
          folderPath: null,
        },
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

const indexed = {
  fileId: REF,
  chunksWritten: 1,
  chunksTotal: 1,
  chunksStored: 1,
  partial: false,
};

beforeEach(() => {
  vi.mocked(indexWholeDocument).mockReset();
  vi.mocked(indexWholeDocument).mockResolvedValue(indexed);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

describe('indexUploadedFile — the conversation stamp', () => {
  it('stamps an emailed attachment with the conversation it arrived on', async () => {
    const log: Query[] = [];
    await indexUploadedFile(
      fakeSql(log, { documentId: null, conversationId: 'conv-1' }),
      'file-1',
    );
    expect(vi.mocked(indexWholeDocument).mock.calls[0]?.[0]).toMatchObject({
      fileId: REF,
      conversationId: 'conv-1',
      teamIds: null,
      projectId: null,
    });
  });

  it('indexes a file filed into a document as that document, under no conversation', async () => {
    const log: Query[] = [];
    await indexUploadedFile(
      fakeSql(log, { documentId: 'doc-1', conversationId: 'conv-1' }),
      'file-1',
    );
    expect(vi.mocked(indexWholeDocument).mock.calls[0]?.[0]).toMatchObject({
      conversationId: null,
      teamIds: ['team-a'],
    });
  });

  it('stamps no conversation on an ordinary upload', async () => {
    const log: Query[] = [];
    await indexUploadedFile(
      fakeSql(log, { documentId: null, conversationId: null }),
      'file-1',
    );
    expect(vi.mocked(indexWholeDocument).mock.calls[0]?.[0]).toMatchObject({
      conversationId: null,
    });
  });

  it('reads the binding with the file row it indexes', async () => {
    const log: Query[] = [];
    await indexUploadedFile(
      fakeSql(log, { documentId: null, conversationId: 'conv-1' }),
      'file-1',
    );
    const read = log.find((query) =>
      query.text.includes('FROM app.file_metadata WHERE id'),
    );
    expect(read?.text).toContain('conversation_id AS "conversationId"');
  });
});

describe('emailedAttachmentConversation', () => {
  it('is the bound conversation of an unbound file, and nothing else', () => {
    expect(
      emailedAttachmentConversation({
        documentId: null,
        conversationId: 'conv-1',
      }),
    ).toBe('conv-1');
    expect(
      emailedAttachmentConversation({
        documentId: 'doc-1',
        conversationId: 'conv-1',
      }),
    ).toBeNull();
    expect(emailedAttachmentConversation({ documentId: null })).toBeNull();
  });
});

describe('reconcileMailAttachmentStamps — the backfill', () => {
  interface AttachmentRow {
    id: string;
    storageRef: string;
    conversationId: string;
    /** Its conversation exists and is not marked spam; default yes. */
    conversationLive?: boolean;
  }

  /** The app side: attachment rows served a keyset page at a time. */
  function attachmentsSql(rows: AttachmentRow[], log: Query[]): Sql {
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$');
      log.push({ text, values });
      if (!text.includes('FROM app.file_metadata')) return Promise.resolve([]);
      const afterId = values[1];
      const limit = Number(values.at(-1));
      return Promise.resolve(
        rows
          .filter((row) => typeof afterId !== 'string' || row.id > afterId)
          .slice(0, limit)
          .map((row) => Object.assign({ conversationLive: true }, row)),
      );
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    return tag as unknown as Sql;
  }

  /** The corpus side: records each statement; an UPDATE answers the next
   * row count, a SELECT the refs of `held` it was asked about. */
  function corpusPool(corrected: number[], held: string[] = []) {
    const statements: { text: string; params: unknown[] }[] = [];
    const pool = {
      json: (value: unknown) => ({ json: value }),
      unsafe: (text: string, params: unknown[]) => {
        statements.push({ text, params });
        if (text.trimStart().startsWith('SELECT')) {
          const asked = params[1] as string[];
          return Promise.resolve(
            held
              .filter((ref) => asked.includes(ref))
              .map((ref) => ({ fileId: ref })),
          );
        }
        return Promise.resolve({ count: corrected.shift() ?? 0 });
      },
    };
    vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the pass uses only json and unsafe
      pool as unknown as Awaited<ReturnType<typeof getKnowledgePoolForOrg>>,
    );
    return statements;
  }

  /** `releaseCorpusRefs` as the reconcile hands it in: releases what it is
   * handed, recording each call. */
  function releaser(failing: string[] = []) {
    const calls: string[][] = [];
    const releaseCorpus = (refs: string[]) => {
      calls.push(refs);
      return Promise.resolve({
        released: refs.filter((ref) => !failing.includes(ref)),
        failures: refs
          .filter((ref) => failing.includes(ref))
          .map((ref) => ({ ref, stage: 'corpus' as const, message: 'down' })),
      });
    };
    return { calls, releaseCorpus };
  }

  const rows: AttachmentRow[] = [
    { id: 'f1', storageRef: 's3:org-1/a.pdf', conversationId: 'conv-1' },
    { id: 'f2', storageRef: 's3:org-1/b.pdf', conversationId: 'conv-1' },
    { id: 'f3', storageRef: 's3:org-1/c.pdf', conversationId: 'conv-2' },
  ];

  it('stamps every attachment row past the first page, and counts what changed', async () => {
    const log: Query[] = [];
    const statements = corpusPool([2, 0]);
    const { calls, releaseCorpus } = releaser();
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql(rows, log),
      { organizationId: 'org-1', orgSlug: 'acme', limit: 2, releaseCorpus },
    );
    expect(result).toEqual({
      scanned: 3,
      corrected: 2,
      released: 0,
      failures: 0,
    });
    expect(statements).toHaveLength(2);
    expect(statements.map((statement) => statement.params[1])).toEqual([
      {
        json: [
          { file_id: 's3:org-1/a.pdf', conversation_id: 'conv-1' },
          { file_id: 's3:org-1/b.pdf', conversation_id: 'conv-1' },
        ],
      },
      { json: [{ file_id: 's3:org-1/c.pdf', conversation_id: 'conv-2' }] },
    ]);
    for (const statement of statements) {
      expect(statement.params[0]).toBe('acme');
      expect(statement.text).toContain('d.org_slug = $1');
      // Only a row that lacks the stamp, or carries another, is written.
      expect(statement.text).toContain(
        'd.conversation_id IS DISTINCT FROM v.conversation_id',
      );
      // A stamp is not an edit of the attachment: its time stays.
      expect(statement.text).not.toContain('updated_at');
    }
    // Every conversation is live: nothing to release.
    expect(calls).toEqual([]);
  });

  it('walks only live attachments — unbound file rows bound to a conversation', async () => {
    const log: Query[] = [];
    corpusPool([]);
    await reconcileMailAttachmentStamps(attachmentsSql([], log), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      releaseCorpus: releaser().releaseCorpus,
    });
    const read = log[0];
    expect(read?.values[0]).toBe('org-1');
    expect(read?.text).toContain('fm.document_id IS NULL');
    expect(read?.text).toContain('fm.conversation_id IS NOT NULL');
    expect(read?.text).toContain("fm.lifecycle_status = 'active'");
    expect(read?.text).toContain('ORDER BY fm.id');
  });

  it('reads each attachment with its conversation, as corpus-liveness does', async () => {
    const log: Query[] = [];
    corpusPool([]);
    await reconcileMailAttachmentStamps(attachmentsSql([], log), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      releaseCorpus: releaser().releaseCorpus,
    });
    const read = log[0]?.text ?? '';
    expect(read).toContain('LEFT JOIN app.conversations c');
    expect(read).toContain('c.org_id = fm.org_id');
    expect(read).toContain(
      "(c.id IS NOT NULL AND c.status IS DISTINCT FROM 'spam')",
    );
  });

  it('leaves a ref an active document holds to the document', async () => {
    // Filed into a document, the ref indexes as that document; the scope
    // pass clears any conversation stamp it still carries, so stamping it
    // here would only flip it back and forth every night.
    const log: Query[] = [];
    corpusPool([]);
    await reconcileMailAttachmentStamps(attachmentsSql([], log), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      releaseCorpus: releaser().releaseCorpus,
    });
    const read = log[0]?.text ?? '';
    expect(read).toContain('NOT EXISTS');
    expect(read).toContain('d.file_ref = fm.storage_ref');
  });

  it('releases the corpus copy of an attachment whose conversation is gone or spam, and stamps only the live', async () => {
    // A conversation deleted or marked spam before its lane queued the
    // release: the blob walk restarts at its head each night and may never
    // reach these rows, so this pass — which visits every attachment — does.
    const statements = corpusPool([1], ['s3:org-1/b.pdf']);
    const { calls, releaseCorpus } = releaser();
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql(
        [
          rows[0] as AttachmentRow,
          { ...(rows[1] as AttachmentRow), conversationLive: false },
          { ...(rows[2] as AttachmentRow), conversationLive: false },
        ],
        [],
      ),
      { organizationId: 'org-1', orgSlug: 'acme', releaseCorpus },
    );
    // Only the live attachment is stamped.
    const update = statements.find((statement) =>
      statement.text.includes('UPDATE'),
    );
    expect(update?.params[1]).toEqual({
      json: [{ file_id: 's3:org-1/a.pdf', conversation_id: 'conv-1' }],
    });
    // The dead ones are looked up in the corpus, and only a ref it still
    // holds is released — c.pdf went on an earlier night.
    const lookup = statements.find((statement) =>
      statement.text.trimStart().startsWith('SELECT'),
    );
    expect(lookup?.params).toEqual([
      'acme',
      ['s3:org-1/b.pdf', 's3:org-1/c.pdf'],
    ]);
    expect(calls).toEqual([['s3:org-1/b.pdf']]);
    expect(result).toEqual({
      scanned: 3,
      corrected: 1,
      released: 1,
      failures: 0,
    });
  });

  it('counts a failed release, for the next night to retry', async () => {
    corpusPool([], ['s3:org-1/a.pdf']);
    const { releaseCorpus } = releaser(['s3:org-1/a.pdf']);
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql(
        [{ ...(rows[0] as AttachmentRow), conversationLive: false }],
        [],
      ),
      { organizationId: 'org-1', orgSlug: 'acme', releaseCorpus },
    );
    expect(result).toMatchObject({ released: 0, failures: 1 });
  });

  it('writes nothing to the corpus for an organization with no emailed attachment', async () => {
    const statements = corpusPool([]);
    const { calls, releaseCorpus } = releaser();
    const result = await reconcileMailAttachmentStamps(attachmentsSql([], []), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      releaseCorpus,
    });
    expect(result).toEqual({
      scanned: 0,
      corrected: 0,
      released: 0,
      failures: 0,
    });
    expect(statements).toEqual([]);
    expect(calls).toEqual([]);
  });
});
