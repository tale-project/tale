import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { getUserTeamIds } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  deleteSkillForViewer,
  listSkillsForViewer,
  readSkillAssetForViewer,
  readSkillForViewer,
  saveSkillForViewer,
} from '../../core/skills/file_actions.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { skillErrorResponse } from './errors.ts';
import { uploadSkillBundlePg } from './upload.ts';
import { withSkillWriterLock } from './writer-lock.ts';

/**
 * /api/app/skills — the org's skill bundles, REUSING the 0.4 file layer
 * verbatim (`convex/skills/file_actions.ts` — SKILL.md frontmatter + bundle
 * files on the org config tree). Visibility (`org | team`), owner
 * adoption, and verify-before-write live in the reused functions; this
 * module authenticates, derives the viewer (teams + the orgSettings admin
 * capability), and maps error codes onto HTTP through the map the REST
 * family shares (`errors.ts`). The zip-upload lane rides the upload-intent
 * flow (`upload.ts`).
 */

const editSchema = z.object({
  description: z.string().min(1).max(2000),
  body: z.string().max(200_000),
  visibility: z.enum(['org', 'team', 'private']).optional(),
  teams: z.array(z.string().max(128)).max(20).optional(),
  icon: z.string().max(100).optional(),
  labels: z.array(z.string().max(100)).max(50).optional(),
});

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
      return skillErrorResponse(c, error);
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
      return skillErrorResponse(c, error);
    }
  });

  app.put('/:slug', async (c) => {
    const body = editSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const who = await caller(c);
      const slug = c.req.param('slug');
      // Serialized with the upload lane on the per-slug writer lock: a save
      // must never land between an upload's two swap renames.
      const skill = await withSkillWriterLock(
        deps.sql,
        c.get('orgId'),
        slug,
        () => saveSkillForViewer({ ...who, slug, ...body.data }),
      );
      return c.json({ skill });
    } catch (error) {
      return skillErrorResponse(c, error);
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
      return skillErrorResponse(c, error);
    }
  });

  app.delete('/:slug', async (c) => {
    try {
      const who = await caller(c);
      const slug = c.req.param('slug');
      const deleted = await withSkillWriterLock(
        deps.sql,
        c.get('orgId'),
        slug,
        () => deleteSkillForViewer({ ...who, slug }),
      );
      return c.json({ deleted });
    } catch (error) {
      return skillErrorResponse(c, error);
    }
  });

  return app;
}
