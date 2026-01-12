'use client';

import type { Variants, Transition, Easing } from 'framer-motion';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { DURATION, EASING } from './constants';

/**
 * Returns animation props that respect reduced motion preferences.
 */
export function useAnimationProps<T extends Variants>(
  variants: T,
  reducedMotionVariant: keyof T = 'visible' as keyof T
) {
  const prefersReducedMotion = usePrefersReducedMotion();

  if (prefersReducedMotion) {
    return {
      initial: reducedMotionVariant,
      animate: reducedMotionVariant,
      exit: reducedMotionVariant,
    };
  }

  return {
    initial: 'hidden',
    animate: 'visible',
    exit: 'exit',
    variants,
  };
}

/**
 * Returns a transition object that respects reduced motion.
 */
export function useTransition(
  duration: number = DURATION.standard,
  ease: Easing = EASING.out as Easing
): Transition {
  const prefersReducedMotion = usePrefersReducedMotion();

  if (prefersReducedMotion) {
    return { duration: 0 };
  }

  return { duration: duration / 1000, ease };
}

/**
 * Hook for determining animation className based on reduced motion preference.
 */
export function useAnimationClass(
  animatedClass: string,
  fallbackClass: string = ''
) {
  const prefersReducedMotion = usePrefersReducedMotion();
  return prefersReducedMotion ? fallbackClass : animatedClass;
}
