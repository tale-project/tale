import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { paramToAutomationSlug } from '../../lib/automations/slug.ts';
import {
  beginRun,
  beginRunInTx,
  bindProjectInTx,
  cancelRun,
  cancelRunInTx,
  deleteTrigger,
  deployedVersion,
  getRun,
  listAutomations,
  listRuns,
  listTriggers,
  listVersions,
  setTrigger,
  versionRow,
} from '../domains/automations/store.ts';
import {
  assertExplicitOrg,
  chargeLane,
  domainErrorResponse,
  invalidBodyResponse,
  loadRestProject,
  readJsonBody,
  readOptionalJsonBody,
  readPageLimit,
  requireDeveloper,
  type RestEnv,
  restProjectAuth,
} from './shared.ts';

/**
 * Organization automation definitions and explicitly scoped run resources.
 * Project routes additionally enforce the key holder's project permissions;
 * global run routes expose only runs without a project.
 * Starting a run needs NO trigger row: the API key IS the entitlement,
 * which keeps the programmatic surface symmetric with the app.
 *
 * Authoring (save/deploy) deliberately has no REST route — 0.4 parity: the
 * builder writes ride the session surface.
 */

export function createAutomationRestRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  const decodeName = (c: Context<RestEnv>): string =>
    paramToAutomationSlug(c.req.param('name') ?? '');
  const emptyBody = z.object({}).strict();
  const runBody = z
    .object({
      input: z.unknown().optional(),
      mode: z.enum(['mock', 'live']).optional(),
      version: z.number().int().min(1).optional(),
    })
    .strict();

  app.use('/projects/*', async (c, next) => {
    const ambiguous = await assertExplicitOrg(deps.sql, c);
    if (ambiguous) return ambiguous;
    return next();
  });

  /** Whether any version of the automation exists in this org — the
   * trigger and run doors answer 404 for a name nobody saved, never a
   * "bound" trigger or a "not deployed" refusal for a typo. */
  const automationExists = async (
    c: Context<RestEnv>,
    name: string,
  ): Promise<boolean> =>
    (await versionRow(deps.sql, c.get('organizationId'), name, undefined)) !==
    null;

  app.get('/automations', async (c) => {
    return c.json({
      // Definitions are shared by the organization. Their project install
      // ids are not: a catalog read must not reveal hidden projects.
      automations: (
        await listAutomations(deps.sql, c.get('organizationId'))
      ).map(({ projectIds: _projectIds, ...definition }) => definition),
    });
  });

  app.get('/automations/:name{.+?}/versions', async (c) => {
    const name = decodeName(c);
    return c.json({
      name,
      versions: await listVersions(deps.sql, c.get('organizationId'), name),
    });
  });

  app.get('/automations/:name{.+?}/triggers', async (c) => {
    const name = decodeName(c);
    return c.json({
      name,
      triggers: await listTriggers(deps.sql, c.get('organizationId'), name),
    });
  });

  /** Bind what starts the automation. `token` is present exactly once per
   * minted webhook secret — the row keeps only its hash. */
  app.put('/automations/:name{.+?}/triggers', async (c) => {
    const body = z
      .object({
        kind: z.enum(['schedule', 'webhook', 'event']),
        cron: z.string().max(200).optional(),
        timezone: z.string().max(100).optional(),
        event: z.string().max(200).optional(),
        enabled: z.boolean().optional(),
        rotateToken: z.boolean().optional(),
      })
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return c.json(
        { error: '"kind" must be one of: schedule, webhook, event' },
        400,
      );
    }
    try {
      requireDeveloper(c);
      const name = decodeName(c);
      if (!(await automationExists(c, name))) {
        return c.json({ error: 'Automation not found' }, 404);
      }
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

  /** Unbind the automation's trigger — idempotent for an automation that
   * exists (204 whether or not a trigger was bound); an unknown name is a
   * 404, so a typo never reads as "unbound". Versions and run history stay. */
  app.delete('/automations/:name{.+?}/triggers', async (c) => {
    try {
      requireDeveloper(c);
      const name = decodeName(c);
      if (!(await automationExists(c, name))) {
        return c.json({ error: 'Automation not found' }, 404);
      }
      await deleteTrigger(deps.sql, c.get('organizationId'), name);
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/projects/:id/automations', async (c) => {
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadRestProject(deps.sql, auth, c.req.param('id'));
      return c.json({
        automations: (await listAutomations(deps.sql, auth.organizationId))
          .filter((definition) => definition.projectIds.includes(project.id))
          .map(({ projectIds: _projectIds, ...definition }) => definition),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Idempotent install into the URL project; authorization and binding
   * share one transaction, and no caller can override the scope in JSON. */
  const installAutomation = async (c: Context<RestEnv>) => {
    const body = emptyBody.safeParse(await readOptionalJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      requireDeveloper(c);
      const name = decodeName(c);
      const auth = await restProjectAuth(deps.sql, c);
      const result = await transactSerializable(deps.sql, async (tx) => {
        const project = await loadRestProject(
          tx,
          auth,
          c.req.param('id') ?? '',
          { write: true },
        );
        if (
          (await versionRow(tx, auth.organizationId, name, undefined)) === null
        )
          return null;
        return bindProjectInTx(tx, {
          organizationId: auth.organizationId,
          name,
          projectId: project.id,
          actor: auth.userId,
        });
      });
      if (result === null) {
        return c.json({ error: 'Automation not found' }, 404);
      }
      return c.json({ name, added: result.bound }, result.bound ? 201 : 200);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };

  /** A bounded window inside exactly the URL scope. */
  const readRuns = async (c: Context<RestEnv>) => {
    try {
      const projectId = c.req.param('id');
      if (projectId !== undefined) {
        const auth = await restProjectAuth(deps.sql, c);
        await loadRestProject(deps.sql, auth, projectId);
      }
      const limit = readPageLimit(c, { fallback: 50, max: 200 });
      if (limit instanceof Response) return limit;
      return c.json({
        runs: await listRuns(deps.sql, c.get('organizationId'), {
          name: decodeName(c),
          projectId: projectId ?? null,
          limit,
        }),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };
  app.get('/automations/:name{.+?}/runs', readRuns);
  app.get('/projects/:id/automations/:name{.+?}/runs', readRuns);

  /** Start a run of the deployed version (or a named one). Answers 202 with
   * the run's identity; poll its detail URL in the same scope. A live
   * run can act on the organization's behalf, so it needs the developer
   * capability; a mock run reaches nothing outside the process. */
  const startRun = async (c: Context<RestEnv>) => {
    const limited = await chargeLane(deps.sql, c, 'rest:execute');
    if (limited) return limited;
    const body = runBody.safeParse(await readOptionalJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    const mode = body.data.mode ?? 'live';
    try {
      if (mode === 'live') requireDeveloper(c);
      const name = decodeName(c);
      const organizationId = c.get('organizationId');
      const projectId = c.req.param('id');
      const auth =
        projectId === undefined ? null : await restProjectAuth(deps.sql, c);
      if (auth !== null && projectId !== undefined) {
        await loadRestProject(deps.sql, auth, projectId, { write: true });
      }
      if (!(await automationExists(c, name))) {
        return c.json({ error: 'Automation not found' }, 404);
      }
      if (body.data.version !== undefined) {
        const named = await versionRow(
          deps.sql,
          organizationId,
          name,
          body.data.version,
        );
        if (named === null) {
          return c.json(
            {
              error: `"${name}" has no version ${body.data.version}.`,
              code: 'AUTOMATION_VERSION_UNKNOWN',
            },
            404,
          );
        }
        // The deploy gate holds on this door too: a LIVE run acts on the
        // organization's behalf, so it may only run the version the gate
        // promoted. Naming any saved version is the mock lane's privilege —
        // the builder's test run, which reaches nothing outside the process.
        if (
          mode === 'live' &&
          (await deployedVersion(deps.sql, organizationId, name)) !==
            body.data.version
        ) {
          return c.json(
            {
              error: `"${name}@${body.data.version}" is not the deployed version — deploy it first, or run it in mock mode.`,
              code: 'AUTOMATION_VERSION_NOT_DEPLOYED',
            },
            409,
          );
        }
      }
      const args = {
        organizationId: c.get('organizationId'),
        name,
        input: body.data.input ?? {},
        mode,
        startedBy: `api-key:${c.get('userId')}`,
        ...(body.data.version !== undefined
          ? { version: body.data.version }
          : {}),
      };
      const started =
        auth !== null && projectId !== undefined
          ? await transactSerializable(deps.sql, async (tx) => {
              const project = await loadRestProject(tx, auth, projectId, {
                write: true,
              });
              return beginRunInTx(tx, { ...args, projectId: project.id });
            })
          : await beginRun(deps.sql, { ...args, requireOrgScope: true });
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
  };
  app.post('/automations/:name{.+?}/runs', startRun);
  app.post('/projects/:id/automations/:name{.+?}/runs', startRun);
  app.post('/projects/:id/automations/:name{.+?}', installAutomation);

  /** One version's document — the latest deployed-aware read. */
  app.get('/automations/:name{.+?}', async (c) => {
    const name = decodeName(c);
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
  const readRun = async (c: Context<RestEnv>) => {
    try {
      const projectId = c.req.param('id');
      if (projectId !== undefined) {
        const auth = await restProjectAuth(deps.sql, c);
        await loadRestProject(deps.sql, auth, projectId);
      }
      const run = await getRun(
        deps.sql,
        c.get('organizationId'),
        c.req.param('runId') ?? '',
      );
      if (run === null || run.projectId !== (projectId ?? null))
        return c.json({ error: 'Run not found' }, 404);
      return c.json(run);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };
  app.get('/runs/:runId', readRun);
  app.get('/projects/:id/runs/:runId', readRun);

  /** Stop a run at its next node boundary. A run that is not there is a
   * 404 — `{cancelled: false}` is reserved for a run that exists and had
   * already finished, so a mistyped id never reads as "nothing to cancel". */
  const stopRun = async (c: Context<RestEnv>) => {
    if (!emptyBody.safeParse(await readOptionalJsonBody(c)).success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      requireDeveloper(c);
      const runId = c.req.param('runId') ?? '';
      const projectId = c.req.param('id');
      if (projectId !== undefined) {
        const auth = await restProjectAuth(deps.sql, c);
        const result = await transactSerializable(deps.sql, async (tx) => {
          await loadRestProject(tx, auth, projectId, { write: true });
          const run = await getRun(tx, auth.organizationId, runId);
          if (run === null || run.projectId !== projectId) return null;
          return cancelRunInTx(tx, auth.organizationId, runId);
        });
        return result === null
          ? c.json({ error: 'Run not found' }, 404)
          : c.json(result);
      }
      const run = await getRun(deps.sql, c.get('organizationId'), runId);
      if (run === null || run.projectId !== null) {
        return c.json({ error: 'Run not found' }, 404);
      }
      return c.json(await cancelRun(deps.sql, c.get('organizationId'), runId));
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };
  app.post('/runs/:runId/cancel', stopRun);
  app.post('/projects/:id/runs/:runId/cancel', stopRun);

  return app;
}
