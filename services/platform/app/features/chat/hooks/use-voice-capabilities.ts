'use client';

import { useMemo } from 'react';

import { useListProviders } from '@/app/features/settings/providers/hooks/queries';

type ProviderList = ReturnType<typeof useListProviders>['providers'];

export interface VoiceCapabilities {
  /** A `text-to-speech` model exists on a provider with a usable key. */
  hasTts: boolean;
  /** A `transcription` model exists on a provider with a usable key. */
  hasTranscription: boolean;
  /**
   * Provider config is still loading. Callers should treat capabilities as
   * AVAILABLE while loading so the voice controls aren't falsely disabled on
   * first paint (mirrors how the chat composer only blocks once the provider
   * list resolves).
   */
  isLoading: boolean;
}

/**
 * Does any configured provider expose a model with `tag`? "Configured" mirrors
 * the chat send gate (`activeModelMissingApiKey`): the provider has a key, or
 * the specific model carries its own per-model override key.
 */
function hasConfiguredModelForTag(
  providers: ProviderList,
  tag: 'text-to-speech' | 'transcription',
): boolean {
  for (const provider of providers) {
    if (
      !provider ||
      !('models' in provider) ||
      !Array.isArray(provider.models)
    ) {
      continue;
    }
    const providerHasKey =
      'hasApiKey' in provider && Boolean(provider.hasApiKey);
    for (const model of provider.models) {
      const tags = model?.tags;
      if (!Array.isArray(tags) || !tags.includes(tag)) continue;
      if (providerHasKey || model?.hasApiKeyOverride) return true;
    }
  }
  return false;
}

/**
 * Reports whether the org has a usable text-to-speech / transcription setup,
 * so the composer's voice-output toggle and the dictation mic can disable
 * themselves (with an explanatory tooltip) instead of failing only at action
 * time. Built on the same `useListProviders` source of truth as model select.
 */
export function useVoiceCapabilities(
  organizationId: string,
): VoiceCapabilities {
  const { providers, isLoading } = useListProviders(organizationId);
  return useMemo(
    () => ({
      hasTts: hasConfiguredModelForTag(providers, 'text-to-speech'),
      hasTranscription: hasConfiguredModelForTag(providers, 'transcription'),
      isLoading,
    }),
    [providers, isLoading],
  );
}
