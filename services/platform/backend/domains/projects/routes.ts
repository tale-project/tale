import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  createProjectInputSchema,
  deleteProjectInputSchema,
  projectKnowledgeModeSchema,
  updateProjectAgentSettingsSchema,
  updateProjectIdentitySchema,
  updateProjectInstructionsSchema,
  updateProjectModelSettingsSchema,
  updateProjectSharingSchema,
} from '../../../lib/shared/schemas/projects.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { ensureDefaultProjectLabels } from '../tasks/service.ts';
import {
  deleteProjectSecret,
  listProjectSecrets,
  setProjectSecret,
  setProjectSecretPair,
} from './secrets.ts';
import {
  archiveProject,
  assertCanCreateProjects,
  createProject,
  createProjectAgent,
  deleteProject,
  deleteProjectAgent,
  duplicateProject,
  getProject,
  getProjectAuthContext,
  listAccessibleUserIds,
  listProjectAgents,
  listProjects,
  listProjectsOverview,
  listSidebarProjects,
  ProjectError,
  restoreProject,
  searchProjects,
  setProjectPinned,
  updateProjectAgent,
  updateProjectAgentSettings,
  updateProjectConnectorSettings,
  updateProjectIdentity,
  updateProjectInstructions,
  updateProjectKnowledgeMode,
  updateProjectModelSettings,
  updateProjectSharing,
  type ProjectAuthContext,
} from './service.ts';

// The project bodies parse with the SHARED schemas (`lib/shared/schemas/
// projects.ts`) — the one copy the editor, this door and the service read,
// so the icon/color allowlists and every cap are enforced here rather than
// in a looser hand copy. Only the fields the session door adds on top
// (`key`, `externalItemId`) are declared locally.
const createProjectSchema = createProjectInputSchema
  .omit({ organizationId: true })
  .extend({
    key: z.string().max(10).optional(),
    externalItemId: z.string().max(512).optional(),
  });

const connectorSettingsSchema = z.object({
  connectorsMode: z.enum(['all', 'restricted']),
  allowedConnectorSlugs: z.array(z.string()).max(200).optional(),
});

const projectAgentSchema = z.object({
  name: z.string().min(1).max(200),
  harness: z.string().min(1).max(100),
  model: z.string().min(1).max(300),
  modelProvider: z.string().max(300).optional(),
  skills: z.array(z.string()).max(100),
  connectors: z.array(z.string()).max(100),
  tools: z.array(z.string()).max(100).optional(),
  secrets: z.array(z.string()).max(100).optional(),
  instructions: z.string().max(30_000).optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ProjectError) {
    return c.json(
      {
        error: error.code,
        ...(error.data !== undefined ? { data: error.data } : {}),
      },
      error.status,
    );
  }
  if (error instanceof RateLimitExceededError) {
    return rateLimitedResponse(c, error);
  }
  throw error;
}

/** /api/app/projects — the projects surface (session + org-member gated). */
export function createProjectRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const authCtx = (c: Context<OrgEnv>): Promise<ProjectAuthContext> =>
    getProjectAuthContext(
      deps.sql,
      {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        role: c.get('orgMember').role,
      },
      c.get('sessionBundle').user.email,
    );

  app.get('/', async (c) => {
    const auth = await authCtx(c);
    const includeArchived = c.req.query('includeArchived') === 'true';
    return c.json({
      projects: await listProjects(deps.sql, auth, { includeArchived }),
    });
  });

  app.get('/overview', async (c) => {
    const auth = await authCtx(c);
    const includeArchived = c.req.query('includeArchived') === 'true';
    const asOfRaw = c.req.query('asOf');
    const asOf = asOfRaw === undefined ? Number.NaN : Number(asOfRaw);
    return c.json(
      await listProjectsOverview(deps.sql, auth, {
        includeArchived,
        ...(Number.isFinite(asOf) && asOf > 0 ? { asOf } : {}),
      }),
    );
  });

  app.get('/sidebar', async (c) => {
    const auth = await authCtx(c);
    return c.json({ projects: await listSidebarProjects(deps.sql, auth) });
  });

  app.get('/search', async (c) => {
    const auth = await authCtx(c);
    const query = c.req.query('q') ?? '';
    return c.json({ projects: await searchProjects(deps.sql, auth, query) });
  });

  app.post('/', async (c) => {
    const body = createProjectSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      assertCanCreateProjects(auth);
      await checkUserRateLimit(deps.sql, 'project:create', auth.userId);
      const projectId = await transactSerializable(deps.sql, async (tx) => {
        const id = await createProject(tx, auth, body.data);
        await ensureDefaultProjectLabels(tx, {
          organizationId: auth.organizationId,
          projectId: id,
          createdBy: auth.userId,
        });
        return id;
      });
      return c.json({ projectId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:id', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        project: await getProject(deps.sql, auth, c.req.param('id')),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:id/accessible-users', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await listAccessibleUserIds(deps.sql, auth, c.req.param('id')),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/duplicate', async (c) => {
    const body = z
      .object({ name: z.string().max(200).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await checkUserRateLimit(deps.sql, 'project:create', auth.userId);
      const projectId = await transactSerializable(deps.sql, (tx) =>
        duplicateProject(tx, auth, c.req.param('id'), body.data.name),
      );
      return c.json({ projectId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/archive', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        archiveProject(tx, auth, c.req.param('id')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/restore', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        restoreProject(tx, auth, c.req.param('id')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/pin', async (c) => {
    const body = z
      .object({ pinned: z.boolean() })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        setProjectPinned(tx, auth, c.req.param('id'), body.data.pinned),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/identity', async (c) => {
    const body = updateProjectIdentitySchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateProjectIdentity(tx, auth, {
          projectId: c.req.param('id'),
          ...body.data,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/instructions', async (c) => {
    const body = updateProjectInstructionsSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateProjectInstructions(
          tx,
          auth,
          c.req.param('id'),
          body.data.instructions,
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/sharing', async (c) => {
    const body = updateProjectSharingSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateProjectSharing(tx, auth, {
          projectId: c.req.param('id'),
          ...body.data,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/knowledge-mode', async (c) => {
    const body = z
      .object({ knowledgeMode: projectKnowledgeModeSchema })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateProjectKnowledgeMode(
          tx,
          auth,
          c.req.param('id'),
          body.data.knowledgeMode,
        ),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/agent-settings', async (c) => {
    const body = updateProjectAgentSettingsSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateProjectAgentSettings(tx, auth, {
          projectId: c.req.param('id'),
          ...body.data,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/model-settings', async (c) => {
    const body = updateProjectModelSettingsSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateProjectModelSettings(tx, auth, {
          projectId: c.req.param('id'),
          ...body.data,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/connector-settings', async (c) => {
    const body = connectorSettingsSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateProjectConnectorSettings(tx, auth, {
          projectId: c.req.param('id'),
          ...body.data,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:id', async (c) => {
    const body = deleteProjectInputSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      if (body.data.mode === 'cascade') {
        await checkUserRateLimit(
          deps.sql,
          'project:delete-cascade',
          auth.userId,
        );
      }
      const result = await transactSerializable(deps.sql, (tx) =>
        deleteProject(tx, auth, {
          projectId: c.req.param('id'),
          ...body.data,
        }),
      );
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:id/agents', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        agents: await listProjectAgents(deps.sql, auth, c.req.param('id')),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/agents', async (c) => {
    const body = projectAgentSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      const agentId = await transactSerializable(deps.sql, (tx) =>
        createProjectAgent(tx, auth, {
          projectId: c.req.param('id'),
          ...body.data,
        }),
      );
      return c.json({ agentId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/agents/:agentId', async (c) => {
    const body = projectAgentSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateProjectAgent(tx, auth, {
          agentId: c.req.param('agentId'),
          ...body.data,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/agents/:agentId', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        deleteProjectAgent(tx, auth, c.req.param('agentId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // --- Project secrets (metadata-only listings; values are write-only) ---

  app.get('/:id/secrets', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        secrets: await listProjectSecrets(deps.sql, auth, c.req.param('id')),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/secrets', async (c) => {
    const body = z
      .object({
        name: z.string().min(1).max(200),
        value: z.string().min(1).max(10_000),
        description: z.string().max(500).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        setProjectSecret(tx, auth, {
          projectId: c.req.param('id'),
          ...body.data,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:id/secrets/pair', async (c) => {
    const body = z
      .object({
        baseName: z.string().min(1).max(200),
        username: z.string().min(1).max(10_000),
        password: z.string().min(1).max(10_000),
        description: z.string().max(500).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        setProjectSecretPair(tx, auth, {
          projectId: c.req.param('id'),
          ...body.data,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:id/secrets/:name', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        deleteProjectSecret(tx, auth, {
          projectId: c.req.param('id'),
          name: c.req.param('name'),
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
