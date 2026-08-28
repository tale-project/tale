import type { TransactionSql } from 'postgres';

import { inboundRecipientAddress } from '../../../convex/conversations/reply_from.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  notifyConversationAssigned,
  notifyConversationAssignedTeam,
} from '../collab/service.ts';
import { ConversationError } from './service.ts';

/**
 * Address→assignee routing — the 0.5 twin of
 * `convex/conversations/address_routing.ts`: the built-in governance hook,
 * run inline when an INBOUND conversation is created (before downstream
 * notifications observe the row), never a user-installable automation. The
 * org's `conversation_routing` policy file maps the address the customer
 * wrote to onto a team queue and/or a person; no policy / no match / no
 * address is a quiet no-op, and a stale rule (a since-deleted team or user)
 * must never break ingest.
 */

type Db = TransactionSql;

export interface RoutableConversation {
  id: string;
  organizationId: string;
  subject: string | null;
  status: string | null;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Set a conversation's individual owner and/or team queue
 * (system-initiated). Validates each target belongs to the conversation's
 * org (defense-in-depth), patches only the dimensions that change, emits a
 * `system` audit row, and notifies the newly-set owner / team impersonally.
 * Returns true when it wrote a change.
 */
export async function applyConversationAssignment(
  db: Db,
  conversation: RoutableConversation,
  next: { assigneeUserId?: string; assigneeTeamId?: string },
): Promise<boolean> {
  if (next.assigneeUserId) {
    const members = await db<{ role: string }[]>`
      SELECT "role" FROM "member"
      WHERE "organizationId" = ${conversation.organizationId}
        AND "userId" = ${next.assigneeUserId}
      LIMIT 1
    `;
    if (!members[0]) {
      throw new ConversationError(
        'user_not_in_org',
        'Assignee is not a member of this organization',
        400,
      );
    }
  }
  if (next.assigneeTeamId) {
    const teams = await db<{ organizationId: string }[]>`
      SELECT "organizationId" FROM "team" WHERE "id" = ${next.assigneeTeamId}
      LIMIT 1
    `;
    if (teams[0]?.organizationId !== conversation.organizationId) {
      throw new ConversationError(
        'team_not_in_org',
        'Team does not belong to this organization',
        400,
      );
    }
  }

  const patch: { assigneeUserId?: string; assigneeTeamId?: string } = {};
  if (
    next.assigneeUserId &&
    next.assigneeUserId !== conversation.assigneeUserId
  ) {
    patch.assigneeUserId = next.assigneeUserId;
  }
  if (
    next.assigneeTeamId &&
    next.assigneeTeamId !== conversation.assigneeTeamId
  ) {
    patch.assigneeTeamId = next.assigneeTeamId;
  }
  if (
    patch.assigneeUserId === undefined &&
    patch.assigneeTeamId === undefined
  ) {
    return false;
  }

  await db`
    UPDATE app.conversations SET
      assignee_user_id = ${patch.assigneeUserId ?? db.unsafe('assignee_user_id')},
      assignee_team_id = ${patch.assigneeTeamId ?? db.unsafe('assignee_team_id')}
    WHERE id = ${conversation.id}
  `;
  await createAuditLog(db, {
    organizationId: conversation.organizationId,
    actorId: 'system',
    actorType: 'system',
    action: 'assign_conversation',
    category: 'data',
    resourceType: 'conversation',
    resourceId: conversation.id,
    ...(conversation.subject !== null
      ? { resourceName: conversation.subject }
      : {}),
    previousState: {
      assigneeUserId: conversation.assigneeUserId,
      assigneeTeamId: conversation.assigneeTeamId,
    },
    newState: {
      assigneeUserId: patch.assigneeUserId ?? conversation.assigneeUserId,
      assigneeTeamId: patch.assigneeTeamId ?? conversation.assigneeTeamId,
    },
    status: 'success',
  });
  const notifyFields = {
    id: conversation.id,
    organizationId: conversation.organizationId,
    subject: conversation.subject,
    status: conversation.status,
  };
  if (patch.assigneeUserId) {
    await notifyConversationAssigned(db, {
      conversation: notifyFields,
      assigneeUserId: patch.assigneeUserId,
      actorType: 'system',
      actorId: 'system',
    });
  }
  if (patch.assigneeTeamId) {
    await notifyConversationAssignedTeam(db, {
      conversation: notifyFields,
      teamId: patch.assigneeTeamId,
      actorUserId: null,
    });
  }
  await emitHintInTx(db, {
    orgId: conversation.organizationId,
    entity: 'conversation',
    entityId: conversation.id,
  });
  return true;
}

/**
 * Match the address the customer wrote to (`metadata.to[0].address`,
 * case-insensitive, exact) against the org's `conversation_routing` rules
 * and assign to the matched team and/or person. Skips an already-assigned
 * conversation; an explicit `enabled: false` silences configured rules.
 * Returns true when it assigned.
 */
export async function applyAddressRouting(
  db: Db,
  conversation: RoutableConversation,
): Promise<boolean> {
  if (conversation.assigneeUserId || conversation.assigneeTeamId) {
    return false;
  }
  const derived = inboundRecipientAddress(conversation.metadata ?? undefined);
  const address = (derived ?? '').trim().toLowerCase();
  if (!address) return false;

  const config = await readGovernancePolicyForOrg(
    db,
    conversation.organizationId,
    'conversation_routing',
  );
  if (config === null || config.enabled === false) return false;
  const match = config.rules.find(
    (rule) => rule.address.trim().toLowerCase() === address,
  );
  if (!match || (!match.teamId && !match.userId)) return false;
  try {
    return await applyConversationAssignment(db, conversation, {
      ...(match.userId !== undefined ? { assigneeUserId: match.userId } : {}),
      ...(match.teamId !== undefined ? { assigneeTeamId: match.teamId } : {}),
    });
  } catch (error) {
    // A stale rule (a since-deleted team/user) must never break inbound
    // ingest — log and leave the conversation unassigned.
    console.warn(
      '[address-routing] matched rule but assignment failed; leaving unassigned',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
