import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { runSessionWithStore } from '../../../convex/automations_builder/run_session.ts';
import { resolveWorkflowAgentServing } from '../../../convex/lib/providers/agent_serving.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { createCtxShim } from '../../lib/convex-shim.ts';
import { knowledgeShimHandlers } from '../knowledge/service.ts';
import { pgAutomationStore } from './dispatch-store.ts';
import {
  AutomationError,
  answerAsk,
  beginRun,
  cancelRun,
  deleteAutomationCascade,
  deleteTrigger,
  deploy,
  getPendingAskForRun,
  getRun,
  listAutomations,
  listRuns,
  listTriggers,
  listVersions,
  saveVersion,
  setAutomationProjects,
  setTrigger,
  versionRow,
  deployedVersion,
} from './store.ts';

/**
 * /api/app/automations — the automation store surface: immutable versions,
 * explicit deploys behind the tests gate, name-bound triggers/bindings, and
 * the durable runs (start manual runs, watch them, cancel them). Authoring
 * writes and live runs need the admin/developer role; mock runs and reads
 * are member surfaces, mirroring the 0.4 gates.
 */

const saveSchema = z.object({
  document: z.unknown(),
  message: z.string().max(500).optional(),
  testsPassed: z.boolean().optional(),
  taskContract: z.unknown().optional(),
  settings: z.unknown().optional(),
  presentation: z.unknown().optional(),
});

const deploySchema = z.object({ version: z.number().int().min(1) });

const triggerSchema = z.object({
  kind: z.enum(['schedule', 'webhook', 'event']),
  cron: z.string().max(200).optional(),
  timezone: z.string().max(100).optional(),
  event: z.string().max(200).optional(),
  enabled: z.boolean().optional(),
  rotateToken: z.boolean().optional(),
});

const projectsSchema = z.object({
  projectIds: z.array(z.string().min(1)).max(100),
});

const answerSchema = z.object({ answer: z.string().min(1).max(20_000) });

const startSchema = z.object({
  input: z.unknown().optional(),
  mode: z.enum(['mock', 'live']).optional(),
  version: z.number().int().min(1).optional(),
  projectId: z.string().optional(),
});

const builderSessionSchema = z.object({
  goal: z.string(),
  model: z.object({ providerSlug: z.string(), modelId: z.string() }),
  projectId: z.string().optional(),
  maxTurns: z.number().optional(),
});

/** A goal is one instruction, not a document (the 0.4 bound). */
const MAX_GOAL_CHARS = 4000;

/** Hard ceiling on the caller's turn budget (the policy default is 14). */
const MAX_TURNS_CAP = 30;

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof AutomationError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

export function createAutomationRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const requireAuthor = (c: Context<OrgEnv>): Response | null =>
    isAdminOrDeveloperRole(c.get('orgMember').role)
      ? null
      : c.json({ error: 'admin or developer role required' }, 403);

  app.get('/', async (c) => {
    return c.json({
      automations: await listAutomations(deps.sql, c.get('orgId')),
    });
  });

  // What an UNPINNED agent-node model pick would run on RIGHT NOW — the
  // runtime's own workflow resolver, so the editor can never drift from a
  // run. A resolution failure is a RESULT, not an error (the 0.4 contract).
  app.get('/serving-preview', async (c) => {
    const organizationId = c.get('orgId');
    const model = c.req.query('model') ?? '';
    const harness = c.req.query('harness') ?? '';
    if (model.length === 0 || harness.length === 0) {
      return c.json({ error: 'model and harness are required' }, 400);
    }
    // The knowledge shim = credential reads + the better-auth org lookup the
    // provider walk resolves slugs through.
    const shim = createCtxShim(knowledgeShimHandlers(deps.sql));
    try {
      const serving = await resolveWorkflowAgentServing(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 resolver; its ctx facilities (org lookup + default-credential read) are covered by knowledgeShimHandlers
        shim as unknown as Parameters<typeof resolveWorkflowAgentServing>[0],
        {
          organizationId,
          model,
          harness,
        },
      );
      return c.json({
        ok: true as const,
        providerSlug: serving.providerSlug,
        modelId: serving.modelId,
        lane: serving.lane,
      });
    } catch (error) {
      return c.json({
        ok: false as const,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // The automation name is a '/'-separated path — it rides as a wildcard
  // suffix on every per-automation route, split from the trailing verb.
  const nameFrom = (c: Context<OrgEnv>, suffix: string): string => {
    const rest = c.req.path.split('/api/app/automations/')[1] ?? '';
    return decodeURIComponent(
      suffix === '' ? rest : rest.slice(0, -(suffix.length + 1)),
    );
  };

  // The live question of one run — membership-gated like every run read;
  // null when nothing is waiting on a person.
  app.get('/runs/:runId/ask', async (c) => {
    return c.json({
      ask: await getPendingAskForRun(
        deps.sql,
        c.get('orgId'),
        c.req.param('runId'),
      ),
    });
  });

  // Any member may answer (the 0.4 gate) — the agent asked a PERSON, not a
  // role. The answer records and the resume job rides its transaction.
  app.post('/asks/:askId/answer', async (c) => {
    const body = answerSchema.parse(await c.req.json());
    try {
      await answerAsk(deps.sql, {
        organizationId: c.get('orgId'),
        askId: c.req.param('askId'),
        answer: body.answer,
        answeredBy: c.get('sessionBundle').user.id,
      });
    } catch (error) {
      return handleError(c, error);
    }
    return c.json({ ok: true });
  });

  app.post('/runs/:runId/cancel', async (c) => {
    return c.json(
      await cancelRun(deps.sql, c.get('orgId'), c.req.param('runId')),
    );
  });

  app.get('/runs/:runId', async (c) => {
    const run = await getRun(deps.sql, c.get('orgId'), c.req.param('runId'));
    return run === null
      ? c.json({ error: 'run not found' }, 404)
      : c.json({ run });
  });

  app.get('/runs', async (c) => {
    const name = c.req.query('name');
    const limitRaw = Number(c.req.query('limit') ?? '50');
    return c.json({
      runs: await listRuns(deps.sql, c.get('orgId'), {
        ...(name !== undefined ? { name } : {}),
        ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
      }),
    });
  });

  /**
   * Author an automation from a goal, autonomously — the 0.4
   * `startBuilderSession`. Returns when the session ends (minutes, not
   * milliseconds); the versions it saves appear in the listing long before
   * the summary resolves. The session authors against the deterministic
   * mocks — `runSessionWithStore` never enables live execution — and a
   * `projectId` pins the first save to that project via the store scope.
   */
  app.post('/builder/sessions', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = builderSessionSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const goal = body.data.goal.trim();
    if (goal.length === 0 || goal.length > MAX_GOAL_CHARS) {
      return c.json(
        {
          error: `Describe the automation in 1 to ${MAX_GOAL_CHARS} characters.`,
        },
        400,
      );
    }
    const maxTurns = body.data.maxTurns;
    if (
      maxTurns !== undefined &&
      (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > MAX_TURNS_CAP)
    ) {
      return c.json(
        {
          error: `maxTurns must be an integer between 1 and ${MAX_TURNS_CAP}.`,
        },
        400,
      );
    }
    if (body.data.projectId !== undefined) {
      const projects = await deps.sql<{ id: string }[]>`
        SELECT id FROM app.projects
        WHERE id = ${body.data.projectId} AND org_id = ${c.get('orgId')}
        LIMIT 1
      `;
      if (projects.length === 0) {
        return c.json({ error: 'project not found' }, 404);
      }
    }
    try {
      const store = pgAutomationStore(deps.sql, {
        organizationId: c.get('orgId'),
        actor: c.get('sessionBundle').user.id,
        ...(body.data.projectId !== undefined
          ? { projectId: body.data.projectId }
          : {}),
      });
      const shim = createCtxShim(knowledgeShimHandlers(deps.sql));
      const outcome = await runSessionWithStore(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the session touches ctx only through the handlers above
        shim as unknown as Parameters<typeof runSessionWithStore>[0],
        {
          organizationId: c.get('orgId'),
          actorId: c.get('sessionBundle').user.id,
          goal,
          model: body.data.model,
          ...(maxTurns !== undefined ? { maxTurns } : {}),
        },
        store,
      );
      return c.json({ outcome });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:name{.+}/save', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = saveSchema.safeParse(await c.req.json());
    if (!body.success || body.data.document === undefined) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      return c.json(
        await saveVersion(deps.sql, {
          organizationId: c.get('orgId'),
          name: nameFrom(c, 'save'),
          document: body.data.document,
          actor: c.get('sessionBundle').user.id,
          ...(body.data.message !== undefined
            ? { message: body.data.message }
            : {}),
          ...(body.data.testsPassed !== undefined
            ? { testsPassed: body.data.testsPassed }
            : {}),
          ...(body.data.taskContract !== undefined
            ? { taskContract: body.data.taskContract }
            : {}),
          ...(body.data.settings !== undefined
            ? { settings: body.data.settings }
            : {}),
          ...(body.data.presentation !== undefined
            ? { presentation: body.data.presentation }
            : {}),
        }),
        201,
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:name{.+}/deploy', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = deploySchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      return c.json(
        await deploy(deps.sql, {
          organizationId: c.get('orgId'),
          name: nameFrom(c, 'deploy'),
          version: body.data.version,
          actor: c.get('sessionBundle').user.id,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:name{.+}/trigger', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = triggerSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      return c.json(
        await setTrigger(deps.sql, {
          organizationId: c.get('orgId'),
          name: nameFrom(c, 'trigger'),
          trigger: body.data,
          actor: c.get('sessionBundle').user.id,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:name{.+}/trigger', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    return c.json({
      deleted: await deleteTrigger(
        deps.sql,
        c.get('orgId'),
        nameFrom(c, 'trigger'),
      ),
    });
  });

  app.post('/:name{.+}/projects', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = projectsSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      await setAutomationProjects(deps.sql, {
        organizationId: c.get('orgId'),
        name: nameFrom(c, 'projects'),
        projectIds: body.data.projectIds,
        actor: c.get('sessionBundle').user.id,
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:name{.+}/start', async (c) => {
    const body = startSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const mode = body.data.mode ?? 'mock';
    if (mode === 'live') {
      const denied = requireAuthor(c);
      if (denied) return denied;
    }
    try {
      const started = await beginRun(deps.sql, {
        organizationId: c.get('orgId'),
        name: nameFrom(c, 'start'),
        input: body.data.input ?? {},
        mode,
        startedBy: `user:${c.get('sessionBundle').user.id}`,
        ...(body.data.version !== undefined
          ? { version: body.data.version }
          : {}),
        ...(body.data.projectId !== undefined
          ? { projectId: body.data.projectId }
          : {}),
      });
      if (started === null) {
        return c.json(
          {
            error: 'AUTOMATION_NOT_DEPLOYED',
            message: 'No version to run — save a version and deploy it first.',
          },
          409,
        );
      }
      return c.json(started, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:name{.+}/versions', async (c) => {
    return c.json({
      versions: await listVersions(
        deps.sql,
        c.get('orgId'),
        nameFrom(c, 'versions'),
      ),
    });
  });

  app.get('/:name{.+}/triggers', async (c) => {
    return c.json({
      triggers: await listTriggers(
        deps.sql,
        c.get('orgId'),
        nameFrom(c, 'triggers'),
      ),
    });
  });

  app.delete('/:name{.+}', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    await deleteAutomationCascade(deps.sql, {
      organizationId: c.get('orgId'),
      name: nameFrom(c, ''),
      actor: c.get('sessionBundle').user.id,
    });
    return c.json({ deleted: true });
  });

  app.get('/:name{.+}', async (c) => {
    const name = nameFrom(c, '');
    const orgId = c.get('orgId');
    const deployed = await deployedVersion(deps.sql, orgId, name);
    const latest = (await listVersions(deps.sql, orgId, name))[0];
    if (!latest) {
      return c.json({ error: 'automation not found' }, 404);
    }
    const version = await versionRow(
      deps.sql,
      orgId,
      name,
      deployed ?? latest.version,
    );
    return c.json({
      name,
      latestVersion: latest.version,
      deployedVersion: deployed ?? null,
      document: version?.document ?? null,
      presentation: version?.presentation ?? null,
      settings: version?.settings ?? null,
    });
  });

  return app;
}
