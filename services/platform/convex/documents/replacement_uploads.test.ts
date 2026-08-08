import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'documents';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

type T = TestConvex<typeof schema>;
const ORG = 'org_replacement_intents';
const SLUG = 'replacement-intents';
const AUTHOR = 'u_replacement_author';
const NONCE = '1337b449-187f-4d66-a05e-f53979c9ef4f';

function makeT(): T {
  return convexTest(schema, modules);
}

async function seedControlledDocument(
  t: T,
  state: 'draft' | 'in_review' | 'approved' = 'draft',
): Promise<{
  documentId: Id<'documents'>;
  currentFileId: Id<'_storage'>;
}> {
  return await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${AUTHOR}_${ORG}`,
      userId: AUTHOR,
      organizationId: ORG,
      role: 'editor',
      createdAt: 0,
    });
    const currentFileId = await ctx.storage.store(
      new Blob(['current bytes'], { type: 'text/plain' }),
    );
    const documentId = await ctx.db.insert('documents', {
      organizationId: ORG,
      title: 'controlled.txt',
      extension: 'txt',
      mimeType: 'text/plain',
      sourceProvider: 'upload',
      fileId: currentFileId,
      contentHash: 'a'.repeat(64),
      createdBy: AUTHOR,
      record: {
        state,
        version: 1,
        controlledAt: 0,
        controlledBy: AUTHOR,
        approvedVersions:
          state === 'approved'
            ? [
                {
                  version: 1,
                  fileId: currentFileId,
                  contentHash: 'a'.repeat(64),
                  approvedAt: 1,
                  approvedBy: AUTHOR,
                },
              ]
            : [],
      },
      historyFiles: state === 'approved' ? [currentFileId] : undefined,
    });
    return { documentId, currentFileId };
  });
}

async function createIntent(
  t: T,
  documentId: Id<'documents'>,
  currentFileId: Id<'_storage'>,
  expectedRecordState: 'draft' | 'approved' = 'draft',
): Promise<Id<'controlledDocumentReplacementUploads'>> {
  return await t.mutation(
    internal.documents.replacement_uploads
      .createControlledDocumentReplacementUploadIntent,
    {
      organizationId: ORG,
      orgSlug: SLUG,
      actorUserId: AUTHOR,
      actorEmail: 'author@example.test',
      documentId,
      expectedRecordState,
      expectedVersion: 1,
      expectedFileId: currentFileId,
      fileName: 'replacement.txt',
      clientContentType: 'text/plain',
      backend: 'convex',
      intentNonce: NONCE,
      uploadExpiresAt: Date.now() + 60_000,
    },
  );
}

async function storeCandidate(
  t: T,
  ownedByIntent: boolean,
): Promise<Id<'_storage'>> {
  return await t.run((ctx) =>
    ctx.storage.store(
      new Blob(['replacement bytes'], {
        type: ownedByIntent ? `text/plain; tale-intent=${NONCE}` : 'text/plain',
      }),
    ),
  );
}

describe('controlled replacement upload intents', () => {
  it('freezes an approved target only when its retained snapshot matches', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(
      t,
      'approved',
    );

    const intentId = await createIntent(
      t,
      documentId,
      currentFileId,
      'approved',
    );
    expect(await t.run((ctx) => ctx.db.get(intentId))).toMatchObject({
      expectedRecordState: 'approved',
      expectedVersion: 1,
      expectedFileId: currentFileId,
      state: 'issued',
    });

    await t.run(async (ctx) => {
      const document = await ctx.db.get(documentId);
      if (document?.record === undefined) throw new Error('record missing');
      await ctx.db.patch(documentId, {
        record: { ...document.record, approvedVersions: [] },
      });
    });
    await expect(
      createIntent(t, documentId, currentFileId, 'approved'),
    ).rejects.toThrow(/DOCUMENT_RECORD_APPROVED_SNAPSHOT_INVALID/);
  });

  it('refuses to begin replacement while the record is in review', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(
      t,
      'in_review',
    );

    await expect(createIntent(t, documentId, currentFileId)).rejects.toThrow(
      /DOCUMENT_RECORD_INVALID_STATE/,
    );
  });

  it('persists superseded before rejecting a stale finalize acquire', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(t);
    const intentId = await createIntent(t, documentId, currentFileId);
    await t.run(async (ctx) => {
      const document = await ctx.db.get(documentId);
      if (document?.record === undefined) throw new Error('record missing');
      await ctx.db.patch(documentId, {
        record: { ...document.record, state: 'in_review' },
      });
    });

    const result = await t.mutation(
      internal.documents.replacement_uploads
        .acquireControlledDocumentReplacementFinalize,
      {
        organizationId: ORG,
        actorUserId: AUTHOR,
        intentId,
        leaseId: 'lease-stale',
      },
    );
    expect(result).toEqual({
      phase: 'rejected',
      rejectionCode: 'DOCUMENT_RECORD_VERSION_MISMATCH',
    });
    const superseded = await t.run((ctx) => ctx.db.get(intentId));
    expect(superseded).toMatchObject({
      state: 'superseded',
      cleanupPending: true,
    });
    expect(superseded?.leaseId).toBeUndefined();
    expect(
      await t.mutation(
        internal.documents.replacement_uploads
          .acquireControlledDocumentReplacementFinalize,
        {
          organizationId: ORG,
          actorUserId: AUTHOR,
          intentId,
          leaseId: 'lease-replay',
        },
      ),
    ).toEqual({ phase: 'rejected', rejectionCode: 'superseded' });
  });

  it('rejects an arbitrary Convex ref that lacks the intent nonce', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(t);
    const intentId = await createIntent(t, documentId, currentFileId);
    const arbitraryRef = await storeCandidate(t, false);

    await expect(
      t.mutation(
        internal.documents.replacement_uploads
          .acquireControlledDocumentReplacementFinalize,
        {
          organizationId: ORG,
          actorUserId: AUTHOR,
          intentId,
          leaseId: 'lease-arbitrary',
          storageId: arbitraryRef,
        },
      ),
    ).rejects.toThrow(/not owned by this replacement intent/);

    const intent = await t.run((ctx) => ctx.db.get(intentId));
    expect(intent?.state).toBe('issued');
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) => q.eq('storageId', arbitraryRef))
          .first(),
      ),
    ).toBeNull();
  });

  it('rejects actor and organization mismatches before blob registration', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(t);
    const intentId = await createIntent(t, documentId, currentFileId);
    const storageId = await storeCandidate(t, true);

    for (const principal of [
      { organizationId: ORG, actorUserId: 'u_other' },
      { organizationId: 'org_other', actorUserId: AUTHOR },
    ]) {
      await expect(
        t.mutation(
          internal.documents.replacement_uploads
            .acquireControlledDocumentReplacementFinalize,
          {
            ...principal,
            intentId,
            leaseId: `lease-${principal.organizationId}`,
            storageId,
          },
        ),
      ).rejects.toThrow(/belongs to another user/);
    }
  });

  it('permits only one active finalize lease', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(t);
    const intentId = await createIntent(t, documentId, currentFileId);
    const storageId = await storeCandidate(t, true);
    await t.run((ctx) =>
      ctx.db.patch(intentId, {
        state: 'attesting',
        stagingRef: storageId,
        finalRef: storageId,
        leaseId: 'lease-a',
        leaseExpiresAt: Date.now() + 60_000,
      }),
    );

    await expect(
      t.mutation(
        internal.documents.replacement_uploads
          .acquireControlledDocumentReplacementFinalize,
        {
          organizationId: ORG,
          actorUserId: AUTHOR,
          intentId,
          leaseId: 'lease-b',
          storageId,
        },
      ),
    ).rejects.toThrow(/already being finalized/);
  });

  it('resumes a promoted intent after the previous finalize lease expires', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(t);
    const intentId = await createIntent(t, documentId, currentFileId);
    const storageId = await storeCandidate(t, true);
    await t.run((ctx) =>
      ctx.db.patch(intentId, {
        state: 'promoted',
        stagingRef: storageId,
        finalRef: storageId,
        leaseId: 'lease-crashed',
        leaseExpiresAt: Date.now() - 1,
        verifiedContentType: 'text/plain',
        contentHash: 'b'.repeat(64),
        size: 17,
      }),
    );

    const resumed = await t.mutation(
      internal.documents.replacement_uploads
        .acquireControlledDocumentReplacementFinalize,
      {
        organizationId: ORG,
        actorUserId: AUTHOR,
        intentId,
        leaseId: 'lease-retry',
      },
    );
    expect(resumed).toMatchObject({
      phase: 'promoted',
      finalRef: storageId,
      contentHash: 'b'.repeat(64),
      verifiedContentType: 'text/plain',
    });
  });

  it('keeps failed cleanup durable until physical deletion is acknowledged', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(t);
    const intentId = await createIntent(t, documentId, currentFileId);
    const storageId = await storeCandidate(t, true);
    await t.run((ctx) =>
      ctx.db.patch(intentId, {
        stagingRef: storageId,
        finalRef: storageId,
        state: 'failed',
        cleanupPending: true,
        cleanupDueAt: 0,
        lastError: 'attestation failed',
      }),
    );

    const [leased] = await t.mutation(
      internal.documents.replacement_uploads
        .leaseControlledDocumentReplacementCleanupBatch,
      {},
    );
    expect(leased?.refs).toEqual([storageId]);
    await t.mutation(
      internal.documents.replacement_uploads
        .completeControlledDocumentReplacementCleanup,
      { intentId, error: 'temporary object-store outage' },
    );
    const retrying = await t.run((ctx) => ctx.db.get(intentId));
    expect(retrying?.cleanupPending).toBe(true);
    expect(retrying?.cleanupAttempts).toBe(1);
    expect(retrying?.lastError).toContain('temporary object-store outage');

    await t.mutation(
      internal.documents.replacement_uploads
        .completeControlledDocumentReplacementCleanup,
      { intentId },
    );
    const cleaned = await t.run((ctx) => ctx.db.get(intentId));
    expect(cleaned).toMatchObject({
      state: 'cleaned',
      cleanupPending: false,
    });
  });

  it('cleans only the exposed S3 staging ref after a successful bind', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(t);
    const intentId = await createIntent(t, documentId, currentFileId);
    const stagingRef = `s3:${SLUG}/staging`;
    const finalRef = `s3:${SLUG}/final`;
    await t.run((ctx) =>
      ctx.db.patch(intentId, {
        backend: 's3',
        stagingRef,
        finalRef,
        state: 'bound',
        resultVersion: 1,
        cleanupPending: true,
        cleanupDueAt: 0,
      }),
    );

    const [leased] = await t.mutation(
      internal.documents.replacement_uploads
        .leaseControlledDocumentReplacementCleanupBatch,
      {},
    );
    expect(leased?.refs).toEqual([stagingRef]);
    expect(leased?.refs).not.toContain(finalRef);
  });

  it('never cleans an intent ref adopted by another document binding', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(t);
    const intentId = await createIntent(t, documentId, currentFileId);
    const stagingRef = `s3:${SLUG}/adopted-staging`;
    await t.run(async (ctx) => {
      const adoptedDocumentId = await ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'adopted.txt',
        fileId: stagingRef,
        sourceProvider: 'upload',
      });
      await ctx.db.insert('fileMetadata', {
        organizationId: ORG,
        storageId: stagingRef,
        documentId: adoptedDocumentId,
        source: 'user',
        fileName: 'adopted.txt',
        contentType: 'text/plain',
        size: 1,
      });
      await ctx.db.patch(intentId, {
        backend: 's3',
        stagingRef,
        finalRef: `s3:${SLUG}/unused-final`,
        state: 'bound',
        resultVersion: 1,
        cleanupPending: true,
        cleanupDueAt: 0,
      });
    });

    const leased = await t.mutation(
      internal.documents.replacement_uploads
        .leaseControlledDocumentReplacementCleanupBatch,
      {},
    );
    expect(leased).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(intentId))).toMatchObject({
      state: 'bound',
      cleanupPending: false,
    });
  });

  it('refuses another replacement when draft-only history reaches its cap', async () => {
    const t = makeT();
    const { documentId, currentFileId } = await seedControlledDocument(t);
    await t.run((ctx) =>
      ctx.db.patch(documentId, {
        historyFiles: Array.from(
          { length: 200 },
          (_, index) => `s3:${SLUG}/draft-history/${index}`,
        ),
      }),
    );

    await expect(createIntent(t, documentId, currentFileId)).rejects.toThrow(
      /file-replacement history limit/,
    );
  });
});
