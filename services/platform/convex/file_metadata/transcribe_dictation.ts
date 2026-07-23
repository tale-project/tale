'use node';

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

const MAX_DICTATION_BYTES = 8 * 1024 * 1024;

// Transcription needs a resolved provider model
// (`convex/providers/resolve_model`, moved with the providers plane) — gone.
// Unlike `transcribe_audio.ts`'s fire-and-forget internalAction, this one is
// a user-triggered action the chat UI directly awaits
// (`app/features/chat/hooks/use-media-recorder-dictation.ts`), so an offline
// `ConvexError` is the right signal: it propagates to the caller's `catch`
// exactly like any other action failure.

/**
 * One-shot transcription for short dictation snippets recorded via
 * MediaRecorder in the browser. Used as a fallback in browsers (Firefox)
 * that don't ship the Web Speech API.
 *
 * Offline. See file header. Auth + membership are still
 * enforced before the error so this doesn't leak "offline" to non-members;
 * `pickExtensionFromMime` below is kept and still exported/tested — it's a
 * pure helper with no provider dependency.
 */
export const transcribeDictation = action({
  args: {
    audio: v.bytes(),
    mimeType: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({ text: v.string() }),
  handler: async (ctx, args): Promise<{ text: string }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    await ctx.runQuery(
      internal.approvals.internal_queries.verifyOrganizationMembership,
      {
        organizationId: args.organizationId,
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      },
    );

    if (args.audio.byteLength === 0) {
      return { text: '' };
    }
    if (args.audio.byteLength > MAX_DICTATION_BYTES) {
      throw new ConvexError({
        code: 'DICTATION_TOO_LARGE',
        maxBytes: MAX_DICTATION_BYTES,
      });
    }

    throw new ConvexError(
      'Dictation transcription is offline while the platform AI backend is rewritten.',
    );
  },
});

export function pickExtensionFromMime(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac'))
    return 'm4a';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  return 'webm';
}
