import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { paramToAutomationSlug } from '../../lib/automations/slug.ts';
import { isValidAutomationName } from '../../lib/engine/core/validate/name.ts';
import {
  AutomationError,
  beginRun,
  beginRunInTx,
  bindingProjectIds,
  bindProjectInTx,
  cancelRun,
  cancelRunInTx,
  deleteAutomationCascade,
  deleteTrigger,
  deployedVersion,
  getRun,
  listAutomations,
  listRuns,
  listTriggers,
  listVersions,
  setTrigger,
  unbindProjectInTx,
  versionRow,
} from '../domains/automations/store.ts';
import { listProjects } from '../domains/projects/service.ts';
import {
  assertExplicitOrg,
  chargeLane,
  domainErrorResponse,
  invalidBodyResponse,
  invalidQueryResponse,
  loadRestProject,
  notFound,
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

  /** The automation the URL names (`__` for `/`) — or the 404 for a
   * segment that is not a name at all (`../../models`, five hundred
   * characters of garbage), so no query ever sees it. The answer is the
   * one an unknown automation gets: existence is not revealed either way.
   * The path is a SINGLE segment: a raw `billing/dunning` used to match a
   * multi-segment pattern and silently resolve to `billing` alone. */
  const decodeName = (c: Context<RestEnv>): string | Response => {
    const name = paramToAutomationSlug(c.req.param('name') ?? '');
    return isValidAutomationName(name)
      ? name
      : notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
  };
  const emptyBody = z.object({}).strict();

  /** The projects the key holder may see, archived ones included — the
   * filter every binding listing goes through, so a catalog read never
   * reveals a hidden project's installations. */
  const visibleProjectIds = async (
    c: Context<RestEnv>,
  ): Promise<Set<string>> => {
    const auth = await restProjectAuth(deps.sql, c);
    return new Set(
      (await listProjects(deps.sql, auth, { includeArchived: true })).map(
        (project) => project.id,
      ),
    );
  };
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
    // Definitions are shared by the organization. Their project install
    // ids are the caller's only way to start a project-bound automation
    // (the org URL refuses it) — answered as the projects the caller can
    // SEE, so a catalog read never reveals a hidden project.
    const visible = await visibleProjectIds(c);
    return c.json({
      automations: (
        await listAutomations(deps.sql, c.get('organizationId'))
      ).map((definition) =>
        Object.assign(definition, {
          projectIds: definition.projectIds.filter((id) => visible.has(id)),
        }),
      ),
    });
  });

  /** Retire an automation: every version, its trigger, its installations.
   * A run still in flight refuses the delete (409) — the stepper needs the
   * versions it would remove. */
  app.delete('/automations/:name', async (c) => {
    try {
      requireDeveloper(c);
      const name = decodeName(c);
      if (name instanceof Response) return name;
      if (!(await automationExists(c, name))) {
        return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
      }
      await deleteAutomationCascade(deps.sql, {
        organizationId: c.get('organizationId'),
        name,
        actor: c.get('userId'),
      });
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/automations/:name/versions', async (c) => {
    const name = decodeName(c);
    if (name instanceof Response) return name;
    if (!(await automationExists(c, name))) {
      return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
    }
    return c.json({
      name,
      versions: await listVersions(deps.sql, c.get('organizationId'), name),
    });
  });

  app.get('/automations/:name/triggers', async (c) => {
    const name = decodeName(c);
    if (name instanceof Response) return name;
    if (!(await automationExists(c, name))) {
      return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
    }
    return c.json({
      name,
      triggers: await listTriggers(deps.sql, c.get('organizationId'), name),
    });
  });

  /** Bind what starts the automation. `token` is present exactly once per
   * minted webhook secret — the row keeps only its hash. */
  app.put('/automations/:name/triggers', async (c) => {
    const body = z
      .object({
        kind: z.enum(['schedule', 'webhook', 'event']),
        cron: z.string().max(200).optional(),
        timezone: z.string().max(100).optional(),
        event: z.string().max(200).optional(),
        enabled: z.boolean().optional(),
        rotateToken: z.boolean().optional(),
      })
      .strict()
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      requireDeveloper(c);
      const name = decodeName(c);
      if (name instanceof Response) return name;
      if (!(await automationExists(c, name))) {
        return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
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
  app.delete('/automations/:name/triggers', async (c) => {
    try {
      requireDeveloper(c);
      const name = decodeName(c);
      if (name instanceof Response) return name;
      if (!(await automationExists(c, name))) {
        return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
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
      const visible = await visibleProjectIds(c);
      return c.json({
        automations: (await listAutomations(deps.sql, auth.organizationId))
          .filter((definition) => definition.projectIds.includes(project.id))
          .map((definition) =>
            Object.assign(definition, {
              projectIds: definition.projectIds.filter((id) => visible.has(id)),
            }),
          ),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Uninstall from the URL project — the inverse of the install: the
   * binding goes, the definition, its other installations and its run
   * history stay. 404 when the automation is unknown or not installed here. */
  app.delete('/projects/:id/automations/:name', async (c) => {
    try {
      requireDeveloper(c);
      const name = decodeName(c);
      if (name instanceof Response) return name;
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
        return unbindProjectInTx(tx, {
          organizationId: auth.organizationId,
          name,
          projectId: project.id,
        });
      });
      if (result === null) {
        return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
      }
      if (!result.unbound) {
        return notFound(
          c,
          `"${name}" is not installed in this project`,
          'AUTOMATION_NOT_INSTALLED',
        );
      }
      return c.body(null, 204);
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
      if (name instanceof Response) return name;
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
        return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
      }
      return c.json({ name, added: result.bound }, result.bound ? 201 : 200);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };

  /** A bounded window inside exactly the URL scope. */
  const readRuns = async (c: Context<RestEnv>) => {
    try {
      const name = decodeName(c);
      if (name instanceof Response) return name;
      const projectId = c.req.param('id');
      if (projectId !== undefined) {
        const auth = await restProjectAuth(deps.sql, c);
        await loadRestProject(deps.sql, auth, projectId);
      }
      if (!(await automationExists(c, name))) {
        return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
      }
      const limit = readPageLimit(c, { fallback: 50, max: 200 });
      if (limit instanceof Response) return limit;
      return c.json({
        runs: await listRuns(deps.sql, c.get('organizationId'), {
          name,
          projectId: projectId ?? null,
          limit,
        }),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };
  app.get('/automations/:name/runs', readRuns);
  app.get('/projects/:id/automations/:name/runs', readRuns);

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
    const name = decodeName(c);
    if (name instanceof Response) return name;
    try {
      if (mode === 'live') requireDeveloper(c);
      const organizationId = c.get('organizationId');
      const projectId = c.req.param('id');
      const auth =
        projectId === undefined ? null : await restProjectAuth(deps.sql, c);
      if (auth !== null && projectId !== undefined) {
        await loadRestProject(deps.sql, auth, projectId, { write: true });
      }
      if (!(await automationExists(c, name))) {
        return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
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
      // The refusal names its precondition: the projects this automation
      // is installed in (those the caller can see), so the recovery —
      // start it at `/api/v1/projects/{id}/automations/{name}/runs` — is
      // in the answer rather than only in the product UI.
      if (
        error instanceof AutomationError &&
        error.code === 'AUTOMATION_PROJECT_SCOPE_REQUIRED'
      ) {
        const visible = await visibleProjectIds(c);
        const projectIds = (
          await bindingProjectIds(deps.sql, c.get('organizationId'), name)
        ).filter((id) => visible.has(id));
        return c.json(
          { error: error.message, code: error.code, data: { projectIds } },
          409,
        );
      }
      return domainErrorResponse(c, error);
    }
  };
  app.post('/automations/:name/runs', startRun);
  app.post('/projects/:id/automations/:name/runs', startRun);
  app.post('/projects/:id/automations/:name', installAutomation);

  /** One version's document — the latest deployed-aware read. */
  app.get('/automations/:name', async (c) => {
    const name = decodeName(c);
    if (name instanceof Response) return name;
    const versionParam = c.req.query('version');
    let version: number | undefined;
    if (versionParam !== undefined) {
      const parsed = Number(versionParam);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return invalidQueryResponse(
          c,
          'INVALID_QUERY',
          'invalid query: "version" must be a positive integer',
          [{ path: 'version', message: 'must be a positive integer' }],
        );
      }
      version = parsed;
    }
    const row = await versionRow(
      deps.sql,
      c.get('organizationId'),
      name,
      version,
    );
    if (row === null)
      return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
    const deployed = await deployedVersion(
      deps.sql,
      c.get('organizationId'),
      name,
    );
    const visible = await visibleProjectIds(c);
    const projectIds = (
      await bindingProjectIds(deps.sql, c.get('organizationId'), name)
    ).filter((id) => visible.has(id));
    return c.json({
      name: row.name,
      version: row.version,
      document: row.document,
      ...(row.message !== undefined ? { message: row.message } : {}),
      ...(row.testsPassed !== undefined
        ? { testsPassed: row.testsPassed }
        : {}),
      // One spelling of "nothing deployed" on both the listing and this
      // read: null, never an absent key.
      deployedVersion: deployed ?? null,
      projectIds,
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
        return notFound(c, 'Run not found', 'RUN_NOT_FOUND');
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
    const body = emptyBody.safeParse(await readOptionalJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
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
          ? notFound(c, 'Run not found', 'RUN_NOT_FOUND')
          : c.json(result);
      }
      const run = await getRun(deps.sql, c.get('organizationId'), runId);
      if (run === null || run.projectId !== null) {
        return notFound(c, 'Run not found', 'RUN_NOT_FOUND');
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
