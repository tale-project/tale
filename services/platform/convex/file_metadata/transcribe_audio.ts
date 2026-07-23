'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { blobRefValidator } from '../lib/storage/blob_ref';

// The real pipeline
// (ffmpeg compression → chunking → Whisper transcription → RAG indexing) is
// gone with the providers plane (`convex/providers/resolve_model`), the
// chat-pipeline error classifier (`convex/lib/error_classification`), and the
// moved RAG upload helper (`convex/workflow_engine/action_defs/rag/helpers/upload_file_direct`).
//
// `transcribeAudio` is scheduled fire-and-forget (`ctx.scheduler.runAfter`)
// from `file_metadata/mutations.ts` and `internal_mutations.ts` — there is no
// caller awaiting its result, so a bare `throw` here would only show up in
// Convex's own function logs and leave the fileMetadata row stuck at
// `'queued'`/`'processing'` forever (the UI has no other way to learn it
// failed). Instead this marks the row `'failed'` with a clear explanatory
// `transcriptionError`, reusing the exact mutation the real failure path used
// — the same user-visible "offline" signal as a thrown error, delivered
// through the channel this action shape actually has.

/**
 * No-op — marks the row `'failed'` instead of transcribing.
 * See file header.
 */
export const transcribeAudio = internalAction({
  args: {
    storageId: blobRefValidator,
    fileName: v.string(),
    contentType: v.string(),
    organizationId: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    console.debug(
      `[transcribeAudio] Audio transcription is offline while the platform AI backend is rewritten; marking ${args.storageId} failed`,
    );
    await ctx.runMutation(
      internal.file_metadata.internal_mutations.updateFileTranscription,
      {
        storageId: args.storageId,
        transcriptionStatus: 'failed',
        transcriptionError:
          'Audio transcription is offline while the platform AI backend is rewritten.',
        transcriptionProgress: '',
      },
    );
    return null;
  },
});
