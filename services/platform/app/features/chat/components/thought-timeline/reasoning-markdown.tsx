'use client';

import type { MarkdownComponentMap } from '@/lib/utils/markdown-types';

/**
 * Minimal markdown overrides for reasoning prose: tight, symmetric block spacing
 * with the FIRST block's top margin and the LAST block's bottom margin zeroed
 * (`first:mt-0 last:mb-0`), so the reasoning text's first line sits flush with
 * the toggle rather than a line below it. Color/size are inherited from the row
 * wrapper. Deliberately tiny (just block spacing — no shiki / citations /
 * router) so the timeline stays decoupled from the heavy chat markdown renderer.
 */
export const REASONING_MARKDOWN_COMPONENTS: MarkdownComponentMap = {
  p: ({ children }) => (
    <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
};
