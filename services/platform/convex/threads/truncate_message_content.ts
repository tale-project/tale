import type { vAssistantContent } from '@convex-dev/agent/validators';
import type { Infer } from 'convex/values';

export type AssistantContent = Infer<typeof vAssistantContent>;
type AssistantContentParts = Exclude<AssistantContent, string>;
type AssistantContentPart = AssistantContentParts[number];

/**
 * Truncate an assistant message's `content` to the first `displayedLength`
 * characters of its text, **preserving every non-text part in place**.
 *
 * Why this exists: the cancel-generation flow used to overwrite a message
 * with `{ role: 'assistant', content: '<string>' }`, which collapses
 * structured parts (reasoning, tool-call, tool-result, file, source) into
 * a single text part — wiping any image/file/tool cards the user had
 * already seen. This helper rebuilds `content` with all non-text parts
 * intact and only the text parts truncated.
 *
 * For multiple text parts (uncommon — typically text is split by an
 * intervening tool-call), the cumulative truncation ignores the single
 * space `joinText()` inserts between text parts; off-by-(n-1) chars in
 * that edge case is acceptable.
 */
export function truncateAssistantContent(
  content: AssistantContent,
  displayedLength: number,
): AssistantContent {
  if (displayedLength < 0) {
    throw new Error(
      `truncateAssistantContent: displayedLength must be >= 0, got ${displayedLength}`,
    );
  }

  if (typeof content === 'string') {
    return content.slice(0, Math.min(displayedLength, content.length));
  }

  let textConsumed = 0;
  const out: AssistantContentPart[] = [];

  for (const part of content) {
    if (part.type !== 'text') {
      out.push(part);
      continue;
    }
    if (textConsumed >= displayedLength) {
      continue;
    }
    const remaining = displayedLength - textConsumed;
    if (part.text.length <= remaining) {
      out.push(part);
      textConsumed += part.text.length;
    } else {
      out.push({ ...part, text: part.text.slice(0, remaining) });
      textConsumed = displayedLength;
    }
  }

  return out;
}
