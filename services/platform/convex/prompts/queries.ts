import { v } from 'convex/values';

import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { queryWithRLS } from '../lib/rls/helpers/query_with_rls';
import { getUserOrganizations } from '../lib/rls/organization/get_user_organizations';
import { hasTeamAccess } from '../lib/team_access';
import { promptScopeValidator, promptTemplateValidator } from './validators';

export const listPrompts = queryWithRLS({
  args: {
    organizationId: v.string(),
    scope: v.optional(promptScopeValidator),
  },
  returns: v.array(promptTemplateValidator),
  handler: async (ctx, args) => {
    const user = await getAuthUserIdentity(ctx);
    if (!user) return [];

    const userOrganizations = await getUserOrganizations(ctx, user);
    const membership = userOrganizations.find(
      (m) => m.organizationId === args.organizationId,
    );
    if (!membership) return [];

    const userTeamIds = await getUserTeamIds(ctx, user.userId);
    const results = [];

    const { scope } = args;
    if (scope) {
      for await (const prompt of ctx.db
        .query('promptTemplates')
        .withIndex('by_organizationId_and_scope', (q) =>
          q.eq('organizationId', args.organizationId).eq('scope', scope),
        )) {
        if (scope === 'personal' && prompt.createdBy !== user.userId) {
          continue;
        }
        if (!hasTeamAccess(prompt, userTeamIds)) {
          continue;
        }
        if (prompt.isPublished || prompt.createdBy === user.userId) {
          results.push(prompt);
        }
      }
    } else {
      for await (const prompt of ctx.db
        .query('promptTemplates')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', args.organizationId),
        )) {
        if (prompt.scope === 'personal' && prompt.createdBy !== user.userId) {
          continue;
        }
        if (!hasTeamAccess(prompt, userTeamIds)) {
          continue;
        }
        if (prompt.isPublished || prompt.createdBy === user.userId) {
          results.push(prompt);
        }
      }
    }

    return results;
  },
});

export const getPrompt = queryWithRLS({
  args: {
    promptId: v.id('promptTemplates'),
  },
  returns: v.union(promptTemplateValidator, v.null()),
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.promptId);
    if (!prompt) return null;

    const user = await getAuthUserIdentity(ctx);
    if (!user) return null;

    if (prompt.scope === 'personal' && prompt.createdBy !== user.userId) {
      return null;
    }

    if (prompt.scope === 'team') {
      const userTeamIds = await getUserTeamIds(ctx, user.userId);
      if (!hasTeamAccess(prompt, userTeamIds)) return null;
    }

    return prompt;
  },
});
