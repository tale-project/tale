/**
 * Build Agent Steps Summary
 *
 * Builds a compact summary of agent steps to avoid oversized payloads.
 */

import { isRecord } from '../../../../../../lib/utils/type-guards';

/**
 * Builds a compact summary of agent steps to avoid oversized payloads
 */
export function buildAgentStepsSummary(steps: unknown[]): unknown {
  const summary: Array<Record<string, unknown>> = [];
  const MAX_EVENTS = 12;
  const MAX_TEXT = 1500;

  const safeString = (val: unknown, max: number): string => {
    const s = typeof val === 'string' ? val : JSON.stringify(val);
    return (s ?? '').slice(0, max);
  };

  const pickText = (out: unknown): string | null => {
    if (typeof out === 'string') return out;
    const outRec = isRecord(out) ? out : undefined;
    const oc = outRec?.['content'];
    if (Array.isArray(oc)) {
      const texts = oc
        .map((seg) => (isRecord(seg) ? seg['text'] : undefined))
        .filter(
          (t): t is string => typeof t === 'string' && t.trim().length > 0,
        );
      if (texts.length > 0) return texts.join('\n');
    }
    return null;
  };

  outer: for (let i = 0; i < steps.length; i++) {
    const rawStep = steps[i];
    if (!isRecord(rawStep)) continue;
    const content = Array.isArray(rawStep['content']) ? rawStep['content'] : [];

    for (let j = 0; j < content.length; j++) {
      const rawC = content[j];
      if (!isRecord(rawC)) continue;
      const type = rawC['type'];

      if (type === 'tool-call' || type === 'tool-result') {
        const toolName = rawC['toolName'] ?? null;
        const toolCallId = rawC['toolCallId'] ?? null;
        const item: Record<string, unknown> = { type, toolName, toolCallId };

        if (type === 'tool-call') {
          item.input = safeString(rawC['input'], MAX_TEXT);
        } else {
          const text = pickText(rawC['output']);
          if (text && text.trim()) {
            item.outputText = safeString(text, MAX_TEXT);
          }
        }

        summary.push(item);
        if (summary.length >= MAX_EVENTS) break outer;
      }
    }
  }

  return summary.length > 0 ? summary : null;
}
