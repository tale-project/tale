// @vitest-environment node

import type { Sql } from 'postgres';
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import { MESSAGE_REF_LIKE_PATTERN } from '../../../lib/knowledge/message-ref.ts';
import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import { getKnowledgePoolForOrg } from '../../core/knowledge/pool.ts';
import {
  emailedAttachmentConversation,
  indexUploadedFile,
  reconcileMailAttachmentStamps,
} from './service.ts';

/**
 * An emailed attachment's corpus row carries the conversation it arrived on:
 * stamped by the indexer, backfilled onto the rows indexed before it did,
 * and taken off a row that is no attachment any more. The stamp is what
 * keeps the row out of every door that does not wrap mail (the corpus
 * pre-filter) and what tells the chat tools to label and wrap it as mail;
 * the retrievable filter decides it from the file row either way.
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

/** An active document, as both the indexer and the stamp pass's walks read
 * one: the rule that sends a ref such a document holds to the document. */
const ACTIVE_DOCUMENT =
  "(d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')";

/** The indexer's read of an active document holding the file's ref. */
const isHolderRead = (query: Query) =>
  query.text.includes('d.team_tags AS "teamTags"');

/** A document's scope, as the indexer reads it. */
interface DocumentScope {
  teamTags: string[];
  projectId: string | null;
  folderId: string | null;
  folderPath: string | null;
}

/** The app database: one file row, bound as the fixture says, alive — and,
 * when `heldBy` says so, an active document holding the file's ref. */
function fakeSql(
  log: Query[],
  file: { documentId: string | null; conversationId: string | null },
  heldBy?: DocumentScope,
): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    if (isHolderRead({ text, values })) {
      return Promise.resolve(
        heldBy === undefined ? [] : [{ teamId: null, ...heldBy }],
      );
    }
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
  timeline.length = 0;
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

  it('indexes an attachment whose ref an active document holds as that document, under no conversation', async () => {
    // The corpus row is the ref's: stamped with the conversation, it would
    // hide the document from every document door until the nightly clear,
    // and under no scope it would blank the document's until the scope pass.
    const log: Query[] = [];
    await indexUploadedFile(
      fakeSql(
        log,
        { documentId: null, conversationId: 'conv-1' },
        {
          teamTags: ['team-h'],
          projectId: 'project-1',
          folderId: null,
          folderPath: 'Contracts',
        },
      ),
      'file-1',
    );
    expect(vi.mocked(indexWholeDocument).mock.calls[0]?.[0]).toMatchObject({
      fileId: REF,
      conversationId: null,
      teamIds: ['team-h'],
      projectId: 'project-1',
      folderPath: 'Contracts',
    });
    // The walks' rule: an active document with the ref as its file.
    const holder = log.find(isHolderRead);
    expect(holder?.values).toEqual(['org-1', REF]);
    expect(holder?.text).toContain('d.file_ref = $');
    expect(holder?.text).toContain(ACTIVE_DOCUMENT);
  });

  it('indexes a file filed into a document as its ref holder, when a lower-id twin holds the ref too', async () => {
    // A WebDAV COPY leaves two documents on one ref, and the file row stays
    // with the source. The corpus row is the ref's: indexed as the source
    // while the scope pass writes the lower-id twin's scope back, the row
    // would read as drift after every re-index.
    const log: Query[] = [];
    await indexUploadedFile(
      fakeSql(
        log,
        { documentId: 'doc-2', conversationId: null },
        {
          teamTags: ['team-twin'],
          projectId: null,
          folderId: null,
          folderPath: 'Copies',
        },
      ),
      'file-1',
    );
    expect(vi.mocked(indexWholeDocument).mock.calls[0]?.[0]).toMatchObject({
      conversationId: null,
      teamIds: ['team-twin'],
      folderPath: 'Copies',
    });
    // The holder is read first; the bound document only stands in for one.
    expect(log.filter(isHolderRead)).toHaveLength(1);
    expect(
      log.filter((query) => query.text.includes('FROM app.documents WHERE id')),
    ).toEqual([]);
  });

  it('indexes a filed file as the document it is filed in when no active document holds its ref', async () => {
    // Its own document trashed, say: nothing holds the ref as an active
    // document, and the file still indexes under the document it is filed in.
    const log: Query[] = [];
    await indexUploadedFile(
      fakeSql(log, { documentId: 'doc-1', conversationId: 'conv-1' }),
      'file-1',
    );
    expect(log.filter(isHolderRead)).toHaveLength(1);
    expect(
      log.find((query) => query.text.includes('FROM app.documents WHERE id'))
        ?.values,
    ).toEqual(['doc-1']);
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

  it('is no conversation for an unbound file whose ref an active document holds', () => {
    expect(
      emailedAttachmentConversation({
        documentId: null,
        conversationId: 'conv-1',
        heldByActiveDocument: true,
      }),
    ).toBeNull();
    expect(
      emailedAttachmentConversation({
        documentId: null,
        conversationId: 'conv-1',
        heldByActiveDocument: false,
      }),
    ).toBe('conv-1');
  });
});

/** One emailed attachment row, as the stamp pass's statement answers it. */
interface AttachmentRow {
  id: string;
  storageRef: string;
  conversationId: string;
  /** Its conversation exists and is not marked spam; default yes. */
  conversationLive?: boolean;
}

/** The value a statement binds right before the SQL that starts with
 * `next` — so a fake finds a parameter wherever the statement puts it. */
function boundBefore(
  strings: TemplateStringsArray,
  values: unknown[],
  next: string,
): unknown {
  const index = strings.findIndex(
    (part, at) => at > 0 && part.trimStart().startsWith(next),
  );
  return index > 0 ? values[index - 1] : undefined;
}

/** Both databases' statements in the order they ran, one label each —
 * `app …` or `corpus …` — so a test can tell which side held what when. */
const timeline: string[] = [];

/** The app side: the attachment rows, served as the one statement both
 * walks read asks — a keyset page, or the rows of given refs. A transaction
 * hands its callback a handle of its own, whose statements the timeline
 * labels `app tx …`: a read on it is the clear's backing recheck, and
 * `failRecheck` may fail the n-th of those; `failCommit` fails its COMMIT.
 * `hangRecheck` loses the n-th one's connection without a reset: its read
 * never answers, and nothing after it on that connection does either — its
 * transaction's end included. */
function attachmentsSql(
  rows: AttachmentRow[],
  log: Query[],
  options: {
    failRecheck?: (recheck: number) => Error | undefined;
    failCommit?: Error;
    hangRecheck?: (recheck: number) => boolean;
  } = {},
): Sql {
  let rechecks = 0;
  const on =
    (side: 'app' | 'app tx', connection = { gone: false }) =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$');
      log.push({ text, values });
      if (!text.includes('FROM app.file_metadata')) {
        timeline.push(`${side} ${text.trim()}`);
        return Promise.resolve([]);
      }
      timeline.push(`${side} read`);
      if (side === 'app tx') {
        const recheck = rechecks;
        rechecks += 1;
        if (options.hangRecheck?.(recheck) === true) {
          connection.gone = true;
          return new Promise<never>(() => undefined);
        }
        const failure = options.failRecheck?.(recheck);
        if (failure !== undefined) return Promise.reject(failure);
      }
      const afterId = boundBefore(strings, values, '::text IS NULL OR fm.id');
      const refs = boundBefore(strings, values, '::text[] IS NULL');
      const limit = values.at(-1);
      return Promise.resolve(
        rows
          .filter((row) => typeof afterId !== 'string' || row.id > afterId)
          .filter(
            (row) => !Array.isArray(refs) || refs.includes(row.storageRef),
          )
          .slice(0, typeof limit === 'number' ? limit : rows.length)
          .map((row) => Object.assign({ conversationLive: true }, row)),
      );
    };
  const begin = async <T>(
    callback: (atx: unknown) => Promise<T>,
  ): Promise<T> => {
    log.push({ text: 'BEGIN', values: [] });
    timeline.push('app BEGIN');
    const connection = { gone: false };
    const lost = new Promise<never>(() => undefined);
    let result: T;
    try {
      result = await callback(on('app tx', connection));
    } catch (error) {
      if (connection.gone) return lost;
      log.push({ text: 'ROLLBACK', values: [] });
      timeline.push('app ROLLBACK');
      throw error;
    }
    if (connection.gone) return lost;
    if (options.failCommit !== undefined) {
      timeline.push('app COMMIT failed');
      throw options.failCommit;
    }
    log.push({ text: 'COMMIT', values: [] });
    timeline.push('app COMMIT');
    return result;
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(on('app'), { begin }) as unknown as Sql;
}

/** A corpus row carrying a conversation stamp. */
interface StampedRow {
  fileId: string;
  conversationId: string;
}

interface Statement {
  text: string;
  params: unknown[];
}

/** The corpus side, recording each statement. The read of the stamps
 * answers `stamped` a keyset page at a time by ref; the lookup of dead refs,
 * the ones of `held` it was asked about; a stamp UPDATE, the next of
 * `corrected`; a clear, every row it was handed, as its `RETURNING` does —
 * after `onClear`, which stands for an app-side write that commits as the
 * clear lands. A transaction whose callback throws rolls back. */
function corpusPool(
  corpus: {
    corrected?: number[];
    held?: string[];
    stamped?: StampedRow[];
    onClear?: () => void;
  } = {},
): Statement[] {
  const corrected = [...(corpus.corrected ?? [])];
  const statements: Statement[] = [];
  const pool = {
    json: (value: unknown) => ({ json: value }),
    begin: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
      statements.push({ text: 'BEGIN', params: [] });
      timeline.push('corpus BEGIN');
      try {
        const result = await callback(pool);
        statements.push({ text: 'COMMIT', params: [] });
        timeline.push('corpus COMMIT');
        return result;
      } catch (error) {
        statements.push({ text: 'ROLLBACK', params: [] });
        timeline.push('corpus ROLLBACK');
        throw error;
      }
    },
    unsafe: (text: string, params: unknown[]) => {
      statements.push({ text, params });
      timeline.push(
        `corpus ${
          text.includes('SET conversation_id = NULL')
            ? 'clear'
            : text.includes('SET conversation_id = v.conversation_id')
              ? 'stamp'
              : 'read'
        }`,
      );
      if (text.includes('conversation_id IS NOT NULL')) {
        const afterRef = params[2];
        return Promise.resolve(
          (corpus.stamped ?? [])
            .filter(
              (row) => typeof afterRef !== 'string' || row.fileId > afterRef,
            )
            .slice(0, Number(params[3])),
        );
      }
      if (text.trimStart().startsWith('SELECT')) {
        const asked = params[1] as string[];
        return Promise.resolve(
          (corpus.held ?? [])
            .filter((ref) => asked.includes(ref))
            .map((ref) => ({ fileId: ref })),
        );
      }
      if (text.includes('SET conversation_id = NULL')) {
        corpus.onClear?.();
        const handed = params[1] as { json: { file_id: string }[] };
        return Promise.resolve(
          Object.assign(
            handed.json.map((row) => ({ fileId: row.file_id })),
            { count: handed.json.length },
          ),
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

/** The two releases the reconcile hands in — `releaseCorpus`
 * (`releaseCorpusRefs`, the first walk's) and `releaseUnbacked`
 * (`releaseRefs`, the second walk's) — each recording its own calls. Both
 * keep what `keep` names (something still holds it in the corpus), fail
 * what `failing` names, and release the rest. */
function releaser(options: { failing?: string[]; keep?: string[] } = {}) {
  const failing = options.failing ?? [];
  const keep = options.keep ?? [];
  const recorded = (calls: string[][]) => (refs: string[]) => {
    calls.push(refs);
    return Promise.resolve({
      released: refs.filter(
        (ref) => !failing.includes(ref) && !keep.includes(ref),
      ),
      kept: refs.filter((ref) => keep.includes(ref)),
      failures: refs
        .filter((ref) => failing.includes(ref))
        .map((ref) => ({ ref, stage: 'corpus' as const, message: 'down' })),
    });
  };
  const corpusCalls: string[][] = [];
  const unbackedCalls: string[][] = [];
  return {
    corpusCalls,
    unbackedCalls,
    releases: {
      releaseCorpus: recorded(corpusCalls),
      releaseUnbacked: recorded(unbackedCalls),
    },
  };
}

/** What the pass reports when it changed nothing. */
const QUIET = {
  scanned: 0,
  corrected: 0,
  released: 0,
  failures: 0,
  stampsScanned: 0,
  cleared: 0,
  restamped: 0,
  unbackedReleased: 0,
  unbackedFailures: 0,
  recheckReleased: 0,
  recheckFailures: 0,
};

const isStamp = (statement: Statement) =>
  statement.text.includes('SET conversation_id = v.conversation_id');
const isClear = (statement: Statement) =>
  statement.text.includes('SET conversation_id = NULL');
/** The app side's reads of attachment rows, its transactions aside. */
const attachmentReads = (log: Query[]) =>
  log.filter((query) => query.text.includes('FROM app.file_metadata'));

const rows: AttachmentRow[] = [
  { id: 'f1', storageRef: 's3:org-1/a.pdf', conversationId: 'conv-1' },
  { id: 'f2', storageRef: 's3:org-1/b.pdf', conversationId: 'conv-1' },
  { id: 'f3', storageRef: 's3:org-1/c.pdf', conversationId: 'conv-2' },
];

describe('reconcileMailAttachmentStamps — the backfill', () => {
  it('stamps every attachment row past the first page, and counts what changed', async () => {
    const log: Query[] = [];
    const statements = corpusPool({ corrected: [2, 0] });
    const { corpusCalls, unbackedCalls, releases } = releaser();
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql(rows, log),
      { organizationId: 'org-1', orgSlug: 'acme', limit: 2, ...releases },
    );
    expect(result).toEqual({ ...QUIET, scanned: 3, corrected: 2 });
    const stamps = statements.filter(isStamp);
    expect(stamps).toHaveLength(2);
    expect(stamps.map((statement) => statement.params[1])).toEqual([
      {
        json: [
          { file_id: 's3:org-1/a.pdf', conversation_id: 'conv-1' },
          { file_id: 's3:org-1/b.pdf', conversation_id: 'conv-1' },
        ],
      },
      { json: [{ file_id: 's3:org-1/c.pdf', conversation_id: 'conv-2' }] },
    ]);
    for (const statement of stamps) {
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
    expect(corpusCalls).toEqual([]);
    expect(unbackedCalls).toEqual([]);
  });

  it('walks only live attachments — unbound file rows bound to a conversation', async () => {
    const log: Query[] = [];
    corpusPool();
    await reconcileMailAttachmentStamps(attachmentsSql([], log), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      ...releaser().releases,
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
    corpusPool();
    await reconcileMailAttachmentStamps(attachmentsSql([], log), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      ...releaser().releases,
    });
    const read = log[0]?.text ?? '';
    expect(read).toContain('LEFT JOIN app.conversations c');
    expect(read).toContain('c.org_id = fm.org_id');
    expect(read).toContain(
      "(c.id IS NOT NULL AND c.status IS DISTINCT FROM 'spam')",
    );
  });

  it('leaves a ref an active document holds to the document', async () => {
    // Filed into a document, the ref indexes as that document, and the
    // second walk takes off any conversation stamp it still carries; stamping
    // it here would only flip it back and forth every night.
    const log: Query[] = [];
    corpusPool();
    await reconcileMailAttachmentStamps(attachmentsSql([], log), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      ...releaser().releases,
    });
    const read = log[0]?.text ?? '';
    expect(read).toContain('NOT EXISTS');
    expect(read).toContain('d.file_ref = fm.storage_ref');
    // The indexer's own rule for such a ref (`activeDocumentHoldingRef`).
    expect(read).toContain(ACTIVE_DOCUMENT);
  });

  it('releases the corpus copy of an attachment whose conversation is gone or spam, and stamps only the live', async () => {
    // A conversation deleted or marked spam before its lane queued the
    // release: the blob walk restarts at its head each night and may never
    // reach these rows, so this pass — which visits every attachment — does.
    const statements = corpusPool({
      corrected: [1],
      held: ['s3:org-1/b.pdf'],
    });
    const { corpusCalls, unbackedCalls, releases } = releaser();
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql(
        [
          rows[0] as AttachmentRow,
          { ...(rows[1] as AttachmentRow), conversationLive: false },
          { ...(rows[2] as AttachmentRow), conversationLive: false },
        ],
        [],
      ),
      { organizationId: 'org-1', orgSlug: 'acme', ...releases },
    );
    // Only the live attachment is stamped.
    expect(statements.find(isStamp)?.params[1]).toEqual({
      json: [{ file_id: 's3:org-1/a.pdf', conversation_id: 'conv-1' }],
    });
    // The dead ones are looked up in the corpus, and only a ref it still
    // holds is released — c.pdf went on an earlier night.
    const lookup = statements.find((statement) =>
      statement.text.includes('file_id = ANY($2::text[])'),
    );
    expect(lookup?.params).toEqual([
      'acme',
      ['s3:org-1/b.pdf', 's3:org-1/c.pdf'],
    ]);
    // Corpus-only: the file row keeps the bytes.
    expect(corpusCalls).toEqual([['s3:org-1/b.pdf']]);
    expect(unbackedCalls).toEqual([]);
    expect(result).toEqual({
      ...QUIET,
      scanned: 3,
      corrected: 1,
      released: 1,
    });
  });

  it('counts a failed release, for the next night to retry', async () => {
    corpusPool({ held: ['s3:org-1/a.pdf'] });
    const { releases } = releaser({ failing: ['s3:org-1/a.pdf'] });
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql(
        [{ ...(rows[0] as AttachmentRow), conversationLive: false }],
        [],
      ),
      { organizationId: 'org-1', orgSlug: 'acme', ...releases },
    );
    expect(result).toEqual({ ...QUIET, scanned: 1, failures: 1 });
  });

  it('writes nothing to the corpus for an organization with no emailed attachment and no stamp', async () => {
    const statements = corpusPool();
    const { corpusCalls, unbackedCalls, releases } = releaser();
    const result = await reconcileMailAttachmentStamps(attachmentsSql([], []), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      ...releases,
    });
    expect(result).toEqual(QUIET);
    // One read of the stamps, and not a single write.
    expect(
      statements.map((statement) => statement.text.trimStart().split(/\s/)[0]),
    ).toEqual(['SELECT']);
    expect(corpusCalls).toEqual([]);
    expect(unbackedCalls).toEqual([]);
  });
});

describe('reconcileMailAttachmentStamps — a stamp no attachment backs', () => {
  it('takes the stamp off a row no attachment backs any more, when something still keeps it', async () => {
    // filed.pdf was filed into a document after its stamp was written: the
    // document keeps the ref in the corpus, and the stamp hid it from every
    // document door. a.pdf is still an attachment and keeps its stamp.
    const log: Query[] = [];
    const statements = corpusPool({
      stamped: [
        { fileId: 's3:org-1/a.pdf', conversationId: 'conv-1' },
        { fileId: 's3:org-1/filed.pdf', conversationId: 'conv-1' },
      ],
    });
    const { corpusCalls, unbackedCalls, releases } = releaser({
      keep: ['s3:org-1/filed.pdf'],
    });
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql([rows[0] as AttachmentRow], log),
      { organizationId: 'org-1', orgSlug: 'acme', ...releases },
    );
    // Only the ref no attachment backs is judged, by the release that takes
    // bytes too; it keeps the ref, so its stamp comes off — and only the
    // stamp this walk read.
    expect(unbackedCalls).toEqual([['s3:org-1/filed.pdf']]);
    expect(corpusCalls).toEqual([]);
    const clearAt = statements.findIndex(isClear);
    const [clear, ...more] = statements.filter(isClear);
    expect(more).toEqual([]);
    expect(clear?.params).toEqual([
      'acme',
      { json: [{ file_id: 's3:org-1/filed.pdf', conversation_id: 'conv-1' }] },
    ]);
    expect(clear?.text).toContain('d.org_slug = $1');
    expect(clear?.text).toContain('d.conversation_id = v.conversation_id');
    // It answers the rows it cleared, for the backing to be read again.
    expect(clear?.text).toContain('RETURNING d.file_id');
    expect(attachmentReads(log).at(-1)?.values).toContainEqual([
      's3:org-1/filed.pdf',
    ]);
    // Still no attachment: the stamp stays off.
    expect(statements.slice(clearAt).filter(isStamp)).toEqual([]);
    // Taking a stamp off is no more an edit than putting one on.
    expect(clear?.text).not.toContain('updated_at');
    expect(result).toEqual({
      ...QUIET,
      scanned: 1,
      stampsScanned: 2,
      cleared: 1,
    });
  });

  it('puts a stamp back at once when its ref turned back into an attachment as the clear landed', async () => {
    // The document holding filed.pdf is deleted while the pass runs, and
    // the unbound file row it leaves is an emailed attachment again: the
    // stamp the clear takes off is right once more. The corpus has a
    // database of its own, so nothing can guard the clear with the app's
    // rows; the pass reads the backing again and stamps it back rather than
    // leaving a hub row until the next night.
    const attachments: AttachmentRow[] = [];
    const statements = corpusPool({
      stamped: [{ fileId: 's3:org-1/filed.pdf', conversationId: 'conv-1' }],
      onClear: () => {
        attachments.push({
          id: 'f9',
          storageRef: 's3:org-1/filed.pdf',
          conversationId: 'conv-1',
        });
      },
    });
    const { releases } = releaser({ keep: ['s3:org-1/filed.pdf'] });
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql(attachments, []),
      { organizationId: 'org-1', orgSlug: 'acme', ...releases },
    );
    const clearAt = statements.findIndex(isClear);
    expect(clearAt).toBeGreaterThanOrEqual(0);
    const [restamp, ...more] = statements.slice(clearAt).filter(isStamp);
    expect(more).toEqual([]);
    expect(restamp?.params).toEqual([
      'acme',
      { json: [{ file_id: 's3:org-1/filed.pdf', conversation_id: 'conv-1' }] },
    ]);
    // The first walk's statement: it writes only a row that lacks the stamp.
    expect(restamp?.text).toContain(
      'd.conversation_id IS DISTINCT FROM v.conversation_id',
    );
    // The stamp did not stay off: it counts as put back, not as cleared.
    expect(result).toEqual({ ...QUIET, stampsScanned: 1, restamped: 1 });
  });

  it.each([false, true])(
    'restores a dead attachment stamp before releasing it, including a failed release (%s)',
    async (fails) => {
      // A NULL stamp would offer the mail's contextual headers to ordinary
      // content-hash clones. Keep it isolated until its release succeeds.
      const attachments: AttachmentRow[] = [];
      const statements = corpusPool({
        stamped: [{ fileId: 's3:org-1/filed.pdf', conversationId: 'conv-1' }],
        onClear: () => {
          attachments.push({
            id: 'f9',
            storageRef: 's3:org-1/filed.pdf',
            conversationId: 'conv-1',
            conversationLive: false,
          });
        },
      });
      let calls = 0;
      const releaseUnbacked = vi.fn(async (refs: string[]) => {
        calls += 1;
        if (calls === 1) return { kept: refs, released: [], failures: [] };
        expect(statements.filter(isStamp)).toHaveLength(1);
        expect(statements.at(-1)?.text).toBe('COMMIT');
        return fails
          ? {
              kept: [],
              released: [],
              failures: refs.map((ref) => ({
                ref,
                stage: 'corpus' as const,
                message: 'down',
              })),
            }
          : { kept: [], released: refs, failures: [] };
      });
      const result = await reconcileMailAttachmentStamps(
        attachmentsSql(attachments, []),
        {
          organizationId: 'org-1',
          orgSlug: 'acme',
          ...releaser().releases,
          releaseUnbacked,
        },
      );
      expect(releaseUnbacked).toHaveBeenCalledTimes(2);
      expect(releaseUnbacked).toHaveBeenLastCalledWith(['s3:org-1/filed.pdf']);
      expect(statements.find(isStamp)?.params).toEqual([
        'acme',
        {
          json: [{ file_id: 's3:org-1/filed.pdf', conversation_id: 'conv-1' }],
        },
      ]);
      expect(
        statements.findIndex((statement) => statement.text === 'BEGIN'),
      ).toBeLessThan(statements.findIndex(isClear));
      // The recheck's release, apart from the walk's own: its stamp was
      // put back first.
      expect(result).toEqual({
        ...QUIET,
        stampsScanned: 1,
        restamped: 1,
        recheckReleased: fails ? 0 : 1,
        recheckFailures: fails ? 1 : 0,
      });
    },
  );

  it('releases a stamped row nothing keeps, and never un-stamps it', async () => {
    // Unstamped, a dead attachment would read as a hub row and be offered to
    // content-hash clones; it goes instead — with its bytes, when nothing
    // references them (`releaseUnbacked`).
    const statements = corpusPool({
      stamped: [{ fileId: 's3:org-1/gone.pdf', conversationId: 'conv-9' }],
    });
    const { corpusCalls, unbackedCalls, releases } = releaser();
    const result = await reconcileMailAttachmentStamps(attachmentsSql([], []), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      ...releases,
    });
    expect(unbackedCalls).toEqual([['s3:org-1/gone.pdf']]);
    expect(corpusCalls).toEqual([]);
    expect(statements.filter(isClear)).toEqual([]);
    // The second walk's release, apart from the first walk's counts.
    expect(result).toEqual({
      ...QUIET,
      stampsScanned: 1,
      unbackedReleased: 1,
    });
  });

  it('leaves the stamp on when the release failed, for the next night', async () => {
    const statements = corpusPool({
      stamped: [{ fileId: 's3:org-1/x.pdf', conversationId: 'conv-1' }],
    });
    const { releases } = releaser({ failing: ['s3:org-1/x.pdf'] });
    const result = await reconcileMailAttachmentStamps(attachmentsSql([], []), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      ...releases,
    });
    expect(statements.filter(isClear)).toEqual([]);
    expect(result).toEqual({
      ...QUIET,
      stampsScanned: 1,
      unbackedFailures: 1,
    });
  });

  it('leaves an attachment of a dead conversation to the first walk: one release, not two', async () => {
    const statements = corpusPool({
      held: ['s3:org-1/b.pdf'],
      stamped: [{ fileId: 's3:org-1/b.pdf', conversationId: 'conv-1' }],
    });
    const { corpusCalls, unbackedCalls, releases } = releaser();
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql(
        [{ ...(rows[1] as AttachmentRow), conversationLive: false }],
        [],
      ),
      { organizationId: 'org-1', orgSlug: 'acme', ...releases },
    );
    // Corpus-only: the file row still holds the bytes.
    expect(corpusCalls).toEqual([['s3:org-1/b.pdf']]);
    expect(unbackedCalls).toEqual([]);
    expect(statements.filter(isClear)).toEqual([]);
    expect(result).toEqual({
      ...QUIET,
      scanned: 1,
      released: 1,
      stampsScanned: 1,
    });
  });

  it('reads the stamps a keyset page at a time by ref, email bodies aside', async () => {
    const statements = corpusPool({
      stamped: [
        { fileId: 's3:org-1/a.pdf', conversationId: 'conv-1' },
        { fileId: 's3:org-1/b.pdf', conversationId: 'conv-1' },
        { fileId: 's3:org-1/c.pdf', conversationId: 'conv-2' },
      ],
    });
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql(rows, []),
      {
        organizationId: 'org-1',
        orgSlug: 'acme',
        limit: 2,
        ...releaser().releases,
      },
    );
    const reads = statements.filter((statement) =>
      statement.text.includes('conversation_id IS NOT NULL'),
    );
    // Two pages, the second after the first page's last ref; the short one
    // ends the walk.
    expect(reads.map((read) => read.params)).toEqual([
      ['acme', MESSAGE_REF_LIKE_PATTERN, null, 2],
      ['acme', MESSAGE_REF_LIKE_PATTERN, 's3:org-1/b.pdf', 2],
    ]);
    for (const read of reads) {
      expect(read.text).toContain('org_slug = $1');
      // A body's `msg:` ref is decided by its inbound email, never here.
      expect(read.text).toContain('file_id NOT LIKE $2');
      expect(read.text).toContain('file_id > $3');
      expect(read.text).toContain('ORDER BY file_id');
    }
    expect(result.stampsScanned).toBe(3);
  });

  it('judges what an attachment backs with the statement the stamping walk reads', async () => {
    const log: Query[] = [];
    corpusPool({
      stamped: [
        { fileId: 's3:org-1/a.pdf', conversationId: 'conv-1' },
        { fileId: 's3:org-1/filed.pdf', conversationId: 'conv-1' },
      ],
    });
    await reconcileMailAttachmentStamps(
      attachmentsSql([rows[0] as AttachmentRow], log),
      {
        organizationId: 'org-1',
        orgSlug: 'acme',
        ...releaser({ keep: ['s3:org-1/filed.pdf'] }).releases,
      },
    );
    const [page, byRef, again, ...rest] = attachmentReads(log);
    expect(rest).toEqual([]);
    // One rule for both walks, so a row the first stamps is never one the
    // second clears — and the same rule reads the backing again after the
    // clear.
    expect(byRef?.text).toBe(page?.text);
    expect(byRef?.values).toContainEqual([
      's3:org-1/a.pdf',
      's3:org-1/filed.pdf',
    ]);
    expect(again?.text).toBe(page?.text);
    expect(again?.values).toContainEqual(['s3:org-1/filed.pdf']);
  });
});

/** `count` corpus rows stamped with conv-1, in ref order. */
function stampedRows(count: number): StampedRow[] {
  return Array.from({ length: count }, (_, at) => ({
    fileId: `s3:org-1/f${String(at).padStart(3, '0')}.pdf`,
    conversationId: 'conv-1',
  }));
}

const timedOut = Object.assign(
  new Error('canceling statement due to statement timeout'),
  { code: '57014' },
);

const firstWord = (statement: Statement) =>
  statement.text.trimStart().split(/\s/)[0];

describe('reconcileMailAttachmentStamps — how long a clear holds its rows', () => {
  // The rows a clear takes the stamp off stay locked until its backing
  // recheck answers, and an indexer claiming one of those refs waits behind
  // them.

  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warn.mockClear();
  });

  it('clears at most a hundred stamps per corpus transaction', async () => {
    const stamped = stampedRows(250);
    const statements = corpusPool({ stamped });
    const log: Query[] = [];
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql([], log),
      {
        organizationId: 'org-1',
        orgSlug: 'acme',
        ...releaser({ keep: stamped.map((row) => row.fileId) }).releases,
      },
    );
    expect(
      statements
        .filter((statement) => ['BEGIN', 'COMMIT'].includes(statement.text))
        .map((statement) => statement.text),
    ).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
    expect(
      statements
        .filter(isClear)
        .map(
          (statement) =>
            (statement.params[1] as { json: unknown[] }).json.length,
        ),
    ).toEqual([100, 100, 50]);
    // Each recheck reads in an app transaction of its own, bounded.
    expect(
      log
        .filter(
          (query) =>
            query.text === 'BEGIN' ||
            query.text.includes('SET LOCAL statement_timeout'),
        )
        .map((query) => query.text),
    ).toEqual([
      'BEGIN',
      "SET LOCAL statement_timeout = '10s'",
      'BEGIN',
      "SET LOCAL statement_timeout = '10s'",
      'BEGIN',
      "SET LOCAL statement_timeout = '10s'",
    ]);
    expect(result).toEqual({ ...QUIET, stampsScanned: 250, cleared: 250 });
  });

  it('takes the app connection of its recheck, its statement timeout set, before it locks a corpus row', async () => {
    // A wait for a free app connection never counts against the lock: the
    // rows stay locked for the clear, one bounded read and the stamp put back.
    const attachments: AttachmentRow[] = [];
    corpusPool({
      stamped: [{ fileId: 's3:org-1/filed.pdf', conversationId: 'conv-1' }],
      onClear: () => {
        attachments.push({
          id: 'f9',
          storageRef: 's3:org-1/filed.pdf',
          conversationId: 'conv-1',
        });
      },
    });
    await reconcileMailAttachmentStamps(attachmentsSql(attachments, []), {
      organizationId: 'org-1',
      orgSlug: 'acme',
      ...releaser({ keep: ['s3:org-1/filed.pdf'] }).releases,
    });
    // Both the timeout and the recheck on the clear's own app transaction:
    // a read on the pool would wait for a second connection, rows locked.
    expect(timeline.slice(timeline.indexOf('app BEGIN'))).toEqual([
      'app BEGIN',
      "app tx SET LOCAL statement_timeout = '10s'",
      'corpus BEGIN',
      'corpus clear',
      'app tx read',
      'corpus stamp',
      'corpus COMMIT',
      'app COMMIT',
    ]);
  });

  it('rolls a clear back when its recheck times out: the stamps stay on and nothing counts as cleared', async () => {
    const statements = corpusPool({
      stamped: [{ fileId: 's3:org-1/filed.pdf', conversationId: 'conv-1' }],
    });
    const { unbackedCalls, releases } = releaser({
      keep: ['s3:org-1/filed.pdf'],
    });
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql([], [], { failRecheck: () => timedOut }),
      { organizationId: 'org-1', orgSlug: 'acme', ...releases },
    );
    // No COMMIT: the clear is undone, the stamp back on.
    expect(statements.map(firstWord)).toEqual([
      'SELECT',
      'BEGIN',
      'UPDATE',
      'ROLLBACK',
    ]);
    expect(timeline.slice(timeline.indexOf('app BEGIN'))).toEqual([
      'app BEGIN',
      "app tx SET LOCAL statement_timeout = '10s'",
      'corpus BEGIN',
      'corpus clear',
      'app tx read',
      'corpus ROLLBACK',
      'app ROLLBACK',
    ]);
    expect(result).toEqual({ ...QUIET, stampsScanned: 1 });
    // Only the walk's own release ran; the recheck released nothing.
    expect(unbackedCalls).toEqual([['s3:org-1/filed.pdf']]);
    expect(warn.mock.calls).toEqual([
      [
        '[knowledge] stale conversation stamps for acme: a clear did not finish (rows=1), the next night retries it:',
        timedOut,
      ],
    ]);
  });

  it('counts a clear whose corpus side committed when only its app transaction failed to end', async () => {
    // That transaction only read: nothing it could undo is left undone, so
    // the clear stands — the dead attachment it found is released, and the
    // counts say what was committed.
    const attachments: AttachmentRow[] = [];
    corpusPool({
      stamped: [{ fileId: 's3:org-1/filed.pdf', conversationId: 'conv-1' }],
      onClear: () => {
        attachments.push({
          id: 'f9',
          storageRef: 's3:org-1/filed.pdf',
          conversationId: 'conv-1',
          conversationLive: false,
        });
      },
    });
    const lost = new Error('Connection terminated');
    const releaseUnbacked = vi.fn(async (refs: string[]) =>
      releaseUnbacked.mock.calls.length === 1
        ? { kept: refs, released: [], failures: [] }
        : { kept: [], released: refs, failures: [] },
    );
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql(attachments, [], { failCommit: lost }),
      {
        organizationId: 'org-1',
        orgSlug: 'acme',
        ...releaser().releases,
        releaseUnbacked,
      },
    );
    expect(timeline.slice(timeline.indexOf('app BEGIN'))).toEqual([
      'app BEGIN',
      "app tx SET LOCAL statement_timeout = '10s'",
      'corpus BEGIN',
      'corpus clear',
      'app tx read',
      'corpus stamp',
      'corpus COMMIT',
      'app COMMIT failed',
    ]);
    expect(releaseUnbacked).toHaveBeenLastCalledWith(['s3:org-1/filed.pdf']);
    expect(result).toEqual({
      ...QUIET,
      stampsScanned: 1,
      restamped: 1,
      recheckReleased: 1,
    });
    expect(warn.mock.calls).toEqual([
      [
        "[knowledge] stale conversation stamps for acme: a clear committed (rows=1), but its recheck's app transaction did not end cleanly:",
        lost,
      ],
    ]);
  });

  it('rolls a clear back when its recheck never answers, and goes on with the next clear', async () => {
    // A half-open app connection (its peer gone without a reset) never
    // delivers the server's statement timeout. Without a bound of its own,
    // the clear held its corpus rows until TCP gave up, minutes later, and
    // every indexer and release on those refs waited behind them.
    vi.useFakeTimers();
    try {
      const stamped = stampedRows(150);
      const statements = corpusPool({ stamped });
      const pass = reconcileMailAttachmentStamps(
        attachmentsSql([], [], { hangRecheck: (recheck) => recheck === 0 }),
        {
          organizationId: 'org-1',
          orgSlug: 'acme',
          ...releaser({ keep: stamped.map((row) => row.fileId) }).releases,
        },
      );
      const ends = () =>
        statements
          .map(firstWord)
          .filter((word) =>
            ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(word ?? ''),
          );
      // A sound connection's own timeout would have answered by now; this
      // one still holds the rows.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(ends()).toEqual(['BEGIN']);
      // The bound lapses: the corpus side rolls back, its stamps still on.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ends()).toEqual(['BEGIN', 'ROLLBACK']);
      // Its app transaction never ends: the pass waits for that only so
      // long, then goes on with the next clear, and only that one counts.
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pass;
      expect(ends()).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT']);
      expect(result).toEqual({ ...QUIET, stampsScanned: 150, cleared: 50 });
      expect(
        timeline.filter((entry) =>
          ['app ROLLBACK', 'app COMMIT'].includes(entry),
        ),
      ).toEqual(['app COMMIT']);
      expect(warn.mock.calls).toEqual([
        [
          '[knowledge] stale conversation stamps for acme: a clear did not finish (rows=100), the next night retries it:',
          new Error('the recheck did not answer within 15000 ms'),
        ],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes on with the next clear after one that did not finish', async () => {
    const stamped = stampedRows(150);
    const statements = corpusPool({ stamped });
    const result = await reconcileMailAttachmentStamps(
      attachmentsSql([], [], {
        failRecheck: (recheck) => (recheck === 0 ? timedOut : undefined),
      }),
      {
        organizationId: 'org-1',
        orgSlug: 'acme',
        ...releaser({ keep: stamped.map((row) => row.fileId) }).releases,
      },
    );
    expect(
      statements
        .map(firstWord)
        .filter((word) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(word ?? '')),
    ).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT']);
    expect(result).toEqual({ ...QUIET, stampsScanned: 150, cleared: 50 });
  });
});
