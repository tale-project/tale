import { ConvexError } from 'convex/values';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  deleteSkillForViewer,
  listSkillsForViewer,
  readSkillAssetForViewer,
  readSkillForViewer,
  saveSkillForViewer,
} from '../../../convex/skills/file_actions.ts';
import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { getUserTeamIds } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { uploadSkillBundlePg } from './upload.ts';

/**
 * /api/app/skills — the org's skill bundles, REUSING the 0.4 file layer
 * verbatim (`convex/skills/file_actions.ts` — SKILL.md frontmatter + bundle
 * files on the org config tree). Visibility (`org | team`), owner
 * adoption, and verify-before-write live in the reused functions; this
 * module authenticates, derives the viewer (teams + the orgSettings admin
 * capability), and maps error codes onto HTTP. The zip-upload lane rides a
 * later increment with the upload-intent flow.
 */

const editSchema = z.object({
  description: z.string().min(1).max(2000),
  body: z.string().max(200_000),
  visibility: z.enum(['org', 'team', 'private']).optional(),
  teams: z.array(z.string().max(128)).max(20).optional(),
  icon: z.string().max(100).optional(),
  labels: z.array(z.string().max(100)).max(50).optional(),
});

const ERROR_STATUS: Record<string, 400 | 403 | 404 | 422> = {
  INVALID_SKILL_SLUG: 400,
  INVALID_SKILL: 400,
  SKILL_PRIVATE_RETIRED: 400,
  SKILL_FORBIDDEN: 403,
  SKILL_MALFORMED: 422,
  STORAGE_NOT_OWNED: 403,
  STORAGE_NOT_FOUND: 404,
  BUNDLE_TOO_LARGE: 400,
  INVALID_BUNDLE: 400,
  WRITE_FAILED: 400,
};

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (data !== null && typeof data === 'object' && 'code' in data) {
      const record = data as { code?: unknown; message?: unknown };
      const code = typeof record.code === 'string' ? record.code : 'ERROR';
      const status = ERROR_STATUS[code];
      if (status !== undefined) {
        return c.json(
          {
            error: code,
            message: typeof record.message === 'string' ? record.message : code,
          },
          status,
        );
      }
    }
  }
  throw error;
}

export function createSkillRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const caller = async (c: Context<OrgEnv>) => {
    const orgSlug = await resolveOrgSlug(deps.sql, c.get('orgId'));
    if (!orgSlug) {
      throw new Error(`organization ${c.get('orgId')} has no slug`);
    }
    const userId = c.get('sessionBundle').user.id;
    return {
      orgSlug,
      viewer: {
        kind: 'user' as const,
        userId,
        teamIds: await getUserTeamIds(deps.sql, userId),
        isOrgAdmin: defineAbilityFor(c.get('orgMember').role).can(
          'write',
          'orgSettings',
        ),
      },
    };
  };

  app.get('/', async (c) => {
    return c.json(await listSkillsForViewer(await caller(c)));
  });

  app.get('/:slug', async (c) => {
    try {
      const skill = await readSkillForViewer({
        ...(await caller(c)),
        slug: c.req.param('slug'),
      });
      if (skill === null) return c.json({ error: 'skill not found' }, 404);
      return c.json({ skill });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:slug/assets/:path{.+}', async (c) => {
    try {
      const asset = await readSkillAssetForViewer({
        ...(await caller(c)),
        slug: c.req.param('slug'),
        path: c.req.param('path'),
      });
      if (asset === null) return c.json({ error: 'asset not found' }, 404);
      return c.json({ asset });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.put('/:slug', async (c) => {
    const body = editSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const skill = await saveSkillForViewer({
        ...(await caller(c)),
        slug: c.req.param('slug'),
        ...body.data,
      });
      return c.json({ skill });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** The bundle-upload lane (zip staged via the org byte lane). */
  app.post('/upload', async (c) => {
    const body = z
      .object({
        storageId: z.string().min(1).max(2_000),
        force: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const who = await caller(c);
      return c.json(
        await uploadSkillBundlePg(deps.sql, {
          organizationId: c.get('orgId'),
          orgSlug: who.orgSlug,
          viewer: who.viewer,
          storageId: body.data.storageId,
          ...(body.data.force !== undefined ? { force: body.data.force } : {}),
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:slug', async (c) => {
    try {
      const deleted = await deleteSkillForViewer({
        ...(await caller(c)),
        slug: c.req.param('slug'),
      });
      return c.json({ deleted });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
