/**
 * Extract Tool Diagnostics
 *
 * Extracts tool diagnostics from agent steps.
 */

import type { ToolDiagnostics } from '../types';

/**
 * Extracts tool diagnostics from agent steps
 */
export function extractToolDiagnostics(steps: unknown[]): ToolDiagnostics {
  let lastToolName: string | null = null;
  let lastToolInputText: string | null = null;
  let lastToolResultText: string | null = null;

  // Find last tool-result
  let lastResult: Record<string, unknown> | null = null;
  for (let i = steps.length - 1; i >= 0 && !lastResult; i--) {
    const step = steps[i] as Record<string, unknown>;
    const content = (step?.['content'] as unknown[]) || [];
    if (!Array.isArray(content)) continue;

    for (let j = content.length - 1; j >= 0; j--) {
      const c = content[j] as Record<string, unknown>;
      if (c?.['type'] === 'tool-result') {
        lastResult = c;
        break;
      }
    }
  }

  if (lastResult) {
    lastToolName = (lastResult['toolName'] as string) ?? null;
    const toolCallId = (lastResult['toolCallId'] as string) ?? null;
    const output = lastResult['output'] as
      | Record<string, unknown>
      | string
      | undefined;

    // Extract result text
    if (typeof output === 'string' && output.trim()) {
      lastToolResultText = output;
    } else {
      const outContent = (output as Record<string, unknown>)?.[
        'content'
      ] as unknown;
      if (Array.isArray(outContent)) {
        const texts = outContent
          .map((seg) => (seg as Record<string, unknown>)?.['text'])
          .filter(
            (t): t is string => typeof t === 'string' && t.trim().length > 0,
          );
        if (texts.length > 0) lastToolResultText = texts.join('\n');
      }
    }

    // Find matching tool-call to capture input
    if (toolCallId) {
      outer: for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i] as Record<string, unknown>;
        const content = (step?.['content'] as unknown[]) || [];
        if (!Array.isArray(content)) continue;

        for (let j = content.length - 1; j >= 0; j--) {
          const c = content[j] as Record<string, unknown>;
          if (c?.['type'] === 'tool-call' && c?.['toolCallId'] === toolCallId) {
            const rawInput = c?.['input'];
            const s =
              typeof rawInput === 'string'
                ? rawInput
                : JSON.stringify(rawInput);
            lastToolInputText = (s ?? '').slice(0, 1500);
            break outer;
          }
        }
      }
    }
  }

  return { lastToolName, lastToolInputText, lastToolResultText };
}
