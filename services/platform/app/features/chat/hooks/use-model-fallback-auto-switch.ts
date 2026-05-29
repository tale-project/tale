import { useEffect, useRef } from 'react';

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
 * Auto-switch the model selector after a successful fallback, extracted from
 * ChatInterface.
 *
 * Watches messages reactively: when a `[MODEL_FALLBACK]` "retrying with X"
 * message is followed by a successful assistant response, update the selector
 * so future messages use the working model.
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

    // Find the latest MODEL_FALLBACK "retrying with" message
    const fallbackMsg = messages
      .toReversed()
      .find(
        (msg) =>
          msg.role === 'system' &&
          msg.content?.includes('[MODEL_FALLBACK]') &&
          msg.content?.includes('retrying with'),
      );
    if (
      !fallbackMsg?.content ||
      fallbackMsg.id === lastProcessedFallbackRef.current
    )
      return;

    // Only switch after a successful assistant message appears after the fallback
    const fallbackIdx = messages.findIndex((msg) => msg.id === fallbackMsg.id);
    const hasSuccessAfter = messages
      .slice(fallbackIdx + 1)
      .some((msg) => msg.role === 'assistant');
    if (!hasSuccessAfter) return;

    lastProcessedFallbackRef.current = fallbackMsg.id;

    // Extract target model: "X failed — retrying with <model>."
    // Greedy match up to the trailing period to handle dots in model
    // names (e.g. "moonshotai/kimi-k2.5").
    const match = fallbackMsg.content.match(/retrying with (.+)\./);
    if (!match) return;

    const successfulModel = match[1];
    const currentSelected = selectedModelOverrides[agentName];
    if (successfulModel && successfulModel !== currentSelected) {
      setSelectedModelOverride(agentName, successfulModel);
    }
  }, [
    messages,
    agentName,
    isLoading,
    selectedModelOverrides,
    setSelectedModelOverride,
  ]);
}
