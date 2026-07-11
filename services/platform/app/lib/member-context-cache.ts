import {
  memberRoleSchema,
  type MemberRole,
} from '@/lib/shared/schemas/organizations';
import { isRecord } from '@/lib/utils/type-utils';

/**
 * Last-known member context (user, org, role) for instant nav-shell hydration
 * on the next load of the same dashboard (epic #2386). While the live
 * `getCurrentMemberContext` subscription is still resolving, the dashboard
 * layout can mount the real navigation rail from this hint instead of the
 * masked placeholder — the subscription then confirms or corrects it within
 * one round trip (revalidate-on-connect).
 *
 * Safety model (correctness over speed):
 * - Minimal shell fields only (ids + role) — no names, emails, or content.
 * - Reads are keyed: they return a role only when BOTH the user id and the
 *   organization id match, so one user's (or org's) shell can never hydrate
 *   another's. Callers must additionally gate on the WS being authenticated —
 *   every query the hydrated shell fires is still RLS-authorized server-side.
 * - `disabled` / non-member results are never cached (they clear instead), a
 *   TTL bounds staleness, and `sessionStorage` scopes the hint to the tab.
 */

const STORAGE_KEY = 'tale:member-context';

/** A shell hint older than this is stale enough to prefer the placeholder. */
const TTL_MS = 12 * 60 * 60 * 1000;

const isBrowser = typeof window !== 'undefined';

interface CachedMemberContext {
  userId: string;
  organizationId: string;
  role: MemberRole;
  savedAt: number;
}

function parseRecord(raw: string): CachedMemberContext | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const { userId, organizationId, role, savedAt } = parsed;
    if (
      typeof userId !== 'string' ||
      typeof organizationId !== 'string' ||
      typeof savedAt !== 'number'
    ) {
      return null;
    }
    const parsedRole = memberRoleSchema.safeParse(role);
    if (!parsedRole.success) return null;
    return { userId, organizationId, role: parsedRole.data, savedAt };
  } catch (error) {
    console.warn('Failed to parse cached member context:', error);
    return null;
  }
}

/**
 * The cached role for exactly this user in exactly this org, or `null` when
 * absent, mismatched, stale, or malformed (bad records are removed so the cold
 * path stays clean).
 */
export function readCachedMemberContextRole(
  userId: string,
  organizationId: string,
): MemberRole | null {
  if (!isBrowser) return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to read cached member context:', error);
    return null;
  }
  if (!raw) return null;
  const record = parseRecord(raw);
  if (!record || record.savedAt + TTL_MS < Date.now()) {
    clearMemberContextCache();
    return null;
  }
  if (record.userId !== userId || record.organizationId !== organizationId) {
    return null;
  }
  return record.role;
}

/**
 * Persist the server-resolved member context. `disabled` is deliberately
 * rejected — hydrating a disabled shell would flash AccessDenied state from a
 * possibly stale hint.
 */
export function cacheMemberContext(context: {
  userId: string;
  organizationId: string;
  role: MemberRole;
}): void {
  if (!isBrowser) return;
  if (context.role === 'disabled') {
    clearMemberContextCache();
    return;
  }
  const record: CachedMemberContext = { ...context, savedAt: Date.now() };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (error) {
    // Quota / security errors — instant shell hydration is lost for the next
    // reload only; the live subscription still renders this load correctly.
    console.warn('Failed to persist member context:', error);
  }
}

export function clearMemberContextCache(): void {
  if (!isBrowser) return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear cached member context:', error);
  }
}
