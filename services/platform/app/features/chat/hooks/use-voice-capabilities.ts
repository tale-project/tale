'use client';

/**
 * Whether the organization can synthesize speech at all — a
 * `text-to-speech`-tagged model behind a direct credential exists. Derived
 * from the composer catalog (same device-cached read the picker uses), so
 * the answer is warm on reload and costs no extra query. Loading reads as
 * available: a briefly-enabled control beats one that flickers in late.
 */

import { useComposerModels } from '../data/chat-backend';

export function useVoiceCapabilities(organizationId: string): {
  hasTts: boolean;
  isLoading: boolean;
} {
  const catalog = useComposerModels(organizationId);
  if (catalog.status === 'ready') {
    return { hasTts: catalog.data.voice.ttsAvailable, isLoading: false };
  }
  return { hasTts: true, isLoading: true };
}
