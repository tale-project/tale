// @vitest-environment node

/**
 * The one document-text reader behind both `rag_fetch` doors. What is pinned:
 * the source order (corpus → inline row → the text a read checked and kept),
 * that the on-demand lane runs only for a ref the live-truth filter
 * admitted, that it asks for the read of a file nothing has read and waits
 * a bounded while for a read still running, that a denied ref and an
 * unknown ref answer the SAME miss with no filename, and that every other
 * miss states the file's true indexing state and names it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KnowledgeAccessScope } from '../../../lib/knowledge/types';
import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const fetchDocumentByFileIdMock = vi.fn();
vi.mock('./fetch', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    fetchDocumentByFileId: (...args: unknown[]) =>
      fetchDocumentByFileIdMock(...args),
  };
});

const ROW_FN = 'documents/internal_queries:findDocumentByFileId';
const FILTER_FN = 'documents/internal_queries:filterRetrievableRagFileIds';
const ON_DEMAND_FN = 'file_metadata/internal_queries:readTextOnDemandForAgent';
const REQUEST_FN = 'file_metadata/internal_mutations:requestTextRead';

const ACCESS: KnowledgeAccessScope = {
  teamIds: ['org_org_1'],
  projectIds: ['project_1'],
  includeHub: true,
  userId: 'user_1',
};

type Reads = Record<string, (args: Record<string, unknown>) => unknown>;

function createCtx(reads: Reads) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const run = vi.fn((ref: unknown, args: unknown) => {
    const name = functionRefName(ref);
    const queryArgs = args as Record<string, unknown>;
    calls.push({ name, args: queryArgs });
    const handler = reads[name];
    if (!handler) {
      return Promise.reject(new Error(`unexpected call in test: ${name}`));
    }
    return Promise.resolve(handler(queryArgs));
  });
  return { ctx: { runQuery: run, runMutation: run } as never, calls };
}

async function read(reads: Reads, fileId = 's3:acme/lead-verify.txt') {
  const { readDocumentText } = await import('./document_text');
  const { ctx, calls } = createCtx(reads);
  const result = await readDocumentText(ctx, {
    organizationId: 'org_1',
    orgSlug: 'acme',
    fileId,
    access: ACCESS,
  });
  return { result, calls };
}

const corpusDoc = {
  fileId: 's3:acme/lead-verify.txt',
  filename: 'lead-verify.txt',
  folderPath: null,
  modifiedAt: null,
  text: 'indexed text',
  conversationId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchDocumentByFileIdMock.mockResolvedValue(null);
});

describe('readDocumentText — the source order', () => {
  it('serves the corpus text first and reads nothing else', async () => {
    fetchDocumentByFileIdMock.mockResolvedValueOnce(corpusDoc);
    const { result, calls } = await read({});
    expect(result).toEqual({
      status: 'ok',
      text: 'indexed text',
      filename: 'lead-verify.txt',
      conversationId: null,
      source: 'corpus',
    });
    expect(calls).toEqual([]);
  });

  it('serves a visible row’s inline content when the corpus has no text', async () => {
    const { result, calls } = await read({
      [ROW_FN]: () => ({
        title: 'Note',
        content: 'inline body',
        projectId: null,
        teamId: null,
        teamTags: [],
      }),
    });
    expect(result).toMatchObject({
      status: 'ok',
      text: 'inline body',
      filename: 'Note',
      source: 'inline',
    });
    // No admission call and no byte read for content the row already served.
    expect(calls.map((c) => c.name)).toEqual([ROW_FN]);
  });

  it('never serves inline content of a row outside the caller’s scope', async () => {
    const { result } = await read({
      [ROW_FN]: () => ({
        title: 'Other project plan',
        content: 'private',
        projectId: 'project_OTHER',
        teamId: null,
        teamTags: [],
      }),
      [FILTER_FN]: () => [],
    });
    expect(result).toEqual({
      status: 'not_found',
      message: expect.stringContaining('No readable document'),
    });
    expect(JSON.stringify(result)).not.toContain('Other project plan');
  });

  it('serves the text a read kept once the live-truth filter admits the ref [CHAT-R48]', async () => {
    const { result, calls } = await read({
      [ROW_FN]: () => ({
        title: 'lead-verify.txt',
        content: null,
        projectId: 'project_1',
        teamId: null,
        teamTags: [],
      }),
      [FILTER_FN]: () => ['s3:acme/lead-verify.txt'],
      [ON_DEMAND_FN]: () => ({
        kind: 'text',
        filename: 'lead-verify.txt',
        text: 'checked text',
        indexing: { status: 'skipped' },
      }),
    });
    expect(result).toEqual({
      status: 'ok',
      text: 'checked text',
      filename: 'lead-verify.txt',
      conversationId: null,
      source: 'file',
    });
    // The admission check is the SAME wire shape the corpus fetch uses:
    // identity top-level, the sets under `access`.
    const filter = calls.find((c) => c.name === FILTER_FN);
    expect(filter?.args).toEqual({
      organizationId: 'org_1',
      fileIds: ['s3:acme/lead-verify.txt'],
      userId: 'user_1',
      access: {
        teamIds: ['org_org_1'],
        projectIds: ['project_1'],
        includeHub: true,
      },
    });
    // And it is decided BEFORE the file row is read.
    expect(calls.map((c) => c.name).indexOf(FILTER_FN)).toBeLessThan(
      calls.map((c) => c.name).indexOf(ON_DEMAND_FN),
    );
  });
});

describe('readDocumentText — a read still to come', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const ADMITTED = {
    [ROW_FN]: () => null,
    [FILTER_FN]: () => ['s3:acme/lead-verify.txt'],
  };
  const PENDING = {
    kind: 'unreadable',
    filename: 'lead-verify.txt',
    sizeBytes: 42,
    indexing: { status: 'skipped' },
    heldByDocument: true,
    extractable: true,
    reason: 'pending',
  };
  const TEXT = {
    kind: 'text',
    filename: 'lead-verify.txt',
    text: 'checked text',
    indexing: { status: 'skipped' },
  };

  it('asks for the read of a file nothing has read, waits for it and serves it', async () => {
    vi.useFakeTimers();
    const answers = [
      { kind: 'unread', filename: 'lead-verify.txt', indexing: {} },
      PENDING,
      TEXT,
    ];
    const reading = read({
      ...ADMITTED,
      [ON_DEMAND_FN]: () => answers.shift(),
      [REQUEST_FN]: () => true,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const { result, calls } = await reading;
    expect(result).toMatchObject({
      status: 'ok',
      text: 'checked text',
      source: 'file',
    });
    // One ask, for the admitted ref — and after the admission.
    const asks = calls.filter((c) => c.name === REQUEST_FN);
    expect(asks).toEqual([
      {
        name: REQUEST_FN,
        args: { organizationId: 'org_1', storageId: 's3:acme/lead-verify.txt' },
      },
    ]);
    expect(calls.map((c) => c.name).indexOf(FILTER_FN)).toBeLessThan(
      calls.map((c) => c.name).indexOf(REQUEST_FN),
    );
  });

  it('waits for a read still running without asking again', async () => {
    vi.useFakeTimers();
    const answers = [PENDING, PENDING, TEXT];
    const reading = read({
      ...ADMITTED,
      [ON_DEMAND_FN]: () => answers.shift(),
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const { result, calls } = await reading;
    expect(result).toMatchObject({ status: 'ok', text: 'checked text' });
    expect(calls.some((c) => c.name === REQUEST_FN)).toBe(false);
  });

  it('says the file is still being read once the wait runs out', async () => {
    vi.useFakeTimers();
    const { READ_WAIT_MS } = await import('./document_text');
    const reading = read({ ...ADMITTED, [ON_DEMAND_FN]: () => PENDING });
    await vi.advanceTimersByTimeAsync(READ_WAIT_MS + 1_000);
    const { result } = await reading;
    expect(result).toMatchObject({
      status: 'not_found',
      filename: 'lead-verify.txt',
      message: expect.stringContaining(
        '"lead-verify.txt" is still being read. Fetch it again in a moment',
      ),
    });
  });

  it('says the file could not be read when no read can be asked for', async () => {
    const { result } = await read({
      ...ADMITTED,
      [ON_DEMAND_FN]: () => ({
        kind: 'unread',
        filename: 'lead-verify.txt',
        indexing: {},
      }),
      [REQUEST_FN]: () => false,
    });
    expect(result).toEqual({
      status: 'not_found',
      filename: 'lead-verify.txt',
      message:
        '"lead-verify.txt" could not be read. Say so instead of guessing at its contents.',
    });
  });
});

describe('readDocumentText — the honest miss', () => {
  it('answers a denied ref and an unknown ref with one identical miss, unnamed [KNOW-R3]', async () => {
    const denied = await read({
      [ROW_FN]: () => null,
      [FILTER_FN]: () => [],
    });
    const unknown = await read(
      {
        [ROW_FN]: () => null,
        [FILTER_FN]: () => [],
      },
      's3:acme/nothing-here.txt',
    );
    expect(denied.result).toEqual(unknown.result);
    expect(denied.result).not.toHaveProperty('filename');
    // A denied ref never reaches the file row: no name, no size, no state.
    expect(denied.calls.some((c) => c.name === ON_DEMAND_FN)).toBe(false);
  });

  /** The on-demand lane's answer for an admitted ref it could not serve. */
  function unreadable(over: Record<string, unknown>) {
    return {
      kind: 'unreadable',
      filename: 'scan.pdf',
      sizeBytes: 60 * 1024 * 1024,
      indexing: { status: 'queued' },
      heldByDocument: true,
      extractable: true,
      reason: 'too_large',
      ...over,
    };
  }

  async function missFor(over: Record<string, unknown>) {
    const filename = (over.filename as string | undefined) ?? 'scan.pdf';
    const { result } = await read(
      {
        [ROW_FN]: () => null,
        [FILTER_FN]: () => [`s3:acme/${filename}`],
        [ON_DEMAND_FN]: () => unreadable(over),
      },
      `s3:acme/${filename}`,
    );
    expect(result).toMatchObject({ status: 'not_found', filename });
    return result.status === 'not_found' ? result.message : '';
  }

  // A file too large to read before its index exists is read through that
  // index; the miss says where the index stands, by its true state.
  it.each([
    ['queued', { status: 'queued' }, /being indexed — try again shortly/],
    ['running', { status: 'running' }, /being indexed — try again shortly/],
    [
      'skipped',
      { status: 'skipped' },
      /Knowledge tab.*skipRagIndexing: false/s,
    ],
    ['pending', { status: 'pending' }, /Knowledge tab/],
    [
      'failed',
      { status: 'failed', error: 'Embedding provider refused' },
      /Indexing it failed \(Embedding provider refused\)\. Say so; it can be re-indexed/,
    ],
    ['completed', { status: 'completed' }, /Say so instead of guessing/],
  ])(
    'states the %s index of a document too large to read without it, and names the file',
    async (_state, indexing, pattern) => {
      const message = await missFor({ indexing });
      expect(message).toContain('"scan.pdf" is 60 MiB');
      expect(message).toContain('limit is 50 MiB');
      expect(message).toMatch(pattern);
    },
  );

  // A chat, task or email attachment is on no Knowledge tab and no Index now
  // reaches it: the miss states the fact and stops there, where it used to
  // tell the model to index the file from the project's Knowledge tab.
  it.each([
    ['skipped', { status: 'skipped' }],
    ['pending', { status: 'pending' }],
    ['failed', { status: 'failed', error: 'Embedding provider refused' }],
  ])(
    'names no index door for a %s attachment too large to read',
    async (_state, indexing) => {
      const message = await missFor({
        filename: 'minutes.docx',
        indexing,
        heldByDocument: false,
      });
      expect(message).toContain('Say so instead of guessing');
      expect(message).not.toContain('Knowledge tab');
      expect(message).not.toContain('Documents page');
      expect(message).not.toContain('skipRagIndexing');
    },
  );

  // An index run on a `.doc` or an image can only end `unsupported`, so the
  // miss stops at that fact — for a document too, which a person could
  // index, in every state whose miss would otherwise name an index door.
  it.each([
    ['a skipped document', 'minutes.doc', { status: 'skipped' }, true],
    ['a pending document', 'photo.png', { status: 'pending' }, true],
    ['a queued document', 'minutes.doc', { status: 'queued' }, true],
    [
      'a failed document',
      'scan.png',
      { status: 'failed', error: 'Indexing skipped (empty)' },
      true,
    ],
    ['a skipped attachment', 'bundle.zip', { status: 'skipped' }, false],
  ])(
    'names no index door for %s no extractor reads',
    async (_label, filename, indexing, heldByDocument) => {
      const message = await missFor({
        filename,
        indexing,
        heldByDocument,
        extractable: false,
        reason: 'binary',
      });
      expect(message).toContain(
        `"${filename}" is a file type indexing cannot read`,
      );
      expect(message).toContain('Say so instead of guessing');
      expect(message).not.toContain('Knowledge tab');
      expect(message).not.toContain('Documents page');
      expect(message).not.toContain('skipRagIndexing');
    },
  );

  it.each([
    ['no text', { reason: 'no_text' }, /holds no readable text/],
    [
      'a file that does not open',
      { reason: 'malformed' },
      /does not open as its file type/,
    ],
    [
      'a credential',
      { reason: 'refused', refusal: 'secret-detected' },
      /secret scan found what looks like a credential/,
    ],
    [
      'the PII policy',
      { reason: 'refused', refusal: 'pii-blocked' },
      /PII policy blocks its content/,
    ],
    [
      'a PII scan that could not run',
      { reason: 'refused', refusal: 'pii-scan-failed' },
      /PII policy could not scan it/,
    ],
  ])('says the file cannot be read for %s', async (_label, over, pattern) => {
    const message = await missFor(over);
    expect(message).toMatch(pattern);
    expect(message).toContain('Say so instead of guessing');
  });

  it('says a read that failed is left to the index, by the index’s state', async () => {
    const message = await missFor({ sizeBytes: 2048, reason: 'read_failed' });
    expect(message).toBe(
      '"scan.pdf" could not be read before it is indexed. It is being indexed — try again shortly, or say so.',
    );
  });

  it('names the text limit for a document whose text is too long to read without its index', async () => {
    const message = await missFor({
      sizeBytes: 2 * 1024 * 1024,
      reason: 'too_much_text',
    });
    expect(message).toContain('limit is 4 MiB of text');
    expect(message).toMatch(/being indexed — try again shortly/);
  });

  it('names the cap for a text file too large to read on demand', async () => {
    const message = await missFor({
      filename: 'dump.csv',
      sizeBytes: 9 * 1024 * 1024,
      indexing: { status: 'skipped' },
    });
    expect(message).toContain('9 MiB');
    expect(message).toContain('limit is 4 MiB');
    expect(message).toContain('skipRagIndexing: false');
  });

  it('names the cap and no index door for an attachment too large to read', async () => {
    const message = await missFor({
      filename: 'server.log',
      sizeBytes: 9 * 1024 * 1024,
      indexing: { status: 'pending' },
      heldByDocument: false,
    });
    expect(message).toContain('limit is 4 MiB');
    expect(message).toContain('Say so instead of guessing');
    expect(message).not.toContain('Knowledge tab');
  });

  it('says so when an admitted ref has no live file row behind it', async () => {
    const { result } = await read({
      [ROW_FN]: () => ({
        title: 'Orphan.txt',
        content: null,
        projectId: 'project_1',
        teamId: null,
        teamTags: [],
      }),
      [FILTER_FN]: () => ['s3:acme/lead-verify.txt'],
      [ON_DEMAND_FN]: () => null,
    });
    expect(result).toMatchObject({
      status: 'not_found',
      filename: 'Orphan.txt',
      message: expect.stringContaining('not on record'),
    });
  });
});

describe('readDocumentText — an email body', () => {
  const MSG_REF = 'msg:6f3c2a1e-8b7d-4e5f-9a0b-1c2d3e4f5a6b';

  it('serves the indexed body, marked as mail', async () => {
    fetchDocumentByFileIdMock.mockResolvedValueOnce({
      ...corpusDoc,
      fileId: MSG_REF,
      filename: 'Application: field sales agent',
      text: 'Applying for the field sales agent role.',
      conversationId: 'conv_1',
    });
    const { result, calls } = await read({}, MSG_REF);
    expect(result).toEqual({
      status: 'ok',
      text: 'Applying for the field sales agent role.',
      filename: 'Application: field sales agent',
      conversationId: 'conv_1',
      source: 'corpus',
    });
    expect(calls).toEqual([]);
  });

  it('answers one miss for an email the corpus cannot serve, and reads nothing else', async () => {
    // Denied, deleted, or refused by the secret scan: no document row and
    // no stored bytes to fall back to — and reading the message row would
    // serve the very text the indexer refused.
    const { result, calls } = await read({}, MSG_REF);
    expect(result).toEqual({
      status: 'not_found',
      message:
        'No readable email with that ref in this organization. Re-run ' +
        'rag_search and use a ref from its results.',
    });
    expect(calls).toEqual([]);
  });
});
