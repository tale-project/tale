'use node';

/**
 * Resolve the organization's transcription model against the provider world:
 * the first `transcription`-tagged catalog entry served by an active DIRECT
 * credential (api-key/env) — the same connector set and catalog the
 * composer's `listComposerModels` reads, and the same conditions that derive
 * its `voice.transcriptionAvailable` flag, so the dictation button, the
 * file-upload pipeline, and this resolver can never disagree.
 *
 * Only `openai`-format connectors qualify: the transcription wire is the
 * OpenAI `/audio/transcriptions` shape, and the Anthropic Messages format
 * has no transcription endpoint at all.
 */

import { ConvexError } from 'convex/values';

import type { ActionCtx } from '../../_generated/server';
import { resolveProviderCredential } from '../../provider_credentials/resolve_credential';
import { getProviderCatalog } from './catalog_fetch';
import { resolveProvidersForOrgId } from './org_providers';

export interface ResolvedTranscriptionModel {
  readonly modelId: string;
  readonly providerName: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Request convention; absent ⇒ `multipart` (OpenAI Whisper-compatible). */
  readonly transcriptionMode?: 'multipart' | 'json-base64';
}

export async function resolveTranscriptionModel(
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
      // One unreachable catalog must not blank transcription for the whole org.
      console.warn(
        `[transcription] could not resolve catalog for "${provider.name}"`,
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
        `[transcription] no usable credential for "${provider.name}"`,
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
