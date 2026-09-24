import type { TransactionSql } from 'postgres';

import { inboundRecipientAddress } from '../../../lib/shared/conversations/reply-from.ts';
import {
  matchRoutingRule,
  type RoutingArrival,
} from '../../../lib/shared/conversations/routing-match.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  assertAssignableMember,
  writeConversationAssignee,
  writeConversationTeam,
  type AssignmentActor,
} from './service.ts';

/**
 * Conversation routing — the built-in governance hook, run inline when a
 * conversation is created from outside (an inbound email, or an API mirror)
 * before downstream notifications observe the row; never a user-installable
 * automation. The org's `conversation_routing` policy file maps where a
 * conversation arrived (a mailbox, the address it was sent to, an API source)
 * onto a team queue and/or a person. No policy / no match is a quiet no-op,
 * and a stale rule (a since-deleted team or user) must never break ingest.
 */

type Db = TransactionSql;

export interface RoutableConversation {
  id: string;
  organizationId: string;
  subject: string | null;
  status: string | null;
  channel: string | null;
  connectorName: string | null;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  metadata: Record<string, unknown> | null;
}

const SYSTEM: AssignmentActor = { type: 'system' };

/**
 * Set a conversation's individual owner and/or team queue
 * (system-initiated), through the same writes the Inbox doors use: each
 * target is validated against the conversation's org, only a changed
 * dimension is written, each is audited as `system` under its own action, and
 * the new owner / team is notified impersonally. Returns true when it wrote a
 * change.
 */
export async function applyConversationAssignment(
  db: Db,
  conversation: RoutableConversation,
  next: { assigneeUserId?: string; assigneeTeamId?: string },
): Promise<boolean> {
  // Both targets are checked before either is written, so a stale half of a
  // rule leaves the conversation untouched rather than half-routed.
  if (next.assigneeUserId) {
    await assertAssignableMember(
      db,
      conversation.organizationId,
      next.assigneeUserId,
    );
  }
  let changed = false;
  if (next.assigneeTeamId) {
    changed = await writeConversationTeam(
      db,
      conversation,
      next.assigneeTeamId,
      SYSTEM,
    );
  }
  if (next.assigneeUserId) {
    changed =
      (await writeConversationAssignee(
        db,
        conversation,
        next.assigneeUserId,
        SYSTEM,
      )) || changed;
  }
  return changed;
}

/**
 * Route a new, still-unassigned conversation by where it arrived: an email by
 * its mailbox (`arrival.credentialId`) and the address it was sent to, an API
 * conversation by its source (`connector_name`). Precedence is
 * `matchRoutingRule`'s. An explicit `enabled: false` silences every rule.
 * Returns true when it assigned.
 */
export async function applyConversationRouting(
  db: Db,
  conversation: RoutableConversation,
  arrival: { credentialId?: string } = {},
): Promise<boolean> {
  if (conversation.assigneeUserId || conversation.assigneeTeamId) {
    return false;
  }
  const recipient = inboundRecipientAddress(conversation.metadata ?? undefined);
  const routed: RoutingArrival | undefined =
    conversation.channel === 'api'
      ? conversation.connectorName
        ? { lane: 'api', source: conversation.connectorName }
        : undefined
      : {
          lane: 'email',
          ...(arrival.credentialId !== undefined
            ? { credentialId: arrival.credentialId }
            : {}),
          ...(recipient !== undefined ? { recipient } : {}),
        };
  if (routed === undefined) return false;

  const config = await readGovernancePolicyForOrg(
    db,
    conversation.organizationId,
    'conversation_routing',
  );
  if (config === null) return false;
  const target = matchRoutingRule(config, routed);
  if (target === undefined) return false;
  try {
    return await applyConversationAssignment(db, conversation, {
      ...(target.userId !== undefined ? { assigneeUserId: target.userId } : {}),
      ...(target.teamId !== undefined ? { assigneeTeamId: target.teamId } : {}),
    });
  } catch (error) {
    // A stale rule (a since-deleted team/user) must never break ingest —
    // log and leave the conversation unassigned.
    console.warn(
      '[conversation-routing] matched rule but assignment failed; leaving unassigned',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
