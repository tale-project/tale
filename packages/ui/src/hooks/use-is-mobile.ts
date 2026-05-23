import { useBreakpoint } from './use-breakpoint';

/**
 * `true` when the viewport is narrower than the `md` breakpoint (`< 768px`).
 * Convenience wrapper around {@link useBreakpoint}.
 */
export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile';
}
