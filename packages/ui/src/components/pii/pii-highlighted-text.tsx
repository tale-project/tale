/**
 * `PiiHighlightedText` — render text with detected PII spans highlighted.
 *
 * Walks the segment list and slices the input text into a mix of plain
 * text runs and highlighted spans. Each highlighted span carries a
 * Radix tooltip showing the translated PII type label.
 *
 * Two visual variants drive the "stages" view in the playground:
 *   - `variant="redacted"` (default): yellow background — text being
 *     prepared for an external system, PII still visible.
 *   - `variant="tokenized"`: blue background, monospace — shows the
 *     indexed `[EMAIL_1]` token instead of the original text. This is
 *     what gets sent to the AI.
 *   - `variant="restored"`: green background — the AI's response after
 *     `detokenize` runs and the original PII is back in place.
 *
 * Type-label translations are resolved via the `piiTypes` namespace
 * shipped by this package — no consumer wiring needed beyond mounting
 * the shared `<I18nProvider>` at the app root.
 *
 * Accessibility
 *   - Each highlighted span is a `<mark>` with an `aria-label` carrying
 *     the type label so screen readers announce "Sensitive: Email" when
 *     they hit the span. The visual tooltip is `aria-hidden` because
 *     the same content is already in `aria-label` — no double-read.
 */

import { type ReactNode } from 'react';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../overlays/tooltip';
import { piiTypeLabel } from './pii-type-labels';

/** One span the highlighter draws over the text. */
export interface PiiHighlightSegment {
  /** Inclusive byte offset (UTF-16 code units) into `text`. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** PII pattern name — used to look up the tooltip label. */
  type: string;
  /**
   * Optional alternative label for the highlighted span body. The
   * "tokenized" stage passes the indexed token (`[EMAIL_1]`); other
   * stages render the actual text from `text.slice(start, end)`.
   */
  label?: string;
}

export interface PiiHighlightedTextProps {
  /** The full text in which the spans are located. */
  text: string;
  /** Detected spans. May be empty — then the component just renders `text`. */
  segments: ReadonlyArray<PiiHighlightSegment>;
  /**
   * Visual variant — picks the highlight colour and font for the marks.
   * The colours map to platform tokens so light / dark mode work without
   * extra rules.
   */
  variant?: 'redacted' | 'tokenized' | 'restored';
  /** Optional className passed through to the outer `<div>`. */
  className?: string;
}

/**
 * Map variant → Tailwind classes. Pulled out to keep the render function
 * readable. The colour tokens (`--color-warning-base`, etc.) are platform
 * design-system variables already defined in `globals.css`.
 */
const VARIANT_CLASSES: Record<
  NonNullable<PiiHighlightedTextProps['variant']>,
  string
> = {
  redacted:
    'bg-[color:var(--color-warning-base)]/20 text-[color:var(--color-warning-fg)] ring-1 ring-[color:var(--color-warning-base)]/40',
  tokenized:
    'font-mono bg-[color:var(--color-info-base)]/20 text-[color:var(--color-info-fg)] ring-1 ring-[color:var(--color-info-base)]/40',
  restored:
    'bg-[color:var(--color-success-base)]/20 text-[color:var(--color-success-fg)] ring-1 ring-[color:var(--color-success-base)]/40',
};

export function PiiHighlightedText({
  text,
  segments,
  variant = 'redacted',
  className,
}: PiiHighlightedTextProps): ReactNode {
  const { t } = useT('piiTypes');
  // Sort by start so we walk left-to-right.
  const ordered = [...segments].sort((a, b) => a.start - b.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < ordered.length; i++) {
    const seg = ordered[i];
    if (!seg || seg.start < cursor) {
      // Overlap — skip this span; the detector should have deduped but
      // we defend against malformed input rather than crash.
      continue;
    }
    if (seg.start > cursor) {
      nodes.push(<span key={`t-${i}`}>{text.slice(cursor, seg.start)}</span>);
    }
    const body = seg.label ?? text.slice(seg.start, seg.end);
    const label = piiTypeLabel(seg.type, t);
    nodes.push(
      <Tooltip key={`m-${i}`}>
        <TooltipTrigger asChild>
          <mark
            // `aria-label` carries the type so screen readers announce
            // it even without the visual tooltip popping.
            aria-label={`${label}: ${text.slice(seg.start, seg.end)}`}
            className={cn(
              'rounded px-1 py-0.5 cursor-help',
              VARIANT_CLASSES[variant],
            )}
          >
            {body}
          </mark>
        </TooltipTrigger>
        <TooltipContent aria-hidden>{label}</TooltipContent>
      </Tooltip>,
    );
    cursor = seg.end;
  }
  if (cursor < text.length) {
    nodes.push(<span key="t-end">{text.slice(cursor)}</span>);
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          'whitespace-pre-wrap wrap-break-word leading-relaxed',
          className,
        )}
      >
        {nodes}
      </div>
    </TooltipProvider>
  );
}
