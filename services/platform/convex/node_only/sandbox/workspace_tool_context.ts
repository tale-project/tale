'use node';

/**
 * Resolve the knowledge-scope ToolCtx fields for a workspace-tool dispatch
 * (`/api/tools/execute`). The loop injects these onto the ToolCtx from the
 * turn's SerializableAgentConfig (lib/agent_chat/internal_actions.ts); a
 * dispatch call has no live turn, so it re-resolves them fresh from the
 * agent's config file + binding — node runtime because the config is a file
 * under $TALE_CONFIG_DIR (same reason resolveAgentConfigInline is node).
 *
 * Fresh-per-call on purpose (like the integration dispatch's availability
 * check): a config edit mid-session applies to the next tool call, and the
 * grant snapshot on the token row still bounds WHICH tools are callable.
 */

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { resolveAgentConfigInline } from '../../agents/resolve_agent_config';
import { orgSlugFromId } from '../../lib/helpers/org_slug';

export const resolveWorkspaceToolContext = internalAction({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
  },
  returns: v.object({
    agentTeamId: v.optional(v.string()),
    agentTeamIds: v.optional(v.array(v.string())),
    includeTeamKnowledge: v.optional(v.boolean()),
    includeOrgKnowledge: v.optional(v.boolean()),
    knowledgeFileIds: v.optional(v.array(v.string())),
  }),
  handler: async (ctx, args) => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const { config } = await resolveAgentConfigInline(ctx, {
      orgSlug,
      agentSlug: args.agentSlug,
      organizationId: args.organizationId,
    });
    return {
      ...(config.agentTeamId !== undefined && {
        agentTeamId: config.agentTeamId,
      }),
      ...(config.agentTeamIds !== undefined && {
        agentTeamIds: config.agentTeamIds,
      }),
      ...(config.includeTeamKnowledge !== undefined && {
        includeTeamKnowledge: config.includeTeamKnowledge,
      }),
      ...(config.includeOrgKnowledge !== undefined && {
        includeOrgKnowledge: config.includeOrgKnowledge,
      }),
      ...(config.knowledgeFileIds !== undefined && {
        knowledgeFileIds: config.knowledgeFileIds,
      }),
    };
  },
});
