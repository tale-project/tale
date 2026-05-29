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
