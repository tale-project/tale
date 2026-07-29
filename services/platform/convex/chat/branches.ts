/**
 * Edit and regenerate as SIBLING BRANCHES — never a rewrite.
 *
 * Editing a user message (or re-answering one) copies the conversation up to
 * the fork point into a fresh hidden thread, so the original stays intact
 * and the two versions are siblings the navigator flips between. The sidebar
 * shows only the ROOT of a lineage; which sibling each fork point currently
 * displays is the root's `branchSelections` map, so the choice follows the
 * user across devices.
 *
 * The copy boundary is the one load-bearing subtlety: an EDIT copies strictly
 * BEFORE the edited user message (the resent text lands at the same
 * sequence), while a REGENERATE copies THROUGH the user message it re-answers
 * (the turn resends it without appending). Copies are gap-free from zero, so
 * sequences align across every sibling of a fork.
 */

import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { mutation, query, type MutationCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { loadOwnedThread } from './threads';

/** Selections beyond this are dropped oldest-first — a bound, not a quota. */
const MAX_BRANCH_SELECTIONS = 50;

async function requireOrgUser(
  ctx: Parameters<typeof getOrganizationMember>[0],
  organizationId: string,
): Promise<string> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new Error('Unauthenticated');
  await getOrganizationMember(ctx, organizationId, authUser);
  return authUser.userId;
}

/**
 * Copy `parent`'s conversation up to `copyThrough` (inclusive) into a fresh
 * hidden sibling forked at `forkSequence`. The branch inherits everything a
 * turn reads from the thread (agent, capabilities, project) so a turn into it
 * behaves exactly like one into the parent.
 */
async function createBranch(
  ctx: MutationCtx,
  parent: Doc<'threads'>,
  forkSequence: number,
  copyThrough: number,
): Promise<Doc<'threads'>['_id']> {
  const now = Date.now();
  const rootId = parent.branchRootId ?? String(parent._id);
  const branchId = await ctx.db.insert('threads', {
    organizationId: parent.organizationId,
    userId: parent.userId,
    kind: parent.kind,
    title: parent.title,
    agentSlug: parent.agentSlug,
    capabilities: parent.capabilities,
    harness: parent.harness,
    projectId: parent.projectId,
    hidden: true,
    branchRootId: rootId,
    branchParentId: String(parent._id),
    branchForkSequence: forkSequence,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });

  const history = await ctx.db
    .query('messages')
    .withIndex('by_thread_sequence', (q) => q.eq('threadId', parent._id))
    .collect();
  let sequence = 0;
  for (const message of history) {
    if (message.sequence > copyThrough) break;
    await ctx.db.insert('messages', {
      organizationId: message.organizationId,
      threadId: branchId,
      role: message.role,
      parts: message.parts,
      sequence,
      model: message.model,
      providerSlug: message.providerSlug,
      usage: message.usage,
      blockedReason: message.blockedReason,
      error: message.error,
      createdAt: now,
    });
    sequence += 1;
  }
  return branchId;
}

/**
 * Fork for an EDIT: the branch carries everything BEFORE the edited user
 * message; the client then sends the edited text into the branch through the
 * normal turn, which appends it at the same sequence the original held.
 */
export const branchForEdit = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    editedMessageId: v.string(),
  },
  returns: v.union(v.id('threads'), v.null()),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread) return null;
    if (thread.arena !== undefined) return null;

    const messageId = ctx.db.normalizeId('messages', args.editedMessageId);
    const message = messageId ? await ctx.db.get(messageId) : null;
    if (
      !message ||
      message.threadId !== String(thread._id) ||
      message.role !== 'user'
    ) {
      return null;
    }

    return await createBranch(
      ctx,
      thread,
      message.sequence,
      message.sequence - 1,
    );
  },
});

/**
 * Fork for a REGENERATE: the branch carries everything THROUGH the user
 * message the chosen assistant reply answered; `regenerateTurn` then re-runs
 * that prompt without appending it again.
 */
export const branchForRegenerate = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    assistantMessageId: v.string(),
  },
  returns: v.union(v.id('threads'), v.null()),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread) return null;
    if (thread.arena !== undefined) return null;

    const messageId = ctx.db.normalizeId('messages', args.assistantMessageId);
    const message = messageId ? await ctx.db.get(messageId) : null;
    if (
      !message ||
      message.threadId !== String(thread._id) ||
      message.role !== 'assistant'
    ) {
      return null;
    }

    // The user turn this reply answered: the closest user message before it.
    let promptSequence: number | undefined;
    for await (const earlier of ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) =>
        q.eq('threadId', String(thread._id)).lt('sequence', message.sequence),
      )
      .order('desc')) {
      if (earlier.role === 'user') {
        promptSequence = earlier.sequence;
        break;
      }
    }
    if (promptSequence === undefined) return null;

    return await createBranch(ctx, thread, promptSequence, promptSequence);
  },
});

const branchInfoValidator = v.object({
  id: v.id('threads'),
  parentId: v.string(),
  forkSequence: v.number(),
  createdAt: v.number(),
});

/**
 * A root's whole lineage in one read: its branches (any depth — they all
 * carry the same `branchRootId`) plus the root's selection map. One watch
 * serves the navigator, so flipping siblings costs no extra subscriptions.
 */
export const listThreadBranches = query({
  args: { organizationId: v.string(), rootThreadId: v.string() },
  returns: v.object({
    branches: v.array(branchInfoValidator),
    selections: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const root = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.rootThreadId,
    );
    if (!root) return { branches: [], selections: null };

    const branches = await ctx.db
      .query('threads')
      .withIndex('by_branchRoot', (q) => q.eq('branchRootId', String(root._id)))
      .collect();

    return {
      branches: branches
        // Arena columns share the lineage for the trash cascade but carry no
        // `branchParentId` — they are not edit siblings; skip them.
        .filter(
          (branch) =>
            branch.lifecycleStatus === undefined &&
            branch.branchParentId !== undefined,
        )
        .map((branch) => ({
          id: branch._id,
          parentId: branch.branchParentId ?? String(root._id),
          forkSequence: branch.branchForkSequence ?? 0,
          createdAt: branch.createdAt,
        })),
      selections: root.branchSelections ?? null,
    };
  },
});

/**
 * Record which sibling a fork point shows. Stored on the ROOT row as a JSON
 * map keyed `"<parentId>:<forkSequence>"`, bounded by dropping the oldest
 * entries — a selection is a viewing preference, not data. A metadata edit:
 * `updatedAt` stays untouched.
 */
export const setBranchSelection = mutation({
  args: {
    organizationId: v.string(),
    rootThreadId: v.string(),
    forkKey: v.string(),
    selectedThreadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const root = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.rootThreadId,
    );
    if (!root) return null;

    let selections: Record<string, string> = {};
    if (root.branchSelections !== undefined) {
      try {
        const parsed: unknown = JSON.parse(root.branchSelections);
        if (parsed !== null && typeof parsed === 'object') {
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string') selections[key] = value;
          }
        }
      } catch (error) {
        console.warn('[chat] unreadable branch selections were reset', error);
      }
    }
    selections[args.forkKey] = args.selectedThreadId;
    const keys = Object.keys(selections);
    if (keys.length > MAX_BRANCH_SELECTIONS) {
      selections = Object.fromEntries(
        keys
          .slice(keys.length - MAX_BRANCH_SELECTIONS)
          .map((key) => [key, selections[key] ?? '']),
      );
    }
    await ctx.db.patch(root._id, {
      branchSelections: JSON.stringify(selections),
    });
    return null;
  },
});
