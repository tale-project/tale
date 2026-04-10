/**
 * Agents REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/agents              — List agents
 *   GET    /api/v1/agents/tools        — List available tools
 *   GET    /api/v1/agents/integrations — List available integrations
 *   GET    /api/v1/agents/:slug        — Get agent config + binding
 *   PATCH  /api/v1/agents/:slug        — Update agent binding (team assignment)
 */

import { internal } from '../_generated/api';
import {
  extractPathParts,
  jsonError,
  jsonNoContent,
  jsonOk,
  withRestAuth,
} from '../lib/rest/helpers';

const PREFIX = '/api/v1/agents/';

export const listAgents = withRestAuth('rest:api', async (rc) => {
  const agents = await rc.ctx.runAction(
    internal.agents.internal_actions.listAgentsInternal,
    { orgSlug: rc.org.orgSlug },
  );

  return jsonOk(agents);
});

export const getAgent = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id: slug, subPath } = extractPathParts(url, PREFIX);

  if (!slug) {
    return jsonError('Missing agent slug', 400);
  }

  // Handle special sub-paths at the collection level
  if (slug === 'tools' && !subPath) {
    const { TOOL_NAMES } = await import('../agent_tools/tool_names');
    return jsonOk(
      TOOL_NAMES.map((name: string) => ({ name, available: true })),
    );
  }

  if (slug === 'integrations' && !subPath) {
    const integrations = await rc.ctx.runQuery(
      internal.agents.internal_queries.getAvailableIntegrations,
      { organizationId: rc.org.organizationId },
    );
    return jsonOk(integrations);
  }

  // Get agent config from filesystem
  const agentConfig = await rc.ctx.runAction(
    internal.agents.internal_actions.readAgentInternal,
    { orgSlug: rc.org.orgSlug, agentName: slug },
  );

  // Get binding from DB
  const binding = await rc.ctx.runQuery(
    internal.agents.internal_queries.getBindingByAgent,
    { organizationId: rc.org.organizationId, agentSlug: slug },
  );

  return jsonOk({ config: agentConfig, binding });
});

export const patchAgent = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id: slug } = extractPathParts(url, PREFIX);

  if (!slug) {
    return jsonError('Missing agent slug', 400);
  }

  const body = await request.json();

  await rc.ctx.runMutation(internal.agents.mutations.upsertBinding, {
    organizationId: rc.org.organizationId,
    agentSlug: slug,
    teamId: body.teamId,
  });

  return jsonNoContent();
});
