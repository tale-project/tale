'use node';

import { v } from 'convex/values';

import { TRANSCRIPTION_SLUG } from '../../lib/shared/constants/usage';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { estimateTranscriptionCostCents } from '../governance/cost_estimation';
import { resolveTranscriptionModel } from '../providers/resolve_model';

const TRANSCRIBE_API_TIMEOUT_MS = 60_000;
const MAX_DICTATION_BYTES = 8 * 1024 * 1024;

interface TranscriptionResponse {
  text?: string;
  duration?: number;
}

/**
 * One-shot transcription for short dictation snippets recorded via
 * MediaRecorder in the browser. Used as a fallback in browsers (Firefox)
 * that don't ship the Web Speech API.
 *
 * Audio bytes are passed inline in the action argument rather than via
 * Convex `_storage`. This is intentional: storageIds are not bound to a
 * user, so accepting one here would let any org member transcribe (and
 * delete) blobs they didn't upload. Inline bytes keep the call ephemeral
 * — no orphan storage, no ownership ambiguity, no separate cleanup path.
 *
 * Max payload is 8 MiB, comfortably above ~5 minutes of Opus-32 kbps
 * dictation. Longer recordings go through the regular file-upload pipeline
 * (`transcribe_audio.ts`).
 */
export const transcribeDictation = action({
  args: {
    audio: v.bytes(),
    mimeType: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({ text: v.string() }),
  handler: async (ctx, args): Promise<{ text: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await ctx.runQuery(
      internal.approvals.internal_queries.verifyOrganizationMembership,
      {
        organizationId: args.organizationId,
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      },
    );

    if (args.audio.byteLength === 0) {
      return { text: '' };
    }
    if (args.audio.byteLength > MAX_DICTATION_BYTES) {
      throw new Error('Dictation audio exceeds 8 MiB limit');
    }

    const modelData = await resolveTranscriptionModel(ctx, {
      organizationId: args.organizationId,
    });

    // Whisper validates by file extension. Map the recorded MIME to the
    // closest accepted extension; `.ogg`/`.webm`/`.mp4` cover what
    // MediaRecorder produces in Firefox / Chromium / Safari.
    const ext = pickExtensionFromMime(args.mimeType);
    const audioBlob = new Blob([args.audio], { type: args.mimeType });

    const formData = new FormData();
    formData.append('file', audioBlob, `dictation.${ext}`);
    formData.append('model', modelData.modelId);
    formData.append('response_format', 'verbose_json');

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      TRANSCRIBE_API_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(`${modelData.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${modelData.apiKey}` },
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Transcription API ${response.status}: ${errorText.slice(0, 200)}`,
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- OpenAI-compatible response shape
    const result = (await response.json()) as TranscriptionResponse;

    // Some OpenAI-compatible servers omit `text` on empty audio. Default
    // to '' rather than letting Convex's `v.string()` return-validator
    // throw on the way out — the caller treats empty as "nothing to
    // transcribe" and silently keeps the input unchanged.
    const text = typeof result.text === 'string' ? result.text : '';
    const durationSec = result.duration ?? 0;

    if (durationSec > 0) {
      const costEstimateCents = estimateTranscriptionCostCents(
        durationSec,
        modelData.centsPerAudioMinute,
      );
      await ctx.runMutation(
        internal.governance.internal_mutations.recordTranscriptionUsage,
        {
          organizationId: args.organizationId,
          userId: String(authUser._id),
          agentSlug: TRANSCRIPTION_SLUG,
          model: modelData.modelId,
          provider: modelData.providerName,
          audioDurationSec: durationSec,
          costEstimateCents,
          timestamp: Date.now(),
        },
      );
    }

    return { text };
  },
});

function pickExtensionFromMime(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac'))
    return 'm4a';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  return 'webm';
}
