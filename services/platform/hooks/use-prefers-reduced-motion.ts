'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to detect if the user prefers reduced motion.
 *
 * This respects the user's system-level accessibility preference for reduced motion,
 * which can be set in:
 * - macOS: System Preferences → Accessibility → Display → Reduce motion
 * - Windows: Settings → Ease of Access → Display → Show animations
 * - iOS: Settings → Accessibility → Motion → Reduce Motion
 * - Android: Settings → Accessibility → Remove animations
 *
 * Use this hook to:
 * - Skip animations entirely
 * - Use simpler transitions instead of complex animations
 * - Show content instantly instead of with reveal effects
 *
 * @example
 * ```tsx
 * function AnimatedComponent() {
 *   const prefersReducedMotion = usePrefersReducedMotion();
 *
 *   if (prefersReducedMotion) {
 *     return <div>{content}</div>; // Instant, no animation
 *   }
 *
 *   return <motion.div animate={...}>{content}</motion.div>;
 * }
 * ```
 *
 * @returns {boolean} True if the user prefers reduced motion
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check if window is available (SSR safety)
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const listener = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  return prefersReducedMotion;
}
