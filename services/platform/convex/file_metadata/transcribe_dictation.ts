'use node';

import { ConvexError, v } from 'convex/values';

import { TRANSCRIPTION_SLUG } from '../../lib/shared/constants/usage';
import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { estimateTranscriptionCostCents } from '../governance/cost_estimation';
import { checkProviderHostPolicy } from '../lib/http/host_policy';
import { getProviderCatalog } from '../lib/providers/catalog_fetch';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import { requestTranscription } from './transcription_request';

const TRANSCRIBE_API_TIMEOUT_MS = 60_000;
const MAX_DICTATION_BYTES = 8 * 1024 * 1024;

interface ResolvedTranscriptionModel {
  readonly modelId: string;
  readonly providerName: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

/**
 * Resolve the organization's transcription model against the provider world:
 * the first `transcription`-tagged catalog entry served by an active DIRECT
 * credential (api-key/env) — the same connector set and catalog the
 * composer's `listComposerModels` reads, and the same conditions that derive
 * its `voice.transcriptionAvailable` flag, so the dictation button's
 * availability signal and this resolver can never disagree. Mirrors
 * `convex/lib/providers/resolve_tts_model.ts`.
 *
 * Only `openai`-format connectors qualify: the transcription wire is the
 * OpenAI `/audio/transcriptions` shape, and the Anthropic Messages format
 * has no transcription endpoint at all.
 */
async function resolveTranscriptionModel(
  ctx: ActionCtx,
  opts: { organizationId: string },
): Promise<ResolvedTranscriptionModel> {
  const providers = await resolveProvidersForOrgId(ctx, opts.organizationId);
  for (const provider of providers) {
    if (provider.apiFormat !== 'openai') continue;
    let catalog;
    try {
      catalog = await getProviderCatalog(provider);
    } catch (error) {
      // One unreachable catalog must not blank dictation for the whole org.
      console.warn(
        `[dictation] could not resolve catalog for "${provider.name}"`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    const entry = catalog.find((candidate) =>
      candidate.tags.includes('transcription'),
    );
    if (!entry) continue;

    let credential;
    try {
      credential = await resolveProviderCredential(ctx, {
        organizationId: opts.organizationId,
        providerSlug: provider.name,
      });
    } catch (error) {
      console.warn(
        `[dictation] no usable credential for "${provider.name}"`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    // Transcription is a plain HTTP call — a subscription credential is
    // bound to a vendor harness and cannot answer it.
    if (
      credential.authMethod !== 'api-key' &&
      credential.authMethod !== 'env'
    ) {
      continue;
    }
    const baseUrl = credential.endpointUrl ?? provider.baseUrl;
    if (!baseUrl) continue;

    return {
      modelId: entry.id,
      providerName: provider.name,
      baseUrl,
      apiKey: credential.secret,
    };
  }

  throw new ConvexError({
    code: 'NO_TRANSCRIPTION_MODEL',
    message: 'No transcription model is configured for this organization.',
  });
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
 * dictation.
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

    const modelData = await resolveTranscriptionModel(ctx, {
      organizationId: args.organizationId,
    });

    // Defense-in-depth: re-check host policy at request time so a provider
    // file edited to point at an internal host (e.g. metadata service)
    // cannot exfiltrate the bearer token (mirrors `tts/synthesize.ts`).
    checkProviderHostPolicy(modelData.baseUrl);

    // Whisper validates by file extension (multipart). Map the recorded MIME
    // to the closest accepted token; `.ogg`/`.webm`/`.mp4` cover what
    // MediaRecorder produces in Firefox / Chromium / Safari.
    const ext = pickExtensionFromMime(args.mimeType);
    const audioBlob = new Blob([args.audio], { type: args.mimeType });

    // Dictation snippets are short, so a single request handles the whole
    // clip. `duration` is only returned by the multipart/verbose_json path;
    // empty audio yields '' so the `v.string()` return validator holds.
    const result = await requestTranscription({
      model: modelData,
      blob: audioBlob,
      fileName: `dictation.${ext}`,
      format: ext,
      timeoutMs: TRANSCRIBE_API_TIMEOUT_MS,
    });

    const text = result.text ?? '';
    const durationSec = result.duration ?? 0;

    if (durationSec > 0) {
      // The rewritten catalog schema carries no per-minute transcription
      // price, so the estimate is 0 until it grows one — the ledger still
      // records the audio minutes and the request.
      const costEstimateCents = estimateTranscriptionCostCents(
        durationSec,
        undefined,
      );
      await ctx.runMutation(
        internal.governance.internal_mutations.recordTranscriptionUsage,
        {
          organizationId: args.organizationId,
          userId: authUser.userId,
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
