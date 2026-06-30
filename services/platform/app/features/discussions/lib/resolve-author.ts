/**
 * Resolve a discussion entry's author from its persisted `authorId` (a Better
 * Auth userId for a human, or an agent slug). ROLE-INDEPENDENT on purpose: the
 * opening post is stored `role:'assistant'` yet is human-authored, so alignment
 * and attribution must key off the author identity, not the message role.
 *
 * Pure + dependency-light (takes a `resolveActor` resolver rather than the hook)
 * so it unit-tests without React. Returns `{}` for legacy/unattributed messages
 * so callers fall back to the role-based default and old threads render exactly
 * as they do today.
 */

export interface DiscussionAuthorView {
  /** True when the entry is the current user's — right-aligned, no name label.
   *  Undefined when authorship is unknown (legacy messages). */
  isOwn?: boolean;
  /** Display name for a NON-own entry (teammate or agent). Undefined when the
   *  author can't be resolved (removed member, `workflow` sentinel, …). */
  authorName?: string;
}

/** Minimal slice of `useActorDirectory`'s `resolveActor` — it returns the raw id
 *  as `name` when it can't resolve the actor, which is how we detect a miss. */
type ResolveActor = (type: 'user' | 'agent', id: string) => { name: string };

export function describeDiscussionAuthor(
  authorId: string | undefined,
  currentUserId: string | undefined,
  resolveActor: ResolveActor,
): DiscussionAuthorView {
  if (!authorId) return {};
  if (currentUserId && authorId === currentUserId) return { isOwn: true };

  const asUser = resolveActor('user', authorId);
  if (asUser.name !== authorId) {
    return { isOwn: false, authorName: asUser.name };
  }
  const asAgent = resolveActor('agent', authorId);
  if (asAgent.name !== authorId) {
    return { isOwn: false, authorName: asAgent.name };
  }
  // Someone else's, but unresolved — left-align with no label.
  return { isOwn: false };
}
