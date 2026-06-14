'use client';

import { Brain, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

import { ThinkingDots } from './thinking-dots';

/**
 * The single status strip shared by BOTH the pre-bubble gap shell
 * (`ThinkingIndicator`) and the in-bubble `MessageThoughtHeader`. Rendering the
 * exact same markup on both sides of the gap→bubble handoff is what keeps the
 * label from shifting: previously the gap shell led with a (reserved-width)
 * chevron and the bubble didn't, so the title jumped left by ~1.25rem when the
 * bubble took over.
 *
 * The strip doubles as the SINGLE reasoning toggle: when `expandable`, the
 * leading glyph is a real chevron and the row is a button that reveals the
 * reasoning prose below (the in-bubble `MessageThoughtHeader` owns that body).
 * To keep the gap→bubble handoff jitter-free, the leading slot is ALWAYS
 * present at a fixed width — a chevron when expandable, otherwise an invisible
 * same-width spacer. The gap shell is never expandable, so the spacer holds the
 * chevron's place; the brain/text never shift when the bubble takes over, nor
 * when reasoning arrives mid-stream and the spacer flips to a chevron in place.
 *
 * Fixed `h-5` + `truncate`: the live label swaps between states of different
 * lengths ("Thinking" ↔ "Searching knowledge base for …"), so it MUST truncate
 * rather than wrap — a wrapping label would change the header height and shift
 * the whole message on every state change.
 */
export function ThoughtHeader({
  text,
  showDots,
  className,
  expandable = false,
  expanded = false,
  onToggle,
  bodyId,
}: {
  text: string;
  /** Bouncing dots after the label, signalling live activity. */
  showDots?: boolean;
  /** Outer spacing (the gap shell passes its list padding here). */
  className?: string;
  /** Render a real chevron and make the row a toggle button. When false a
   *  same-width invisible spacer holds the chevron's place (zero jitter). */
  expandable?: boolean;
  /** Whether the revealed reasoning body is currently open. */
  expanded?: boolean;
  onToggle?: () => void;
  /** id of the revealed region, for `aria-controls` when expanded. */
  bodyId?: string;
}) {
  const leading = expandable ? (
    <ChevronRight
      className={cn(
        'size-3.5 shrink-0 transition-transform',
        expanded && 'rotate-90',
      )}
      aria-hidden="true"
    />
  ) : (
    <span className="size-3.5 shrink-0" aria-hidden="true" />
  );

  const rowClassName =
    'flex h-5 min-w-0 items-center gap-1.5 text-sm font-medium';
  const children = (
    <>
      {leading}
      <Brain className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate text-left">{text}</span>
      {showDots && <ThinkingDots />}
    </>
  );

  return (
    <div className={cn('mb-3', className)}>
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={expanded ? bodyId : undefined}
          className={cn(
            rowClassName,
            'text-muted-foreground hover:text-foreground w-full transition-colors',
          )}
        >
          {children}
        </button>
      ) : (
        <div className={cn(rowClassName, 'text-muted-foreground')}>
          {children}
        </div>
      )}
    </div>
  );
}
