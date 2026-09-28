// @vitest-environment node

/**
 * The RAG status a controlled-record replacement leaves on its new file row.
 * A file no extractor reads used to be inserted as a bare `unsupported` — no
 * `rag_error_code`, no sentence — so REST `indexing.errorCode` was absent
 * (the contract promises it on every `unsupported`), the badge's dialog had
 * no reason to give, and the retry door refused with a generic sentence. It
 * now carries the state a sync import and the indexer write, through the
 * same helper. Driven through the real finalize door from an intent whose
 * bytes are already promoted, so no object-store call is made.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RAG_ERROR_UNSUPPORTED_TYPE } from '../../core/knowledge/rag_error_codes.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { finalizeReplacementUpload } from './replacement.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/rate-limit.ts')>()),
  checkOrganizationRateLimit: vi.fn(async () => undefined),
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  // No upload policy: the platform's own format allowlist still applies.
  readGovernancePolicyForOrg: vi.fn(async () => null),
}));
vi.mock('../../jobs/enqueue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jobs/enqueue.ts')>()),
  addJobInTx: vi.fn(),
}));

interface Statement {
  text: string;
  values: unknown[];
}

const auth = {
  organizationId: 'org-1',
  userId: 'user-1',
  role: 'admin',
  teamIds: [],
};

/**
 * One draft controlled record on `s3:acme/v1`, and an intent that replaces
 * it with `fileName` — attested as `contentType` and promoted to its final
 * key. The acquire step's lease claim is kept, so the bind reads it back.
 */
function database(fileName: string, contentType: string) {
  const statements: Statement[] = [];
  const now = Date.now();
  const intent: Record<string, unknown> = {
    id: 'intent-1',
    organizationId: 'org-1',
    orgSlug: 'acme',
    actorUserId: 'user-1',
    actorEmail: 'owner@acme.test',
    documentId: 'doc-1',
    expectedRecordState: 'draft',
    expectedVersion: 1,
    expectedFileId: 's3:acme/v1',
    fileName,
    clientContentType: contentType,
    lastModified: null,
    stagingRef: 's3:acme/staging',
    finalRef: 's3:acme/v2',
    state: 'promoted',
    uploadExpiresAt: now + 60_000,
    leaseId: null,
    leaseExpiresAt: null,
    verifiedContentType: contentType,
    contentHash: 'sha-v2',
    size: 2048,
    resultVersion: null,
    cleanupPending: true,
    cleanupDueAt: null,
    cleanupAttempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1);
  const doc = {
    id: 'doc-1',
    organizationId: 'org-1',
    title: `minutes.${extension}`,
    fileRef: 's3:acme/v1',
    mimeType: contentType,
    extension,
    sourceProvider: 'upload',
    externalItemId: null,
    contentHash: 'sha-v1',
    historyFiles: [],
    teamId: null,
    teamTags: [],
    projectId: null,
    createdBy: 'user-1',
    folderId: null,
    metadata: {},
    lifecycleStatus: null,
    record: { state: 'draft', version: 1, approvedVersions: [] },
    scannedPagesDetected: null,
    ocrApplied: null,
    sourceCreatedAt: null,
    sourceModifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$').replace(/\s+/g, ' ');
    statements.push({ text, values });
    if (text.includes('UPDATE app.document_replacement_uploads SET lease_id')) {
      intent.leaseId = values[0];
      intent.leaseExpiresAt = values[1];
      return Promise.resolve([{ id: 'intent-1' }]);
    }
    if (text.includes('FROM app.document_replacement_uploads')) {
      return Promise.resolve([{ ...intent }]);
    }
    if (text.includes('FROM app.documents')) {
      return Promise.resolve([doc]);
    }
    if (text.includes('INSERT INTO app.file_metadata')) {
      return Promise.resolve([{ id: 'file-2' }]);
    }
    if (text.includes('RETURNING fm.org_id')) {
      // The status lands before the swap moves the record onto the new
      // file; the replacement's own document hint follows it.
      return Promise.resolve([{ orgId: 'org-1', listed: false }]);
    }
    if (text.includes('UPDATE app.documents SET')) {
      return Promise.resolve([{ id: 'doc-1' }]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (t: string) => t,
    json: (v: unknown) => v,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const fileRowInsert = (statements: Statement[]): Statement | undefined =>
  statements.find((s) => s.text.includes('INSERT INTO app.file_metadata'));

const statusWrites = (statements: Statement[]): Statement[] =>
  statements.filter((s) => s.text.includes('UPDATE app.file_metadata'));

const indexJobs = () =>
  vi
    .mocked(addJobInTx)
    .mock.calls.filter(([, name]) => name === 'rag.index_file');

afterEach(() => {
  vi.clearAllMocks();
});

describe('finalizeReplacementUpload — the new file row’s RAG status', () => {
  // The upload allowlist's types no extractor reads: the only ones that can
  // reach this lane without being queued.
  it.each([
    ['minutes.doc', 'application/msword'],
    ['budget.xls', 'application/vnd.ms-excel'],
    ['deck.ppt', 'application/vnd.ms-powerpoint'],
    ['ledger.ac2', 'application/octet-stream'],
  ])(
    'lands a replaced %s on unsupported_type with the indexer’s sentence',
    async (fileName, contentType) => {
      const { sql, statements } = database(fileName, contentType);

      await expect(
        finalizeReplacementUpload(sql, auth, 'intent-1'),
      ).resolves.toEqual({ version: 1 });

      // Inserted with no status of its own — never the bare `unsupported`.
      expect(fileRowInsert(statements)?.values).not.toContain('unsupported');
      const writes = statusWrites(statements);
      expect(writes).toHaveLength(1);
      expect(writes[0]?.values).toEqual(
        expect.arrayContaining([
          'unsupported',
          `No text extractor exists for "${fileName}".`,
          RAG_ERROR_UNSUPPORTED_TYPE,
          'file-2',
        ]),
      );
      expect(indexJobs()).toEqual([]);
    },
  );

  it('still queues a replacement the indexer reads', async () => {
    const { sql, statements } = database(
      'minutes.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    await expect(
      finalizeReplacementUpload(sql, auth, 'intent-1'),
    ).resolves.toEqual({
      version: 1,
    });

    expect(fileRowInsert(statements)?.values).toContain('queued');
    expect(statusWrites(statements)).toEqual([]);
    expect(indexJobs()).toEqual([
      [
        expect.anything(),
        'rag.index_file',
        { fileId: 'file-2' },
        expect.anything(),
      ],
    ]);
  });

  // The sync and upload lanes keep a `.log` on its empty status (a Reindex
  // can index it). Here the upload allowlist refuses it first, so a `.log`
  // record is never made terminal either: no file row is written at all.
  it('refuses a `.log` before any file row or status is written', async () => {
    const { sql, statements } = database('server.log', 'text/plain');

    await expect(
      finalizeReplacementUpload(sql, auth, 'intent-1'),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });

    expect(fileRowInsert(statements)).toBeUndefined();
    expect(statusWrites(statements)).toEqual([]);
    expect(indexJobs()).toEqual([]);
  });
});
