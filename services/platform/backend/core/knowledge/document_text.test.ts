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
    'states the %s state of a binary file it cannot read, and names the file',
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
