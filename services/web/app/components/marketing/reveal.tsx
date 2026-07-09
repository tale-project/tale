import { cn } from '@tale/ui/cn';
import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

import { useSkipEntrance } from '@/lib/motion/entrance';

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
  ...rest
}: RevealProps) {
  const skip = useSkipEntrance();
  const initial = skip ? false : { opacity: 0, ...(y ? { y } : {}) };
  const target = { opacity: 1, ...(y ? { y: 0 } : {}) };
  const transition = skip
    ? { duration: 0 }
    : { duration, delay, ease: MARKETING_EASE };

  if (onMount) {
    return (
      <motion.div
        initial={initial}
        animate={target}
        transition={transition}
        className={cn(className)}
        {...rest}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={initial}
      whileInView={target}
      viewport={MARKETING_VIEWPORT}
      transition={transition}
      className={cn(className)}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
