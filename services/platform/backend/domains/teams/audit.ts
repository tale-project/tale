import type { TransactionSql } from 'postgres';

import { createAuditLog } from '../audit_logs/service.ts';
import type { AuditLogActorType } from '../audit_logs/types.ts';

/**
 * The audit rows a team's lifecycle owes — one vocabulary for every door
 * that writes a team or a membership: the app's own routes, Better Auth's
 * organization endpoints (through the plugin hooks) and the SSO group sync.
 * SCIM keeps its `scim_*` rows (`logScim`) and does not go through here.
 *
 * Every row is `category: 'member'` on `resourceType: 'team'`, so the audit
 * log filters group a team's whole history under the team id. Who acted:
 * the signed-in user for the app and plugin doors, the sync itself
 * (`actorType: 'system'`, `actorId: 'sso'`) for provisioning.
 */

export interface TeamAuditActor {
  id: string;
  email?: string;
  role?: string;
  type: AuditLogActorType;
}

/** The synchronizer's own identity — mirrors `logScim`'s `scim` actor. */
export const SSO_SYNC_ACTOR: TeamAuditActor = { id: 'sso', type: 'system' };

/** The identity a plugin hook records when Better Auth hands it no user
 * (a server-side call with no session). */
export const PLUGIN_SYSTEM_ACTOR: TeamAuditActor = {
  id: 'system',
  type: 'system',
};

interface TeamRef {
  organizationId: string;
  actor: TeamAuditActor;
  teamId: string;
  teamName: string;
}

function actorFields(actor: TeamAuditActor) {
  return {
    actorId: actor.id,
    ...(actor.email !== undefined ? { actorEmail: actor.email } : {}),
    ...(actor.role !== undefined ? { actorRole: actor.role } : {}),
    actorType: actor.type,
  };
}

export function auditTeamCreated(
  tx: TransactionSql,
  args: TeamRef & { metadata?: Record<string, unknown> },
): Promise<string> {
  return createAuditLog(tx, {
    organizationId: args.organizationId,
    ...actorFields(args.actor),
    action: 'team.created',
    category: 'member',
    resourceType: 'team',
    resourceId: args.teamId,
    resourceName: args.teamName,
    newState: { name: args.teamName },
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    status: 'success',
  });
}

/** A rename. `previousName` is recorded when the door knew it. */
export function auditTeamUpdated(
  tx: TransactionSql,
  args: TeamRef & {
    previousName?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  return createAuditLog(tx, {
    organizationId: args.organizationId,
    ...actorFields(args.actor),
    action: 'team.updated',
    category: 'member',
    resourceType: 'team',
    resourceId: args.teamId,
    resourceName: args.teamName,
    ...(args.previousName !== undefined
      ? { previousState: { name: args.previousName } }
      : {}),
    newState: { name: args.teamName },
    changedFields: ['name'],
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    status: 'success',
  });
}

export function auditTeamDeleted(
  tx: TransactionSql,
  args: TeamRef & { metadata?: Record<string, unknown> },
): Promise<string> {
  return createAuditLog(tx, {
    organizationId: args.organizationId,
    ...actorFields(args.actor),
    action: 'team.deleted',
    category: 'member',
    resourceType: 'team',
    resourceId: args.teamId,
    resourceName: args.teamName,
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    status: 'success',
  });
}

interface MembershipRef extends TeamRef {
  /** The person whose membership changed. */
  userId: string;
  teamMemberId: string;
  targetEmail?: string;
  metadata?: Record<string, unknown>;
}

function membershipMetadata(args: MembershipRef): Record<string, unknown> {
  return {
    userId: args.userId,
    teamMemberId: args.teamMemberId,
    ...(args.targetEmail !== undefined
      ? { targetEmail: args.targetEmail }
      : {}),
    ...args.metadata,
  };
}

export function auditTeamMemberAdded(
  tx: TransactionSql,
  args: MembershipRef,
): Promise<string> {
  return createAuditLog(tx, {
    organizationId: args.organizationId,
    ...actorFields(args.actor),
    action: 'team.member_added',
    category: 'member',
    resourceType: 'team',
    resourceId: args.teamId,
    resourceName: args.teamName,
    metadata: membershipMetadata(args),
    status: 'success',
  });
}

export function auditTeamMemberRemoved(
  tx: TransactionSql,
  args: MembershipRef,
): Promise<string> {
  return createAuditLog(tx, {
    organizationId: args.organizationId,
    ...actorFields(args.actor),
    action: 'team.member_removed',
    category: 'member',
    resourceType: 'team',
    resourceId: args.teamId,
    resourceName: args.teamName,
    metadata: membershipMetadata(args),
    status: 'success',
  });
}
