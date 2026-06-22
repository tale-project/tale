import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';

/**
 * Public, org-gated wrapper to LIST GitHub issues for an app surface. Integration
 * operations dispatch through an internal action (the connector runs server-side;
 * the org's token never reaches the client), so there's no public function to
 * bind to directly — this is the thin, read-only entry an app's view binds to via
 * `capabilities.functions`. Scoped to `list_issues` (no write ops) by design.
 *
 * One-shot (not reactive): GitHub is the source of truth. Selecting an issue to
 * create a task (createTaskFromExternalIssue) materializes it into the reactive
 * `tasks` table, which the rest of the view reads live.
 */
export const listGitHubIssues = action({
  args: {
    organizationId: v.string(),
    owner: v.string(),
    repo: v.string(),
    state: v.optional(v.string()),
    page: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- third-party issue shape at the API boundary
  handler: async (ctx, args): Promise<any> => {
    await requireOrgMembershipById(ctx, args.organizationId);
    return await ctx.runAction(
      internal.agent_tools.integrations.internal_actions.executeIntegration,
      {
        organizationId: args.organizationId,
        integrationName: 'github',
        operation: 'list_issues',
        params: {
          owner: args.owner,
          repo: args.repo,
          state: args.state ?? 'open',
          per_page: Math.min(Math.max(args.perPage ?? 30, 1), 100),
          page: Math.max(args.page ?? 1, 1),
        },
        skipApprovalCheck: true,
      },
    );
  },
});
