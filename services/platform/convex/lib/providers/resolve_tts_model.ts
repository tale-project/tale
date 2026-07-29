'use node';

/**
 * Resolve the organization's text-to-speech model against the provider
 * world: the first `text-to-speech`-tagged catalog entry served by an active
 * DIRECT credential (api-key/env), with the voice and speaking instructions
 * picked by locale → base language → default.
 *
 * Failures are coded `ConvexError`s that `errorCodeFromCaught` classifies
 * into the closed `TtsErrorCode` enum — the codes fan out to every org
 * member on the chunk rows, so no free text ever leaves here.
 */

import { ConvexError } from 'convex/values';

import type { AudioFormat } from '../../../lib/shared/schemas/providers';
import type { ActionCtx } from '../../_generated/server';
import { resolveProviderCredential } from '../../provider_credentials/resolve_credential';
import { getProviderCatalog } from './catalog_fetch';
import { resolveProvidersForOrgId } from './org_providers';

export interface ResolvedTtsModel {
  readonly modelId: string;
  readonly providerName: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly voice: string;
  readonly audioFormat: AudioFormat;
  readonly instructions?: string;
  readonly centsPerMillionCharacters?: number;
}

export async function resolveTtsModel(
  ctx: ActionCtx,
  opts: { organizationId: string; locale: string; providerName?: string },
): Promise<ResolvedTtsModel> {
  const providers = await resolveProvidersForOrgId(ctx, opts.organizationId);
  const ordered =
    opts.providerName === undefined
      ? providers
      : [
          ...providers.filter((c) => c.name === opts.providerName),
          ...providers.filter((c) => c.name !== opts.providerName),
        ];

  for (const provider of ordered) {
    let catalog;
    try {
      catalog = await getProviderCatalog(provider);
    } catch (error) {
      // One unreachable catalog must not blank voice for the whole org.
      console.warn(
        `[tts] could not resolve catalog for "${provider.name}"`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    const entry = catalog.find((candidate) =>
      candidate.tags.includes('text-to-speech'),
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
        `[tts] no usable credential for "${provider.name}"`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    // Synthesis is a plain HTTP call — a subscription credential is bound to
    // a vendor harness and cannot answer it.
    if (
      credential.authMethod !== 'api-key' &&
      credential.authMethod !== 'env'
    ) {
      continue;
    }
    const baseUrl = credential.endpointUrl ?? provider.baseUrl;
    if (!baseUrl) continue;

    const tts = entry.tts;
    const baseLocale = opts.locale.split('-')[0] ?? opts.locale;
    const voice =
      tts?.voicesByLocale?.[opts.locale] ??
      tts?.voicesByLocale?.[baseLocale] ??
      tts?.defaultVoice;
    if (voice === undefined) {
      throw new ConvexError({
        code: 'UNKNOWN_VOICE',
        message: `Model "${entry.id}" declares no voice for locale "${opts.locale}" and no default voice.`,
      });
    }
    const instructions =
      tts?.instructionsByLocale?.[opts.locale] ??
      tts?.instructionsByLocale?.[baseLocale] ??
      tts?.defaultInstructions;

    return {
      modelId: entry.id,
      providerName: provider.name,
      baseUrl,
      apiKey: credential.secret,
      voice,
      audioFormat: tts?.audioFormat ?? 'mp3',
      ...(instructions !== undefined ? { instructions } : {}),
      ...(tts?.centsPerMillionCharacters !== undefined
        ? { centsPerMillionCharacters: tts.centsPerMillionCharacters }
        : {}),
    };
  }

  throw new ConvexError({
    code: 'NO_PROVIDER',
    message: 'No text-to-speech model is configured for this organization.',
  });
}
