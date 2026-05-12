import { ConvexError } from 'convex/values';

/**
 * Cap on how many entries the inlined `versionHistory` array on each
 * promptTemplates row keeps. When a publish would push past this, the oldest
 * entry is dropped (FIFO) and a console.warn is emitted once.
 * MAX_PROMPT_CONTENT_BYTES × MAX_PROMPT_VERSION_HISTORY ≈ 800 KB, staying
 * comfortably under the 1 MiB Convex per-document limit.
 */
export const MAX_PROMPT_VERSION_HISTORY = 50;

/**
 * Per-version content byte cap. Mirrors the artifact pattern
 * (artifacts/internal_mutations.ts MAX_ARTIFACT_BYTES): we cap below the
 * 1 MiB Convex doc limit so a single update — which also pushes a snapshot
 * into versionHistory — stays under the limit even at the 50-entry cap.
 */
export const MAX_PROMPT_CONTENT_BYTES = 16_000;
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
