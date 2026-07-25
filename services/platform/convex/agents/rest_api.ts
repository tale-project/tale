/**
 * Agents REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/agents          — List the agents the key holder can use
 *   GET    /api/v1/agents/:slug    — One agent in full
 *   PUT    /api/v1/agents/:slug    — Create or update an agent
 *   DELETE /api/v1/agents/:slug    — Delete an agent
 *
 * An agent lives in the organization's config TREE, not in a table: the public
 * actions in `actions.ts` verify the session caller and then delegate the
 * filesystem work to `file_actions.ts`. This surface does the same, with the
 * caller's identity coming from the API key instead of `ctx.auth`: the org slug
 * — which is the directory every path resolves under — comes from the resolved
 * organization, never from the request, and `isOrgAdmin` is the same
 * `orgSettings` write capability the session path computes. Per-agent ownership
 * (may this member edit an agent they do not own?) is then decided by the file
 * layer exactly as before, so REST cannot reach past a `private` agent's owner.
 *
 * An agent slug is a FLAT name (`support-triage`), never a path, so it needs no
 * URL codec — unlike an automation name.
 */

import { internal } from '../_generated/api';
import {
  extractPathParts,
  jsonError,
  jsonNoContent,
  jsonOk,
  optionalEnum,
  optionalString,
  optionalStringArray,
  optionalStringArrayOrNull,
  readJsonObject,
  requiredString,
  restCallerIsOrgAdmin,
  withRestAuth,
} from '../lib/rest/helpers';

const PREFIX = '/api/v1/agents/';

/** Ceilings mirroring `lib/shared/schemas/agents.ts`, so an oversized field is
 * refused at the boundary instead of by the file writer. */
const MAX_SLUG = 200;
const MAX_DISPLAY_NAME = 200;
const MAX_DESCRIPTION = 1000;
const MAX_INSTRUCTIONS = 100_000;

export const listAgents = withRestAuth('rest:api', async (rc) => {
  const listing = await rc.ctx.runAction(
    internal.agents.file_actions.listAgents,
    {
      orgSlug: rc.org.orgSlug,
      viewerUserId: rc.user.userId,
      isOrgAdmin: await restCallerIsOrgAdmin(rc),
    },
  );
  return jsonOk(listing);
});

export const getAgent = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id, subPath } = extractPathParts(url, PREFIX);
  if (!id) return jsonError('Missing agent slug', 400);
  if (subPath !== null)
    return jsonError(`Unknown sub-resource: ${subPath}`, 404);

  const agent = await rc.ctx.runAction(internal.agents.file_actions.readAgent, {
    orgSlug: rc.org.orgSlug,
    slug: id,
    viewerUserId: rc.user.userId,
    isOrgAdmin: await restCallerIsOrgAdmin(rc),
  });
  if (!agent) return jsonError('Agent not found', 404);
  return jsonOk(agent);
});

/**
 * Create or update an agent. `PUT` because the slug in the path IS the
 * identity: the same request creates the file or replaces the fields it names,
 * and everything it does not name round-trips from what is on disk.
 */
export const putAgent = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id, subPath } = extractPathParts(url, PREFIX);
  if (!id) return jsonError('Missing agent slug', 400);
  if (subPath !== null)
    return jsonError(`Unknown sub-resource: ${subPath}`, 404);

  const body = await readJsonObject(request);
  const displayName = requiredString(body, 'displayName', MAX_DISPLAY_NAME);
  const description = optionalString(body, 'description', MAX_DESCRIPTION);
  const instructions = optionalString(body, 'instructions', MAX_INSTRUCTIONS);
  const visibility = optionalEnum(body, 'visibility', [
    'private',
    'org',
  ] as const);
  const icon = optionalString(body, 'icon', 200);
  const labels = optionalStringArray(body, 'labels', 50);
  // `null` removes a narrowing; absent keeps the current one.
  const tools = optionalStringArrayOrNull(body, 'tools');
  const skills = optionalStringArrayOrNull(body, 'skills');
  const knowledge = optionalEnum(body, 'knowledge', [
    'none',
    'documents',
    'web',
    'all',
  ] as const);

  const saved = await rc.ctx.runAction(internal.agents.file_actions.saveAgent, {
    orgSlug: rc.org.orgSlug,
    slug: id,
    viewerUserId: rc.user.userId,
    isOrgAdmin: await restCallerIsOrgAdmin(rc),
    displayName,
    ...(description !== undefined && { description }),
    ...(instructions !== undefined && { instructions }),
    ...(visibility !== undefined && { visibility }),
    ...(icon !== undefined && { icon }),
    ...(labels !== undefined && { labels }),
    ...(tools !== undefined && { tools }),
    ...(skills !== undefined && { skills }),
    ...(knowledge !== undefined && { knowledge }),
  });
  return jsonOk(saved);
});

export const deleteAgent = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id, subPath } = extractPathParts(url, PREFIX);
  if (!id) return jsonError('Missing agent slug', 400);
  if (subPath !== null)
    return jsonError(`Unknown sub-resource: ${subPath}`, 404);
  if (id.length > MAX_SLUG) return jsonError('Agent slug is too long', 400);

  const deleted = await rc.ctx.runAction(
    internal.agents.file_actions.deleteAgent,
    {
      orgSlug: rc.org.orgSlug,
      slug: id,
      viewerUserId: rc.user.userId,
      isOrgAdmin: await restCallerIsOrgAdmin(rc),
    },
  );
  // The file layer answers false for "there was nothing to delete", which is a
  // 404 here rather than a silent success.
  if (!deleted) return jsonError('Agent not found', 404);
  return jsonNoContent();
});
