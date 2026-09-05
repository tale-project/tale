import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { registerConnector } from '../../../lib/connectors/registry.ts';
import { nodeTypes } from '../../../lib/engine/core/slots.ts';
import { AppError } from '../../../lib/shared/errors/app-error';
import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { runSessionWithStore } from '../../core/automations_builder/run_session.ts';
import { loadConnectorDefinitions } from '../../core/connector_credentials/connector_catalog.ts';
import { resolveWorkflowAgentServing } from '../../core/lib/providers/agent_serving.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { knowledgeShimHandlers } from '../knowledge/service.ts';
import { pgAutomationStore } from './dispatch-store.ts';
import { getOrgAutomationMetrics } from './metrics.ts';
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
  listAutomationsForApp,
  listRuns,
  listTriggers,
  listVersions,
  saveVersion,
  setAutomationProjects,
  setTrigger,
  versionRow,
  deployedVersion,
  bindingProjectIds,
} from './store.ts';
import { uploadAutomationPg } from './upload.ts';

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

const uploadSchema = z.object({
  projectId: z.string().min(1).max(128).optional(),
  files: z
    .array(z.object({ name: z.string().max(300), content: z.string() }))
    .max(8)
    .optional(),
  storageId: z.string().min(1).max(2_000).optional(),
  overwriteSkills: z.array(z.string().max(200)).max(50).optional(),
});

const startSchema = z.object({
  input: z.unknown().optional(),
  mode: z.enum(['mock', 'live']).optional(),
  version: z.number().int().min(1).optional(),
  // Capped like every other project-id door — beginRun validates it exists in
  // the org, so an uncapped bare string can neither run long nor misfile.
  projectId: z.string().min(1).max(128).optional(),
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
  // The shared upload lane refuses with the 0.4 `AppError({code,message})`
  // contract — surface it as the structured 4xx the dialog maps.
  if (error instanceof AppError) {
    const data: unknown = error.data;
    if (data !== null && typeof data === 'object') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object; string-typeof guards gate the reads
      const record = data as Record<string, unknown>;
      return c.json(
        {
          error: typeof record.code === 'string' ? record.code : 'REFUSED',
          message:
            typeof record.message === 'string'
              ? record.message
              : 'The request was refused.',
        },
        400,
      );
    }
  }
  throw error;
}

/** Agent nodes whose `model` is set but `modelProvider` is not — the
 * serving-preview banner's subjects (the 0.4 `unpinnedAgentNodeIds`). */
function unpinnedAgentNodeIds(document: unknown): string[] {
  if (
    document === null ||
    typeof document !== 'object' ||
    !('nodes' in document) ||
    !Array.isArray(document.nodes)
  ) {
    return [];
  }
  const ids: string[] = [];
  for (const node of document.nodes as unknown[]) {
    if (node === null || typeof node !== 'object') continue;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object; per-field typeof guards gate every read
    const record = node as Record<string, unknown>;
    if (record.type !== 'agent') continue;
    if (typeof record.model !== 'string' || record.model === '') continue;
    if (
      typeof record.modelProvider === 'string' &&
      record.modelProvider !== ''
    ) {
      continue;
    }
    if (typeof record.id === 'string') ids.push(record.id);
  }
  return ids;
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

  // The APP listing (0.4 wire): deployed-version behaviour fields + scope.
  app.get('/listing', async (c) => {
    const projectId = c.req.query('projectId');
    return c.json({
      automations: await listAutomationsForApp(deps.sql, c.get('orgId'), {
        ...(projectId !== undefined ? { projectId } : {}),
        includeProjectBound: c.req.query('includeProjectBound') === 'true',
      }),
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

  /** Node-type catalog (the 0.4 `catalog.listNodeTypes` — connector types
   * only; the editor folds its own core floor over these). */
  app.get('/catalog/node-types', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    for (const connector of loadConnectorDefinitions()) {
      registerConnector(connector);
    }
    const summaries = [];
    for (const def of nodeTypes().values()) {
      if (def.kind !== 'connector') continue;
      summaries.push({
        type: def.type,
        kind: def.kind,
        description: def.description,
        allowedFields: [...def.allowedFields],
        requiredFields: [...def.requiredFields],
        outputKind: def.outputKind,
        hasEffect: def.connector?.hasEffect ?? false,
      });
    }
    summaries.sort((a, b) => a.type.localeCompare(b.type));
    return c.json({ nodeTypes: summaries });
  });

  /** Run KPIs for the metrics page (member-readable, like the 0.4 query). */
  app.get('/metrics', async (c) => {
    const periodRaw = Number(c.req.query('periodDays') ?? '7');
    const periodDays =
      periodRaw === 30
        ? (30 as const)
        : periodRaw === 90
          ? (90 as const)
          : (7 as const);
    const modeRaw = c.req.query('mode');
    return c.json(
      await getOrgAutomationMetrics(deps.sql, c.get('orgId'), {
        periodDays,
        ...(modeRaw === 'mock' || modeRaw === 'live' ? { mode: modeRaw } : {}),
      }),
    );
  });

  /** The manual package upload (text or staged-zip lane). */
  app.post('/upload', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = uploadSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await resolveOrgSlug(deps.sql, c.get('orgId'));
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    try {
      return c.json(
        await uploadAutomationPg(
          deps.sql,
          {
            organizationId: c.get('orgId'),
            orgSlug,
            userId: c.get('sessionBundle').user.id,
            role: c.get('orgMember').role,
          },
          body.data,
        ),
      );
    } catch (error) {
      return handleError(c, error);
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
    try {
      return c.json(
        await cancelRun(deps.sql, c.get('orgId'), c.req.param('runId')),
      );
    } catch (error) {
      // cancelRun is now a terminal door (audit row + session stop) — surface
      // a rare terminal-write failure structured rather than as a bare 500.
      return handleError(c, error);
    }
  });

  app.get('/runs/:runId', async (c) => {
    const run = await getRun(deps.sql, c.get('orgId'), c.req.param('runId'));
    return run === null
      ? c.json({ error: 'run not found' }, 404)
      : c.json({ run });
  });

  app.get('/runs', async (c) => {
    const name = c.req.query('name');
    const projectId = c.req.query('projectId');
    const limitRaw = Number(c.req.query('limit') ?? '50');
    return c.json({
      runs: await listRuns(deps.sql, c.get('orgId'), {
        ...(name !== undefined ? { name } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
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
   * `projectId` pins the first save to that project via the store scope. An
   * aborted request cancels the session at its next turn boundary.
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
          // A closed tab, a reload or a dropped connection aborts the request;
          // the session sees it at its next turn boundary and ends as
          // `cancelled` instead of spending model turns nobody will read.
          isCancelled: () => c.req.raw.signal.aborted,
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

  app.get('/:name{.+}/projects', async (c) => {
    return c.json({
      projectIds: await bindingProjectIds(
        deps.sql,
        c.get('orgId'),
        nameFrom(c, 'projects'),
      ),
    });
  });

  app.delete('/:name{.+}', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    try {
      await deleteAutomationCascade(deps.sql, {
        organizationId: c.get('orgId'),
        name: nameFrom(c, ''),
        actor: c.get('sessionBundle').user.id,
      });
    } catch (error) {
      // The active-run guard refuses with a coded 409 the dialog surfaces.
      return handleError(c, error);
    }
    return c.json({ deleted: true });
  });

  // The 0.4 `getAutomation`: version omitted = the LATEST saved one (never
  // silently the deployed one); the unpinned-agent warning reads the
  // DEPLOYED version's document, which need not be the loaded one.
  app.get('/:name{.+}', async (c) => {
    const name = nameFrom(c, '');
    const orgId = c.get('orgId');
    const versionParam = Number(c.req.query('version') ?? Number.NaN);
    const row = await versionRow(
      deps.sql,
      orgId,
      name,
      Number.isFinite(versionParam) ? versionParam : undefined,
    );
    if (!row) {
      return c.json({ error: 'automation not found' }, 404);
    }
    const deployed = await deployedVersion(deps.sql, orgId, name);
    const deployedRow =
      deployed === null
        ? null
        : deployed === row.version
          ? row
          : await versionRow(deps.sql, orgId, name, deployed);
    const unpinned =
      deployedRow === null ? [] : unpinnedAgentNodeIds(deployedRow.document);
    return c.json({
      name: row.name,
      version: row.version,
      document: row.document,
      ...(row.message !== null ? { message: row.message } : {}),
      ...(row.testsPassed !== null ? { testsPassed: row.testsPassed } : {}),
      ...(row.presentation !== null && row.presentation !== undefined
        ? { presentation: row.presentation }
        : {}),
      ...(row.settings !== null && row.settings !== undefined
        ? { settings: row.settings }
        : {}),
      ...(deployed !== null ? { deployedVersion: deployed } : {}),
      ...(unpinned.length > 0 ? { deployedUnpinnedAgentNodes: unpinned } : {}),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    });
  });

  return app;
}
