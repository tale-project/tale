/**
 * Read access for a principal that is NOT the request's authenticated caller —
 * a sandbox external-agent turn acting as its user. The session token proves
 * which user the turn runs as; it does NOT prove that user is still an active
 * member of the org, so a workspace read must re-derive access the same way a
 * user-side query would.
 *
 * Same policy, same sources as `rlsRules`: membership comes from
 * {@link getUserOrganizations} (memberMirror fast path, Better Auth fallback,
 * `disabled` roles dropped), the role check is {@link authorizeRls} — the one
 * role → table → action matrix. This module only re-homes that evaluation onto
 * an explicit userId instead of the JWT identity; it must never grow its own
 * rules.
 */

import type { QueryCtx } from '../../../_generated/server';
import { getUserOrganizations } from '../organization/get_user_organizations';
import { authorizeRls } from './access_control';

/**
 * The tables the workspace read tools expose, as role-matrix subjects.
 *
 * Every member of this union MUST have a row in `platformPermissions` —
 * {@link authorizeRls} denies by default, so a subject without one is refused
 * outright rather than falling through to a laxer rule.
 *
 * A `true` here means only that the caller's ROLE may read the table. Some
 * subjects need a second, narrower gate that this module deliberately does not
 * own: `documents` and `tasks` narrow to the caller's team/project visibility,
 * and `conversations` narrows further still to its assignment scope (a
 * conversation assigned to nobody is admin triage only). Treating `allowed:
 * true` as "read the whole org" is a leak for those three.
 */
export const AGENT_READ_SUBJECTS = [
  'documents',
  'contacts',
  'products',
  'websites',
  'tasks',
  'projects',
  'conversations',
] as const;

export type AgentReadSubject = (typeof AGENT_READ_SUBJECTS)[number];

export type AgentReadAccess =
  | { allowed: true; role: string }
  | { allowed: false; reason: 'not_a_member' | 'read_denied' };

export async function resolveAgentReadAccess(
  ctx: QueryCtx,
  args: {
    userId: string;
    organizationId: string;
    subject: AgentReadSubject;
  },
): Promise<AgentReadAccess> {
  const memberships = await getUserOrganizations(ctx, { userId: args.userId });
  const membership = memberships.find(
    (entry) => entry.organizationId === args.organizationId,
  );
  // Removed users and `disabled` roles both land here: getUserOrganizations
  // filters disabled memberships out, exactly as the RLS request path does.
  if (!membership) {
    return { allowed: false, reason: 'not_a_member' };
  }
  if (!authorizeRls(membership.role, args.subject, 'read')) {
    return { allowed: false, reason: 'read_denied' };
  }
  return { allowed: true, role: membership.role };
}
