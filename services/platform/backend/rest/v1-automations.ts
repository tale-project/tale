import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  beginRun,
  bindingProjectIds,
  cancelRun,
  deleteTrigger,
  deployedVersion,
  getRun,
  listAutomations,
  listRuns,
  listTriggers,
  listVersions,
  setAutomationProjects,
  setTrigger,
  versionRow,
} from '../domains/automations/store.ts';
import {
  assertReadable,
  loadProjectOrThrow,
} from '../domains/projects/service.ts';
import {
  chargeLane,
  domainErrorResponse,
  pageLimit,
  requireDeveloper,
  restProjectAuth,
  type RestEnv,
} from './shared.ts';

/**
 * /api/v1 automations + runs — the spec surface: reads for everyone in the
 * org, work-starting and authoring writes behind the developer capability.
 * Starting a run needs NO trigger row: the API key IS the entitlement,
 * which keeps the programmatic surface symmetric with the app.
 *
 * Authoring (save/deploy) deliberately has no REST route — 0.4 parity: the
 * builder writes ride the session surface.
 */

export function createAutomationRestRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  const decodeName = (c: Context<RestEnv>, suffix: string): string =>
    decodeURIComponent(
      (c.req.path.split('/api/v1/automations/')[1] ?? '').slice(
        0,
        suffix.length > 0 ? -suffix.length : undefined,
      ),
    );

  app.get('/automations', async (c) => {
    return c.json({
      automations: await listAutomations(deps.sql, c.get('organizationId')),
    });
  });

  app.get('/automations/:name{.+}/versions', async (c) => {
    const name = decodeName(c, '/versions');
    return c.json({
      name,
      versions: await listVersions(deps.sql, c.get('organizationId'), name),
    });
  });

  app.get('/automations/:name{.+}/triggers', async (c) => {
    const name = decodeName(c, '/triggers');
    return c.json({
      name,
      triggers: await listTriggers(deps.sql, c.get('organizationId'), name),
    });
  });

  /** Bind what starts the automation. `token` is present exactly once per
   * minted webhook secret — the row keeps only its hash. */
  app.put('/automations/:name{.+}/triggers', async (c) => {
    const body = z
      .object({
        kind: z.enum(['schedule', 'webhook', 'event']),
        cron: z.string().max(200).optional(),
        timezone: z.string().max(100).optional(),
        event: z.string().max(200).optional(),
        enabled: z.boolean().optional(),
        rotateToken: z.boolean().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: '"kind" must be one of: schedule, webhook, event' },
        400,
      );
    }
    try {
      requireDeveloper(c);
      const name = decodeName(c, '/triggers');
      const result = await setTrigger(deps.sql, {
        organizationId: c.get('organizationId'),
        name,
        trigger: body.data,
        actor: c.get('userId'),
      });
      return c.json({ name, ...result });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Unbind the automation's trigger. Versions and run history stay. */
  app.delete('/automations/:name{.+}/triggers', async (c) => {
    try {
      requireDeveloper(c);
      const name = decodeName(c, '/triggers');
      await deleteTrigger(deps.sql, c.get('organizationId'), name);
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Bind the automation to a project — the machine door's install step.
   * Idempotent single-project ADD; the target must exist in-org AND be
   * visible to the minting user (an invisible project reads as absent). */
  app.post('/automations/:name{.+}/projects', async (c) => {
    const body = z
      .object({ projectId: z.string().min(1).max(64) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body ("projectId" is required)' }, 400);
    }
    try {
      requireDeveloper(c);
      const name = decodeName(c, '/projects');
      const versions = await listVersions(
        deps.sql,
        c.get('organizationId'),
        name,
      );
      if (versions.length === 0) {
        return c.json({ error: 'Automation not found' }, 404);
      }
      const auth = await restProjectAuth(deps.sql, c);
      let project;
      try {
        project = await loadProjectOrThrow(deps.sql, body.data.projectId);
        assertReadable(project, auth);
      } catch {
        return c.json({ error: 'Project not found' }, 404);
      }
      if (project.organizationId !== c.get('organizationId')) {
        return c.json({ error: 'Project not found' }, 404);
      }
      const bound = await bindingProjectIds(
        deps.sql,
        c.get('organizationId'),
        name,
      );
      if (bound.includes(project.id)) {
        return c.json({ name, added: false });
      }
      await setAutomationProjects(deps.sql, {
        organizationId: c.get('organizationId'),
        name,
        projectIds: [...bound, project.id],
        actor: c.get('userId'),
      });
      return c.json({ name, added: true }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** The newest runs first — a bounded window (`limit` 1..200, default
   * 50), not a cursor walk; poll `GET /runs/{runId}` for one run. */
  app.get('/automations/:name{.+}/runs', async (c) => {
    const name = decodeName(c, '/runs');
    return c.json({
      runs: await listRuns(deps.sql, c.get('organizationId'), {
        name,
        limit: pageLimit(c.req.query('limit'), { fallback: 50, max: 200 }),
      }),
    });
  });

  /** Start a run of the deployed version (or a named one). Answers 202 with
   * the run's identity — the caller polls `GET /api/v1/runs/{runId}`. A live
   * run can act on the organization's behalf, so it needs the developer
   * capability; a mock run reaches nothing outside the process. */
  app.post('/automations/:name{.+}/runs', async (c) => {
    const limited = await chargeLane(deps.sql, c, 'rest:execute');
    if (limited) return limited;
    const body = z
      .object({
        input: z.unknown().optional(),
        mode: z.enum(['mock', 'live']).optional(),
        version: z.number().int().min(1).optional(),
        projectId: z.string().max(200).optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const mode = body.data.mode ?? 'live';
    try {
      if (mode === 'live') requireDeveloper(c);
      const name = decodeName(c, '/runs');
      const started = await beginRun(deps.sql, {
        organizationId: c.get('organizationId'),
        name,
        input: body.data.input ?? {},
        mode,
        startedBy: `api-key:${c.get('userId')}`,
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
            error: `"${name}" has no version to run — save a version and deploy it first.`,
            code: 'AUTOMATION_NOT_DEPLOYED',
          },
          409,
        );
      }
      return c.json({ ...started, name, mode }, 202);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** One version's document — the latest deployed-aware read. */
  app.get('/automations/:name{.+}', async (c) => {
    const name = decodeName(c, '');
    const versionParam = c.req.query('version');
    let version: number | undefined;
    if (versionParam !== undefined) {
      const parsed = Number(versionParam);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return c.json({ error: '"version" must be a positive integer' }, 400);
      }
      version = parsed;
    }
    const row = await versionRow(
      deps.sql,
      c.get('organizationId'),
      name,
      version,
    );
    if (row === null) return c.json({ error: 'Automation not found' }, 404);
    const deployed = await deployedVersion(
      deps.sql,
      c.get('organizationId'),
      name,
    );
    return c.json({
      name: row.name,
      version: row.version,
      document: row.document,
      ...(row.message !== undefined ? { message: row.message } : {}),
      ...(row.testsPassed !== undefined
        ? { testsPassed: row.testsPassed }
        : {}),
      ...(deployed !== undefined ? { deployedVersion: deployed } : {}),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    });
  });

  // ---- runs ----------------------------------------------------------------
  app.get('/runs/:runId', async (c) => {
    const run = await getRun(
      deps.sql,
      c.get('organizationId'),
      c.req.param('runId'),
    );
    if (run === null) return c.json({ error: 'Run not found' }, 404);
    return c.json(run);
  });

  app.post('/runs/:runId/cancel', async (c) => {
    try {
      requireDeveloper(c);
      return c.json(
        await cancelRun(
          deps.sql,
          c.get('organizationId'),
          c.req.param('runId'),
        ),
      );
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  return app;
}
