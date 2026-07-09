/**
 * Rebase a root-absolute content asset src onto the deploy mount point.
 *
 * Docs pages embed screenshots as `![alt](/images/…)` (the convention
 * `tests/images.test.ts` enforces), which resolves against `public/` when
 * the app is served at `/`. Deployed under a sub-path (Vite `base`, e.g.
 * `/docs/` on tale.dev), markdown links pick the prefix up from the
 * router's `basepath`, but `<img>` srcs bypass the router — without this
 * rebase the browser requests the host root, which answers with an HTML
 * fallback it refuses to render as an image.
 *
 * Vite injects `base` as `import.meta.env.BASE_URL` (always
 * trailing-slashed); callers pass it in so the function stays pure and
 * testable across bases.
 */
export function rebaseImageSrc(
  base: string,
  src: string | undefined,
): string | undefined {
  if (!src) return src;
  // Only root-absolute paths belong to this app's `public/`; leave scheme'd
  // (`https:`, `data:`, …) and protocol-relative (`//host`) URLs untouched.
  if (!src.startsWith('/') || src.startsWith('//')) return src;
  const prefix = base.replace(/\/$/, '');
  return prefix ? `${prefix}${src}` : src;
}
