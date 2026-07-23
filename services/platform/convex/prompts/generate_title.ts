/**
 * AI-powered title generation for saved prompts.
 *
 * The real implementation ran a short `generateText` call
 * through an Agent SDK instance — model resolution
 * (`convex/providers/failover`), the prompt registry (`lib/prompts/registry`),
 * and provider-options building (`lib/provider_options`) all moved/broke with
 * the chat pipeline rewrite. Callers already tolerate a `null` result (the
 * original contract: "fall back to a generated PROMPT-XXXXX id if this
 * throws or returns an empty title" — see `prompts/actions.ts`'s
 * `aiTitle?.trim() || generateFallbackTitle()`), but a content-derived title
 * is far more useful than an opaque id, so this deterministically returns the
 * first 40 characters of the prompt content instead.
 */

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';

const FALLBACK_TITLE_MAX_LENGTH = 40;

/**
 * Deterministic fallback title: the first `FALLBACK_TITLE_MAX_LENGTH`
 * characters of the (whitespace-collapsed) content, ellipsized when
 * truncated. Empty input yields `''` — callers already treat an empty/falsy
 * title as "generate your own fallback" (see file header).
 */
function fallbackTitleFromContent(content: string): string {
  const singleLine = content.trim().replace(/\s+/g, ' ');
  if (singleLine.length === 0) return '';
  return singleLine.length > FALLBACK_TITLE_MAX_LENGTH
    ? `${singleLine.slice(0, FALLBACK_TITLE_MAX_LENGTH).trimEnd()}…`
    : singleLine;
}

/**
 * Offline — returns a deterministic content-derived title
 * instead of calling the (gone) AI pipeline. See file header.
 */
export const generatePromptTitle = internalAction({
  args: {
    content: v.string(),
    organizationId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (_ctx, args): Promise<string | null> => {
    const title = fallbackTitleFromContent(args.content);
    console.debug(
      '[generatePromptTitle] AI title generation is offline while the platform AI backend is rewritten; using a content-derived fallback title',
    );
    return title.length > 0 ? title : null;
  },
});
