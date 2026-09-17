'use client';

/**
 * Whether the organization can synthesize speech (a `text-to-speech`-tagged
 * model behind a direct credential) and transcribe audio (a
 * transcription model chosen by the organization's Auto/pin policy).
 * Shares the composer's query, but audio preflight requires a fresh answer.
 * Unknown/loading is distinct from a confirmed unavailable capability.
 */

import { useCallback } from 'react';

import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import { PROVIDER_CREDENTIAL_HINT_ENTITY } from '@/lib/shared/hint-entities';

import { useChatQueryClient, useComposerModels } from '../data/chat-backend';

export function useVoiceCapabilities(organizationId: string): {
  hasTts: boolean;
  hasTranscription: boolean | undefined;
  transcriptionUnavailableReason?: string;
  isLoading: boolean;
  refresh: () => void;
} {
  const catalog = useComposerModels(organizationId, { requireFresh: true });
  const queryClient = useChatQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: backendEntityPrefix(
        organizationId,
        PROVIDER_CREDENTIAL_HINT_ENTITY,
      ),
    });
  }, [organizationId, queryClient]);
  if (catalog.status === 'ready') {
    return {
      hasTts: catalog.data.voice.ttsAvailable,
      hasTranscription: catalog.data.voice.transcriptionAvailable,
      transcriptionUnavailableReason:
        catalog.data.voice.transcriptionUnavailableReason,
      isLoading: false,
      refresh,
    };
  }
  return {
    hasTts: true,
    hasTranscription: undefined,
    isLoading: true,
    refresh,
  };
}
