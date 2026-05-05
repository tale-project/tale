// Lightweight in-memory IP token bucket. Marketing forms are low-traffic and
// the web service runs as a single instance — durable storage isn't justified.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
// Hard cap so a flood of unique IPs can't grow the Map without bound. When
// hit, we evict the oldest 25% of entries (Map iteration is insertion-ordered).
const MAX_BUCKETS = 10_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function evictExpired(now: number): void {
  for (const [ip, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(ip);
  }
  if (buckets.size > MAX_BUCKETS) {
    const drop = Math.ceil(buckets.size / 4);
    let i = 0;
    for (const ip of buckets.keys()) {
      if (i >= drop) break;
      buckets.delete(ip);
      i += 1;
    }
  }
}

export function checkRateLimit(
  ip: string,
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    if (bucket) buckets.delete(ip);
    if (buckets.size >= MAX_BUCKETS) evictExpired(now);
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }

  if (bucket.count >= MAX_PER_WINDOW) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { ok: true };
}
