'use client';

import { Brain } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

import { ThinkingDots } from './thinking-dots';

/**
 * The single status strip shared by BOTH the pre-bubble gap shell
 * (`ThinkingIndicator`) and the in-bubble `MessageThoughtHeader`. Rendering the
 * exact same markup on both sides of the gap→bubble handoff is what keeps the
 * label from shifting: previously the gap shell led with a (reserved-width)
 * chevron and the bubble didn't, so the title jumped left by ~1.25rem when the
 * bubble took over. There is no chevron and no expand affordance here — the
 * reasoning/tool detail renders inline in the body below, not behind a toggle.
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
}: {
  text: string;
  /** Bouncing dots after the label, signalling live activity. */
  showDots?: boolean;
  /** Outer spacing (the gap shell passes its list padding here). */
  className?: string;
}) {
  return (
    <div className={cn('mb-3', className)}>
      <div className="text-muted-foreground flex h-5 min-w-0 items-center gap-1.5 text-sm font-medium">
        <Brain className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate text-left">{text}</span>
        {showDots && <ThinkingDots />}
      </div>
    </div>
  );
}
