/**
 * Extract Tool Diagnostics
 *
 * Extracts tool diagnostics from agent steps.
 */

import type { ToolDiagnostics } from '../types';

import {
  isRecord,
  getString,
  getArray,
} from '../../../../../../lib/utils/type-guards';

function toRecord(val: unknown): Record<string, unknown> | undefined {
  return isRecord(val) ? val : undefined;
}

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
    const step = toRecord(steps[i]);
    const content = (step ? getArray(step, 'content') : undefined) || [];
    if (!Array.isArray(content)) continue;

    for (let j = content.length - 1; j >= 0; j--) {
      const c = toRecord(content[j]);
      if (c?.['type'] === 'tool-result') {
        lastResult = c;
        break;
      }
    }
  }

  if (lastResult) {
    lastToolName = getString(lastResult, 'toolName') ?? null;
    const toolCallId = getString(lastResult, 'toolCallId') ?? null;
    const output = lastResult['output'];

    // Extract result text
    if (typeof output === 'string' && output.trim()) {
      lastToolResultText = output;
    } else {
      const outputRec = toRecord(output);
      if (outputRec) {
        const outContent = getArray(outputRec, 'content');
        if (outContent) {
          const texts = outContent
            .map((seg: unknown) => {
              const segRec = toRecord(seg);
              return segRec ? getString(segRec, 'text') : undefined;
            })
            .filter(
              (t): t is string => typeof t === 'string' && t.trim().length > 0,
            );
          if (texts.length > 0) lastToolResultText = texts.join('\n');
        }
      }
    }

    // Find matching tool-call to capture input
    if (toolCallId) {
      outer: for (let i = steps.length - 1; i >= 0; i--) {
        const step = toRecord(steps[i]);
        const content = (step ? getArray(step, 'content') : undefined) || [];
        if (!Array.isArray(content)) continue;

        for (let j = content.length - 1; j >= 0; j--) {
          const c = toRecord(content[j]);
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
