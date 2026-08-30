/**
 * Resolve a user id to a display name for notification copy.
 *
 * The resolved name is a proper noun (the person's name or email), so it is
 * safe to interpolate into copy in ANY locale. When the id can't be resolved
 * — a deleted user, a sentinel like 'system', or a malformed id — this returns
 * null so the caller can fall back to an impersonal, fully-localized body
 * rather than leaking an English fallback word into DE/FR copy. Never throws.
 */

import { getUserById } from '../betterAuth/trusted_headers/get_user_by_id';
import type { QueryCtx } from '../lib/ctx';

export async function resolveUserDisplayName(
  ctx: QueryCtx,
  userId: string | undefined | null,
): Promise<string | null> {
  if (!userId) return null;
  try {
    const user = await getUserById(ctx, userId);
    const name = (user?.name ?? '').trim() || (user?.email ?? '').trim();
    return name || null;
  } catch (err) {
    console.warn(
      `[resolveUserDisplayName] lookup failed for '${userId}': ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * Resolve both the acting user (who filed/cancelled the request) and the
 * data-subject (whose data the request concerns) for DSAR notifications.
 * `named` is true only when BOTH resolve — the call site uses it to pick the
 * fully-named copy variant, falling back to an impersonal (still localized)
 * body when either name is unavailable.
 */
export async function resolveActorAndSubject(
  ctx: QueryCtx,
  actorId: string | undefined | null,
  subjectUserId: string | undefined | null,
): Promise<{ actor: string | null; subject: string | null; named: boolean }> {
  const actor = await resolveUserDisplayName(ctx, actorId);
  const subject = await resolveUserDisplayName(ctx, subjectUserId);
  return { actor, subject, named: Boolean(actor && subject) };
}
