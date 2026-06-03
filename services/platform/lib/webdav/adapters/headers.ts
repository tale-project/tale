// First hop of X-Forwarded-For — the original client IP set by Caddy on the
// /dav/* route. Used only as a rate-limit bucket key, never as a security
// boundary, so the simple first-token parse is sufficient. Shared by the Hono
// (fetch) and Node (Vite Connect) adapters so the parsing can't drift.
export function firstForwardedFor(xff: string | null): string | undefined {
  if (!xff) return undefined;
  const first = xff.split(',')[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}
