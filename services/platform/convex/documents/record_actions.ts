'use node';

import { createHash, randomUUID } from 'node:crypto';

import { ConvexError, v } from 'convex/values';

import { DOCUMENT_MAX_FILE_SIZE } from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { action, internalAction } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  deleteBlob,
  generateReplacementBlobUpload,
  putImmutableS3Blob,
  readBlobBytes,
  s3BlobSize,
} from '../lib/storage/blob_access';
import { parseBlobRef, type BlobRef } from '../lib/storage/blob_ref';
import { attestDocumentContentType } from './attest_document_bytes';
import { controlledDocumentReplacementExpectedRecordStateValidator } from './schema';

interface BeginReplacementUploadResult {
  intentId: Id<'controlledDocumentReplacementUploads'>;
  url: string;
  method: 'POST' | 'PUT';
  uploadContentType: string;
  uploadExpiresAt: number;
}

interface ReplacementUploadStatus {
  state:
    | 'issued'
    | 'attesting'
    | 'promoted'
    | 'bound'
    | 'cancelled'
    | 'superseded'
    | 'failed'
    | 'cleaned';
  resultVersion?: number;
  cleanupPending: boolean;
  lastError?: string;
  updatedAt: number;
}

function invalidBlob(message: string) {
  return new ConvexError({
    code: 'UPLOAD_BLOB_INVALID',
    message,
  });
}

function fileTooLarge() {
  return new ConvexError({
    code: 'FILE_TOO_LARGE',
    message: `File exceeds the ${Math.round(
      DOCUMENT_MAX_FILE_SIZE / (1024 * 1024),
    )} MB limit`,
    reasonCode: 'file_too_large',
    limitBytes: DOCUMENT_MAX_FILE_SIZE,
  });
}

/**
 * Read the object from the organization-owned backend before binding it.
 *
 * Convex storage ids are proven to exist through `ctx.storage.get`; S3 refs
 * pass through `readBlobBytes`, whose namespace guard rejects keys outside the
 * organization's slug. Size and SHA-256 therefore come from the bytes the
 * server actually read, never from browser metadata.
 */
async function readReplacementBytes(
  ctx: ActionCtx,
  orgSlug: string,
  fileId: BlobRef,
): Promise<Uint8Array> {
  const parsed = parseBlobRef(fileId);
  if (parsed.backend === 'convex') {
    const blob = await ctx.storage.get(parsed.storageId);
    if (blob === null) {
      throw invalidBlob('The uploaded replacement file no longer exists.');
    }
    if (blob.size > DOCUMENT_MAX_FILE_SIZE) throw fileTooLarge();
    return new Uint8Array(await blob.arrayBuffer());
  }

  let declaredSize: number | null;
  try {
    declaredSize = await s3BlobSize(orgSlug, fileId);
  } catch {
    throw invalidBlob(
      'The uploaded replacement file is outside this organization.',
    );
  }
  if (declaredSize === null) {
    throw invalidBlob('The uploaded replacement file no longer exists.');
  }
  if (declaredSize > DOCUMENT_MAX_FILE_SIZE) throw fileTooLarge();

  let bytes: Uint8Array;
  try {
    bytes = await readBlobBytes(ctx, orgSlug, fileId);
  } catch {
    throw invalidBlob('The uploaded replacement file could not be verified.');
  }
  if (bytes.byteLength > DOCUMENT_MAX_FILE_SIZE) throw fileTooLarge();
  return bytes;
}

export const beginControlledDocumentReplacementUpload = action({
  args: {
    organizationId: v.string(),
    documentId: v.id('documents'),
    expectedRecordState:
      controlledDocumentReplacementExpectedRecordStateValidator,
    expectedVersion: v.number(),
    expectedFileId: v.union(v.id('_storage'), v.string()),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    lastModified: v.optional(v.number()),
  },
  returns: v.object({
    intentId: v.id('controlledDocumentReplacementUploads'),
    url: v.string(),
    method: v.union(v.literal('POST'), v.literal('PUT')),
    uploadContentType: v.string(),
    uploadExpiresAt: v.number(),
  }),
  handler: async (ctx, args): Promise<BeginReplacementUploadResult> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const intentNonce = randomUUID();
    const handoff = await generateReplacementBlobUpload(
      ctx,
      auth.orgSlug,
      intentNonce,
      args.contentType,
    );
    const intentId: Id<'controlledDocumentReplacementUploads'> =
      await ctx.runMutation(
        internal.documents.replacement_uploads
          .createControlledDocumentReplacementUploadIntent,
        {
          organizationId: args.organizationId,
          orgSlug: auth.orgSlug,
          actorUserId: auth.userId,
          actorEmail: auth.email,
          documentId: args.documentId,
          expectedRecordState: args.expectedRecordState,
          expectedVersion: args.expectedVersion,
          expectedFileId: args.expectedFileId,
          fileName: args.fileName,
          clientContentType: args.contentType,
          lastModified: args.lastModified,
          backend: handoff.backend,
          intentNonce,
          stagingRef: handoff.stagingRef,
          finalRef: handoff.finalRef,
          uploadExpiresAt: handoff.uploadExpiresAt,
        },
      );
    return {
      intentId,
      url: handoff.url,
      method: handoff.method,
      uploadContentType: handoff.uploadContentType,
      uploadExpiresAt: handoff.uploadExpiresAt,
    };
  },
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Attest, promote and atomically bind one intent-owned replacement upload.
 *
 * The only client-supplied blob reference is the fresh Convex storage id;
 * the acquire mutation accepts it only when its stored content type carries
 * this intent's nonce. S3 refs never cross the finalize API boundary.
 */
export const finalizeControlledDocumentReplacementUpload = action({
  args: {
    organizationId: v.string(),
    intentId: v.id('controlledDocumentReplacementUploads'),
    storageId: v.optional(v.id('_storage')),
  },
  returns: v.object({ version: v.number() }),
  handler: async (ctx, args): Promise<{ version: number }> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const leaseId = randomUUID();
    const principal = {
      organizationId: args.organizationId,
      actorUserId: auth.userId,
      intentId: args.intentId,
      leaseId,
    };
    let acquired = false;
    try {
      const intent = await ctx.runMutation(
        internal.documents.replacement_uploads
          .acquireControlledDocumentReplacementFinalize,
        { ...principal, storageId: args.storageId },
      );
      if (intent.phase === 'bound') {
        if (intent.version === undefined) {
          throw invalidBlob('The completed replacement has no result version.');
        }
        return { version: intent.version };
      }
      if (intent.phase === 'rejected') {
        throw new ConvexError({
          code: intent.rejectionCode ?? 'UPLOAD_INTENT_INVALID',
          message: 'The replacement upload can no longer be finalized.',
        });
      }
      acquired = true;

      if (intent.phase === 'attest') {
        if (
          intent.orgSlug === undefined ||
          intent.backend === undefined ||
          intent.stagingRef === undefined ||
          intent.finalRef === undefined ||
          intent.fileName === undefined
        ) {
          throw invalidBlob(
            'The replacement upload registration is incomplete.',
          );
        }
        const bytes = await readReplacementBytes(
          ctx,
          intent.orgSlug,
          intent.stagingRef,
        );
        const verifiedContentType = await attestDocumentContentType(
          bytes,
          intent.fileName,
        );
        const contentHash = createHash('sha256').update(bytes).digest('hex');

        if (intent.backend === 's3') {
          await putImmutableS3Blob(
            intent.orgSlug,
            intent.finalRef,
            bytes,
            verifiedContentType,
          );
          const promotedBytes = await readBlobBytes(
            ctx,
            intent.orgSlug,
            intent.finalRef,
          );
          const promotedHash = createHash('sha256')
            .update(promotedBytes)
            .digest('hex');
          if (promotedHash !== contentHash) {
            throw invalidBlob(
              'The immutable replacement object does not match its attestation.',
            );
          }
        }

        await ctx.runMutation(
          internal.documents.replacement_uploads
            .recordControlledDocumentReplacementPromotion,
          {
            ...principal,
            verifiedContentType,
            contentHash,
            size: bytes.byteLength,
          },
        );
      }

      const bound = await ctx.runMutation(
        internal.documents.replacement_uploads
          .bindControlledDocumentReplacement,
        principal,
      );
      if (bound.phase === 'rejected') {
        throw new ConvexError({
          code: bound.rejectionCode,
          message: 'The controlled record changed before the final bind.',
        });
      }
      return { version: bound.version };
    } catch (error) {
      if (acquired) {
        await ctx
          .runMutation(
            internal.documents.replacement_uploads
              .failControlledDocumentReplacementUpload,
            { ...principal, error: errorMessage(error) },
          )
          .catch(() => undefined);
      }
      throw error;
    }
  },
});

export const reconcileControlledDocumentReplacementUpload = action({
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
  handler: async (ctx, args): Promise<ReplacementUploadStatus> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    return await ctx.runQuery(
      internal.documents.replacement_uploads
        .getControlledDocumentReplacementUploadStatusForPrincipal,
      {
        organizationId: args.organizationId,
        actorUserId: auth.userId,
        intentId: args.intentId,
      },
    );
  },
});

/**
 * Physically remove due staging/orphan refs, acknowledging the intent only
 * after every delete succeeds. Failed deletes stay durable with backoff.
 */
export const cleanupControlledDocumentReplacementUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const batch = await ctx.runMutation(
      internal.documents.replacement_uploads
        .leaseControlledDocumentReplacementCleanupBatch,
      {},
    );
    for (const item of batch) {
      try {
        for (const ref of item.refs) {
          await deleteBlob(ctx, item.orgSlug, ref);
        }
        await ctx.runMutation(
          internal.documents.replacement_uploads
            .completeControlledDocumentReplacementCleanup,
          { intentId: item.intentId },
        );
      } catch (error) {
        await ctx.runMutation(
          internal.documents.replacement_uploads
            .completeControlledDocumentReplacementCleanup,
          {
            intentId: item.intentId,
            error: errorMessage(error),
          },
        );
      }
    }
    return null;
  },
});

/**
 * Disabled compatibility boundary for clients that have not moved to
 * begin/finalize intents. Accepting a raw blob ref here would restore the
 * ownership defect the intent protocol closes.
 */
export const replaceControlledDocumentFile = action({
  args: {
    organizationId: v.string(),
    documentId: v.id('documents'),
    expectedVersion: v.number(),
    expectedFileId: v.union(v.id('_storage'), v.string()),
    fileId: v.union(v.id('_storage'), v.string()),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    lastModified: v.optional(v.number()),
  },
  returns: v.object({ version: v.number() }),
  handler: async () => {
    throw new ConvexError({
      code: 'UPLOAD_INTENT_REQUIRED',
      message: 'Begin a replacement upload intent before finalizing the file.',
    });
  },
});
