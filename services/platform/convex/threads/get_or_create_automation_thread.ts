import { createThread } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { mutation, query } from '../_generated/server';
import { isOrgMember } from '../lib/rls/auth/check_org_membership';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * App-embedded chat (the AgentChat runtime block): ONE shared thread per
 * (organizationId, automationSlug, subjectType, subjectId), `kind: 'automation_discussion'`.
 *
 * These threads mirror project/task discussions: they reuse the
 * @convex-dev/agent message store and the interactive turn pipeline
 * (`agents/chat_turn.ts:chatWithAgentTurn`), and are org-membership-gated
 * (see `can_access_thread`'s discussion branch) instead of owner-only — any
 * member of the org can read the transcript and send turns. Because the
 * surface is shared, personalization is force-disabled at create so the
 * creator's memories/custom instructions never leak into replies other
 * members read (same rule as `sharedWithProject`).
 *
 * `subjectType`/`subjectId` are host-defined — e.g. ('task', <taskId>) for a
 * task-detail chat; an install-scoped chat uses ('automation', <automationSlug>). The
 * triplet is resolved through the `by_org_automation_subject` index; uniqueness holds
 * among ACTIVE rows (a trashed/expired thread stays on the index but is
 * skipped, so a fresh thread replaces it — matching the RLS gate, which
 * denies soft-deleted threads anyway).
 */

/** Shared shape of the (org, app, subject) triplet both functions key on. */
const subjectArgs = {
  organizationId: v.string(),
  automationSlug: v.string(),
  subjectType: v.string(),
  subjectId: v.string(),
};

/** True when every triplet component is a non-empty trimmed string. Guards
 *  empty-string ids (a common host bug: rendering before the subject id is
 *  loaded) from minting a junk shared thread keyed on ''. */
function isValidSubject(args: {
  automationSlug: string;
  subjectType: string;
  subjectId: string;
}): boolean {
  return (
    args.automationSlug.trim().length > 0 &&
    args.subjectType.trim().length > 0 &&
    args.subjectId.trim().length > 0
  );
}

/**
 * `subjectType` of the Automation Assistant's app-embedded chat (`subjectId`
 * is the app slug). Backed by the `workflow-assistant` agent
 * (`roleRestriction: admin_developer`), which ships mutating tools
 * (create_workflow / save_workflow_definition / update_workflow_step /
 * run_workflow / agent_write) — a capability-bearing surface, not an
 * ordinary shared discussion. The Automations UI hides the panel for
 * member/editor roles via `cannot('read','developerSettings')`, but that
 * gate is UI-only unless mirrored here: without it, any org member could
 * call `getOrCreateAutomationThread`/`getAutomationThread` directly and drive the same
 * mutating tools the panel hides. Gate on the same `developerSettings`
 * capability `apps/install_actions.ts:prepareInstall` uses for the
 * equivalent install/reinstall lifecycle.
 */
const ASSISTANT_SUBJECT_TYPE = 'assistant';

/** True when the caller's role holds the `developerSettings` capability. */
function hasDeveloperAccess(role: string): boolean {
  return defineAbilityFor(role).can('read', 'developerSettings');
}

/** Resolve the ACTIVE `automation_discussion` thread for one triplet, or null. */
async function findActiveAutomationThread(
  ctx: QueryCtx | MutationCtx,
  args: {
    organizationId: string;
    automationSlug: string;
    subjectType: string;
    subjectId: string;
  },
): Promise<Doc<'threadMetadata'> | null> {
  for await (const meta of ctx.db
    .query('threadMetadata')
    .withIndex('by_org_automation_subject', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('automationSlug', args.automationSlug)
        .eq('subjectType', args.subjectType)
        .eq('subjectId', args.subjectId),
    )) {
    // Trashed/expired residue stays on the index until retention hard-deletes
    // it; only an active row counts as "the" thread for this subject.
    if (meta.status === 'active') return meta;
  }
  return null;
}

/**
 * Read-only resolve: {threadId} for the triplet's active thread, or null when
 * none exists yet — so a host can render the transcript (via the existing
 * streaming readers) before the first send ever creates the thread. RLS: org
 * membership; soft denial (null) like the other thread read paths. The
 * Automation Assistant subject additionally requires the `developerSettings`
 * capability (see {@link ASSISTANT_SUBJECT_TYPE}) — same soft-denial shape.
 */
export const getAutomationThread = query({
  args: subjectArgs,
  returns: v.union(v.object({ threadId: v.string() }), v.null()),
  handler: async (ctx, args): Promise<{ threadId: string } | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    if (!isValidSubject(args)) return null;
    if (!(await isOrgMember(ctx, authUser.userId, args.organizationId))) {
      return null;
    }
    if (args.subjectType === ASSISTANT_SUBJECT_TYPE) {
      const member = await getOrganizationMember(
        ctx,
        args.organizationId,
        authUser,
      );
      if (!hasDeveloperAccess(member.role)) return null;
    }
    const meta = await findActiveAutomationThread(ctx, args);
    return meta ? { threadId: meta.threadId } : null;
  },
});

/**
 * Idempotent get-or-create for the triplet's shared thread. Convex serializes
 * conflicting mutations (OCC), so the check-then-insert cannot mint two active
 * threads for one triplet. Membership mirrors `discussions/createDiscussion`:
 * `getOrganizationMember` throws for non-members/disabled members. The
 * Automation Assistant subject additionally requires the
 * `developerSettings` capability (see {@link ASSISTANT_SUBJECT_TYPE}) — a
 * plain member/editor is refused with `FORBIDDEN_DEVELOPER_SETTINGS`, the
 * same code `requireOrgAdminOrDeveloper` / `apps/install_actions.ts`'s
 * `prepareInstall` throw for the equivalent capability-bearing surfaces.
 */
export const getOrCreateAutomationThread = mutation({
  args: {
    ...subjectArgs,
    projectId: v.optional(v.id('projects')),
    title: v.optional(v.string()),
  },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args): Promise<{ threadId: string }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'forbidden' });
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    if (
      args.subjectType === ASSISTANT_SUBJECT_TYPE &&
      !hasDeveloperAccess(member.role)
    ) {
      throw new ConvexError({
        code: 'FORBIDDEN_DEVELOPER_SETTINGS',
        message: `Role "${member.role}" lacks the developer-settings capability required to open the Automation Assistant.`,
      });
    }
    if (!isValidSubject(args)) {
      throw new ConvexError({
        code: 'bad_request',
        message: 'automationSlug, subjectType and subjectId must be non-empty.',
      });
    }
    // A supplied project must belong to the thread's organization — the
    // column is informational (access is org-membership-gated), but a foreign
    // id must not be persistable.
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.organizationId !== args.organizationId) {
        throw new ConvexError({
          code: 'bad_request',
          message: 'projectId does not belong to this organization.',
        });
      }
    }

    const existing = await findActiveAutomationThread(ctx, args);
    if (existing) return { threadId: existing.threadId };

    const threadId = await createThread(ctx, components.agent, {
      userId: authUser.userId,
      title: args.title,
      summary: JSON.stringify({ kind: 'automation_discussion' }),
    });
    const createdAt = Date.now();
    await ctx.db.insert('threadMetadata', {
      threadId,
      userId: authUser.userId,
      chatType: 'general',
      status: 'active',
      kind: 'automation_discussion',
      automationSlug: args.automationSlug,
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      projectId: args.projectId,
      organizationId: args.organizationId,
      title: args.title,
      createdAt,
      updatedAt: createdAt,
      generationStatus: 'idle',
      discussionStatus: 'open',
      agentReplyDepth: 0,
      // Shared surface: never inject the creator's memories/custom
      // instructions into replies that other org members read.
      disablePersonalization: true,
    });
    return { threadId };
  },
});
