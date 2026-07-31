import { ConvexError, v } from 'convex/values';

import {
  extractExtension,
  isRagIndexableFile,
} from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { checkUploadPolicy } from '../governance/upload_enforcement';
import {
  RateLimitExceededError,
  checkOrganizationRateLimit,
} from '../lib/rate_limiter/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { blobRefValidator, isS3Ref } from '../lib/storage/blob_ref';
import { maybeDispatchRagIndexing } from './rag_dispatch';

export const saveFileMetadata = mutation({
  args: {
    organizationId: v.string(),
    // Blob reference: a Convex `_storage` id (default) OR an `s3:<key>` ref when
    // the org has a bring-your-own bucket. The chat composer binds whichever the
    // upload handoff returned; the RAG-index + transcription reads are
    // backend-aware.
    storageId: blobRefValidator,
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    documentId: v.optional(v.id('documents')),
    // Open provenance string (see fileMetadata schema); the UI passes 'user'.
    source: v.optional(v.string()),
    /**
     * For chat-uploaded files only. Binds the row to a chat thread so the
     * thread's lifecycle (trash → grace → hard-delete + restore) cascades
     * to the file. Document Hub uploads omit this field. The mutation
     * verifies the caller has access to the supplied thread to prevent
     * spoofing across orgs.
     */
    threadId: v.optional(v.string()),
    /**
     * Suppress automatic RAG indexing for this upload. The composer sets
     * this when the active conversation targets an external agent (sandbox
     * sessions like Claude Code): those agents receive attachments by
     * file-staging into the sandbox (see external_agent/attachment_files),
     * not via the knowledge base, so indexing them is wasted work that only
     * produces a spurious "Index failed" badge. Worst case a client lies and
     * skips indexing its own file — the file stays usable inline; nothing
     * cross-tenant is exposed, so this stays a client-supplied hint.
     */
    skipRagIndexing: v.optional(v.boolean()),
  },
  async handler(ctx, args) {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    // Authorization boundary: the caller must be an (enabled) member of the
    // org they are writing into. Without this, any authenticated user could
    // inject fileMetadata rows into a foreign org and RAG-index
    // attacker-controlled content into that org's namespace (knowledge
    // poisoning) — checkUploadPolicy/the threadId gate below are not a
    // substitute (the policy defaults to allowed, and the threadId gate only
    // fires for thread-bound chat uploads). Mirrors documents/mutations.ts.
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const userId = authUser.userId;
    const ext = extractExtension(args.fileName);
    const check = await checkUploadPolicy(
      ctx,
      args.organizationId,
      userId,
      ext,
      args.contentType,
      args.size,
    );
    if (!check.allowed) {
      // Preserve the policy's human-readable reason as structured data so the
      // composer can surface why the upload was rejected; a raw Error message
      // is redacted to "Server Error" by Convex in prod. `reasonCode` +
      // usage bytes let the client show an actionable, localized message
      // (e.g. a full per-user volume quota rather than a generic failure).
      throw new ConvexError({
        code: 'UPLOAD_REJECTED',
        reason: check.reason ?? 'Upload rejected by organization policy',
        reasonCode: check.reasonCode,
        ...(check.usedBytes != null && { usedBytes: check.usedBytes }),
        ...(check.limitBytes != null && { limitBytes: check.limitBytes }),
      });
    }

    // Defense-in-depth: a malicious client could pass a foreign org's
    // threadId. Verify the supplied thread belongs to the same org.
    // (Caller-thread membership / role is enforced by the chat send
    // mutation upstream; this is the cross-org gate.)
    const threadId = args.threadId;
    if (threadId !== undefined) {
      const threadMeta = await ctx.db
        .query('threadMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
        .unique();
      if (
        threadMeta &&
        threadMeta.organizationId !== undefined &&
        threadMeta.organizationId !== args.organizationId
      ) {
        throw new ConvexError({ code: 'THREAD_ORG_MISMATCH' });
      }
    }

    // Audio AND video files go through the transcription pipeline (ffmpeg
    // strips video via `-vn`, transcribes the audio track).
    const isAudio =
      args.contentType.startsWith('audio/') ||
      args.contentType.startsWith('video/');

    // Only queue formats the RAG service can actually index. Force-queueing
    // anything else (legacy Office .doc/.xls/.ppt, misc text extensions)
    // earns a deterministic HTTP 400 from RAG and a permanent "Index
    // failed" badge. Non-indexable files keep ragStatus undefined — the
    // audio pattern — and stay usable inline in chat.
    const shouldIndex =
      !args.skipRagIndexing &&
      !isAudio &&
      isRagIndexableFile(args.fileName, args.contentType);

    const now = Date.now();

    const existing = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();

    if (existing) {
      const patchData: Record<string, unknown> = {
        fileName: args.fileName,
        contentType: args.contentType,
        size: args.size,
        uploadedBy: userId,
      };
      if (args.documentId !== undefined) {
        patchData.documentId = args.documentId;
      }
      if (args.source !== undefined) {
        patchData.source = args.source;
      }

      // If the prior pipeline didn't reach a terminal state (failed /
      // undefined for the non-audio RAG path, or for the audio
      // transcription path), reset and re-schedule. Without this, a row
      // left at `queued` by a silently-dropped scheduled action would
      // stay stuck forever.
      const needsRagRetry =
        shouldIndex &&
        (existing.ragStatus === undefined || existing.ragStatus === 'failed');
      const needsTranscribeRetry =
        isAudio &&
        (existing.transcriptionStatus === undefined ||
          existing.transcriptionStatus === 'failed');

      if (needsRagRetry) {
        patchData.ragStatus = 'queued';
        patchData.ragError = undefined;
        patchData.ragErrorCode = undefined;
        patchData.ragProgress = undefined;
        patchData.ragQueuedAt = now;
      }
      // A non-indexable re-upload clears RAG state left over from the
      // pre-allowlist era (rows deterministically failed by RAG's 400),
      // so the composer stops showing a stale "Index failed" for formats
      // that were never indexable.
      if (
        !isAudio &&
        !shouldIndex &&
        (existing.ragStatus === 'failed' || existing.ragStatus === 'queued')
      ) {
        patchData.ragStatus = undefined;
        patchData.ragError = undefined;
        patchData.ragErrorCode = undefined;
        patchData.ragProgress = undefined;
        patchData.ragQueuedAt = undefined;
      }
      if (needsTranscribeRetry) {
        patchData.transcriptionStatus = 'queued';
        patchData.transcriptionError = undefined;
        patchData.transcriptionProgress = undefined;
      }

      await ctx.db.patch(existing._id, patchData);

      if (needsRagRetry) {
        await maybeDispatchRagIndexing(ctx, args.storageId);
      }
      if (needsTranscribeRetry) {
        await ctx.scheduler.runAfter(
          0,
          internal.file_metadata.transcribe_audio.transcribeAudio,
          {
            storageId: args.storageId,
            fileName: args.fileName,
            contentType: args.contentType,
            organizationId: args.organizationId,
          },
        );
      }

      return existing._id;
    }

    const id = await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      // RAG runs on the primary upload for indexable non-audio files;
      // audio's transcript is indexed to RAG separately after
      // transcription succeeds, and non-indexable formats are never
      // queued (RAG would reject them with HTTP 400).
      ragStatus: shouldIndex ? 'queued' : undefined,
      ragQueuedAt: shouldIndex ? now : undefined,
      transcriptionStatus: isAudio ? 'queued' : undefined,
      uploadedBy: userId,
      ...(args.documentId !== undefined && { documentId: args.documentId }),
      ...(args.source !== undefined && { source: args.source }),
      ...(args.threadId !== undefined && { threadId: args.threadId }),
    });

    if (shouldIndex) {
      await maybeDispatchRagIndexing(ctx, args.storageId);
    }

    if (isAudio) {
      await ctx.scheduler.runAfter(
        0,
        internal.file_metadata.transcribe_audio.transcribeAudio,
        {
          storageId: args.storageId,
          fileName: args.fileName,
          contentType: args.contentType,
          organizationId: args.organizationId,
        },
      );
    }

    await ctx.scheduler.runAfter(
      0,
      internal.file_metadata.internal_actions.extractFileMetadata,
      {
        storageId: args.storageId,
        fileName: args.fileName,
        contentType: args.contentType,
        organizationId: args.organizationId,
      },
    );

    // An `s3:` blob was uploaded by a presigned PUT (no Content-Length gate),
    // so verify its real size server-side and reject/correct past the cap.
    if (isS3Ref(args.storageId)) {
      await ctx.scheduler.runAfter(
        0,
        internal.files.blob_actions.verifyS3BlobSize,
        {
          storageId: String(args.storageId),
          organizationId: args.organizationId,
        },
      );
    }

    try {
      await checkOrganizationRateLimit(
        ctx,
        'cleanup:retention',
        args.organizationId,
      );
      await ctx.scheduler.runAfter(
        0,
        internal.governance.retention_cleanup.runRetentionCleanup,
        {},
      );
    } catch (error) {
      if (!(error instanceof RateLimitExceededError)) {
        throw error;
      }
    }

    return id;
  },
});

/**
 * Mark a stuck transcription as user-skipped. Unblocks the chat send-gate when
 * the audio is taking too long (client shows a Skip button after 60s of
 * `running`). Same downstream effect as `failed` — the message sends with a
 * "could not be transcribed" marker.
 */
export const skipTranscription = mutation({
  args: {
    // Blob reference (`_storage` id or `s3:` ref) — a chat audio attachment may
    // live in the org's own bucket. The transcription mutations key the
    // fileMetadata row off the string form either way.
    storageId: blobRefValidator,
    organizationId: v.string(),
  },
  async handler(ctx, args) {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) throw new ConvexError({ code: 'FILE_NOT_FOUND' });
    // Authorization boundary: assert membership against the row's own org.
    // The self-reported organizationId === metadata.organizationId check
    // below catches caller mistakes but is not an authorization boundary on
    // its own (both values are caller-controlled).
    await getOrganizationMember(ctx, metadata.organizationId, authUser);
    if (metadata.organizationId !== args.organizationId) {
      throw new ConvexError({ code: 'NOT_AUTHORIZED' });
    }

    // Source-state precondition. `skipTranscription` is the Skip button
    // the chat composer shows after 60s of `running` — it only makes
    // sense to skip a transcription that's actively in flight or queued.
    // Skipping a `completed` row would clobber the transcript and
    // cascade `videoLinkJobs` into a failed state for a successful run.
    if (
      metadata.transcriptionStatus !== 'queued' &&
      metadata.transcriptionStatus !== 'running'
    ) {
      throw new ConvexError({
        code: 'TRANSCRIPTION_NOT_SKIPPABLE',
        status: metadata.transcriptionStatus ?? 'none',
      });
    }

    // Route through `updateFileTranscription` so the `videoLinkJobs`
    // cascade at internal_mutations.ts:319-345 fires correctly for
    // video-link audio (Whisper branch). Direct `db.patch` here would
    // leave the linked job stuck at `transcribing_handoff` forever.
    await ctx.runMutation(
      internal.file_metadata.internal_mutations.updateFileTranscription,
      {
        storageId: args.storageId,
        transcriptionStatus: 'skipped',
        transcriptionError: 'User skipped transcription',
      },
    );
  },
});

/**
 * Retry a failed transcription. Resets status to `queued` and re-schedules
 * the `transcribeAudio` action. The action itself classifies errors as
 * retryable vs permanent — this endpoint just resets the counter.
 */
export const retryTranscription = mutation({
  args: {
    // Blob reference (`_storage` id or `s3:` ref) — a chat audio attachment may
    // live in the org's own bucket. The transcription mutations key the
    // fileMetadata row off the string form either way.
    storageId: blobRefValidator,
    organizationId: v.string(),
  },
  async handler(ctx, args) {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) throw new ConvexError({ code: 'FILE_NOT_FOUND' });
    // Authorization boundary: assert membership against the row's own org.
    // The self-reported organizationId === metadata.organizationId check
    // below catches caller mistakes but is not an authorization boundary on
    // its own (both values are caller-controlled).
    await getOrganizationMember(ctx, metadata.organizationId, authUser);
    if (metadata.organizationId !== args.organizationId) {
      throw new ConvexError({ code: 'NOT_AUTHORIZED' });
    }

    // Source-state precondition. Retry is only valid from a terminal
    // failure state — retrying `running` would double-bill Whisper
    // (single-flight gate catches it now, but the UI still shouldn't
    // surface a "Retry" button for an in-flight row); retrying
    // `completed` would clobber the existing transcript.
    if (
      metadata.transcriptionStatus !== 'failed' &&
      metadata.transcriptionStatus !== 'skipped'
    ) {
      throw new ConvexError({
        code: 'TRANSCRIPTION_NOT_RETRYABLE',
        status: metadata.transcriptionStatus ?? 'none',
      });
    }

    await ctx.db.patch(metadata._id, {
      transcriptionStatus: 'queued',
      transcriptionError: undefined,
      // Clear the single-flight lock so transcribeAudio can re-acquire.
      transcriptionRunId: undefined,
      transcriptionLeaseExpiresAt: undefined,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.file_metadata.transcribe_audio.transcribeAudio,
      {
        storageId: args.storageId,
        fileName: metadata.fileName,
        contentType: metadata.contentType,
        organizationId: args.organizationId,
      },
    );
  },
});
