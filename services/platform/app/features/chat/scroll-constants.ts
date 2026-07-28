/**
 * Fallback vertical inset (px) between the viewport top and the anchored last
 * user message when the content wrapper's padding-top isn't measurable yet.
 * Prefer {@link resolveTopInset} with the live padding so slack and send-snap
 * stay in sync with the CSS that clears the floating glass header (`md:pt-19`).
 */
export const TOP_INSET = 16;

/**
 * Live top inset for send-snap and response-area slack. The content wrapper's
 * padding-top is the single source of truth: on desktop `md:pt-19` (~76px)
 * clears the absolute frosted header; on smaller breakpoints `p-4` / `sm:p-6`
 * is ordinary breathing room. Falling back to {@link TOP_INSET} covers the
 * brief window before layout styles resolve.
 */
export function resolveTopInset(padTopPx: number): number {
  return padTopPx > 0 ? padTopPx : TOP_INSET;
}
