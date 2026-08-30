/**
 * The upload handshake of the projects REST door.
 *
 * `POST /api/v1/projects/{id}/uploads` mints a backend-aware upload handoff
 * (`files/blob_actions.generateRestBlobUpload`) plus ONE row here binding the
 * handoff to `(organizationId, userId, projectId)` — the row's `_id` is the
 * wire `uploadId`. `POST /api/v1/projects/{id}/files` CONSUMES the row
 * (single-use) in the SAME transaction as the document create — a refused
 * create rolls the consume back, so the handshake survives a corrected retry
 * — and the bind step never has to trust a caller-supplied blob reference:
 *
 *   - S3 handoff: the intent pins the presigned object key (`s3Ref`), and the
 *     bind's `fileId` must equal it exactly.
 *   - Convex handoff: the uploaded `_storage` id is only known to the
 *     uploader after the POST, so the intent carries no reference; the bind's
 *     `fileId` must be a valid `_storage` id NOT already claimed by any
 *     `fileMetadata` row (the `by_storageId` probe), which blocks re-binding
 *     another tenant's or another upload's blob.
 *
 * Every refusal — absent, expired, foreign org/user/project, reference
 * mismatch, already claimed — answers the same `UPLOAD_BLOB_INVALID` (→ 400),
 * so a prober learns nothing about which check failed.
 *
 * TTL + lazy sweep (the `automations/upload_mutations.ts` posture): a crashed
 * worker never consumes its intent, so expired rows are collected on the next
 * mint instead of by a cron — the table only ever holds in-flight handshakes.
 * An expired S3-lane row still names its object, so the sweep schedules
 * `deleteOrgBlobs` for it (best-effort orphan cleanup). Convex-lane intents
 * carry no storageId, so their orphaned blobs are unsweepable from here —
 * the same exposure as the session upload flow, where `generateBlobUpload`
 * hands out POST URLs with no claim row either.
 */

import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { resolveProjectAccessForUser } from './resolve_project_access';

/** An intent this old belongs to a crashed/abandoned handshake — sweepable
 * (same 60-minute TTL as the automations upload lane). */
export const REST_UPLOAD_INTENT_TTL_MS = 60 * 60 * 1000;

/** The one opaque refusal every bad handshake answers. */
function uploadRefusal(): AppError<{ code: string; message: string }> {
  return new AppError({
    code: 'UPLOAD_BLOB_INVALID',
    message: 'Upload not found or expired',
  });
}

/** Best-effort reclaim of expired S3-lane objects, grouped per org so one
 * scheduler call covers each tenant's batch. */
async function scheduleExpiredBlobCleanup(
  ctx: MutationCtx,
  refsByOrg: Map<string, string[]>,
): Promise<void> {
  for (const [organizationId, refs] of refsByOrg) {
    await ctx.scheduler.runAfter(
      0,
      internal.files.blob_actions.deleteOrgBlobs,
      { organizationId, refs },
    );
  }
}

export const createRestUploadIntent = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.string(),
    /** The presigned S3 object ref, iff the handoff was a PUT. */
    s3Ref: v.optional(v.string()),
  },
  returns: v.object({
    uploadId: v.id('restUploadIntents'),
    expiresAt: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ uploadId: Id<'restUploadIntents'>; expiresAt: number }> => {
    const projectId = ctx.db.normalizeId('projects', args.projectId);
    if (projectId === null) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }
    // Re-run the project edit gate with the explicit user, so this mutation
    // is safe standalone (the REST handler also pre-checks before presigning).
    // An invisible project reads as absent — the door's opaque-404 posture.
    const access = await resolveProjectAccessForUser(ctx, projectId, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    if (!access.canRead) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }
    if (!access.canEdit) {
      throw new AppError({
        code: 'RBAC_FORBIDDEN',
        message: 'You do not have permission to add files to this project',
      });
    }

    // Lazy sweep: collect expired handshakes (and reclaim their S3 objects)
    // on the next mint instead of by a cron. The table only ever holds
    // in-flight uploads, so the full scan is a handful of rows.
    const cutoff = Date.now() - REST_UPLOAD_INTENT_TTL_MS;
    const rows = await ctx.db.query('restUploadIntents').collect();
    const expiredS3RefsByOrg = new Map<string, string[]>();
    for (const row of rows) {
      if (row.createdAt >= cutoff) continue;
      await ctx.db.delete(row._id);
      if (row.s3Ref !== undefined) {
        const refs = expiredS3RefsByOrg.get(row.organizationId) ?? [];
        refs.push(row.s3Ref);
        expiredS3RefsByOrg.set(row.organizationId, refs);
      }
    }
    await scheduleExpiredBlobCleanup(ctx, expiredS3RefsByOrg);

    const now = Date.now();
    const uploadId = await ctx.db.insert('restUploadIntents', {
      organizationId: args.organizationId,
      userId: args.userId,
      projectId,
      s3Ref: args.s3Ref,
      createdAt: now,
    });
    return { uploadId, expiresAt: now + REST_UPLOAD_INTENT_TTL_MS };
  },
});

export interface ConsumeRestUploadIntentArgs {
  organizationId: string;
  userId: string;
  projectId: string;
  uploadId: string;
  fileId: string;
}

/**
 * Verify-and-consume core, exported so the bind mutation
 * (`documents/internal_mutations.createDocumentFromUploadForUser`) runs it in
 * the SAME transaction as the document create: a refusal anywhere after the
 * consume (wrong folder, upload policy, the per-org `file:upload` budget)
 * rolls the delete back, so the handshake stays live for a corrected retry
 * instead of orphaning the uploaded object. The same transaction also closes
 * the claimed-probe/insert race: the `fileMetadata` row lands atomically with
 * the probe, so two parallel binds of one blob serialize under OCC and the
 * loser is refused.
 */
export async function consumeRestUploadIntentCore(
  ctx: MutationCtx,
  args: ConsumeRestUploadIntentArgs,
): Promise<void> {
  const projectId = ctx.db.normalizeId('projects', args.projectId);
  const intentId = ctx.db.normalizeId('restUploadIntents', args.uploadId);
  if (projectId === null || intentId === null) throw uploadRefusal();

  const intent = await ctx.db.get(intentId);
  if (
    !intent ||
    intent.organizationId !== args.organizationId ||
    intent.userId !== args.userId ||
    intent.projectId !== projectId
  ) {
    throw uploadRefusal();
  }

  if (intent.createdAt < Date.now() - REST_UPLOAD_INTENT_TTL_MS) {
    // The handshake died of old age. Refuse WITHOUT touching the row: this
    // code path throws, so any delete here would roll back with it — the
    // corpse (and its S3 object) is the mint-time sweep's to collect.
    throw uploadRefusal();
  }

  if (intent.s3Ref !== undefined) {
    // S3 lane: the bind must claim exactly the object this intent presigned.
    if (args.fileId !== intent.s3Ref) throw uploadRefusal();
  } else {
    // Convex lane: any valid `_storage` id — but only an UNCLAIMED one. A
    // fileMetadata row means the blob already belongs to some upload
    // (possibly another tenant's); re-binding it would move bytes across a
    // boundary the intent never covered.
    const storageId = ctx.db.system.normalizeId('_storage', args.fileId);
    if (storageId === null) throw uploadRefusal();
    const claimed = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.fileId))
      .first();
    if (claimed) throw uploadRefusal();
  }

  // Single-use: the row is gone the moment a bind presents it (and only
  // COMMITS with the bind's transaction), so a second bind with the same
  // uploadId answers the same opaque refusal.
  await ctx.db.delete(intent._id);
}

export const consumeRestUploadIntent = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.string(),
    uploadId: v.string(),
    fileId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await consumeRestUploadIntentCore(ctx, args);
    return null;
  },
});
