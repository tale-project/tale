import { ConvexError } from 'convex/values';

// Extract the `{ code: string }` data payload our Convex internal mutations
// raise on expected failures. Returns undefined for non-ConvexError throws
// or unstructured data. Avoids repeated `as { code?: string }` casts.
export function convexErrorCode(err: unknown): string | undefined {
  if (!(err instanceof ConvexError)) return undefined;
  const data: unknown = err.data;
  if (typeof data !== 'object' || data === null) return undefined;
  if (!('code' in data)) return undefined;
  const candidate: unknown = data.code;
  return typeof candidate === 'string' ? candidate : undefined;
}

// Extract the human-readable `{ message: string }` our Convex internal mutations
// raise on expected failures, falling back to `fallback` for non-ConvexError
// throws or unstructured data. Centralizes the toast-message helper that was
// copied verbatim across several settings/chat components.
//
// Uses `instanceof ConvexError` to match the prior call-site behavior. A more
// chunk-split-robust duck-typed variant lives in
// `convex/lib/governance/convex-error-data.ts` (Vite can emit multiple
// ConvexError class copies, breaking instanceof) — switch to it only if a
// regression surfaces, since that would be a behavior change.
export function convexErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ConvexError)) return fallback;
  const data: unknown = err.data;
  if (
    data !== null &&
    typeof data === 'object' &&
    'message' in data &&
    typeof data.message === 'string'
  ) {
    return data.message;
  }
  return fallback;
}
