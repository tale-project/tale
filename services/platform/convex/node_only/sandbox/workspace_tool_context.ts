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

import { ConvexError, v } from 'convex/values';

import { internalAction } from '../../_generated/server';

// `resolveAgentConfigInline`
// (`convex/agents/resolve_agent_config.ts`) moved with the agents domain.
// No live caller reaches this today (the workspace-tool dispatch loop that
// called it, `lib/agent_chat/internal_actions.ts`, moved too) — offline
// error rather than a fabricated empty knowledge scope, since a silent
// "no knowledge access" answer here would be indistinguishable from a real
// (and very different) admin choice.

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
  handler: async (_ctx, _args) => {
    throw new ConvexError(
      'Workspace tool context resolution is offline while the platform AI backend is rewritten.',
    );
  },
});
