'use client';

/**
 * Whether the organization can synthesize speech (a `text-to-speech`-tagged
 * model behind a direct credential) and transcribe audio (a
 * `transcription`-tagged model on an openai-format connector, same
 * credential rule). Derived from the composer catalog (same device-cached
 * read the picker uses), so the answer is warm on reload and costs no extra
 * query.
 *
 * The loading defaults differ on purpose: TTS reads as available (a
 * briefly-enabled toggle beats one that flickers in late — clicking early
 * degrades gracefully), while transcription reads as UNAVAILABLE — it gates
 * the MediaRecorder dictation fallback, and a mic that records, uploads,
 * and then fails is worse than one that appears a round-trip late.
 */

import { useComposerModels } from '../data/chat-backend';

export function useVoiceCapabilities(organizationId: string): {
  hasTts: boolean;
  hasTranscription: boolean;
  isLoading: boolean;
} {
  const catalog = useComposerModels(organizationId);
  if (catalog.status === 'ready') {
    return {
      hasTts: catalog.data.voice.ttsAvailable,
      hasTranscription: catalog.data.voice.transcriptionAvailable,
      isLoading: false,
    };
  }
  return { hasTts: true, hasTranscription: false, isLoading: true };
}
