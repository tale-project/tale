// Lightweight in-memory IP token bucket. Marketing forms are low-traffic and
// the web service runs as a single instance — durable storage isn't justified.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  ip: string,
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    // Lazy eviction: remove expired bucket before creating new one
    if (bucket) buckets.delete(ip);
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }

  if (bucket.count >= MAX_PER_WINDOW) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { ok: true };
}

export function resetRateLimit(): void {
  buckets.clear();
}
