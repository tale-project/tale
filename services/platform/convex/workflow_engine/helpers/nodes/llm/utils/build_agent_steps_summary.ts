/**
 * Build Agent Steps Summary
 *
 * Builds a compact summary of agent steps to avoid oversized payloads.
 */

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
    const oc = (out as Record<string, unknown>)?.['content'] as unknown;
    if (Array.isArray(oc)) {
      const texts = oc
        .map((seg) => (seg as Record<string, unknown>)?.['text'])
        .filter(
          (t): t is string => typeof t === 'string' && t.trim().length > 0,
        );
      if (texts.length > 0) return texts.join('\n');
    }
    return null;
  };

  outer: for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Record<string, unknown>;
    const content = (step?.['content'] as unknown[]) || [];
    if (!Array.isArray(content)) continue;

    for (let j = 0; j < content.length; j++) {
      const c = content[j] as Record<string, unknown>;
      const type = c?.['type'];

      if (type === 'tool-call' || type === 'tool-result') {
        const toolName = c?.['toolName'] ?? null;
        const toolCallId = c?.['toolCallId'] ?? null;
        const item: Record<string, unknown> = { type, toolName, toolCallId };

        if (type === 'tool-call') {
          item.input = safeString(c?.['input'], MAX_TEXT);
        } else {
          const text = pickText(c?.['output']);
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
