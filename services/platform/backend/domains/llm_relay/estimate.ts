import { estimateTokens } from '../../../lib/chat/types.ts';

/**
 * The relay's own count of a prompt, for a call that ended before the
 * vendor reported what it read (tale-project/tale#4942).
 *
 * A request's text is counted at the usual rate. An image, a document or an
 * audio clip travels as base64 (or bytes), and counted as text it would
 * weigh hundreds of times what a vendor bills for it — a screenshot as a
 * quarter of a million tokens. Each such payload counts as one image does
 * at a vendor: about 1,600 tokens, the price of a megapixel at Anthropic
 * and OpenAI alike.
 */

/** What a vendor bills for an inline image of about a megapixel. */
const MEDIA_TOKENS = 1_600;

/** A string that is a payload rather than words: a data URL, or a long run
 * of base64 alone. */
function isPayload(value: string): boolean {
  if (value.startsWith('data:') && value.includes(';base64,')) return true;
  return value.length >= 512 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(value);
}

/** A prompt's tokens, counted: words at the usual rate, each payload as one
 * image. */
export function estimatedPromptTokens(value: unknown): number {
  let tokens = 0;
  const visit = (node: unknown, depth: number): void => {
    if (depth > 64) return;
    if (typeof node === 'string') {
      tokens += isPayload(node) ? MEDIA_TOKENS : estimateTokens(node);
      return;
    }
    if (node instanceof Uint8Array || node instanceof ArrayBuffer) {
      tokens += MEDIA_TOKENS;
      return;
    }
    if (node instanceof URL) {
      tokens += MEDIA_TOKENS;
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) {
        tokens += estimateTokens(key);
        visit(item, depth + 1);
      }
    }
  };
  visit(value, 0);
  return tokens;
}
