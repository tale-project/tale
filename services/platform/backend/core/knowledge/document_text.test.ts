// @vitest-environment node

/**
 * The one document-text reader behind both `rag_fetch` doors. What is pinned:
 * the source order (corpus → inline row → bytes on demand), that the
 * on-demand lane runs only for a ref the live-truth filter admitted, that a
 * denied ref and an unknown ref answer the SAME miss with no filename, and
 * that every other miss states the file's true indexing state and names it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const ACCESS: KnowledgeAccessScope = {
  teamIds: ['org_org_1'],
  projectIds: ['project_1'],
  includeHub: true,
  userId: 'user_1',
};

type Reads = Record<string, (args: Record<string, unknown>) => unknown>;

function createCtx(reads: Reads) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const runQuery = vi.fn((ref: unknown, args: unknown) => {
    const name = functionRefName(ref);
    const queryArgs = args as Record<string, unknown>;
    calls.push({ name, args: queryArgs });
    const handler = reads[name];
    if (!handler) {
      return Promise.reject(new Error(`unexpected query in test: ${name}`));
    }
    return Promise.resolve(handler(queryArgs));
  });
  return { ctx: { runQuery } as never, calls };
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

  it('reads a text file on demand once the live-truth filter admits the ref', async () => {
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
        text: 'bytes decoded',
        indexing: { status: 'skipped' },
      }),
    });
    expect(result).toEqual({
      status: 'ok',
      text: 'bytes decoded',
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

describe('readDocumentText — the honest miss', () => {
  it('answers a denied ref and an unknown ref with one identical miss, unnamed', async () => {
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

  it.each([
    [
      'skipped',
      { status: 'skipped' },
      /uploaded without indexing.*Knowledge tab.*skipRagIndexing: false/s,
    ],
    ['pending', { status: 'pending' }, /uploaded without indexing/],
    ['queued', { status: 'queued' }, /queued for indexing/],
    ['running', { status: 'running' }, /being indexed right now/],
    [
      'failed',
      { status: 'failed', error: 'Embedding provider refused' },
      /Indexing "scan\.pdf" failed \(Embedding provider refused\)/,
    ],
    [
      'unsupported',
      { status: 'unsupported', error: 'No text extractor exists' },
      /no text extractor \(No text extractor exists\)/,
    ],
    [
      'completed',
      { status: 'completed' },
      /indexed but holds no readable text/,
    ],
  ])(
    'states the %s state of a binary document it cannot read, and names the file',
    async (_state, indexing, pattern) => {
      const { result } = await read(
        {
          [ROW_FN]: () => null,
          [FILTER_FN]: () => ['s3:acme/scan.pdf'],
          [ON_DEMAND_FN]: () => ({
            kind: 'unreadable',
            filename: 'scan.pdf',
            sizeBytes: 12_345,
            indexing,
            heldByDocument: true,
            extractable: true,
            reason: 'binary',
          }),
        },
        's3:acme/scan.pdf',
      );
      expect(result.status).toBe('not_found');
      expect(result).toMatchObject({ filename: 'scan.pdf' });
      expect(result.status === 'not_found' ? result.message : '').toMatch(
        pattern,
      );
    },
  );

  // A chat, task or email attachment is on no Knowledge tab and no Index now
  // reaches it: the miss states the fact and stops there, where it used to
  // tell the model to index the file from the project's Knowledge tab.
  it.each([
    ['skipped', { status: 'skipped' }, /attached without indexing/],
    ['pending', { status: 'pending' }, /attached without indexing/],
    [
      'failed',
      { status: 'failed', error: 'Embedding provider refused' },
      /Indexing "minutes\.docx" failed \(Embedding provider refused\)/,
    ],
    [
      'unsupported',
      {
        status: 'unsupported',
        error: 'The file does not parse as .docx.',
      },
      /no text extractor/,
    ],
  ])(
    'names no index door for a %s attachment',
    async (_state, indexing, pattern) => {
      const { result } = await read(
        {
          [ROW_FN]: () => null,
          [FILTER_FN]: () => ['s3:acme/minutes.docx'],
          [ON_DEMAND_FN]: () => ({
            kind: 'unreadable',
            filename: 'minutes.docx',
            sizeBytes: 12_345,
            indexing,
            heldByDocument: false,
            extractable: true,
            reason: 'binary',
          }),
        },
        's3:acme/minutes.docx',
      );
      expect(result).toMatchObject({
        status: 'not_found',
        filename: 'minutes.docx',
      });
      const message = result.status === 'not_found' ? result.message : '';
      expect(message).toMatch(pattern);
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
    [
      'a failed document',
      'scan.png',
      { status: 'failed', error: 'Indexing skipped (empty)' },
      true,
    ],
    ['a skipped attachment', 'bundle.zip', { status: 'skipped' }, false],
  ])(
    'names no index door for %s an index run could not read',
    async (_label, filename, indexing, heldByDocument) => {
      const { result } = await read(
        {
          [ROW_FN]: () => null,
          [FILTER_FN]: () => [`s3:acme/${filename}`],
          [ON_DEMAND_FN]: () => ({
            kind: 'unreadable',
            filename,
            sizeBytes: 12_345,
            indexing,
            heldByDocument,
            extractable: false,
            reason: 'binary',
          }),
        },
        `s3:acme/${filename}`,
      );
      expect(result).toMatchObject({ status: 'not_found', filename });
      const message = result.status === 'not_found' ? result.message : '';
      expect(message).toContain(
        `"${filename}" is a file type indexing cannot read`,
      );
      expect(message).toContain('Say so instead of guessing');
      expect(message).not.toContain('Knowledge tab');
      expect(message).not.toContain('Documents page');
      expect(message).not.toContain('skipRagIndexing');
    },
  );

  // Queued, running or terminal, the state is still the answer.
  it.each([
    ['queued', { status: 'queued' }, /queued for indexing/],
    [
      'unsupported',
      {
        status: 'unsupported',
        error: 'No text extractor exists for "minutes.doc".',
      },
      /no text extractor \(No text extractor exists for "minutes\.doc"\.\)/,
    ],
  ])(
    'still states the %s state of a file an index run could not read',
    async (_state, indexing, pattern) => {
      const { result } = await read(
        {
          [ROW_FN]: () => null,
          [FILTER_FN]: () => ['s3:acme/minutes.doc'],
          [ON_DEMAND_FN]: () => ({
            kind: 'unreadable',
            filename: 'minutes.doc',
            sizeBytes: 12_345,
            indexing,
            heldByDocument: true,
            extractable: false,
            reason: 'binary',
          }),
        },
        's3:acme/minutes.doc',
      );
      expect(result.status === 'not_found' ? result.message : '').toMatch(
        pattern,
      );
    },
  );

  it('names the cap for a text file too large to read on demand', async () => {
    const { result } = await read(
      {
        [ROW_FN]: () => null,
        [FILTER_FN]: () => ['s3:acme/dump.csv'],
        [ON_DEMAND_FN]: () => ({
          kind: 'unreadable',
          filename: 'dump.csv',
          sizeBytes: 9 * 1024 * 1024,
          indexing: { status: 'skipped' },
          heldByDocument: true,
          extractable: true,
          reason: 'too_large',
        }),
      },
      's3:acme/dump.csv',
    );
    expect(result).toMatchObject({ status: 'not_found', filename: 'dump.csv' });
    const message = result.status === 'not_found' ? result.message : '';
    expect(message).toContain('9 MiB');
    expect(message).toContain('limit is 4 MiB');
    expect(message).toContain('skipRagIndexing: false');
  });

  it('names the cap and no index door for an attachment too large to read', async () => {
    const { result } = await read(
      {
        [ROW_FN]: () => null,
        [FILTER_FN]: () => ['s3:acme/server.log'],
        [ON_DEMAND_FN]: () => ({
          kind: 'unreadable',
          filename: 'server.log',
          sizeBytes: 9 * 1024 * 1024,
          indexing: { status: 'pending' },
          heldByDocument: false,
          extractable: true,
          reason: 'too_large',
        }),
      },
      's3:acme/server.log',
    );
    const message = result.status === 'not_found' ? result.message : '';
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

describe('isOnDemandReadableName', () => {
  it('owns exactly the plain-text extractor’s extensions, case-insensitively', async () => {
    const { isOnDemandReadableName } = await import('./document_text');
    expect(isOnDemandReadableName('lead-verify.txt')).toBe(true);
    expect(isOnDemandReadableName('README.MD')).toBe(true);
    expect(isOnDemandReadableName('config.yaml')).toBe(true);
    expect(isOnDemandReadableName('scan.pdf')).toBe(false);
    expect(isOnDemandReadableName('deck.pptx')).toBe(false);
    expect(isOnDemandReadableName('noext')).toBe(false);
    expect(isOnDemandReadableName('.gitignore')).toBe(false);
    expect(isOnDemandReadableName('trailing.')).toBe(false);
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
