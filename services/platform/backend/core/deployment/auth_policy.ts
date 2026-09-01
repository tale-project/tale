/**
 * Pure deployment-config authorization policy.
 *
 * The post-authentication decision is extracted from `requireInstanceAdmin`
 * (auth.ts) so the read-vs-write gate is unit-testable in plain vitest — the
 * betterAuth/rateLimiter components don't register under convexTest, so the
 * Convex-coupled wrapper can't be exercised directly. Kept free of Convex
 * imports: only the pure ability + allowlist helpers.
 */

import { defineAbilityFor } from '../../../lib/permissions/ability';
import { isDeploymentEditor } from './editors';

export interface OrgMembership {
  organizationId: string;
  role: string;
}

export type InstanceAdminDecision =
  | { ok: true; adminMember: OrgMembership }
  | {
      ok: false;
      code: 'FORBIDDEN_INSTANCE_ADMIN' | 'FORBIDDEN_DEPLOYMENT_EDITOR';
    };

/**
 * Decide deployment-config access for an already-authenticated caller.
 *
 * - Read (and any access at all) requires the caller to administer some org
 *   (a role that can read `orgSettings` — owner/admin).
 * - Write additionally requires the caller's email to be in the editor
 *   allowlist (`isDeploymentEditor`). An empty allowlist locks ALL writes.
 *
 * Pure: no I/O beyond `isDeploymentEditor` reading the allowlist env.
 */
export function decideInstanceAdmin(input: {
  email: string | undefined;
  members: OrgMembership[];
  write: boolean;
}): InstanceAdminDecision {
  const adminMember = input.members.find((m) =>
    defineAbilityFor(m.role).can('read', 'orgSettings'),
  );
  if (!adminMember) return { ok: false, code: 'FORBIDDEN_INSTANCE_ADMIN' };
  if (input.write && !isDeploymentEditor(input.email)) {
    return { ok: false, code: 'FORBIDDEN_DEPLOYMENT_EDITOR' };
  }
  return { ok: true, adminMember };
}
