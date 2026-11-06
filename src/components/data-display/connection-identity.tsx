'use client';

import { cn } from '@tale/ui/cn';
import { Link2 } from 'lucide-react';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export interface ConnectionIdentityProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'role' | 'aria-label' | 'aria-labelledby'
> {
  /** The mark on the left: the app asking to connect. */
  from: ReactNode;
  /** The mark on the right: what it connects to. */
  to: ReactNode;
  /**
   * What the picture says, in words: "Claude Code connecting to Tale". The
   * marks are decoration; this is the picture's only accessible text.
   */
  label: string;
}

/** A 40px tile for one side of the connection. */
function Mark({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="border-border bg-muted text-foreground flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border [&>svg]:size-6"
    >
      {children}
    </span>
  );
}

/**
 * Two marks joined by a dashed line with a link glyph on it: who is asking to
 * connect to what. It is one picture, `role="img"` with the `label` you give
 * it, so a screen reader says the sentence and skips the marks.
 *
 * The line draws from the first mark to the second once, when the picture
 * appears, over `--duration-slow`; under `prefers-reduced-motion: reduce` it
 * is simply there. The marks take any node: a vendor icon, a letter, an
 * `Avatar`. Icons are shown at 24px inside the 40px tile.
 *
 * ```tsx
 * <ConnectionIdentity
 *   label="Claude Code connecting to Tale"
 *   from={<ClaudeIcon />}
 *   to={<TaleMark />}
 * />
 * ```
 */
export const ConnectionIdentity = forwardRef<
  HTMLDivElement,
  ConnectionIdentityProps
>(({ from, to, label, className, ...props }, ref) => (
  <div
    ref={ref}
    role="img"
    aria-label={label}
    className={cn('flex items-center justify-center', className)}
    {...props}
  >
    <Mark>{from}</Mark>
    <span
      aria-hidden="true"
      className="relative flex h-6 w-12 shrink-0 items-center justify-center"
    >
      <span className="animate-connection-reveal border-border absolute inset-x-0 top-1/2 border-t border-dashed" />
      <span className="border-border bg-background text-muted-foreground relative flex size-6 items-center justify-center rounded-full border">
        <Link2 className="size-3.5" />
      </span>
    </span>
    <Mark>{to}</Mark>
  </div>
));
ConnectionIdentity.displayName = 'ConnectionIdentity';
