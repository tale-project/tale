/**
 * Conversation assignment privacy — the ONE definition of who may read a
 * conversation.
 *
 * Conversations are scoped more narrowly than anything else the platform
 * retrieves. Org membership plus a role is enough for contacts, products and
 * knowledge entries; it is NOT enough here:
 *
 *  - admins and owners see every conversation;
 *  - a conversation with neither an individual nor a team assignee is
 *    **admin-triage only** — an unassigned inbox row is not org-readable;
 *  - otherwise the caller must be the individual assignee, or in the assigned
 *    team (the union, when both are set).
 *
 * This lives on its own so the RLS rule (`rls_rules.ts`) and every non-RLS
 * reader — the chat assistant's conversations leg, which queries through an
 * RLS-BYPASSING internal query — evaluate the same rule rather than two copies
 * of it. A second copy is how a reader ends up subtly wider than the rule it is
 * supposed to mirror, and the failure mode here is publishing an entire inbox.
 *
 * ## Why the team check is a callback
 *
 * Resolving a caller's team ids costs a cross-component Better Auth round-trip,
 * and `rls_rules.ts` deliberately pays it lazily — only when a rule actually
 * needs it (see `rls_rules.lazy_teams.test.ts`). A predicate taking a resolved
 * `Set` would force that round-trip for every conversation, including the
 * majority decided by the admin or individual-assignee branches before teams
 * matter. So the caller supplies `hasTeam`, and stays in charge of when the
 * lookup happens: `rls_rules.ts` passes a memoised lazy resolver, while a
 * per-turn reader that already resolved its teams passes a plain `Set.has`.
 */

/** The assignment stamps a conversation carries. */
export interface ConversationAssignment {
  readonly assigneeUserId?: string | undefined;
  readonly assigneeTeamId?: string | undefined;
}

/** Who is asking. */
export interface ConversationCaller {
  /** Admin or owner — resolved by the caller via `isAdmin`, never re-derived
   * here, so there is one role hierarchy in the codebase. */
  readonly isAdmin: boolean;
  readonly userId?: string | undefined;
  /**
   * Whether the caller belongs to a team. Called at most once, and ONLY for a
   * conversation whose decision actually depends on it — so a lazy
   * implementation stays lazy.
   */
  readonly hasTeam: (teamId: string) => boolean | Promise<boolean>;
}

/**
 * Whether one conversation is readable by one caller.
 *
 * Fail-closed: every path that is not an explicit grant returns false, so a new
 * assignment shape defaults to invisible rather than to org-wide.
 */
export async function conversationAssignmentAllows(
  conversation: ConversationAssignment,
  caller: ConversationCaller,
): Promise<boolean> {
  if (caller.isAdmin) return true;

  const { assigneeUserId, assigneeTeamId } = conversation;

  // Neither stamp: triage state. Deliberately NOT org-readable — an inbox row
  // nobody owns yet is the most sensitive one, not the least.
  if (!assigneeUserId && !assigneeTeamId) return false;

  // Cheap branch first, so the individual assignee never pays for the team
  // lookup even when the row also carries a team.
  if (assigneeUserId && caller.userId && assigneeUserId === caller.userId) {
    return true;
  }

  if (assigneeTeamId && (await caller.hasTeam(assigneeTeamId))) return true;

  return false;
}
