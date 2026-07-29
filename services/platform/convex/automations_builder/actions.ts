'use node';

/**
 * The client-reachable surface of the automation builder.
 *
 * `run_session.ts` is internal by contract — a session spends the
 * organization's model budget and writes into its automation store — so this
 * is the surface that authorizes: authoring an automation is a developer act,
 * gated exactly like `saveWorkflow` and the node-type catalog next to it.
 *
 * The session runs IN-PROCESS rather than through a nested `ctx.runAction`:
 * an authoring loop is minutes of model turns, and it should live inside this
 * call's own time budget instead of a sub-action's tighter one. The caller
 * holds one promise for the whole session; the versions the session saves
 * appear reactively long before it resolves, so a dropped client loses only
 * the outcome summary, never the work.
 */

import { ConvexError, v } from 'convex/values';

import { action } from '../_generated/server';
import { automationActionStore } from '../automations/store';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import {
  builderSessionOutcomeValidator,
  runSessionWithStore,
  type BuilderSessionOutcome,
} from './run_session';

/** A goal is one instruction, not a document. */
const MAX_GOAL_CHARS = 4000;

/** Hard ceiling on the caller's turn budget (the policy default is 14). */
const MAX_TURNS_CAP = 30;

/**
 * Author an automation from a goal. Returns when the session ends — minutes,
 * not milliseconds; the UI treats the listing as the live signal and this
 * result as the summary.
 */
export const startBuilderSession = action({
  args: {
    organizationId: v.string(),
    goal: v.string(),
    /** Which model authors, named the way the platform names models. The
     * organization's default credential for the provider pays. */
    model: v.object({ providerSlug: v.string(), modelId: v.string() }),
    /** Owning project for the authored automation; absent = the org page. */
    projectId: v.optional(v.id('projects')),
    /** Lower the turn budget for a cheap exploratory run. */
    maxTurns: v.optional(v.number()),
  },
  returns: builderSessionOutcomeValidator,
  handler: async (ctx, args): Promise<BuilderSessionOutcome> => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const goal = args.goal.trim();
    if (goal.length === 0 || goal.length > MAX_GOAL_CHARS) {
      throw new ConvexError({
        code: 'BUILDER_GOAL_INVALID',
        message: `Describe the automation in 1 to ${MAX_GOAL_CHARS} characters.`,
      });
    }
    if (
      args.maxTurns !== undefined &&
      (!Number.isInteger(args.maxTurns) ||
        args.maxTurns < 1 ||
        args.maxTurns > MAX_TURNS_CAP)
    ) {
      throw new ConvexError({
        code: 'BUILDER_TURNS_INVALID',
        message: `maxTurns must be an integer between 1 and ${MAX_TURNS_CAP}.`,
      });
    }
    const store = automationActionStore(ctx, {
      organizationId: args.organizationId,
      actor: auth.userId,
      ...(args.projectId !== undefined && { projectId: args.projectId }),
    });
    return await runSessionWithStore(
      ctx,
      {
        organizationId: args.organizationId,
        actorId: auth.userId,
        goal,
        model: args.model,
        ...(args.maxTurns !== undefined && { maxTurns: args.maxTurns }),
      },
      store,
    );
  },
});
