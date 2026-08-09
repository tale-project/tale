import { ConvexError, v } from 'convex/values';

import { isRagIndexableFile } from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { maybeDispatchRagIndexing } from '../file_metadata/rag_dispatch';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  blobRefValidator,
  convexStorageId,
  parseBlobRef,
  s3KeyBelongsToOrg,
  type BlobRef,
} from '../lib/storage/blob_ref';
import { extractExtension } from './extract_extension';
import {
  assertControlledDraftHistoryCapacity,
  auditRecordTransition,
  DOCUMENT_RECORD_AUDIT_ACTIONS,
  openRecordRevisionInTransaction,
  requireControlledRecord,
  requireCurrentApprovedSnapshot,
  requireDocumentWriteAccessForPrincipal,
} from './records';
import { controlledDocumentReplacementExpectedRecordStateValidator } from './schema';
import { replaceControlledDocumentContentInternal } from './update_document_internal';
import { validateDocumentUpload } from './validate_upload';

export const REPLACEMENT_UPLOAD_LEASE_MS = 10 * 60 * 1000;
export const REPLACEMENT_UPLOAD_RECOVERY_MS = 60 * 60 * 1000;
export const REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS = 60 * 1000;
const CLEANUP_ACTION_LEASE_MS = 5 * 60 * 1000;
const MAX_CLEANUP_BATCH = 20;
const CLOCK_SKEW_MS = 60 * 1000;

type ReplacementIntent = Doc<'controlledDocumentReplacementUploads'>;

function invalidIntent(message: string) {
  return new ConvexError({
    code: 'UPLOAD_INTENT_INVALID',
    message,
  });
}

function assertIntentPrincipal(
  intent: ReplacementIntent,
  args: { organizationId: string; actorUserId: string },
): void {
  if (
    intent.organizationId !== args.organizationId ||
    intent.actorUserId !== args.actorUserId
  ) {
    throw invalidIntent('This replacement upload belongs to another user.');
  }
}

async function requireIntent(
  ctx: MutationCtx,
  intentId: Id<'controlledDocumentReplacementUploads'>,
): Promise<ReplacementIntent> {
  const intent = await ctx.db.get(intentId);
  if (intent === null) {
    throw invalidIntent('The replacement upload intent no longer exists.');
  }
  return intent;
}

async function requireReplacementDocument(
  ctx: MutationCtx,
  intent: ReplacementIntent,
): Promise<Doc<'documents'>> {
  const document = await requireDocumentWriteAccessForPrincipal(ctx, {
    documentId: intent.documentId,
    organizationId: intent.organizationId,
    userId: intent.actorUserId,
  });
  requireControlledRecord(document);
  if ((document.lifecycleStatus ?? 'active') !== 'active') {
    throw new ConvexError({
      code: 'DOCUMENT_RECORD_INVALID_STATE',
      message: 'Only an active controlled record can replace its file.',
    });
  }
  return document;
}

async function assertReplacementNotHeld(
  ctx: MutationCtx,
  document: Doc<'documents'>,
): Promise<void> {
  await assertNotHeld(
    ctx,
    document.organizationId,
    'document',
    String(document._id),
    undefined,
    document.createdBy ?? undefined,
  );
}

function replacementTargetMatches(
  document: Doc<'documents'>,
  target: Pick<
    ReplacementIntent,
    'expectedRecordState' | 'expectedVersion' | 'expectedFileId'
  >,
): boolean {
  const record = requireControlledRecord(document);
  return (
    record.state === (target.expectedRecordState ?? 'draft') &&
    record.version === target.expectedVersion &&
    document.fileId !== undefined &&
    String(document.fileId) === String(target.expectedFileId)
  );
}

function cleanupDueAfterCapability(intent: ReplacementIntent): number {
  return Math.max(
    Date.now(),
    intent.uploadExpiresAt + REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS,
  );
}

async function supersedeReplacementIntent(
  ctx: MutationCtx,
  intent: ReplacementIntent,
  lastError: string,
): Promise<void> {
  const now = Date.now();
  const cleanupDueAt = cleanupDueAfterCapability(intent);
  await ctx.db.patch(intent._id, {
    state: 'superseded',
    cleanupPending: true,
    cleanupDueAt,
    leaseId: undefined,
    leaseExpiresAt: undefined,
    lastError,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(
    Math.max(0, cleanupDueAt - now),
    internal.documents.record_actions
      .cleanupControlledDocumentReplacementUploads,
    {},
  );
}

async function validateConvexIntentStorage(
  ctx: MutationCtx,
  intent: ReplacementIntent,
  storageId: Id<'_storage'>,
): Promise<void> {
  const storage = await ctx.db.system.get(storageId);
  const expectedContentType = `${intent.clientContentType?.trim() || 'application/octet-stream'}; tale-intent=${intent.intentNonce}`;
  if (
    storage === null ||
    storage.contentType !== expectedContentType ||
    storage._creationTime < intent.createdAt - CLOCK_SKEW_MS ||
    storage._creationTime > intent.uploadExpiresAt + CLOCK_SKEW_MS
  ) {
    throw invalidIntent(
      'The uploaded blob is not owned by this replacement intent.',
    );
  }
  const claimedElsewhere = await ctx.db
    .query('controlledDocumentReplacementUploads')
    .withIndex('by_stagingRef', (q) => q.eq('stagingRef', storageId))
    .first();
  if (claimedElsewhere !== null && claimedElsewhere._id !== intent._id) {
    throw invalidIntent(
      'The uploaded blob belongs to another replacement intent.',
    );
  }
  const existingMetadata = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .first();
  if (existingMetadata !== null) {
    throw new ConvexError({
      code: 'UPLOAD_BLOB_ALREADY_BOUND',
      message: 'The uploaded replacement file is already in use.',
    });
  }
}

export const createControlledDocumentReplacementUploadIntent = internalMutation(
  {
    args: {
      organizationId: v.string(),
      orgSlug: v.string(),
      actorUserId: v.string(),
      actorEmail: v.string(),
      documentId: v.id('documents'),
      expectedRecordState:
        controlledDocumentReplacementExpectedRecordStateValidator,
      expectedVersion: v.number(),
      expectedFileId: blobRefValidator,
      fileName: v.string(),
      clientContentType: v.optional(v.string()),
      lastModified: v.optional(v.number()),
      backend: v.union(v.literal('convex'), v.literal('s3')),
      intentNonce: v.string(),
      stagingRef: v.optional(blobRefValidator),
      finalRef: v.optional(blobRefValidator),
      uploadExpiresAt: v.number(),
    },
    returns: v.id('controlledDocumentReplacementUploads'),
    handler: async (ctx, args) => {
      if (
        !Number.isInteger(args.expectedVersion) ||
        args.expectedVersion < 1 ||
        args.fileName.trim().length === 0 ||
        args.intentNonce.length < 32 ||
        !Number.isFinite(args.uploadExpiresAt) ||
        args.uploadExpiresAt <= Date.now()
      ) {
        throw invalidIntent('Invalid replacement upload intent metadata.');
      }
      if (args.backend === 's3') {
        if (
          args.stagingRef === undefined ||
          args.finalRef === undefined ||
          String(args.stagingRef) === String(args.finalRef)
        ) {
          throw invalidIntent('The S3 replacement upload keys are invalid.');
        }
        for (const ref of [args.stagingRef, args.finalRef]) {
          const parsed = parseBlobRef(ref);
          if (
            parsed.backend !== 's3' ||
            !s3KeyBelongsToOrg(parsed.key, args.orgSlug)
          ) {
            throw invalidIntent(
              'The replacement upload key is outside this organization.',
            );
          }
        }
      } else if (args.stagingRef !== undefined || args.finalRef !== undefined) {
        throw invalidIntent('A Convex upload cannot reserve S3 keys.');
      }

      const document = await requireDocumentWriteAccessForPrincipal(ctx, {
        documentId: args.documentId,
        organizationId: args.organizationId,
        userId: args.actorUserId,
      });
      const record = requireControlledRecord(document);
      if (
        (document.lifecycleStatus ?? 'active') !== 'active' ||
        (record.state !== 'draft' && record.state !== 'approved')
      ) {
        throw new ConvexError({
          code: 'DOCUMENT_RECORD_INVALID_STATE',
          message:
            'Only a controlled-record draft or approved record can replace its file.',
        });
      }
      if (!replacementTargetMatches(document, args)) {
        throw new ConvexError({
          code: 'DOCUMENT_RECORD_VERSION_MISMATCH',
          message: 'The controlled record changed. Reopen the dialog.',
        });
      }
      if (args.expectedRecordState === 'approved') {
        requireCurrentApprovedSnapshot(document);
      }
      await assertNotHeld(
        ctx,
        document.organizationId,
        'document',
        String(document._id),
        undefined,
        document.createdBy ?? undefined,
      );
      assertControlledDraftHistoryCapacity(document);

      const now = Date.now();
      return await ctx.db.insert('controlledDocumentReplacementUploads', {
        ...args,
        state: 'issued',
        cleanupPending: true,
        cleanupDueAt:
          args.uploadExpiresAt + REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS,
        cleanupAttempts: 0,
        createdAt: now,
        updatedAt: now,
      });
    },
  },
);

/**
 * Record the fresh Convex storage id immediately after the browser POST.
 *
 * This separate step makes cancel/expiry cleanup durable even when the later
 * finalize action times out before it starts. S3 staging is registered by the
 * server in the begin transaction and never accepts a client ref here.
 */
export const registerControlledDocumentReplacementUpload = mutation({
  args: {
    organizationId: v.string(),
    intentId: v.id('controlledDocumentReplacementUploads'),
    storageId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const intent = await requireIntent(ctx, args.intentId);
    assertIntentPrincipal(intent, {
      organizationId: args.organizationId,
      actorUserId: auth.userId,
    });
    if (intent.backend !== 'convex') {
      throw invalidIntent('An S3 replacement upload is registered at begin.');
    }
    if (
      intent.state === 'failed' ||
      intent.state === 'cancelled' ||
      intent.state === 'superseded' ||
      intent.state === 'cleaned'
    ) {
      throw invalidIntent(
        'The replacement upload can no longer be registered.',
      );
    }
    if (intent.stagingRef !== undefined) {
      if (String(intent.stagingRef) !== String(args.storageId)) {
        throw invalidIntent(
          'This replacement intent already owns another storage id.',
        );
      }
      return null;
    }
    await validateConvexIntentStorage(ctx, intent, args.storageId);
    await ctx.db.patch(intent._id, {
      stagingRef: args.storageId,
      finalRef: args.storageId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

const acquireResultValidator = v.object({
  phase: v.union(
    v.literal('attest'),
    v.literal('promoted'),
    v.literal('bound'),
    v.literal('rejected'),
  ),
  orgSlug: v.optional(v.string()),
  backend: v.optional(v.union(v.literal('convex'), v.literal('s3'))),
  stagingRef: v.optional(blobRefValidator),
  finalRef: v.optional(blobRefValidator),
  fileName: v.optional(v.string()),
  expectedVersion: v.optional(v.number()),
  expectedFileId: v.optional(blobRefValidator),
  clientContentType: v.optional(v.string()),
  lastModified: v.optional(v.number()),
  verifiedContentType: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  size: v.optional(v.number()),
  version: v.optional(v.number()),
  rejectionCode: v.optional(v.string()),
});

export const acquireControlledDocumentReplacementFinalize = internalMutation({
  args: {
    organizationId: v.string(),
    actorUserId: v.string(),
    intentId: v.id('controlledDocumentReplacementUploads'),
    leaseId: v.string(),
    storageId: v.optional(v.id('_storage')),
  },
  returns: acquireResultValidator,
  handler: async (ctx, args) => {
    const intent = await requireIntent(ctx, args.intentId);
    assertIntentPrincipal(intent, args);
    if (intent.state === 'bound') {
      return {
        phase: 'bound' as const,
        version: intent.resultVersion,
      };
    }
    if (
      intent.state === 'failed' ||
      intent.state === 'cancelled' ||
      intent.state === 'superseded' ||
      intent.state === 'cleaned'
    ) {
      return {
        phase: 'rejected' as const,
        rejectionCode: intent.state,
      };
    }

    const now = Date.now();
    if (
      intent.leaseId !== undefined &&
      intent.leaseId !== args.leaseId &&
      (intent.leaseExpiresAt ?? 0) > now
    ) {
      throw new ConvexError({
        code: 'UPLOAD_INTENT_IN_PROGRESS',
        message: 'This replacement upload is already being finalized.',
      });
    }

    const document = await requireReplacementDocument(ctx, intent);
    if (!replacementTargetMatches(document, intent)) {
      await supersedeReplacementIntent(
        ctx,
        intent,
        'The controlled record changed before binding.',
      );
      return {
        phase: 'rejected' as const,
        rejectionCode: 'DOCUMENT_RECORD_VERSION_MISMATCH',
      };
    }
    if ((intent.expectedRecordState ?? 'draft') === 'approved') {
      requireCurrentApprovedSnapshot(document);
    }
    await assertReplacementNotHeld(ctx, document);
    assertControlledDraftHistoryCapacity(document);

    const leaseExpiresAt = now + REPLACEMENT_UPLOAD_LEASE_MS;
    if (intent.state === 'promoted') {
      await ctx.db.patch(intent._id, {
        leaseId: args.leaseId,
        leaseExpiresAt,
        cleanupDueAt: now + REPLACEMENT_UPLOAD_RECOVERY_MS,
        updatedAt: now,
      });
      return {
        phase: 'promoted' as const,
        orgSlug: intent.orgSlug,
        backend: intent.backend,
        stagingRef: intent.stagingRef,
        finalRef: intent.finalRef,
        fileName: intent.fileName,
        expectedVersion: intent.expectedVersion,
        expectedFileId: intent.expectedFileId,
        clientContentType: intent.clientContentType,
        lastModified: intent.lastModified,
        verifiedContentType: intent.verifiedContentType,
        contentHash: intent.contentHash,
        size: intent.size,
      };
    }

    let stagingRef = intent.stagingRef;
    let finalRef = intent.finalRef;
    if (intent.backend === 'convex') {
      const registeredStorageId =
        args.storageId ?? convexStorageId(intent.stagingRef ?? '');
      if (registeredStorageId === null || registeredStorageId === undefined) {
        throw invalidIntent(
          'The Convex replacement upload did not return a storage id.',
        );
      }
      if (
        args.storageId !== undefined &&
        intent.stagingRef !== undefined &&
        String(args.storageId) !== String(intent.stagingRef)
      ) {
        throw invalidIntent(
          'This replacement intent already owns another storage id.',
        );
      }
      await validateConvexIntentStorage(ctx, intent, registeredStorageId);
      stagingRef = registeredStorageId;
      finalRef = registeredStorageId;
    } else if (args.storageId !== undefined) {
      throw invalidIntent('An S3 replacement upload cannot bind a storage id.');
    }
    if (stagingRef === undefined || finalRef === undefined) {
      throw invalidIntent('The replacement upload has no registered blob.');
    }

    if (intent.backend === 's3') {
      const existingMetadata = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', stagingRef))
        .first();
      if (existingMetadata !== null) {
        throw new ConvexError({
          code: 'UPLOAD_BLOB_ALREADY_BOUND',
          message: 'The uploaded replacement file is already in use.',
        });
      }
    }

    await ctx.db.patch(intent._id, {
      stagingRef,
      finalRef,
      state: 'attesting',
      leaseId: args.leaseId,
      leaseExpiresAt,
      cleanupDueAt: leaseExpiresAt + REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS,
      lastError: undefined,
      updatedAt: now,
    });
    return {
      phase: 'attest' as const,
      orgSlug: intent.orgSlug,
      backend: intent.backend,
      stagingRef,
      finalRef,
      fileName: intent.fileName,
      expectedVersion: intent.expectedVersion,
      expectedFileId: intent.expectedFileId,
      clientContentType: intent.clientContentType,
      lastModified: intent.lastModified,
    };
  },
});

export const recordControlledDocumentReplacementPromotion = internalMutation({
  args: {
    organizationId: v.string(),
    actorUserId: v.string(),
    intentId: v.id('controlledDocumentReplacementUploads'),
    leaseId: v.string(),
    verifiedContentType: v.string(),
    contentHash: v.string(),
    size: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await requireIntent(ctx, args.intentId);
    assertIntentPrincipal(intent, args);
    if (intent.state === 'promoted') {
      if (
        intent.verifiedContentType === args.verifiedContentType &&
        intent.contentHash === args.contentHash &&
        intent.size === args.size
      ) {
        return null;
      }
      throw invalidIntent('The promoted replacement attestation changed.');
    }
    if (
      intent.state !== 'attesting' ||
      intent.leaseId !== args.leaseId ||
      (intent.leaseExpiresAt ?? 0) <= Date.now()
    ) {
      throw invalidIntent('The replacement finalize lease expired.');
    }
    if (
      !/^[a-f0-9]{64}$/i.test(args.contentHash) ||
      !Number.isSafeInteger(args.size) ||
      args.size < 0
    ) {
      throw invalidIntent('The replacement attestation is invalid.');
    }
    const now = Date.now();
    await ctx.db.patch(intent._id, {
      state: 'promoted',
      verifiedContentType: args.verifiedContentType,
      contentHash: args.contentHash,
      size: args.size,
      cleanupDueAt: now + REPLACEMENT_UPLOAD_RECOVERY_MS,
      updatedAt: now,
    });
    return null;
  },
});

const bindResultValidator = v.union(
  v.object({
    phase: v.literal('bound'),
    version: v.number(),
  }),
  v.object({
    phase: v.literal('rejected'),
    rejectionCode: v.string(),
  }),
);

export const bindControlledDocumentReplacement = internalMutation({
  args: {
    organizationId: v.string(),
    actorUserId: v.string(),
    intentId: v.id('controlledDocumentReplacementUploads'),
    leaseId: v.string(),
  },
  returns: bindResultValidator,
  handler: async (ctx, args) => {
    const intent = await requireIntent(ctx, args.intentId);
    assertIntentPrincipal(intent, args);
    if (intent.state === 'bound' && intent.resultVersion !== undefined) {
      return { phase: 'bound' as const, version: intent.resultVersion };
    }
    if (
      intent.state !== 'promoted' ||
      intent.leaseId !== args.leaseId ||
      (intent.leaseExpiresAt ?? 0) <= Date.now() ||
      intent.finalRef === undefined ||
      intent.verifiedContentType === undefined ||
      intent.contentHash === undefined ||
      intent.size === undefined
    ) {
      throw invalidIntent(
        'The replacement upload has not been attested for this lease.',
      );
    }
    const finalRef = intent.finalRef;
    const verifiedContentType = intent.verifiedContentType;
    const contentHash = intent.contentHash;
    const size = intent.size;

    const document = await requireReplacementDocument(ctx, intent);
    const record = requireControlledRecord(document);
    if (!replacementTargetMatches(document, intent)) {
      await supersedeReplacementIntent(
        ctx,
        intent,
        'The controlled record changed before the final bind.',
      );
      return {
        phase: 'rejected' as const,
        rejectionCode: 'DOCUMENT_RECORD_VERSION_MISMATCH',
      };
    }
    if ((intent.expectedRecordState ?? 'draft') === 'approved') {
      requireCurrentApprovedSnapshot(document);
    }
    await assertReplacementNotHeld(ctx, document);
    assertControlledDraftHistoryCapacity(document);

    const expectedExtension =
      document.extension ?? extractExtension(document.title);
    const replacementExtension = extractExtension(intent.fileName);
    if (replacementExtension !== expectedExtension) {
      throw new ConvexError({
        code: 'DOCUMENT_RECORD_EXTENSION_MISMATCH',
        message: expectedExtension
          ? `Choose a .${expectedExtension} file to replace this document.`
          : 'Choose a file with the same format as this document.',
        expectedExtension,
      });
    }
    if (document.contentHash === contentHash) {
      throw new ConvexError({
        code: 'DOCUMENT_RECORD_FILE_UNCHANGED',
        message: 'The selected file has the same content as the current file.',
      });
    }

    const existingMetadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', finalRef))
      .first();
    if (existingMetadata !== null) {
      throw new ConvexError({
        code: 'UPLOAD_BLOB_ALREADY_BOUND',
        message: 'The replacement blob is already bound.',
      });
    }

    const validatedUpload = await validateDocumentUpload(ctx, {
      organizationId: intent.organizationId,
      userId: intent.actorUserId,
      fileId: finalRef,
      fileName: intent.fileName,
      contentType: verifiedContentType,
      verifiedSize: size,
    });
    if (validatedUpload.contentType !== verifiedContentType) {
      throw invalidIntent('The server attestation changed during binding.');
    }
    if (
      expectedExtension === undefined &&
      document.mimeType !== undefined &&
      verifiedContentType !== document.mimeType
    ) {
      throw new ConvexError({
        code: 'DOCUMENT_RECORD_EXTENSION_MISMATCH',
        message: 'Choose a file with the same format as this document.',
      });
    }

    const shouldIndex = isRagIndexableFile(
      intent.fileName,
      verifiedContentType,
    );
    const now = Date.now();
    await ctx.db.insert('fileMetadata', {
      organizationId: intent.organizationId,
      storageId: finalRef,
      documentId: intent.documentId,
      source: 'user',
      fileName: intent.fileName,
      contentType: verifiedContentType,
      size,
      sha256: contentHash,
      uploadedBy: intent.actorUserId,
      ragStatus: shouldIndex ? 'queued' : 'unsupported',
      ragQueuedAt: shouldIndex ? now : undefined,
    });

    let resultVersion = record.version;
    if ((intent.expectedRecordState ?? 'draft') === 'approved') {
      const opened = await openRecordRevisionInTransaction(ctx, {
        document,
        actorEmail: intent.actorEmail,
        userId: intent.actorUserId,
        metadata: {
          trigger: 'file_replacement',
          replacementIntentId: String(intent._id),
        },
      });
      resultVersion = opened.version;
    }

    const previousFileId = document.fileId;
    const previousContentHash = document.contentHash;
    const metadata = {
      ...(typeof document.metadata === 'object' &&
      document.metadata !== null &&
      !Array.isArray(document.metadata)
        ? document.metadata
        : {}),
      size,
      sourceProvider: document.sourceProvider ?? 'upload',
      sourceMode: 'manual',
      lastModified: intent.lastModified ?? now,
    };
    await replaceControlledDocumentContentInternal(ctx, {
      documentId: document._id,
      fileId: finalRef,
      mimeType: verifiedContentType,
      extension: replacementExtension,
      contentHash,
      metadata,
      deferContentReindex: true,
    });
    await maybeDispatchRagIndexing(ctx, finalRef);

    await auditRecordTransition(ctx, {
      document,
      actorEmail: intent.actorEmail,
      userId: intent.actorUserId,
      action: DOCUMENT_RECORD_AUDIT_ACTIONS.fileReplaced,
      previousState: {
        state: 'draft',
        version: resultVersion,
        fileId: previousFileId ?? null,
        contentHash: previousContentHash ?? null,
      },
      newState: {
        state: 'draft',
        version: resultVersion,
        fileId: finalRef,
        contentHash,
      },
      metadata: {
        replacementIntentId: String(intent._id),
        sourceRecordState: intent.expectedRecordState ?? 'draft',
        replacementFileName: intent.fileName,
        replacementSize: size,
      },
    });

    const cleanupPending =
      intent.stagingRef !== undefined &&
      String(intent.stagingRef) !== String(finalRef);
    const cleanupDueAt = cleanupPending
      ? cleanupDueAfterCapability(intent)
      : undefined;
    await ctx.db.patch(intent._id, {
      state: 'bound',
      resultVersion,
      cleanupPending,
      cleanupDueAt,
      leaseId: undefined,
      leaseExpiresAt: undefined,
      lastError: undefined,
      updatedAt: now,
    });
    if (cleanupPending && cleanupDueAt !== undefined) {
      await ctx.scheduler.runAfter(
        Math.max(0, cleanupDueAt - now),
        internal.documents.record_actions
          .cleanupControlledDocumentReplacementUploads,
        {},
      );
    }
    return { phase: 'bound' as const, version: resultVersion };
  },
});

export const failControlledDocumentReplacementUpload = internalMutation({
  args: {
    organizationId: v.string(),
    actorUserId: v.string(),
    intentId: v.id('controlledDocumentReplacementUploads'),
    leaseId: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await requireIntent(ctx, args.intentId);
    assertIntentPrincipal(intent, args);
    if (
      intent.state === 'bound' ||
      intent.state === 'cancelled' ||
      intent.state === 'superseded' ||
      intent.state === 'cleaned' ||
      intent.leaseId !== args.leaseId
    ) {
      return null;
    }
    const now = Date.now();
    const cleanupDueAt = cleanupDueAfterCapability(intent);
    await ctx.db.patch(intent._id, {
      state: 'failed',
      cleanupPending: true,
      cleanupDueAt,
      leaseId: undefined,
      leaseExpiresAt: undefined,
      lastError: args.error.slice(0, 1000),
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      Math.max(0, cleanupDueAt - now),
      internal.documents.record_actions
        .cleanupControlledDocumentReplacementUploads,
      {},
    );
    return null;
  },
});

export const getControlledDocumentReplacementUploadStatus = query({
  args: {
    organizationId: v.string(),
    intentId: v.id('controlledDocumentReplacementUploads'),
  },
  returns: v.object({
    state: v.union(
      v.literal('issued'),
      v.literal('attesting'),
      v.literal('promoted'),
      v.literal('bound'),
      v.literal('cancelled'),
      v.literal('superseded'),
      v.literal('failed'),
      v.literal('cleaned'),
    ),
    resultVersion: v.optional(v.number()),
    cleanupPending: v.boolean(),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (authUser === null) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.organizationId !== args.organizationId ||
      intent.actorUserId !== authUser.userId
    ) {
      throw invalidIntent('Replacement upload intent not found.');
    }
    await getOrganizationMember(ctx, args.organizationId, authUser);
    return {
      state: intent.state,
      resultVersion: intent.resultVersion,
      cleanupPending: intent.cleanupPending,
      lastError: intent.lastError,
      updatedAt: intent.updatedAt,
    };
  },
});

export const getControlledDocumentReplacementUploadStatusForPrincipal =
  internalQuery({
    args: {
      organizationId: v.string(),
      actorUserId: v.string(),
      intentId: v.id('controlledDocumentReplacementUploads'),
    },
    returns: v.object({
      state: v.union(
        v.literal('issued'),
        v.literal('attesting'),
        v.literal('promoted'),
        v.literal('bound'),
        v.literal('cancelled'),
        v.literal('superseded'),
        v.literal('failed'),
        v.literal('cleaned'),
      ),
      resultVersion: v.optional(v.number()),
      cleanupPending: v.boolean(),
      lastError: v.optional(v.string()),
      updatedAt: v.number(),
    }),
    handler: async (ctx, args) => {
      const intent = await ctx.db.get(args.intentId);
      if (
        intent === null ||
        intent.organizationId !== args.organizationId ||
        intent.actorUserId !== args.actorUserId
      ) {
        throw invalidIntent('Replacement upload intent not found.');
      }
      return {
        state: intent.state,
        resultVersion: intent.resultVersion,
        cleanupPending: intent.cleanupPending,
        lastError: intent.lastError,
        updatedAt: intent.updatedAt,
      };
    },
  });

export const cancelControlledDocumentReplacementUpload = mutation({
  args: {
    organizationId: v.string(),
    intentId: v.id('controlledDocumentReplacementUploads'),
  },
  returns: v.object({
    state: v.union(v.literal('bound'), v.literal('cancelled')),
    resultVersion: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const intent = await requireIntent(ctx, args.intentId);
    assertIntentPrincipal(intent, {
      organizationId: args.organizationId,
      actorUserId: auth.userId,
    });
    if (intent.state === 'bound') {
      return { state: 'bound' as const, resultVersion: intent.resultVersion };
    }
    const now = Date.now();
    const cleanupDueAt = cleanupDueAfterCapability(intent);
    await ctx.db.patch(intent._id, {
      state: 'cancelled',
      cleanupPending: true,
      cleanupDueAt,
      leaseId: undefined,
      leaseExpiresAt: undefined,
      lastError: 'Replacement upload cancelled.',
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      Math.max(0, cleanupDueAt - now),
      internal.documents.record_actions
        .cleanupControlledDocumentReplacementUploads,
      {},
    );
    return { state: 'cancelled' as const };
  },
});

export const leaseControlledDocumentReplacementCleanupBatch = internalMutation({
  args: {},
  returns: v.array(
    v.object({
      intentId: v.id('controlledDocumentReplacementUploads'),
      orgSlug: v.string(),
      refs: v.array(blobRefValidator),
    }),
  ),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query('controlledDocumentReplacementUploads')
      .withIndex('by_cleanupPending_due', (q) =>
        q.eq('cleanupPending', true).lte('cleanupDueAt', now),
      )
      .take(MAX_CLEANUP_BATCH);
    const leased: Array<{
      intentId: Id<'controlledDocumentReplacementUploads'>;
      orgSlug: string;
      refs: BlobRef[];
    }> = [];
    for (const intent of due) {
      if (
        (intent.state === 'attesting' || intent.state === 'promoted') &&
        (intent.leaseExpiresAt ?? 0) > now
      ) {
        await ctx.db.patch(intent._id, {
          cleanupDueAt:
            (intent.leaseExpiresAt ?? now) +
            REPLACEMENT_UPLOAD_CLEANUP_GRACE_MS,
          updatedAt: now,
        });
        continue;
      }

      const refs =
        intent.state === 'bound'
          ? intent.stagingRef !== undefined &&
            String(intent.stagingRef) !== String(intent.finalRef)
            ? [intent.stagingRef]
            : []
          : [intent.stagingRef, intent.finalRef].filter(
              (ref): ref is BlobRef => ref !== undefined,
            );
      const uniqueRefs = refs.filter(
        (ref, index) =>
          refs.findIndex((candidate) => String(candidate) === String(ref)) ===
          index,
      );
      const deletableRefs: BlobRef[] = [];
      for (const ref of uniqueRefs) {
        const [metadata, currentDocument] = await Promise.all([
          ctx.db
            .query('fileMetadata')
            .withIndex('by_storageId', (q) => q.eq('storageId', ref))
            .first(),
          ctx.db
            .query('documents')
            .withIndex('by_organizationId_and_fileId', (q) =>
              q.eq('organizationId', intent.organizationId).eq('fileId', ref),
            )
            .first(),
        ]);
        // A ref adopted through another legitimate writer is no longer an
        // orphan owned by this intent. Cleanup must never delete shared bytes.
        if (metadata === null && currentDocument === null) {
          deletableRefs.push(ref);
        }
      }
      if (deletableRefs.length === 0) {
        await ctx.db.patch(intent._id, {
          state: intent.state === 'bound' ? 'bound' : 'cleaned',
          cleanupPending: false,
          cleanupDueAt: undefined,
          leaseId: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
        continue;
      }
      if (
        intent.state === 'issued' ||
        intent.state === 'attesting' ||
        intent.state === 'promoted'
      ) {
        await ctx.db.patch(intent._id, {
          state: 'failed',
          lastError: 'Replacement upload expired before it was bound.',
          cleanupDueAt: now + CLEANUP_ACTION_LEASE_MS,
          cleanupAttempts: intent.cleanupAttempts + 1,
          leaseId: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(intent._id, {
          cleanupDueAt: now + CLEANUP_ACTION_LEASE_MS,
          cleanupAttempts: intent.cleanupAttempts + 1,
          updatedAt: now,
        });
      }
      leased.push({
        intentId: intent._id,
        orgSlug: intent.orgSlug,
        refs: deletableRefs,
      });
    }
    return leased;
  },
});

export const completeControlledDocumentReplacementCleanup = internalMutation({
  args: {
    intentId: v.id('controlledDocumentReplacementUploads'),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (intent === null || !intent.cleanupPending) return null;
    const now = Date.now();
    if (args.error === undefined) {
      await ctx.db.patch(intent._id, {
        state: intent.state === 'bound' ? 'bound' : 'cleaned',
        cleanupPending: false,
        cleanupDueAt: undefined,
        leaseId: undefined,
        leaseExpiresAt: undefined,
        lastError: intent.state === 'bound' ? undefined : intent.lastError,
        updatedAt: now,
      });
      return null;
    }
    const retryMs = Math.min(
      60 * 60 * 1000,
      30_000 * 2 ** Math.min(intent.cleanupAttempts, 7),
    );
    await ctx.db.patch(intent._id, {
      cleanupPending: true,
      cleanupDueAt: now + retryMs,
      lastError: `Cleanup failed: ${args.error.slice(0, 900)}`,
      updatedAt: now,
    });
    return null;
  },
});
