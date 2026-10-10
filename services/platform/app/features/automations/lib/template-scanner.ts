/**
 * The engine's template rule, as the code editor reads it: where each
 * `{{ <expression> }}` of a field begins and ends, decided by the same
 * tokenizer the runtime evaluates with (`tokenizeTemplate`), so the editor
 * colours exactly the span a run evaluates — exotic input included, such
 * as a regular expression or a comment holding `}}`.
 */

import type { TemplateScan } from '@tale/ui/code-editor/template-scan';

import { tokenizeTemplate } from '@/lib/engine/core/syntax/tokens';

export function engineTemplateScan(text: string): TemplateScan {
  const tokens = tokenizeTemplate(text);
  return {
    spans: tokens.segments.flatMap((segment) =>
      segment.kind === 'expr'
        ? [
            {
              open: segment.start,
              bodyFrom: segment.start + 2,
              bodyTo: segment.end - 2,
              end: segment.end,
              balanced: segment.parsed !== false,
            },
          ]
        : [],
    ),
    unterminated: tokens.unterminated,
  };
}
