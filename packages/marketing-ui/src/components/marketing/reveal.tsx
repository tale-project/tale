import { cn } from '@tale/ui/cn';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { useState, type ReactNode } from 'react';

import { useSkipEntrance } from '../../lib/entrance';

export const MARKETING_EASE = [0.22, 1, 0.36, 1] as const;

export const MARKETING_VIEWPORT = {
  once: true,
  margin: '-12%' as const,
} as const;

interface RevealProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  /**
   * Opacity-only by default so scroll position stays stable. Pass a small
   * `y` only for above-the-fold hero mounts that use `animate` (not
   * `whileInView`) — never for long-page scroll reveals.
   */
  y?: number;
  delay?: number;
  duration?: number;
  /**
   * When true, plays on mount via `animate` instead of `whileInView`.
   * Use for the hero; keep false for below-the-fold sections.
   */
  onMount?: boolean;
}

/**
 * Shared entrance for marketing pages. Skips on SSR, reduced-motion, and
 * SPA revisits (`useSkipEntrance`). Scroll reveals are opacity-only so
 * they never fight the scroll position (homepage jitter).
 */
export function Reveal({
  children,
  className,
  y = 0,
  delay = 0,
  duration = 0.55,
  onMount = false,
  onFocusCapture,
  ...rest
}: RevealProps) {
  const skip = useSkipEntrance();
  const [focused, setFocused] = useState(false);
  const immediate = skip || focused;
  const offset = onMount ? y : 0;
  const initial = immediate
    ? false
    : { opacity: 0, ...(offset ? { y: offset } : {}) };
  const target = { opacity: 1, ...(offset ? { y: 0 } : {}) };
  const transition = immediate
    ? { duration: 0 }
    : { duration, delay, ease: MARKETING_EASE };
  const animateNow = onMount || immediate;

  return (
    <motion.div
      initial={initial}
      animate={animateNow ? target : undefined}
      whileInView={animateNow ? undefined : target}
      viewport={MARKETING_VIEWPORT}
      transition={transition}
      className={cn(className)}
      {...rest}
      onFocusCapture={(event) => {
        // Keyboard navigation may reach a link before its section has
        // crossed the viewport threshold. Never leave focused UI hidden.
        setFocused(true);
        onFocusCapture?.(event);
      }}
    >
      {children}
    </motion.div>
  );
}
