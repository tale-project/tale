import { ConvexError } from 'convex/values';

/**
 * Cap on how many entries the inlined `versionHistory` array on each
 * promptTemplates row keeps. When a publish would push past this, the oldest
 * entry is dropped (FIFO) and a `prompt_template.history_truncated` audit
 * event is emitted (see version_history.ts + mutations.ts).
 *
 * Budget math: MAX_PROMPT_CONTENT_BYTES (64 KiB) × (MAX_PROMPT_VERSION_HISTORY +
 * 1 row-level current) ≈ 832 KB, leaving ~190 KB headroom for title,
 * description, tags, and per-entry metadata under the 1 MiB Convex per-document
 * limit. The history depth was traded down (50 → 12) to make room for larger
 * per-version content; users editing complex LLM prompts care more about
 * having room to write than about keeping decades of history.
 */
export const MAX_PROMPT_VERSION_HISTORY = 12;

/**
 * Per-version content byte cap. UTF-8 byte count, not char count, so emoji /
 * CJK consume their true storage size. Mirrors the artifact pattern
 * (artifacts/internal_mutations.ts MAX_ARTIFACT_BYTES) at a smaller cap to
 * stay inside the per-document budget after multiplying by the history depth.
 */
export const MAX_PROMPT_CONTENT_BYTES = 65_536;
export const MAX_PROMPT_TITLE_LEN = 200;
export const MAX_PROMPT_DESCRIPTION_LEN = 2_000;

export function assertPromptSizes(args: {
  content?: string;
  title?: string;
  description?: string;
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
}
