'use node';

/**
 * Resolve the organization's transcription model against the provider world:
 * the first `transcription`-tagged catalog entry the provider's active DIRECT
 * default credential (api-key/env) may serve — the same connector set and
 * catalog the composer's `listComposerModels` reads, the credential's model
 * allowlist applied the same way, and the same conditions that derive its
 * `voice.transcriptionAvailable` flag, so the dictation button, the
 * file-upload pipeline, and this resolver can never disagree.
 *
 * Only `openai`-format connectors qualify: the transcription wire is the
 * OpenAI `/audio/transcriptions` shape, and the Anthropic Messages format
 * has no transcription endpoint at all.
 */

import { AppError } from '../../../../lib/shared/errors/app-error';
import { modelAllowlistPermits } from '../../../../lib/shared/utils/model-ref';
import { resolveProviderCredential } from '../../provider_credentials/resolve_credential';
import type { ActionCtx } from '../ctx';
import { internal } from '../handler_names';
import { directActiveCredential } from './direct_credential';
import { resolveProvidersForOrgId } from './org_providers';
import { getServableCatalog } from './servable_catalog';

export interface ResolvedTranscriptionModel {
  readonly modelId: string;
  readonly providerName: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

export async function resolveTranscriptionModel(
  ctx: ActionCtx,
  opts: { organizationId: string },
): Promise<ResolvedTranscriptionModel> {
  const providers = await resolveProvidersForOrgId(ctx, opts.organizationId);
  for (const provider of providers) {
    if (provider.apiFormat !== 'openai') continue;
    // The default credential decides what this provider may serve — read
    // it first so a credential-less provider costs no catalog fetch and an
    // allowlisted one is narrowed the way the composer's flag is.
    const direct = directActiveCredential(
      await ctx.runQuery(
        internal.provider_credentials.queries.getDefaultCredentialInternal,
        { organizationId: opts.organizationId, providerSlug: provider.name },
      ),
    );
    if (direct === null) continue;
    let catalog;
    try {
      catalog = await getServableCatalog(provider, direct.modelAllowlist);
    } catch (error) {
      // One unreachable catalog must not blank transcription for the whole org.
      console.warn(
        `[transcription] could not resolve catalog for "${provider.name}"`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    const entry = catalog.find(
      (candidate) =>
        candidate.tags.includes('transcription') &&
        modelAllowlistPermits(direct.modelAllowlist, candidate.id),
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

  throw new AppError({
    code: 'NO_TRANSCRIPTION_MODEL',
    message: 'No transcription model is configured for this organization.',
  });
}
