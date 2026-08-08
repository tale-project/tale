// Controlled records (phase 5) against a real convex-test backend: the
// opt-in gate (`markControlled` refusal matrix), the full state machine
// (draft → in_review → approved → revision → re-approve, with monotonic
// versions and immutable approved snapshots), the review mint conventions
// (idempotent per version, supersede-previous-pending), the respond
// permission/feedback matrix, the content-freeze guard on EVERY wired write
// path (public update, internal/REST update, connector upsert, WebDAV PUT,
// trash/delete), the generic-approval bypass exclusion, the audit row per
// transition, and the uncontrolled-document regression (no `record` ⇒
// exactly today's behaviour).

import rateLimiterComponent from '@convex-dev/rate-limiter/test';
import { convexTest, type TestConvex } from 'convex-test';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';
import {
  DOCUMENT_RECORD_AUDIT_ACTIONS,
  DOCUMENT_RECORD_MAX_APPROVED_VERSIONS,
} from './records';

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
const authModules = import.meta.glob('../betterAuth/**/*.*s');

const ORG = 'org_records';
const AUTHOR = 'u_author'; // editor-role org member
const REVIEWER = 'u_reviewer'; // editor-role org member
const MEMBER = 'u_member'; // member-role (hub write allowed, project edit not)
const DISABLED = 'u_disabled';

type T = TestConvex<typeof schema>;

// The WebDAV PUT path (saveFileMetadata) schedules background work that can
// warn after a test returns; a console-log RPC pending at worker teardown
// fails the whole run (see tree_mutations.test.ts for the full rationale).
// Deliberately not restored — per-file isolation brings the console back.
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

function makeT(): T {
  const t = convexTest(schema, modules);
  // The WebDAV PUT path registers fileMetadata, which rides the rate-limiter
  // component, and the generic approval resolution resolves the approver's
  // display name through Better Auth — register both (empty is fine);
  // harmless for tests that never touch them.
  rateLimiterComponent.register(t);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

async function seedMembers(t: T): Promise<void> {
  await t.run(async (ctx) => {
    const roles: Array<[string, string]> = [
      [AUTHOR, 'editor'],
      [REVIEWER, 'editor'],
      [MEMBER, 'member'],
      [DISABLED, 'disabled'],
    ];
    for (const [userId, role] of roles) {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${userId}_${ORG}`,
        userId,
        organizationId: ORG,
        role,
        createdAt: 0,
      });
    }
  });
}

async function storeBlob(t: T, content: string): Promise<Id<'_storage'>> {
  return t.run((ctx) => ctx.storage.store(new Blob([content])));
}

async function seedDoc(
  t: T,
  overrides: Partial<Doc<'documents'>> = {},
): Promise<Id<'documents'>> {
  return t.run((ctx) =>
    ctx.db.insert('documents', {
      organizationId: ORG,
      title: 'SOP-7 Cleaning.md',
      sourceProvider: 'upload',
      contentHash: 'hash-v1',
      createdBy: AUTHOR,
      ...overrides,
    }),
  );
}

async function getDoc(
  t: T,
  documentId: Id<'documents'>,
): Promise<Doc<'documents'> | null> {
  return t.run((ctx) => ctx.db.get(documentId));
}

async function recordReviews(
  t: T,
  documentId: Id<'documents'>,
): Promise<Doc<'approvals'>[]> {
  return t.run(async (ctx) => {
    const rows: Doc<'approvals'>[] = [];
    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_resource', (q) =>
        q
          .eq('resourceType', 'document_record_review')
          .eq('resourceId', String(documentId)),
      )) {
      rows.push(approval);
    }
    return rows;
  });
}

async function recordAudits(t: T): Promise<Doc<'auditLogs'>[]> {
  return t.run(async (ctx) =>
    (await ctx.db.query('auditLogs').collect()).filter((row) =>
      row.action.startsWith('document.record_'),
    ),
  );
}

/** Seed a controlled document with a REAL `_storage` blob (so the approve
 * snapshot can read sha256/size from the system table). */
async function controlledDoc(
  t: T,
  overrides: Partial<Doc<'documents'>> = {},
): Promise<{ documentId: Id<'documents'>; fileId: Id<'_storage'> }> {
  const fileId = await storeBlob(t, 'version one bytes');
  const documentId = await seedDoc(t, { fileId, ...overrides });
  await t
    .withIdentity({ subject: AUTHOR })
    .mutation(api.documents.records.markControlled, { documentId });
  return { documentId, fileId };
}

async function submit(
  t: T,
  documentId: Id<'documents'>,
  reviewerUserId: string = REVIEWER,
  as: string = AUTHOR,
): Promise<Id<'approvals'>> {
  const { approvalId } = await t
    .withIdentity({ subject: as })
    .mutation(api.documents.records.submitRecordForReview, {
      documentId,
      reviewerUserId,
    });
  return approvalId;
}

describe('markControlled', () => {
  it('initializes the record and writes the audit row', async () => {
    const t = makeT();
    await seedMembers(t);
    const fileId = await storeBlob(t, 'bytes');
    const documentId = await seedDoc(t, { fileId });

    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.records.markControlled, { documentId });

    const doc = await getDoc(t, documentId);
    expect(doc?.record).toMatchObject({
      state: 'draft',
      version: 1,
      controlledBy: AUTHOR,
      approvedVersions: [],
    });
    const audits = await recordAudits(t);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'document.record_controlled',
      actorId: AUTHOR,
      resourceType: 'document',
      resourceId: String(documentId),
      category: 'data',
    });
  });

  it('allows agent-sourced and provider-less documents', async () => {
    const t = makeT();
    await seedMembers(t);
    for (const sourceProvider of ['agent', undefined]) {
      const fileId = await storeBlob(t, `bytes-${sourceProvider}`);
      const documentId = await seedDoc(t, { fileId, sourceProvider });
      await t
        .withIdentity({ subject: AUTHOR })
        .mutation(api.documents.records.markControlled, { documentId });
      expect((await getDoc(t, documentId))?.record?.state).toBe('draft');
    }
  });

  it('refuses connector/sync-owned sources', async () => {
    const t = makeT();
    await seedMembers(t);
    for (const sourceProvider of ['onedrive', 'sharepoint', 'webdav']) {
      const documentId = await seedDoc(t, {
        fileId: await storeBlob(t, `sync-${sourceProvider}`),
        sourceProvider,
        externalItemId: 'ext-1',
      });
      await expect(
        t
          .withIdentity({ subject: AUTHOR })
          .mutation(api.documents.records.markControlled, { documentId }),
      ).rejects.toThrow(/DOCUMENT_RECORD_SOURCE_UNSUPPORTED/);
    }
  });

  it('refuses an already-controlled document, a blob-less document, and non-members', async () => {
    const t = makeT();
    await seedMembers(t);
    const { documentId } = await controlledDoc(t);
    await expect(
      t
        .withIdentity({ subject: AUTHOR })
        .mutation(api.documents.records.markControlled, { documentId }),
    ).rejects.toThrow(/DOCUMENT_ALREADY_CONTROLLED/);

    const blobless = await seedDoc(t, { title: 'note.md' });
    await expect(
      t
        .withIdentity({ subject: AUTHOR })
        .mutation(api.documents.records.markControlled, {
          documentId: blobless,
        }),
    ).rejects.toThrow(/DOCUMENT_RECORD_NEEDS_FILE/);

    const plain = await seedDoc(t, { fileId: await storeBlob(t, 'x') });
    await expect(
      t
        .withIdentity({ subject: 'u_stranger' })
        .mutation(api.documents.records.markControlled, { documentId: plain }),
    ).rejects.toThrow();
  });

  it('requires project edit access for project-scoped documents', async () => {
    const t = makeT();
    await seedMembers(t);
    const projectId = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Apollo',
        createdBy: AUTHOR,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const documentId = await seedDoc(t, {
      fileId: await storeBlob(t, 'project bytes'),
      projectId,
    });

    await expect(
      t
        .withIdentity({ subject: MEMBER })
        .mutation(api.documents.records.markControlled, { documentId }),
    ).rejects.toThrow(/PROJECT_FORBIDDEN/);

    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.records.markControlled, { documentId });
    expect((await getDoc(t, documentId))?.record?.state).toBe('draft');
  });
});

describe('state machine — draft → review → approved → revision → re-approve', () => {
  it('walks the happy path with monotonic versions and immutable snapshots', async () => {
    const t = makeT();
    await seedMembers(t);
    const { documentId, fileId: fileV1 } = await controlledDoc(t);

    // Submit v1 for review: frozen + minted for the named reviewer.
    const approvalId = await submit(t, documentId);
    let doc = await getDoc(t, documentId);
    expect(doc?.record).toMatchObject({
      state: 'in_review',
      version: 1,
      submittedBy: AUTHOR,
      reviewerUserId: REVIEWER,
    });
    const [minted] = await recordReviews(t, documentId);
    expect(minted).toMatchObject({ _id: approvalId, status: 'pending' });
    expect(minted?.metadata).toMatchObject({
      documentId: String(documentId),
      version: 1,
      requestedFor: REVIEWER,
      requestedBy: AUTHOR,
    });

    // The pending-review projection names who it waits on.
    const pending = await t
      .withIdentity({ subject: REVIEWER })
      .query(api.documents.records.getPendingDocumentRecordReview, {
        documentId,
      });
    expect(pending).toMatchObject({
      approvalId,
      version: 1,
      requestedFor: REVIEWER,
      requestedBy: AUTHOR,
    });

    // Approve v1: snapshot carries the exact blob + its storage sha256/size.
    const expectedMeta = await t.run((ctx) => ctx.db.system.get(fileV1));
    const approveResult = await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.documents.records.respondToDocumentRecordReview, {
        approvalId,
        decision: 'approve',
      });
    expect(approveResult).toEqual({ state: 'approved', version: 1 });
    doc = await getDoc(t, documentId);
    expect(doc?.record).toMatchObject({
      state: 'approved',
      version: 1,
      approvedBy: REVIEWER,
    });
    expect(doc?.record?.approvedVersions).toHaveLength(1);
    expect(doc?.record?.approvedVersions[0]).toMatchObject({
      version: 1,
      fileId: fileV1,
      contentHash: 'hash-v1',
      sha256: expectedMeta?.sha256,
      size: expectedMeta?.size,
      approvedBy: REVIEWER,
    });
    // The approved blob is retained on the row's own history so version
    // listing + delete-time erase keep covering it.
    expect(doc?.historyFiles).toContain(fileV1);
    const [completed] = await recordReviews(t, documentId);
    expect(completed).toMatchObject({
      status: 'completed',
      approvedBy: REVIEWER,
    });

    // Open revision 2 — the v1 snapshot stays addressable.
    const revision = await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.records.openRecordRevision, { documentId });
    expect(revision).toEqual({ version: 2 });
    doc = await getDoc(t, documentId);
    expect(doc?.record).toMatchObject({ state: 'draft', version: 2 });
    expect(doc?.record?.approvedVersions).toHaveLength(1);

    // Draft edit (allowed): replace the blob via the public update path.
    const fileV2 = await storeBlob(t, 'version two bytes');
    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.mutations.updateDocument, {
        documentId,
        fileId: fileV2,
      });
    doc = await getDoc(t, documentId);
    expect(doc?.fileId).toBe(fileV2);
    expect(doc?.historyFiles).toContain(fileV1);

    // Second round: submit + approve → version 2 snapshot appended.
    const secondApproval = await submit(t, documentId);
    await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.documents.records.respondToDocumentRecordReview, {
        approvalId: secondApproval,
        decision: 'approve',
      });
    doc = await getDoc(t, documentId);
    expect(doc?.record).toMatchObject({ state: 'approved', version: 2 });
    expect(doc?.record?.approvedVersions.map((v) => v.version)).toEqual([1, 2]);
    expect(doc?.record?.approvedVersions[1]?.fileId).toBe(fileV2);

    // Every transition is on the audit chain.
    const audits = await recordAudits(t);
    expect(audits.map((row) => row.action).sort()).toEqual(
      [
        'document.record_controlled',
        'document.record_review_responded',
        'document.record_review_responded',
        'document.record_revision_opened',
        'document.record_submitted',
        'document.record_submitted',
      ].sort(),
    );
    const approveAudit = audits.find(
      (row) =>
        row.action === 'document.record_review_responded' &&
        (row.newState as { version?: number } | undefined)?.version === 1,
    );
    expect(approveAudit?.metadata).toMatchObject({
      decision: 'approve',
      feedbackProvided: false,
      snapshot: expect.objectContaining({ fileId: String(fileV1) }),
    });
  });

  it('approve falls back to the row contentHash for non-Convex (s3) blobs', async () => {
    const t = makeT();
    await seedMembers(t);
    const documentId = await seedDoc(t, {
      fileId: 's3:records/sop-7.md',
      contentHash: 's3-hash',
    });
    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.records.markControlled, { documentId });
    const approvalId = await submit(t, documentId);

    await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.documents.records.respondToDocumentRecordReview, {
        approvalId,
        decision: 'approve',
      });

    const doc = await getDoc(t, documentId);
    expect(doc?.record?.approvedVersions[0]).toMatchObject({
      version: 1,
      fileId: 's3:records/sop-7.md',
      contentHash: 's3-hash',
    });
    expect(doc?.record?.approvedVersions[0]?.sha256).toBeUndefined();
  });

  it('approve tolerates a malformed (non-s3, undecodable) fileId — hash-omitted snapshot, no crash', async () => {
    // Twin of the run ledger's malformed-ref tolerance: a corrupt blob ref
    // used to blind-cast into `db.system.get`, which THROWS — crashing the
    // approve from inside the cast. It must stay a visible user-level
    // outcome: the same hash-omitted snapshot the `s3:` arm produces.
    const t = makeT();
    await seedMembers(t);
    const documentId = await seedDoc(t, {
      fileId: 'corrupt-blob-ref',
      contentHash: 'hash-corrupt',
    });
    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.records.markControlled, { documentId });
    const approvalId = await submit(t, documentId);

    const result = await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.documents.records.respondToDocumentRecordReview, {
        approvalId,
        decision: 'approve',
      });
    expect(result).toEqual({ state: 'approved', version: 1 });

    const doc = await getDoc(t, documentId);
    expect(doc?.record?.approvedVersions[0]).toMatchObject({
      version: 1,
      fileId: 'corrupt-blob-ref',
      contentHash: 'hash-corrupt',
    });
    expect(doc?.record?.approvedVersions[0]?.sha256).toBeUndefined();
    expect(doc?.record?.approvedVersions[0]?.size).toBeUndefined();
  });

  it('request-changes requires feedback, records it, and reopens the draft', async () => {
    const t = makeT();
    await seedMembers(t);
    const { documentId } = await controlledDoc(t);
    const approvalId = await submit(t, documentId);

    await expect(
      t
        .withIdentity({ subject: REVIEWER })
        .mutation(api.documents.records.respondToDocumentRecordReview, {
          approvalId,
          decision: 'request_changes',
        }),
    ).rejects.toThrow(/REVIEW_FEEDBACK_REQUIRED/);

    const result = await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.documents.records.respondToDocumentRecordReview, {
        approvalId,
        decision: 'request_changes',
        feedback: 'Section 3 cites the retired solvent.',
      });
    expect(result).toEqual({ state: 'draft', version: 1 });

    const doc = await getDoc(t, documentId);
    expect(doc?.record).toMatchObject({ state: 'draft', version: 1 });
    expect(doc?.record?.approvedVersions).toHaveLength(0);
    const [review] = await recordReviews(t, documentId);
    expect(review?.status).toBe('completed');
    expect(review?.metadata).toMatchObject({
      response: expect.objectContaining({
        decision: 'request_changes',
        respondedBy: REVIEWER,
        feedback: 'Section 3 cites the retired solvent.',
      }),
    });
    const audit = (await recordAudits(t)).find(
      (row) => row.action === 'document.record_review_responded',
    );
    expect(audit?.metadata).toMatchObject({
      decision: 'request_changes',
      feedbackProvided: true,
    });
  });

  it('submit is idempotent per (document, version) and a fresh mint supersedes stale pendings', async () => {
    const t = makeT();
    await seedMembers(t);
    const { documentId } = await controlledDoc(t);

    const first = await submit(t, documentId);
    const replay = await submit(t, documentId);
    expect(replay).toBe(first);
    expect(await recordReviews(t, documentId)).toHaveLength(1);

    // Force the stale-pending shape (record back in draft while the old
    // pending row lingers) — the fresh submit supersedes it.
    await t.run(async (ctx) => {
      const doc = await ctx.db.get(documentId);
      if (!doc?.record) throw new Error('record missing');
      await ctx.db.patch(documentId, {
        record: { ...doc.record, state: 'draft' },
      });
    });
    const fresh = await submit(t, documentId);
    expect(fresh).not.toBe(first);
    const reviews = await recordReviews(t, documentId);
    expect(reviews).toHaveLength(2);
    const superseded = reviews.find((row) => row._id === first);
    expect(superseded).toMatchObject({ status: 'rejected' });
    expect(superseded?.metadata).toMatchObject({ supersededBy: fresh });
    expect(reviews.find((row) => row._id === fresh)?.status).toBe('pending');
  });

  it('holds the submit/respond/revision refusal matrix', async () => {
    const t = makeT();
    await seedMembers(t);
    const { documentId } = await controlledDoc(t);

    // Ineligible designees: disabled + non-member.
    for (const designee of [DISABLED, 'u_stranger']) {
      await expect(
        t
          .withIdentity({ subject: AUTHOR })
          .mutation(api.documents.records.submitRecordForReview, {
            documentId,
            reviewerUserId: designee,
          }),
      ).rejects.toThrow(/REVIEWER_NOT_ELIGIBLE/);
    }

    // Revision only from approved; submit refused once approved.
    await expect(
      t
        .withIdentity({ subject: AUTHOR })
        .mutation(api.documents.records.openRecordRevision, { documentId }),
    ).rejects.toThrow(/DOCUMENT_RECORD_INVALID_STATE/);

    const approvalId = await submit(t, documentId);

    // Non-member cannot respond; a settled review cannot be re-answered.
    await expect(
      t
        .withIdentity({ subject: 'u_stranger' })
        .mutation(api.documents.records.respondToDocumentRecordReview, {
          approvalId,
          decision: 'approve',
        }),
    ).rejects.toThrow();
    await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.documents.records.respondToDocumentRecordReview, {
        approvalId,
        decision: 'approve',
      });
    await expect(
      t
        .withIdentity({ subject: REVIEWER })
        .mutation(api.documents.records.respondToDocumentRecordReview, {
          approvalId,
          decision: 'approve',
        }),
    ).rejects.toThrow(/REVIEW_ALREADY_RESOLVED/);

    await expect(
      t
        .withIdentity({ subject: AUTHOR })
        .mutation(api.documents.records.submitRecordForReview, {
          documentId,
          reviewerUserId: REVIEWER,
        }),
    ).rejects.toThrow(/DOCUMENT_RECORD_INVALID_STATE/);

    // Uncontrolled documents refuse the lifecycle mutations outright.
    const plain = await seedDoc(t, {
      title: 'plain.md',
      fileId: await storeBlob(t, 'plain'),
    });
    await expect(
      t
        .withIdentity({ subject: AUTHOR })
        .mutation(api.documents.records.openRecordRevision, {
          documentId: plain,
        }),
    ).rejects.toThrow(/DOCUMENT_NOT_CONTROLLED/);
  });

  it('project documents gate respond on project edit access', async () => {
    const t = makeT();
    await seedMembers(t);
    const projectId = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Apollo',
        createdBy: AUTHOR,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const { documentId } = await controlledDoc(t, { projectId });
    const approvalId = await submit(t, documentId);

    await expect(
      t
        .withIdentity({ subject: MEMBER })
        .mutation(api.documents.records.respondToDocumentRecordReview, {
          approvalId,
          decision: 'approve',
        }),
    ).rejects.toThrow(/PROJECT_FORBIDDEN/);

    await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.documents.records.respondToDocumentRecordReview, {
        approvalId,
        decision: 'approve',
      });
    expect((await getDoc(t, documentId))?.record?.state).toBe('approved');
  });

  it('refuses the approve past the approved-versions cap', async () => {
    const t = makeT();
    await seedMembers(t);
    const { documentId } = await controlledDoc(t);
    const approvalId = await submit(t, documentId);
    await t.run(async (ctx) => {
      const doc = await ctx.db.get(documentId);
      if (!doc?.record) throw new Error('record missing');
      await ctx.db.patch(documentId, {
        record: {
          ...doc.record,
          approvedVersions: Array.from(
            { length: DOCUMENT_RECORD_MAX_APPROVED_VERSIONS },
            (_, i) => ({
              version: i + 1,
              fileId: `s3:snapshots/${i}`,
              approvedAt: 0,
              approvedBy: REVIEWER,
            }),
          ),
        },
      });
    });

    await expect(
      t
        .withIdentity({ subject: REVIEWER })
        .mutation(api.documents.records.respondToDocumentRecordReview, {
          approvalId,
          decision: 'approve',
        }),
    ).rejects.toThrow(/DOCUMENT_RECORD_VERSION_LIMIT/);
    // The refusal rolled back — the review is still pending and actionable.
    const [review] = await recordReviews(t, documentId);
    expect(review?.status).toBe('pending');
  });
});

describe('content freeze — every wired write path', () => {
  async function frozenDoc(
    t: T,
    state: 'in_review' | 'approved',
  ): Promise<{ documentId: Id<'documents'>; fileId: Id<'_storage'> }> {
    const seeded = await controlledDoc(t);
    const approvalId = await submit(t, seeded.documentId);
    if (state === 'approved') {
      await t
        .withIdentity({ subject: REVIEWER })
        .mutation(api.documents.records.respondToDocumentRecordReview, {
          approvalId,
          decision: 'approve',
        });
    }
    return seeded;
  }

  it('public updateDocument refuses content-bearing fields, allows renames + teams', async () => {
    const t = makeT();
    await seedMembers(t);
    const { documentId } = await frozenDoc(t, 'in_review');
    const as = t.withIdentity({ subject: AUTHOR });

    for (const patch of [
      { content: 'new body' },
      { fileId: await storeBlob(t, 'replacement') },
      { extension: 'pdf' },
      { mimeType: 'application/pdf' },
      { sourceProvider: 'onedrive' as const },
    ]) {
      await expect(
        as.mutation(api.documents.mutations.updateDocument, {
          documentId,
          ...patch,
        }),
      ).rejects.toThrow(/DOCUMENT_RECORD_FROZEN/);
    }

    // Identity/metadata edits stay allowed while frozen.
    await as.mutation(api.documents.mutations.updateDocument, {
      documentId,
      title: 'SOP-7 Cleaning (renamed).md',
      metadata: { department: 'QA' },
    });
    expect((await getDoc(t, documentId))?.title).toBe(
      'SOP-7 Cleaning (renamed).md',
    );
  });

  it('internal updateDocument (REST PATCH / connector update door) refuses frozen content', async () => {
    const t = makeT();
    await seedMembers(t);
    const { documentId } = await frozenDoc(t, 'approved');

    await expect(
      t.mutation(internal.documents.internal_mutations.updateDocument, {
        documentId,
        fileId: await storeBlob(t, 'connector refresh'),
        callerOrgId: ORG,
      }),
    ).rejects.toThrow(/DOCUMENT_RECORD_FROZEN/);
    await expect(
      t.mutation(internal.documents.internal_mutations.updateDocument, {
        documentId,
        contentHash: 'sneaky-rebind',
      }),
    ).rejects.toThrow(/DOCUMENT_RECORD_FROZEN/);

    // Rename-only stays allowed.
    await t.mutation(internal.documents.internal_mutations.updateDocument, {
      documentId,
      title: 'SOP-7 v2.md',
    });
    expect((await getDoc(t, documentId))?.title).toBe('SOP-7 v2.md');
  });

  it('upsertDocumentByExternalId refuses a content refresh on a frozen agent doc', async () => {
    const t = makeT();
    await seedMembers(t);
    const fileId = await storeBlob(t, 'agent artifact v1');
    const documentId = await seedDoc(t, {
      title: 'return.xml',
      fileId,
      sourceProvider: 'agent',
      externalItemId: 'workflow:fld_1:return.xml',
      contentHash: 'agent-hash-1',
    });
    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.records.markControlled, { documentId });
    const approvalId = await submit(t, documentId);
    await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.documents.records.respondToDocumentRecordReview, {
        approvalId,
        decision: 'approve',
      });

    // The producing automation re-runs and tries to refresh the artifact.
    await expect(
      t.mutation(
        internal.documents.internal_mutations.upsertDocumentByExternalId,
        {
          organizationId: ORG,
          externalItemId: 'workflow:fld_1:return.xml',
          title: 'return.xml',
          fileId: await storeBlob(t, 'agent artifact v2'),
          contentHash: 'agent-hash-2',
          sourceProvider: 'agent',
        },
      ),
    ).rejects.toThrow(/DOCUMENT_RECORD_FROZEN/);

    // A metadata-only upsert (same content) is not a content write.
    const skipped = await t.mutation(
      internal.documents.internal_mutations.upsertDocumentByExternalId,
      {
        organizationId: ORG,
        externalItemId: 'workflow:fld_1:return.xml',
        title: 'return.xml',
        fileId,
        contentHash: 'agent-hash-1',
        sourceProvider: 'agent',
        metadata: { note: 'unchanged' },
      },
    );
    expect(skipped.contentChanged).toBe(false);

    // Back in draft, the same refresh is allowed again.
    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.records.openRecordRevision, { documentId });
    const refreshed = await t.mutation(
      internal.documents.internal_mutations.upsertDocumentByExternalId,
      {
        organizationId: ORG,
        externalItemId: 'workflow:fld_1:return.xml',
        title: 'return.xml',
        fileId: await storeBlob(t, 'agent artifact v3'),
        contentHash: 'agent-hash-3',
        sourceProvider: 'agent',
      },
    );
    expect(refreshed.contentChanged).toBe(true);
  });

  it('WebDAV PUT refuses a frozen overwrite; a draft overwrite retains the approved blob', async () => {
    const t = makeT();
    await seedMembers(t);
    const { documentId, fileId: approvedBlob } = await frozenDoc(t, 'approved');
    const doc = await getDoc(t, documentId);

    const putBlob = await storeBlob(t, 'webdav overwrite');
    await expect(
      t.mutation(internal.webdav.tree_mutations.ingestPutBlob, {
        organizationId: ORG,
        pathSegments: [doc?.title ?? ''],
        storageId: putBlob,
        contentType: 'text/markdown',
        size: 16,
        userId: AUTHOR,
      }),
    ).rejects.toThrow(/DOCUMENT_RECORD_FROZEN/);

    // Open a revision → draft. The PUT now lands, and the approved
    // snapshot's blob survives (historyFiles + physical bytes), instead of
    // being purged like an ordinary WebDAV overwrite.
    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.records.openRecordRevision, { documentId });
    const result = await t.mutation(
      internal.webdav.tree_mutations.ingestPutBlob,
      {
        organizationId: ORG,
        pathSegments: [doc?.title ?? ''],
        storageId: putBlob,
        contentType: 'text/markdown',
        size: 16,
        userId: AUTHOR,
      },
    );
    expect(result).toMatchObject({ created: false, documentId });
    const updated = await getDoc(t, documentId);
    expect(updated?.fileId).toBe(putBlob);
    expect(updated?.historyFiles).toContain(approvedBlob);
    const approvedBytes = await t.run((ctx) =>
      ctx.storage.getUrl(approvedBlob),
    );
    expect(approvedBytes).not.toBeNull();
  });

  it('trash/delete refuses on in_review and approved, allows draft + uncontrolled', async () => {
    const t = makeT();
    await seedMembers(t);

    // WebDAV soft delete.
    const inReview = await frozenDoc(t, 'in_review');
    await expect(
      t.mutation(internal.webdav.tree_mutations.softDeleteDocument, {
        organizationId: ORG,
        documentId: inReview.documentId,
      }),
    ).rejects.toThrow(/DOCUMENT_RECORD_PROTECTED/);

    // Public delete.
    const approved = await frozenDoc(t, 'approved');
    await expect(
      t
        .withIdentity({ subject: AUTHOR })
        .mutation(api.documents.mutations.deleteDocument, {
          documentId: approved.documentId,
        }),
    ).rejects.toThrow(/DOCUMENT_RECORD_PROTECTED/);

    // REST-attributed hard delete (callerOrgId present) refuses; the
    // in-process retention/erasure caller (no callerOrgId) stays open.
    await expect(
      t.mutation(internal.documents.internal_mutations.deleteDocumentById, {
        documentId: approved.documentId,
        callerOrgId: ORG,
      }),
    ).rejects.toThrow(/DOCUMENT_RECORD_PROTECTED/);
    await t.mutation(internal.documents.internal_mutations.deleteDocumentById, {
      documentId: approved.documentId,
    });
    expect(await getDoc(t, approved.documentId)).toBeNull();

    // Draft-state controlled documents trash exactly as today.
    const draft = await controlledDoc(t, { title: 'draft-only.md' });
    await t.mutation(internal.webdav.tree_mutations.softDeleteDocument, {
      organizationId: ORG,
      documentId: draft.documentId,
    });
    expect((await getDoc(t, draft.documentId))?.lifecycleStatus).toBe(
      'trashed',
    );
  });

  it('protects a post-revision draft that carries approved history, and audits the deletion of one that never was', async () => {
    const t = makeT();
    await seedMembers(t);

    // Approve v1, then open revision v2. The record is `draft` again, but
    // its approved v1 snapshot is a retained record — "open a revision,
    // then delete" must not be a way to destroy it.
    const revised = await frozenDoc(t, 'approved');
    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.records.openRecordRevision, {
        documentId: revised.documentId,
      });
    const revisedDoc = await getDoc(t, revised.documentId);
    expect(revisedDoc?.record?.state).toBe('draft');
    expect(revisedDoc?.record?.version).toBe(2);
    expect(revisedDoc?.record?.approvedVersions).toHaveLength(1);

    for (const attempt of [
      () =>
        t
          .withIdentity({ subject: AUTHOR })
          .mutation(api.documents.mutations.deleteDocument, {
            documentId: revised.documentId,
          }),
      () =>
        t.mutation(internal.webdav.tree_mutations.softDeleteDocument, {
          organizationId: ORG,
          documentId: revised.documentId,
        }),
      () =>
        t.mutation(internal.documents.internal_mutations.deleteDocumentById, {
          documentId: revised.documentId,
          callerOrgId: ORG,
        }),
    ]) {
      await expect(attempt()).rejects.toThrow(/DOCUMENT_RECORD_PROTECTED/);
    }
    expect(await getDoc(t, revised.documentId)).not.toBeNull();

    // A never-approved draft still deletes — but leaves a trail, so a
    // controlled record can never vanish silently.
    const draft = await controlledDoc(t, { title: 'never-approved.md' });
    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.mutations.deleteDocument, {
        documentId: draft.documentId,
      });
    const deletionEntries = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('auditLogs')
        .withIndex('by_organizationId_and_category', (q) =>
          q.eq('organizationId', ORG).eq('category', 'data'),
        )
        .collect();
      return rows.filter(
        (row) => row.action === DOCUMENT_RECORD_AUDIT_ACTIONS.deleted,
      );
    });
    expect(deletionEntries).toHaveLength(1);
    expect(deletionEntries[0]?.resourceId).toBe(String(draft.documentId));
    expect(deletionEntries[0]?.metadata).toMatchObject({
      version: 1,
      approvedVersionCount: 0,
    });
  });

  it('a WebDAV folder cascade refuses when a frozen record sits in the subtree', async () => {
    const t = makeT();
    await seedMembers(t);
    const folderId = await t.run((ctx) =>
      ctx.db.insert('folders', {
        organizationId: ORG,
        name: 'SOPs',
        createdBy: AUTHOR,
      }),
    );
    const sibling = await seedDoc(t, { title: 'plain.md', folderId });
    const { documentId } = await controlledDoc(t, {
      title: 'controlled.md',
      folderId,
    });
    const approvalId = await submit(t, documentId);
    await t
      .withIdentity({ subject: REVIEWER })
      .mutation(api.documents.records.respondToDocumentRecordReview, {
        approvalId,
        decision: 'approve',
      });

    await expect(
      t.mutation(internal.webdav.tree_mutations.deleteFolderCascade, {
        organizationId: ORG,
        folderId,
      }),
    ).rejects.toThrow(/DOCUMENT_RECORD_PROTECTED/);
    // The throw rolled the whole cascade back — nothing was half-deleted.
    expect(await t.run((ctx) => ctx.db.get(folderId))).not.toBeNull();
    expect((await getDoc(t, sibling))?.lifecycleStatus ?? 'active').toBe(
      'active',
    );
  });
});

describe('generic-approval bypass exclusion', () => {
  it('updateApprovalStatus refuses review-gate rows but keeps generic rows completable', async () => {
    const t = makeT();
    await seedMembers(t);
    const { documentId } = await controlledDoc(t);
    const recordApprovalId = await submit(t, documentId);

    const { taskReviewId, genericId } = await t.run(async (ctx) => {
      const taskReview = await ctx.db.insert('approvals', {
        organizationId: ORG,
        resourceType: 'task_review',
        resourceId: 'task_1',
        priority: 'high',
        status: 'pending',
      });
      const generic = await ctx.db.insert('approvals', {
        organizationId: ORG,
        resourceType: 'human_input_request',
        resourceId: 'thread_1',
        priority: 'medium',
        status: 'pending',
      });
      return { taskReviewId: taskReview, genericId: generic };
    });

    const as = t.withIdentity({ subject: MEMBER });
    await expect(
      as.mutation(api.approvals.mutations.updateApprovalStatus, {
        approvalId: recordApprovalId,
        status: 'executing',
      }),
    ).rejects.toThrow(/APPROVAL_REQUIRES_DEDICATED_RESPOND/);
    await expect(
      as.mutation(api.approvals.mutations.updateApprovalStatus, {
        approvalId: taskReviewId,
        status: 'executing',
      }),
    ).rejects.toThrow(/APPROVAL_REQUIRES_DEDICATED_RESPOND/);

    // Regression: ordinary approval rows keep the generic door.
    await as.mutation(api.approvals.mutations.updateApprovalStatus, {
      approvalId: genericId,
      status: 'executing',
    });
    const generic = await t.run((ctx) => ctx.db.get(genericId));
    expect(generic?.status).toBe('executing');

    // The record review is still pending and resolves through its own door.
    const [review] = await recordReviews(t, documentId);
    expect(review?.status).toBe('pending');
  });
});

describe('uncontrolled documents — exact regression', () => {
  it('update/upsert/delete behave exactly as before for documents without a record', async () => {
    const t = makeT();
    await seedMembers(t);
    const fileId = await storeBlob(t, 'plain v1');
    const documentId = await seedDoc(t, {
      title: 'plain.md',
      fileId,
      externalItemId: 'ext-plain',
    });

    // Content updates pass with no freeze interference and no history
    // append (hash-less public update — today's exact behaviour).
    const nextBlob = await storeBlob(t, 'plain v2');
    await t
      .withIdentity({ subject: AUTHOR })
      .mutation(api.documents.mutations.updateDocument, {
        documentId,
        content: 'plain body',
        fileId: nextBlob,
      });
    let doc = await getDoc(t, documentId);
    expect(doc?.fileId).toBe(nextBlob);
    expect(doc?.historyFiles).toBeUndefined();

    // Sync upsert still swaps content and appends the old blob to history.
    const syncBlob = await storeBlob(t, 'plain v3');
    const upserted = await t.mutation(
      internal.documents.internal_mutations.upsertDocumentByExternalId,
      {
        organizationId: ORG,
        externalItemId: 'ext-plain',
        title: 'plain.md',
        fileId: syncBlob,
        contentHash: 'plain-hash-3',
      },
    );
    expect(upserted).toMatchObject({ action: 'updated', contentChanged: true });
    doc = await getDoc(t, documentId);
    expect(doc?.fileId).toBe(syncBlob);
    expect(doc?.historyFiles).toEqual([nextBlob]);

    // Hard delete still deletes.
    await t.mutation(internal.documents.internal_mutations.deleteDocumentById, {
      documentId,
      callerOrgId: ORG,
    });
    expect(await getDoc(t, documentId)).toBeNull();
  });

  it('WebDAV PUT overwrite still purges the replaced blob for uncontrolled docs', async () => {
    const t = makeT();
    await seedMembers(t);
    const oldBlob = await storeBlob(t, 'old bytes');
    const documentId = await seedDoc(t, {
      title: 'notes.txt',
      fileId: oldBlob,
      sourceProvider: 'webdav',
    });

    const newBlob = await storeBlob(t, 'new bytes');
    const result = await t.mutation(
      internal.webdav.tree_mutations.ingestPutBlob,
      {
        organizationId: ORG,
        pathSegments: ['notes.txt'],
        storageId: newBlob,
        contentType: 'text/plain',
        size: 9,
        userId: AUTHOR,
      },
    );
    expect(result).toMatchObject({ created: false, documentId });
    const doc = await getDoc(t, documentId);
    expect(doc?.fileId).toBe(newBlob);
    expect(doc?.historyFiles).toBeUndefined();
    // The replaced blob was physically purged — today's behaviour.
    expect(await t.run((ctx) => ctx.storage.getUrl(oldBlob))).toBeNull();
  });
});
