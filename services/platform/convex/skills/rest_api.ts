/**
 * Skills REST API handlers.
 *
 * Endpoints:
 *   GET    /api/v1/skills          — List the skills the key holder can see
 *   GET    /api/v1/skills/:slug    — One skill with its markdown body
 *   PUT    /api/v1/skills/:slug    — Create or update a skill bundle
 *   DELETE /api/v1/skills/:slug    — Delete a skill bundle
 *
 * Same shape and same boundary as the agents surface: a skill lives in the
 * organization's config tree, the org slug comes from the resolved organization
 * rather than the request, `isOrgAdmin` is the `orgSettings` write capability,
 * and per-bundle ownership stays the file layer's decision. A skill slug is a
 * FLAT name, so it needs no URL codec.
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
  readJsonObject,
  requiredString,
  restCallerIsOrgAdmin,
  withRestAuth,
} from '../lib/rest/helpers';

const PREFIX = '/api/v1/skills/';

/** Ceilings mirroring `lib/shared/schemas/skills.ts`. */
const MAX_SLUG = 200;
const MAX_DESCRIPTION = 1024;
const MAX_BODY = 1_000_000;

export const listSkills = withRestAuth('rest:api', async (rc) => {
  const listing = await rc.ctx.runAction(
    internal.skills.file_actions.listSkills,
    {
      orgSlug: rc.org.orgSlug,
      viewerUserId: rc.user.userId,
      isOrgAdmin: await restCallerIsOrgAdmin(rc),
    },
  );
  return jsonOk(listing);
});

export const getSkill = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id, subPath } = extractPathParts(url, PREFIX);
  if (!id) return jsonError('Missing skill slug', 400);
  if (subPath !== null) {
    return jsonError(`Unknown sub-resource: ${subPath}`, 404);
  }

  const skill = await rc.ctx.runAction(internal.skills.file_actions.readSkill, {
    orgSlug: rc.org.orgSlug,
    slug: id,
    viewerUserId: rc.user.userId,
    isOrgAdmin: await restCallerIsOrgAdmin(rc),
  });
  if (!skill) return jsonError('Skill not found', 404);
  return jsonOk(skill);
});

/** Create or update a skill bundle — the slug in the path is its identity. */
export const putSkill = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id, subPath } = extractPathParts(url, PREFIX);
  if (!id) return jsonError('Missing skill slug', 400);
  if (subPath !== null) {
    return jsonError(`Unknown sub-resource: ${subPath}`, 404);
  }

  const body = await readJsonObject(request);
  const description = requiredString(body, 'description', MAX_DESCRIPTION);
  const skillBody = requiredString(body, 'body', MAX_BODY);
  const visibility = optionalEnum(body, 'visibility', [
    'private',
    'org',
  ] as const);
  const icon = optionalString(body, 'icon', 200);
  const labels = optionalStringArray(body, 'labels', 50);

  const saved = await rc.ctx.runAction(internal.skills.file_actions.saveSkill, {
    orgSlug: rc.org.orgSlug,
    slug: id,
    viewerUserId: rc.user.userId,
    isOrgAdmin: await restCallerIsOrgAdmin(rc),
    description,
    body: skillBody,
    ...(visibility !== undefined && { visibility }),
    ...(icon !== undefined && { icon }),
    ...(labels !== undefined && { labels }),
  });
  return jsonOk(saved);
});

export const deleteSkill = withRestAuth('rest:api', async (rc, request) => {
  const url = new URL(request.url);
  const { id, subPath } = extractPathParts(url, PREFIX);
  if (!id) return jsonError('Missing skill slug', 400);
  if (subPath !== null) {
    return jsonError(`Unknown sub-resource: ${subPath}`, 404);
  }
  if (id.length > MAX_SLUG) return jsonError('Skill slug is too long', 400);

  const deleted = await rc.ctx.runAction(
    internal.skills.file_actions.deleteSkill,
    {
      orgSlug: rc.org.orgSlug,
      slug: id,
      viewerUserId: rc.user.userId,
      isOrgAdmin: await restCallerIsOrgAdmin(rc),
    },
  );
  if (!deleted) return jsonError('Skill not found', 404);
  return jsonNoContent();
});
