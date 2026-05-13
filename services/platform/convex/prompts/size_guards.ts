import { ConvexError } from 'convex/values';

import {
  MAX_PROMPT_CATEGORY_LEN,
  MAX_PROMPT_CONTENT_BYTES,
  MAX_PROMPT_DESCRIPTION_LEN,
  MAX_PROMPT_TAG_LEN,
  MAX_PROMPT_TAGS_COUNT,
  MAX_PROMPT_TITLE_LEN,
} from './constants';

/**
 * Validate prompt field sizes. All string fields are trimmed before measuring
 * so whitespace padding cannot bypass the caps. Throws `ConvexError({code:
 * 'empty_content' | 'too_large', field, ...})` on the first violation; client
 * `extract-error-code` maps both codes to user-facing toasts.
 *
 * Callers should also trim values before persisting — this function does NOT
 * mutate the input.
 */
export function assertPromptSizes(args: {
  content?: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
}): void {
  if (args.content !== undefined) {
    const trimmed = args.content.trim();
    if (trimmed === '') {
      throw new ConvexError({
        code: 'empty_content',
        field: 'content',
        message: 'Prompt content cannot be empty.',
      });
    }
    const size = new TextEncoder().encode(trimmed).byteLength;
    if (size > MAX_PROMPT_CONTENT_BYTES) {
      throw new ConvexError({
        code: 'too_large',
        field: 'content',
        message: `Prompt content is ${size} bytes; max ${MAX_PROMPT_CONTENT_BYTES}.`,
      });
    }
  }
  if (
    args.title !== undefined &&
    args.title.trim().length > MAX_PROMPT_TITLE_LEN
  ) {
    throw new ConvexError({
      code: 'too_large',
      field: 'title',
      message: `Prompt title exceeds ${MAX_PROMPT_TITLE_LEN} chars.`,
    });
  }
  if (
    args.description !== undefined &&
    args.description.trim().length > MAX_PROMPT_DESCRIPTION_LEN
  ) {
    throw new ConvexError({
      code: 'too_large',
      field: 'description',
      message: `Prompt description exceeds ${MAX_PROMPT_DESCRIPTION_LEN} chars.`,
    });
  }
  if (
    args.category !== undefined &&
    args.category.trim().length > MAX_PROMPT_CATEGORY_LEN
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
    for (const rawTag of args.tags) {
      const tag = rawTag.trim();
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

/**
 * Normalize prompt string fields by trimming. Returns a new object — does not
 * mutate input. Callers persist these normalized values so storage matches
 * what `assertPromptSizes` measured.
 *
 * `tags` are individually trimmed AND empty tags are removed. Duplicate tags
 * are not deduplicated here — the client form is responsible for that.
 */
export function normalizePromptFields<
  T extends {
    title?: string;
    content?: string;
    description?: string;
    category?: string;
    tags?: string[];
  },
>(args: T): T {
  const out = { ...args };
  if (args.title !== undefined) out.title = args.title.trim();
  if (args.content !== undefined) out.content = args.content.trim();
  if (args.description !== undefined) {
    out.description = args.description.trim();
  }
  if (args.category !== undefined) out.category = args.category.trim();
  if (args.tags !== undefined) {
    out.tags = args.tags.map((t) => t.trim()).filter((t) => t.length > 0);
  }
  return out;
}
