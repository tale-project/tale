import { ConvexError } from 'convex/values';

/**
 * Cap on how many entries the inlined `versionHistory` array on each
 * promptTemplates row keeps. When a publish would push past this, the oldest
 * entry is dropped (FIFO) and a `prompt_template.history_truncated` audit
 * event is emitted (see version_history.ts + mutations.ts).
 */
export const MAX_PROMPT_VERSION_HISTORY = 12;

/**
 * Per-version content byte cap (UTF-8). 16 KiB ≈ 4,000 tokens, which covers
 * ~95% of real-world prompt templates including modest few-shot. Production
 * system prompts typically run ~1,200 tokens (~5 KB); the upper-bound
 * industry guidance is ~2,500 tokens (~10 KB) for analytical tools. Above
 * that range, content is usually a document that belongs in RAG, not in a
 * prompt template.
 *
 * Doc-size budget (Convex per-document limit is 1 MiB):
 *   row metadata: 200 (title) + 2000 (desc) + 100 (category) + 20×50 (tags) ≈ 3.3 KB
 * + versionHistory (current + history): 13 × (16,384 + ~200 metadata) ≈ 215 KB
 * = ≈ 218 KB total, leaving ~800 KB headroom.
 */
export const MAX_PROMPT_CONTENT_BYTES = 16_384;
export const MAX_PROMPT_TITLE_LEN = 200;
export const MAX_PROMPT_DESCRIPTION_LEN = 2_000;
export const MAX_PROMPT_CATEGORY_LEN = 100;
export const MAX_PROMPT_TAG_LEN = 50;
export const MAX_PROMPT_TAGS_COUNT = 20;

export function assertPromptSizes(args: {
  content?: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
}): void {
  if (args.content !== undefined) {
    const size = new TextEncoder().encode(args.content).byteLength;
    if (size > MAX_PROMPT_CONTENT_BYTES) {
      throw new ConvexError({
        code: 'too_large',
        field: 'content',
        message: `Prompt content is ${size} bytes; max ${MAX_PROMPT_CONTENT_BYTES}.`,
      });
    }
  }
  if (args.title !== undefined && args.title.length > MAX_PROMPT_TITLE_LEN) {
    throw new ConvexError({
      code: 'too_large',
      field: 'title',
      message: `Prompt title exceeds ${MAX_PROMPT_TITLE_LEN} chars.`,
    });
  }
  if (
    args.description !== undefined &&
    args.description.length > MAX_PROMPT_DESCRIPTION_LEN
  ) {
    throw new ConvexError({
      code: 'too_large',
      field: 'description',
      message: `Prompt description exceeds ${MAX_PROMPT_DESCRIPTION_LEN} chars.`,
    });
  }
  if (
    args.category !== undefined &&
    args.category.length > MAX_PROMPT_CATEGORY_LEN
  ) {
    throw new ConvexError({
      code: 'too_large',
      field: 'category',
      message: `Prompt category exceeds ${MAX_PROMPT_CATEGORY_LEN} chars.`,
    });
  }
  if (args.tags !== undefined) {
    if (args.tags.length > MAX_PROMPT_TAGS_COUNT) {
      throw new ConvexError({
        code: 'too_large',
        field: 'tags',
        message: `Prompt has ${args.tags.length} tags; max ${MAX_PROMPT_TAGS_COUNT}.`,
      });
    }
    for (const tag of args.tags) {
      if (tag.length > MAX_PROMPT_TAG_LEN) {
        throw new ConvexError({
          code: 'too_large',
          field: 'tags',
          message: `Tag exceeds ${MAX_PROMPT_TAG_LEN} chars: "${tag.slice(0, 20)}…".`,
        });
      }
    }
  }
}
