import { useMemo } from 'react';

import { MAX_PROMPT_CONTENT_BYTES } from '@/convex/prompts/constants';
import { formatBytes } from '@/lib/utils/format-bytes';

export interface PromptContentLimit {
  /**
   * Character count for the on-screen counter. Display-only — never treated
   * as a stand-in for `bytes` and never compared against
   * `MAX_PROMPT_CONTENT_BYTES` directly, since one character can be several
   * UTF-8 bytes (accents, emoji, CJK): the same char count can sit under or
   * over the byte cap depending on the content.
   */
  chars: number;
  /** UTF-8 byte length — the value the server actually enforces. */
  bytes: number;
  /** True once `bytes` exceeds the server's cap. The Save gate's source of truth. */
  overLimit: boolean;
  /** True when nearing (>=90%) the byte cap but not yet over it. */
  approachingLimit: boolean;
  /** Human-readable size of the cap (e.g. "16 KB"), for the over-limit alert. */
  limitLabel: string;
}

/**
 * Server measures a UTF-8 byte budget (`MAX_PROMPT_CONTENT_BYTES`,
 * `size_guards.assertPromptSizes`), but bytes are a developer unit end users
 * don't reason in (#2644) — so the counter shows a plain character count
 * with no numeric max attached to it (a char count can't state an exact
 * ceiling: how many bytes a character costs varies with the character). The
 * byte-derived `overLimit`/`approachingLimit` remain the sole source of
 * truth for the Save gate and the counter's warning styling — never derived
 * from `chars` — so the indicator can never claim "under limit" while Save
 * is actually byte-blocked. `limitLabel` surfaces the real cap in
 * human-readable form only where it's relevant: the over-limit alert.
 *
 * Shared by `SavePromptDialog` and `PromptFormDialog`, which measure
 * different inputs (raw vs. trimmed content) but must agree on what "over
 * limit" means.
 */
export function computePromptContentLimit(content: string): PromptContentLimit {
  const bytes = new TextEncoder().encode(content).byteLength;
  const overLimit = bytes > MAX_PROMPT_CONTENT_BYTES;
  const approachingLimit =
    !overLimit && bytes >= MAX_PROMPT_CONTENT_BYTES * 0.9;
  return {
    chars: content.length,
    bytes,
    overLimit,
    approachingLimit,
    limitLabel: formatBytes(MAX_PROMPT_CONTENT_BYTES),
  };
}

/** Memoized wrapper of {@link computePromptContentLimit} for use in render. */
export function usePromptContentLimit(content: string): PromptContentLimit {
  return useMemo(() => computePromptContentLimit(content), [content]);
}
