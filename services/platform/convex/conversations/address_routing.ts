import { AppError } from '../../lib/shared/errors/app-error';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitAuditSuccess } from '../audit_logs/emit';
import { notifyConversationRouted } from '../collab/notify';
import { buildAuditContext } from '../lib/helpers/build_audit_context';
import { inboundRecipientAddress } from './reply_from';

/**
 * Set a conversation's individual owner and/or team queue (system-initiated).
 * Validates each target belongs to the conversation's org (defense-in-depth),
 * patches only the dimensions that change, emits a `system` audit row, and
 * notifies the newly-set owner / team impersonally. Returns true when it wrote
 * a change; an absent dimension in `next` is left untouched.
 */
export async function applyConversationAssignment(
  ctx: MutationCtx,
  conversation: Doc<'conversations'>,
  next: { assigneeUserId?: string; assigneeTeamId?: string },
): Promise<boolean> {
  if (next.assigneeUserId) {
    const role = await ctx.runQuery(
      internal.members.internal_queries.getMirrorMemberRole,
      {
        organizationId: conversation.organizationId,
        userId: next.assigneeUserId,
      },
    );
    if (role === null) {
      throw new AppError({
        code: 'user_not_in_org',
        message: 'Assignee is not a member of this organization',
      });
    }
  }
  if (next.assigneeTeamId) {
    const teamOrgId = await ctx.runQuery(
      internal.members.internal_queries.getTeamOrganizationId,
      { teamId: next.assigneeTeamId },
    );
    if (teamOrgId !== conversation.organizationId) {
      throw new AppError({
        code: 'team_not_in_org',
        message: 'Team does not belong to this organization',
      });
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

  await ctx.db.patch(conversation._id, patch);
  await emitAuditSuccess(ctx, {
    auditCtx: await buildAuditContext(ctx, conversation.organizationId),
    action: 'assign_conversation',
    category: 'data',
    resourceType: 'conversation',
    resourceId: String(conversation._id),
    resourceName: conversation.subject,
    previousState: {
      assigneeUserId: conversation.assigneeUserId ?? null,
      assigneeTeamId: conversation.assigneeTeamId ?? null,
    },
    newState: {
      assigneeUserId:
        patch.assigneeUserId ?? conversation.assigneeUserId ?? null,
      assigneeTeamId:
        patch.assigneeTeamId ?? conversation.assigneeTeamId ?? null,
    },
  });
  await notifyConversationRouted(ctx, {
    conversation,
    assigneeUserId: patch.assigneeUserId,
    assigneeTeamId: patch.assigneeTeamId,
  });
  return true;
}

/**
 * Address→assignee routing — the built-in governance hook, run at inbound
 * conversation creation. Skips an already-assigned conversation, reads the org's
 * `conversation_routing` governance policy from `configCache`, matches the
 * address the customer wrote to (`metadata.to[0].address`, case-insensitive,
 * exact) against its rules, and assigns to the matched team and/or person. No
 * policy / no match / no address ⇒ a quiet no-op. Returns true when it assigned.
 *
 * This is a plain helper (not a workflow action): routing is a governance
 * feature applied inline during ingest, not a user-installable automation.
 */
export async function applyAddressRouting(
  ctx: MutationCtx,
  conversation: Doc<'conversations'>,
): Promise<boolean> {
  if (conversation.assigneeUserId || conversation.assigneeTeamId) return false;
  const derived = inboundRecipientAddress(
    isRecord(conversation.metadata) ? conversation.metadata : undefined,
  );
  const address = (derived ?? '').trim().toLowerCase();
  if (!address) return false;

  const policy = await ctx.db
    .query('configCache')
    .withIndex('by_org_domain_key', (q) =>
      q
        .eq('organizationId', conversation.organizationId)
        .eq('domain', 'governance')
        .eq('key', 'conversation_routing'),
    )
    .first();
  const config = policy?.config;
  // The section's toggle: an explicit `false` silences configured rules
  // without deleting them. Absent keeps the pre-flag behavior — the rules
  // decide.
  if (isRecord(config) && config.enabled === false) return false;
  const rules =
    isRecord(config) && Array.isArray(config.rules) ? config.rules : [];
  const match = rules.find(
    (rule): rule is { address: string; teamId?: string; userId?: string } =>
      isRecord(rule) &&
      typeof rule.address === 'string' &&
      rule.address.trim().toLowerCase() === address,
  );
  if (!match || (!match.teamId && !match.userId)) return false;
  try {
    return await applyConversationAssignment(ctx, conversation, {
      assigneeUserId: match.userId,
      assigneeTeamId: match.teamId,
    });
  } catch (err) {
    // A stale rule (a since-deleted team/user) must never break inbound
    // ingest — log and leave the conversation unassigned.
    console.warn(
      '[address-routing] matched rule but assignment failed; leaving unassigned',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
