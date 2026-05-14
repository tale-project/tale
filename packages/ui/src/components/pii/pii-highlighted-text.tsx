/**
 * `PiiHighlightedText` — render text with detected PII spans highlighted.
 *
 * Walks the segment list and slices the input text into a mix of plain
 * text runs and highlighted spans. Each highlighted span carries a
 * Radix tooltip showing the translated PII type label plus the matched
 * value (so the user gets two pieces of information in one hover).
 *
 * Three visual variants drive the "stages" view in the config panel:
 *   - `variant="redacted"` (default): yellow background — text being
 *     prepared for an external system, PII still visible.
 *   - `variant="tokenized"`: blue background, monospace — shows the
 *     indexed `[EMAIL_1]` token instead of the original text. This is
 *     what gets sent to the AI.
 *   - `variant="restored"`: green background — the AI's response after
 *     `detokenize` runs and the original PII is back in place.
 *
 * Each `<mark>` includes a small type-specific Lucide icon so the
 * category is identifiable without hovering — a quieter affordance than
 * relying on color alone.
 *
 * Type-label translations are resolved via the `piiTypes` namespace
 * shipped by this package — no consumer wiring needed beyond mounting
 * the shared `<I18nProvider>` at the app root.
 *
 * Accessibility
 *   - Each highlighted span is a `<mark>` with an `aria-label` carrying
 *     the type label + matched value so screen readers announce e.g.
 *     "Email: alice@example.com" when they hit the span.
 *   - The icon is `aria-hidden` — its meaning is already in `aria-label`.
 *   - The tooltip is `aria-hidden` for the same reason; it is purely a
 *     visual affordance for sighted users.
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
import { piiTypeIcon } from './pii-type-icons';
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
 * design-system variables already defined in `globals.css`. Hover bumps
 * the resting `ring-1` up to `ring-2` so the affordance is obvious
 * without animating layout (avoiding text reflow on hover).
 */
const VARIANT_CLASSES: Record<
  NonNullable<PiiHighlightedTextProps['variant']>,
  string
> = {
  redacted:
    'bg-[color:var(--color-warning-base)]/15 text-[color:var(--color-warning-fg)] ring-1 ring-[color:var(--color-warning-base)]/40 hover:ring-2 hover:ring-[color:var(--color-warning-base)]/60',
  tokenized:
    'font-mono bg-[color:var(--color-info-base)]/15 text-[color:var(--color-info-fg)] ring-1 ring-[color:var(--color-info-base)]/40 hover:ring-2 hover:ring-[color:var(--color-info-base)]/60',
  restored:
    'bg-[color:var(--color-success-base)]/15 text-[color:var(--color-success-fg)] ring-1 ring-[color:var(--color-success-base)]/40 hover:ring-2 hover:ring-[color:var(--color-success-base)]/60',
};

/** Truncate a long value for the tooltip so it stays a one-liner. */
function truncateForTooltip(value: string, max = 48): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

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
    const rawValue = text.slice(seg.start, seg.end);
    const body = seg.label ?? rawValue;
    const label = piiTypeLabel(seg.type, t);
    const Icon = piiTypeIcon(seg.type);
    nodes.push(
      <Tooltip key={`m-${i}`}>
        <TooltipTrigger asChild>
          <mark
            aria-label={`${label}: ${rawValue}`}
            className={cn(
              'inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 align-baseline leading-tight transition-shadow cursor-help',
              VARIANT_CLASSES[variant],
            )}
          >
            <Icon
              className="size-3 shrink-0 translate-y-px opacity-80"
              aria-hidden
            />
            <span>{body}</span>
          </mark>
        </TooltipTrigger>
        <TooltipContent aria-hidden className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold">{label}</span>
          <span className="font-mono text-[10px] opacity-80">
            {truncateForTooltip(seg.label ? body : rawValue)}
          </span>
        </TooltipContent>
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
