import { useEffect, useRef } from 'react';

import {
  parseModelFallbackBody,
  SYSTEM_MSG_TAG,
} from '@/lib/shared/constants/system-message-tags';

import type { ChatMessage } from './use-message-processing';

interface UseModelFallbackAutoSwitchParams {
  messages: ChatMessage[];
  agentName: string | undefined;
  /** Skip scanning while a response is still streaming (see guard below). */
  isLoading: boolean;
  selectedModelOverrides: Record<string, string>;
  setSelectedModelOverride: (agentName: string, modelId: string | null) => void;
}

/**
 * Auto-switch the model selector after a successful fallback.
 *
 * Watches messages reactively: when a `[MODEL_FALLBACK]` notice is followed by a
 * successful assistant response, pin the selector to the model that worked
 * (the notice's structured `to` field) so future messages use it.
 *
 * The `isLoading` guard makes this only scan once a response has ended — the
 * detection requires "a successful assistant message AFTER the fallback", which
 * can only be true post-stream, so scanning on every streamed token (O(n) per
 * tick) was pure waste.
 */
export function useModelFallbackAutoSwitch({
  messages,
  agentName,
  isLoading,
  selectedModelOverrides,
  setSelectedModelOverride,
}: UseModelFallbackAutoSwitchParams): void {
  const lastProcessedFallbackRef = useRef<string | null>(null);

  useEffect(() => {
    // Only scan after streaming ends — the "success after fallback" signal
    // can't appear mid-stream, so scanning per token is wasted O(n) work.
    if (isLoading) return;
    if (!agentName || !messages.length) return;

    // Find the latest model-fallback notice.
    const fallbackMsg = messages
      .toReversed()
      .find((msg) => msg.systemMessageTag === SYSTEM_MSG_TAG.MODEL_FALLBACK);
    if (!fallbackMsg || fallbackMsg.id === lastProcessedFallbackRef.current) {
      return;
    }

    // Only switch once a successful assistant message follows the fallback.
    const fallbackIdx = messages.findIndex((msg) => msg.id === fallbackMsg.id);
    const hasSuccessAfter = messages
      .slice(fallbackIdx + 1)
      .some((msg) => msg.role === 'assistant');
    if (!hasSuccessAfter) return;

    lastProcessedFallbackRef.current = fallbackMsg.id;

    const { to } = parseModelFallbackBody(
      fallbackMsg.systemMessageBody ?? fallbackMsg.content ?? '',
    );
    // `to === 'default'` is the tag-default (no concrete ref to pin) — skip.
    if (!to || to === 'default') return;

    if (to !== selectedModelOverrides[agentName]) {
      setSelectedModelOverride(agentName, to);
    }
  }, [
    messages,
    agentName,
    isLoading,
    selectedModelOverrides,
    setSelectedModelOverride,
  ]);
}
