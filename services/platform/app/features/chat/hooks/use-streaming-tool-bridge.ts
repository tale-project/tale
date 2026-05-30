import type { UIMessage } from '@convex-dev/agent/react';
import { useEffect } from 'react';

import {
  useStreamingTools,
  type StreamingToolCall,
} from '../context/streaming-tool-context';

/**
 * Push the active message's streaming tool calls into the StreamingToolContext
 * so the canvas pane can render live `file_write` content as the LLM types it.
 *
 * Extracted from ChatInterface; reads the StreamingToolContext internally.
 */
export function useStreamingToolBridge(
  activeMessage: UIMessage | undefined,
): void {
  const { setActive: setActiveStreamingTools } = useStreamingTools();

  useEffect(() => {
    if (!activeMessage?.parts) {
      setActiveStreamingTools([]);
      return;
    }
    const next: StreamingToolCall[] = [];
    for (const [i, p] of activeMessage.parts.entries()) {
      if (!p.type?.startsWith('tool-')) continue;
      const toolName = p.type.slice(5);
      if (toolName !== 'file_write') continue;
      const state = 'state' in p ? p.state : undefined;
      if (state !== 'input-streaming' && state !== 'input-available') continue;
      const rawInput =
        'input' in p && typeof p.input === 'string'
          ? p.input
          : 'input' in p && p.input !== undefined
            ? JSON.stringify(p.input)
            : '';
      // Append the part index so multiple `file_write` parts that lack a real
      // `toolCallId` get distinct fallback ids instead of colliding on
      // `${id}-file_write`. Index is stable across renders (parts keep order).
      const toolCallId =
        'toolCallId' in p && typeof p.toolCallId === 'string'
          ? p.toolCallId
          : `${activeMessage.id}-${toolName}-${i}`;
      next.push({ toolCallId, toolName, rawInput, state });
    }
    setActiveStreamingTools(next);
  }, [activeMessage, setActiveStreamingTools]);
}
