/**
 * The approvals gate for live effectful connector writes.
 *
 * One connector write can send mail, file issues, or post to a channel on the
 * organization's behalf, so before a LIVE write leaves the process it clears
 * this gate. Two surfaces share it — a direct connector call (a chat tool, a
 * conversation reply the user asked for) and an automation node the durable
 * stepper is about to run — so the rule that decides whether a human must sign
 * off is written once, here, and both surfaces agree by construction.
 *
 * The decision is the effect rule the dispatcher already encodes: a `read`
 * changes nothing, so it never waits on a human; a `write` needs the
 * organization's approval before it runs. There is no per-org auto-approval
 * knob to read, so the conservative stance holds for every organization — a
 * live write is gated. Centralizing it means the automation stepper cannot
 * drift to a different rule than a chat tool call.
 *
 * The gate is keyed to the operation, not to a wall-clock moment: an
 * `connector_operation` approval row is found (or created) under a stable
 * `resourceKey`, so re-entering the gate for the SAME operation returns the
 * same decision. That is what makes the two callers durable — the stepper polls
 * this every re-entry while a node waits, and a retried chat call after the
 * human approves finds the granted approval instead of prompting again. The
 * approval record carries its own organization and is only ever matched within
 * it, so nothing approved for one tenant is visible to another.
 *
 * Rows live in the existing `approvals` table under the `connector_operation`
 * resourceType — the type built for exactly this — with the run/turn context in
 * `metadata` (`source`, and for an automation its `runId`/`nodeId`). Nothing
 * here keys on the retired execution table, and the existing readers of the
 * table (the org approvals inbox, the thread cards, the reminder sweep) see
 * these rows through the same columns they already read.
 */

import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import { approvalPolicyConfigSchema } from '../../lib/shared/schemas/governance';
import { isRecord } from '../../lib/utils/type-utils';
import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { readPolicyRow } from '../governance/helpers';
import { resolveApprovalRequirement } from './policy';

/** What the gate tells a caller to do. `allow` carries the approval id when the
 * decision came from a granted record, so a caller can reconcile it. */
export type ApprovalGateDecision =
  | { decision: 'allow'; approvalId?: Id<'approvals'> }
  | { decision: 'needs-approval'; approvalId: Id<'approvals'> }
  | { decision: 'rejected'; approvalId: Id<'approvals'>; reason?: string };

/**
 * Decide whether a live write may run for an organization, creating the pending
 * approval that a human resolves when one is needed.
 *
 * Idempotent per `(organizationId, connector_operation, resourceKey)`: the
 * first call for an operation records a pending approval and asks for a human;
 * later calls report that same record's state. Approving it (the row moves to
 * `executing`) is consumed here — the record flips to `completed` the first time
 * the gate lets the operation through — so it clears from the active-approvals
 * view and a durable resume still reads it as granted.
 */
export const evaluateApprovalGate = internalMutation({
  args: {
    organizationId: v.string(),
    /** Where the write comes from — a direct connector call or an automation
     * node — recorded on the approval so the card and the inbox can tell them
     * apart. */
    source: v.union(v.literal('connector'), v.literal('automation')),
    /** The operation's stable identity: the dispatcher's idempotency key for a
     * direct call, `<runId>:<nodeId>` for an automation node. Re-entering with
     * the same key reuses the same approval. */
    resourceKey: v.string(),
    connector: v.string(),
    action: v.string(),
    effect: v.union(v.literal('read'), v.literal('write')),
    requestedBy: v.optional(v.string()),
    /**
     * Whether this write stays inside the tenant's own platform surface (a
     * `platform`-auth connector: tasks, documents, the org's sandbox). The
     * CALLER decides it because the connector catalog is read from disk and
     * this mutation runs in V8. Absent reads as "outbound", so a caller that
     * has not been taught the distinction keeps the strict behaviour.
     */
    platformInternal: v.optional(v.boolean()),
    /** Stored for the card so a reviewer sees what the operation would do. */
    input: v.optional(v.any()),
    credentialRef: v.optional(v.string()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    runId: v.optional(v.string()),
    nodeId: v.optional(v.string()),
    nodeType: v.optional(v.string()),
    automation: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      decision: v.literal('allow'),
      approvalId: v.optional(v.id('approvals')),
    }),
    v.object({
      decision: v.literal('needs-approval'),
      approvalId: v.id('approvals'),
    }),
    v.object({
      decision: v.literal('rejected'),
      approvalId: v.id('approvals'),
      reason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args): Promise<ApprovalGateDecision> => {
    if (!args.organizationId) {
      throw new AppError({
        code: 'ORGANIZATION_REQUIRED',
        message: 'an approval decision must name the organization it acts for',
      });
    }

    // A read changes nothing in the outside world, so it never waits on a human
    // and never leaves an approval record behind.
    if (args.effect !== 'write') {
      return { decision: 'allow' };
    }

    // Find the operation's own approval, scoped to this organization. The
    // resourceKey is organization-unique by construction (an idempotency key
    // that hashes the org, or a run id that is globally unique), so this returns
    // at most this tenant's row; the explicit organization filter is the
    // belt-and-braces that keeps one org from ever reading another's decision.
    const candidates = await ctx.db
      .query('approvals')
      .withIndex('by_resource', (q) =>
        q
          .eq('resourceType', 'connector_operation')
          .eq('resourceId', args.resourceKey),
      )
      .order('desc')
      .take(16);
    const existing =
      candidates.find((row) => row.organizationId === args.organizationId) ??
      null;

    // An operation already on file keeps its answer, whatever the policy says
    // now: a parked run must not be stranded by a policy loosened mid-flight,
    // and a granted or rejected decision is a fact about THIS operation.
    if (existing === null) {
      const policyRow = await readPolicyRow(
        ctx.db,
        args.organizationId,
        'approval_policy',
      );
      const parsed =
        policyRow === null
          ? null
          : approvalPolicyConfigSchema.safeParse(policyRow.config);
      if (parsed !== null && !parsed.success) {
        console.warn(
          `[approvals] malformed approval_policy for org '${args.organizationId}' — falling back to the built-in rule`,
        );
      }
      const requirement = resolveApprovalRequirement({
        connector: args.connector,
        action: args.action,
        platformInternal: args.platformInternal === true,
        policy: parsed?.success === true ? parsed.data : null,
      });
      // Allowed by policy: no card, no record — the run's own trace and the
      // dispatcher's audit entry are the trail for these.
      if (requirement === 'allow') return { decision: 'allow' };
    }

    if (existing) {
      switch (existing.status) {
        case 'pending':
          // Still waiting on the human — same record, same answer.
          return { decision: 'needs-approval', approvalId: existing._id };
        case 'executing': {
          // Approved and not yet consumed: let it through and mark the record
          // complete so it leaves the active-approvals view. A later re-entry
          // reads `completed` and still allows, which is what keeps a durable
          // resume from prompting twice.
          await ctx.db.patch(existing._id, {
            status: 'completed',
            executedAt: Date.now(),
          });
          return { decision: 'allow', approvalId: existing._id };
        }
        case 'completed':
          return { decision: 'allow', approvalId: existing._id };
        case 'rejected': {
          const comments = isRecord(existing.metadata)
            ? existing.metadata.comments
            : undefined;
          const reason = typeof comments === 'string' ? comments : undefined;
          return {
            decision: 'rejected',
            approvalId: existing._id,
            ...(reason !== undefined && { reason }),
          };
        }
        default: {
          const exhaustive: never = existing.status;
          throw new AppError({
            code: 'APPROVAL_STATUS_UNKNOWN',
            message: `unhandled approval status: ${String(exhaustive)}`,
          });
        }
      }
    }

    // Nothing on file: the organization's policy gates a live write, so record a
    // pending approval a human resolves and tell the caller to wait.
    const approvalId = await ctx.db.insert('approvals', {
      organizationId: args.organizationId,
      status: 'pending',
      resourceType: 'connector_operation',
      resourceId: args.resourceKey,
      priority: 'medium',
      ...(args.threadId !== undefined && { threadId: args.threadId }),
      ...(args.messageId !== undefined && { messageId: args.messageId }),
      metadata: {
        source: args.source,
        connector: args.connector,
        action: args.action,
        operationType: 'write',
        requestedAt: Date.now(),
        ...(args.requestedBy !== undefined && {
          requestedBy: args.requestedBy,
        }),
        ...(args.input !== undefined && { parameters: args.input }),
        ...(args.credentialRef !== undefined && {
          credentialRef: args.credentialRef,
        }),
        ...(args.runId !== undefined && { runId: args.runId }),
        ...(args.nodeId !== undefined && { nodeId: args.nodeId }),
        ...(args.nodeType !== undefined && { nodeType: args.nodeType }),
        ...(args.automation !== undefined && { automation: args.automation }),
      },
    });
    return { decision: 'needs-approval', approvalId };
  },
});
