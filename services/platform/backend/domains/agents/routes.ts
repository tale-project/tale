import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  deleteAgentForCaller,
  listAgentsForCaller,
  listHistoryForCaller,
  readAgentForCaller,
  resolveAgentForCaller,
  restoreFromHistoryForCaller,
  saveAgentForCaller,
  type AgentCallerArgs,
} from '../../core/agents/file_actions.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { agentErrorResponse } from './errors.ts';

/**
 * /api/app/agents — the org's agent personas, REUSING the 0.4 file layer
 * verbatim (`convex/agents/file_actions.ts` — pure filesystem logic over
 * the org config tree, yaml definitions + a history trail). Visibility
 * (`private | org`), owner adoption, verify-before-write, and additive
 * restore all live in the reused functions; this module only authenticates,
 * derives the caller, and maps the reused error codes onto HTTP through the
 * map the REST family shares (`errors.ts`).
 */

const editSchema = z.object({
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  instructions: z.string().max(100_000).optional(),
  visibility: z.enum(['private', 'org']).optional(),
  icon: z.string().max(100).optional(),
  labels: z.array(z.string().max(100)).max(50).optional(),
  tools: z.array(z.string().max(200)).max(200).nullable().optional(),
  skills: z.array(z.string().max(200)).max(200).nullable().optional(),
  knowledge: z.enum(['none', 'documents', 'web', 'all']).optional(),
});

const restoreSchema = z.object({ entry: z.string().min(1).max(255) });

export function createAgentRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const caller = async (c: Context<OrgEnv>): Promise<AgentCallerArgs> => {
    const orgSlug = await resolveOrgSlug(deps.sql, c.get('orgId'));
    if (!orgSlug) {
      throw new Error(`organization ${c.get('orgId')} has no slug`);
    }
    return {
      orgSlug,
      viewerUserId: c.get('sessionBundle').user.id,
      // Administering the org's shared configuration is the `orgSettings`
      // write capability — the same derivation the 0.4 action layer uses.
      isOrgAdmin: defineAbilityFor(c.get('orgMember').role).can(
        'write',
        'orgSettings',
      ),
    };
  };

  app.get('/', async (c) => {
    return c.json(await listAgentsForCaller(await caller(c)));
  });

  app.get('/:slug', async (c) => {
    try {
      const agent = await readAgentForCaller({
        ...(await caller(c)),
        slug: c.req.param('slug'),
      });
      if (agent === null) {
        return c.json({ error: 'agent not found' }, 404);
      }
      return c.json({ agent });
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  app.get('/:slug/resolved', async (c) => {
    try {
      const resolved = await resolveAgentForCaller({
        ...(await caller(c)),
        slug: c.req.param('slug'),
        locale: c.req.query('locale') ?? 'en',
      });
      if (resolved === null) {
        return c.json({ error: 'agent not found' }, 404);
      }
      return c.json({ agent: resolved });
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  app.put('/:slug', async (c) => {
    const body = editSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const agent = await saveAgentForCaller({
        ...(await caller(c)),
        slug: c.req.param('slug'),
        ...body.data,
      });
      return c.json({ agent });
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  app.delete('/:slug', async (c) => {
    try {
      const deleted = await deleteAgentForCaller({
        ...(await caller(c)),
        slug: c.req.param('slug'),
      });
      return c.json({ deleted });
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  app.get('/:slug/history', async (c) => {
    try {
      const entries = await listHistoryForCaller({
        ...(await caller(c)),
        slug: c.req.param('slug'),
      });
      return c.json({ entries });
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  app.post('/:slug/restore', async (c) => {
    const body = restoreSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const agent = await restoreFromHistoryForCaller({
        ...(await caller(c)),
        slug: c.req.param('slug'),
        entry: body.data.entry,
      });
      return c.json({ agent });
    } catch (error) {
      return agentErrorResponse(c, error);
    }
  });

  return app;
}
