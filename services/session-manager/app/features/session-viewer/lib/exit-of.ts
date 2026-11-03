import type { Session } from '@/lib/api/schemas';

/**
 * The IP the session's proxy exits through, with its country, as the page
 * words it everywhere (`203.0.113.7 · DE`): the proxy's own answer, else the IP
 * the session's place was taken from. `null` while none is known (a session
 * that has not run yet).
 */
export function exitOf(session: Session): { ip: string; line: string } | null {
  const ip = session.proxy?.exitIp ?? session.location?.ip ?? null;
  if (ip === null) return null;
  const country = session.proxy?.country ?? session.location?.country ?? null;
  return {
    ip,
    line: country === null || country === '' ? ip : `${ip} · ${country}`,
  };
}
