import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { paramToAutomationSlug } from '../../lib/automations/slug.ts';
import { isValidAutomationName } from '../../lib/engine/core/validate/name.ts';
import {
  AutomationError,
  automationExists,
  beginRun,
  beginRunIdempotent,
  beginRunIdempotentInTx,
  beginRunInTx,
  bindingProjectIds,
  bindProjectInTx,
  cancelRun,
  cancelRunInTx,
  deleteAutomationCascade,
  deleteRunInTx,
  deleteTrigger,
  deployedVersion,
  getRun,
  type IdempotentStart,
  listAutomations,
  type ListRunsOptions,
  listRunsPage,
  listTriggers,
  listVersions,
  type RunRow,
  setTrigger,
  toRunSummary,
  unbindProjectInTx,
  versionRow,
} from '../domains/automations/store.ts';
import { listProjects } from '../domains/projects/service.ts';
import {
  chargeLane,
  domainErrorResponse,
  formatKeysetCursor,
  invalidQueryResponse,
  loadRestProject,
  mintCursor,
  noQuery,
  notFound,
  PAGE_QUERY,
  parseBody,
  queryFilter,
  readKeysetCursor,
  readPageLimit,
  readQuery,
  requireDeveloper,
  type RestEnv,
  restProjectAuth,
} from './shared.ts';

/**
 * Organization automation definitions and explicitly scoped run resources.
 * Project routes additionally enforce the key holder's project permissions;
 * global run routes expose only runs without a project — bar the all-runs
 * listing, which answers every run the key holder can see with the scope
 * of each row named.
 * Starting a run needs NO trigger row: the API key IS the entitlement,
 * which keeps the programmatic surface symmetric with the app.
 *
 * Authoring (save/deploy) deliberately has no REST route — 0.4 parity: the
 * builder writes ride the session surface.
 */

/** The run statuses a listing filters on. */
const RUN_STATUSES = [
  'queued',
  'running',
  'waiting',
  'success',
  'failed',
  'cancelled',
] as const;

/** The full-row fields a listing omits unless asked (`?include=`). */
const RUN_INCLUDES = [
  'input',
  'output',
  'trace',
  'effects',
  'checkpoints',
] as const;

/** The query every run listing takes: the page pair, a status set and the
 * full-row fields to inline. */
const RUN_LIST_QUERY = {
  ...PAGE_QUERY,
  status: queryFilter(128).optional(),
  include: queryFilter(128).optional(),
};

export function createAutomationRestRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  /** The automation the URL names (`__` for `/`) — or the 404 for a
   * segment that is not a name at all (`../../models`, five hundred
   * characters of garbage), so no query ever sees it. The answer is the
   * one an unknown automation gets: existence is not revealed either way.
   * The path is a SINGLE segment, and `__` is the only spelling of `/` in
   * it: a raw `billing/dunning` used to match a multi-segment pattern and
   * silently resolve to `billing` alone, and a `%2F` the router decodes
   * into the parameter used to resolve as an undocumented alias. */
  const decodeName = (c: Context<RestEnv>): string | Response => {
    const raw = c.req.param('name') ?? '';
    if (raw.includes('/')) {
      return notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');
    }
    const name = paramToAutomationSlug(raw);
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
  const triggerBody = z
    .object({
      kind: z.enum(['schedule', 'webhook', 'event']),
      cron: z.string().max(200).optional(),
      timezone: z.string().max(100).optional(),
      event: z.string().max(200).optional(),
      enabled: z.boolean().optional(),
      rotateToken: z.boolean().optional(),
    })
    .strict();

  /** Whether any version of the automation exists in this org — the
   * trigger and run doors answer 404 for a name nobody saved, never a
   * "bound" trigger or a "not deployed" refusal for a typo. */
  const exists = (c: Context<RestEnv>, name: string): Promise<boolean> =>
    automationExists(deps.sql, c.get('organizationId'), name);

  const automationNotFound = (c: Context<RestEnv>) =>
    notFound(c, 'Automation not found', 'AUTOMATION_NOT_FOUND');

  app.get('/automations', noQuery, async (c) => {
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
      if (!(await exists(c, name))) return automationNotFound(c);
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

  /** The version history, with the deployed one marked — a client used to
   * cross-reference the definition read to learn which entry is live. */
  app.get('/automations/:name/versions', noQuery, async (c) => {
    const name = decodeName(c);
    if (name instanceof Response) return name;
    if (!(await exists(c, name))) return automationNotFound(c);
    const organizationId = c.get('organizationId');
    const deployed =
      (await deployedVersion(deps.sql, organizationId, name)) ?? null;
    return c.json({
      name,
      deployedVersion: deployed,
      versions: (await listVersions(deps.sql, organizationId, name)).map(
        (row) => Object.assign(row, { deployed: row.version === deployed }),
      ),
    });
  });

  app.get('/automations/:name/triggers', noQuery, async (c) => {
    const name = decodeName(c);
    if (name instanceof Response) return name;
    if (!(await exists(c, name))) return automationNotFound(c);
    return c.json({
      name,
      triggers: await listTriggers(deps.sql, c.get('organizationId'), name),
    });
  });

  /** Bind what starts the automation. `token` is present exactly once per
   * minted webhook secret — the row keeps only its hash. */
  app.put('/automations/:name/triggers', async (c) => {
    const body = await parseBody(c, triggerBody);
    if (body instanceof Response) return body;
    try {
      requireDeveloper(c);
      const name = decodeName(c);
      if (name instanceof Response) return name;
      if (!(await exists(c, name))) return automationNotFound(c);
      const result = await setTrigger(deps.sql, {
        organizationId: c.get('organizationId'),
        name,
        trigger: body,
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
      if (!(await exists(c, name))) return automationNotFound(c);
      await deleteTrigger(deps.sql, c.get('organizationId'), name);
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/projects/:id/automations', noQuery, async (c) => {
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
        if (!(await automationExists(tx, auth.organizationId, name)))
          return null;
        return unbindProjectInTx(tx, {
          organizationId: auth.organizationId,
          name,
          projectId: project.id,
        });
      });
      if (result === null) return automationNotFound(c);
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
    const body = await parseBody(c, emptyBody, { optional: true });
    if (body instanceof Response) return body;
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
        if (!(await automationExists(tx, auth.organizationId, name)))
          return null;
        return bindProjectInTx(tx, {
          organizationId: auth.organizationId,
          name,
          projectId: project.id,
          actor: auth.userId,
        });
      });
      if (result === null) return automationNotFound(c);
      return c.json({ name, added: result.bound }, result.bound ? 201 : 200);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };

  // ---- run listings ------------------------------------------------------

  /** A comma-separated set parameter, each member one of `allowed`, or the
   * 400 naming every member that is not — an unknown status used to be a
   * silent unfiltered list. */
  const readSetQuery = (
    c: Context<RestEnv>,
    name: string,
    raw: string | undefined,
    allowed: readonly string[],
  ): string[] | undefined | Response => {
    if (raw === undefined) return undefined;
    const values = raw.split(',').map((value) => value.trim());
    const unknown = values.filter((value) => !allowed.includes(value));
    if (unknown.length > 0) {
      return invalidQueryResponse(
        c,
        'INVALID_QUERY',
        `invalid query: "${name}" takes ${allowed.join(', ')} (comma-separated), not "${unknown[0] ?? ''}"`,
        unknown.map((value) => ({
          path: name,
          message: `"${value}" is not one of ${allowed.join(', ')}`,
        })),
      );
    }
    return [...new Set(values)];
  };

  interface RunListQuery {
    statuses: string[] | undefined;
    include: string[];
    before: { at: number; id: string } | null;
    limit: number;
  }

  /** The query of a run listing, parsed and refused as one: the page pair
   * (`cursor` signed for `list`), the status set, the fields to inline. */
  const readRunListQuery = (
    c: Context<RestEnv>,
    list: string,
  ): RunListQuery | Response => {
    const query = readQuery(c, RUN_LIST_QUERY);
    if (query instanceof Response) return query;
    const statuses = readSetQuery(c, 'status', query.status, RUN_STATUSES);
    if (statuses instanceof Response) return statuses;
    const include = readSetQuery(c, 'include', query.include, RUN_INCLUDES);
    if (include instanceof Response) return include;
    const before = readKeysetCursor(c, list);
    if (before instanceof Response) return before;
    const limit = readPageLimit(c, { fallback: 50, max: 200 });
    if (limit instanceof Response) return limit;
    return { statuses, include: include ?? [], before, limit };
  };

  /** A listing row: the summary, plus the full-row fields the caller
   * asked for — exactly the values the single read answers. */
  const runListRow = (row: RunRow, include: readonly string[]) => ({
    ...toRunSummary(row),
    ...(include.includes('input') ? { input: row.input } : {}),
    ...(include.includes('output') ? { output: row.output } : {}),
    ...(include.includes('trace') ? { trace: row.trace } : {}),
    ...(include.includes('effects') ? { effects: row.effects } : {}),
    ...(include.includes('checkpoints')
      ? { checkpoints: row.checkpoints }
      : {}),
  });

  /** One page of runs in `scope`, newest first, as `{runs, isDone,
   * continueCursor}` — the cursor signed for `list`, so it redeems only on
   * the listing that answered it. */
  const answerRunPage = async (
    c: Context<RestEnv>,
    list: string,
    query: RunListQuery,
    scope: Pick<ListRunsOptions, 'name' | 'projectId' | 'visibleProjectIds'>,
  ) => {
    const page = await listRunsPage(deps.sql, c.get('organizationId'), {
      ...scope,
      ...(query.statuses === undefined ? {} : { statuses: query.statuses }),
      ...(query.before === null ? {} : { before: query.before }),
      limit: query.limit,
    });
    return c.json({
      runs: page.runs.map((row) => runListRow(row, query.include)),
      isDone: page.isDone,
      continueCursor:
        page.next === null
          ? ''
          : mintCursor(c, list, formatKeysetCursor(page.next.at, page.next.id)),
    });
  };

  /** One automation's runs inside exactly the URL scope. */
  const readRuns = async (c: Context<RestEnv>) => {
    try {
      const name = decodeName(c);
      if (name instanceof Response) return name;
      const projectId = c.req.param('id');
      const list = `runs:${projectId ?? 'org'}:${name}`;
      const query = readRunListQuery(c, list);
      if (query instanceof Response) return query;
      if (projectId !== undefined) {
        const auth = await restProjectAuth(deps.sql, c);
        await loadRestProject(deps.sql, auth, projectId);
      }
      if (!(await exists(c, name))) return automationNotFound(c);
      return answerRunPage(c, list, query, {
        name,
        projectId: projectId ?? null,
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };
  app.get('/automations/:name/runs', readRuns);
  app.get('/projects/:id/automations/:name/runs', readRuns);

  /** Every run the key holder can see, whatever started it: organization
   * runs and the runs of visible projects, each row naming its
   * `projectId` — the one listing a dashboard needs to answer "what failed
   * today" without walking every automation in both scopes. */
  app.get('/runs', async (c) => {
    try {
      const list = 'runs:all';
      const query = readRunListQuery(c, list);
      if (query instanceof Response) return query;
      const visible = await visibleProjectIds(c);
      return answerRunPage(c, list, query, {
        visibleProjectIds: [...visible],
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** Every run of the URL project, whatever automation ran. */
  app.get('/projects/:id/runs', async (c) => {
    try {
      const projectId = c.req.param('id') ?? '';
      const list = `runs:${projectId}`;
      const query = readRunListQuery(c, list);
      if (query instanceof Response) return query;
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadRestProject(deps.sql, auth, projectId);
      return answerRunPage(c, list, query, { projectId: project.id });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- run start ---------------------------------------------------------

  /** Start a run of the deployed version (or a named one). Answers 202 with
   * the run's identity; poll its detail URL in the same scope. A live
   * run can act on the organization's behalf, so it needs the developer
   * capability; a mock run reaches nothing outside the process. An
   * `Idempotency-Key` names the start: a repeat within a day answers the
   * run it already started (`duplicate: true`), a repeat with a different
   * body is refused. */
  const startRun = async (c: Context<RestEnv>) => {
    const body = await parseBody(c, runBody, { optional: true });
    if (body instanceof Response) return body;
    const mode = body.mode ?? 'live';
    const name = decodeName(c);
    if (name instanceof Response) return name;
    // A blank key is no key — the webhook door reads its delivery-id
    // headers the same way.
    const idempotencyKey = c.req.header('idempotency-key')?.trim() || undefined;
    try {
      // The capability gate before the lane charge: a caller the role
      // refuses must not spend the key holder's run-start budget.
      if (mode === 'live') requireDeveloper(c);
      const limited = await chargeLane(deps.sql, c, 'rest:execute');
      if (limited) return limited;
      const organizationId = c.get('organizationId');
      const projectId = c.req.param('id');
      const auth =
        projectId === undefined ? null : await restProjectAuth(deps.sql, c);
      if (auth !== null && projectId !== undefined) {
        await loadRestProject(deps.sql, auth, projectId, { write: true });
      }
      if (!(await exists(c, name))) return automationNotFound(c);
      if (body.version !== undefined) {
        const named = await versionRow(
          deps.sql,
          organizationId,
          name,
          body.version,
        );
        if (named === null) {
          return c.json(
            {
              error: `"${name}" has no version ${body.version}.`,
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
            body.version
        ) {
          return c.json(
            {
              error: `"${name}@${body.version}" is not the deployed version — deploy it first, or run it in mock mode.`,
              code: 'AUTOMATION_VERSION_NOT_DEPLOYED',
            },
            409,
          );
        }
      }
      const args = {
        organizationId,
        name,
        // An absent input is an empty one; a null input is the null the
        // caller sent, for the inputs schema to accept or refuse.
        input: body.input === undefined ? {} : body.input,
        mode,
        startedBy: `api-key:${c.get('userId')}`,
        ...(body.version !== undefined ? { version: body.version } : {}),
      };
      let started: IdempotentStart | null;
      if (auth !== null && projectId !== undefined) {
        started = await transactSerializable(deps.sql, async (tx) => {
          const project = await loadRestProject(tx, auth, projectId, {
            write: true,
          });
          const scoped = { ...args, projectId: project.id };
          if (idempotencyKey !== undefined) {
            return beginRunIdempotentInTx(tx, scoped, { key: idempotencyKey });
          }
          const fresh = await beginRunInTx(tx, scoped);
          return fresh === null ? null : { ...fresh, duplicate: false };
        });
      } else if (idempotencyKey !== undefined) {
        started = await beginRunIdempotent(
          deps.sql,
          { ...args, requireOrgScope: true },
          { key: idempotencyKey },
        );
      } else {
        const fresh = await beginRun(deps.sql, {
          ...args,
          requireOrgScope: true,
        });
        started = fresh === null ? null : { ...fresh, duplicate: false };
      }
      if (started === null) {
        return c.json(
          {
            error: `"${name}" has no version to run — save a version and deploy it first.`,
            code: 'AUTOMATION_NOT_DEPLOYED',
          },
          409,
        );
      }
      return c.json(
        {
          runId: started.runId,
          version: started.version,
          name,
          mode,
          ...(started.duplicate ? { duplicate: true } : {}),
        },
        202,
      );
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

  /** One version's document: the latest saved one by default, the deployed
   * one — the version a live run executes — with `?version=deployed`, or a
   * numbered one. An unknown version of a known automation is its own 404,
   * so a version-pinning client can tell "never saved" from "deleted". */
  app.get('/automations/:name', async (c) => {
    const query = readQuery(c, {
      version: z
        .string()
        .regex(
          /^(?:deployed|latest|[1-9]\d{0,8})$/,
          'must be "deployed", "latest" or a positive integer',
        )
        .optional(),
    });
    if (query instanceof Response) return query;
    const name = decodeName(c);
    if (name instanceof Response) return name;
    const organizationId = c.get('organizationId');
    const deployed = await deployedVersion(deps.sql, organizationId, name);
    let version: number | undefined;
    if (query.version === 'deployed') {
      if (deployed === undefined) {
        if (!(await exists(c, name))) return automationNotFound(c);
        return c.json(
          {
            error: `"${name}" has no deployed version — nothing is deployed. Read a saved version with ?version=latest or ?version=<n>, and deploy one for live runs.`,
            code: 'AUTOMATION_VERSION_UNKNOWN',
          },
          404,
        );
      }
      version = deployed;
    } else if (query.version !== undefined && query.version !== 'latest') {
      version = Number(query.version);
    }
    const row = await versionRow(deps.sql, organizationId, name, version);
    if (row === null) {
      if (version !== undefined && (await exists(c, name))) {
        return c.json(
          {
            error: `"${name}" has no version ${version}.`,
            code: 'AUTOMATION_VERSION_UNKNOWN',
          },
          404,
        );
      }
      return automationNotFound(c);
    }
    const visible = await visibleProjectIds(c);
    const projectIds = (
      await bindingProjectIds(deps.sql, organizationId, name)
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
  app.get('/runs/:runId', noQuery, readRun);
  app.get('/projects/:id/runs/:runId', noQuery, readRun);

  /** Stop a run at its next node boundary. A run that is not there is a
   * 404 — `{cancelled: false}` is reserved for a run that exists and had
   * already finished, so a mistyped id never reads as "nothing to cancel". */
  const stopRun = async (c: Context<RestEnv>) => {
    const body = await parseBody(c, emptyBody, { optional: true });
    if (body instanceof Response) return body;
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

  /** Remove a FINISHED run — its row, its questions, the delivery and
   * idempotency entries that pointed at it. Mirrors the stop route: the
   * developer capability, the project's write access, the URL scope. A run
   * still in flight is a 409 (`RUN_ACTIVE`); one that is not there, or not
   * in this scope, the same 404 every run door answers. */
  const deleteRun = async (c: Context<RestEnv>) => {
    try {
      requireDeveloper(c);
      const runId = c.req.param('runId') ?? '';
      const projectId = c.req.param('id');
      const organizationId = c.get('organizationId');
      const actor = c.get('userId');
      const auth =
        projectId === undefined ? null : await restProjectAuth(deps.sql, c);
      const result = await transactSerializable(deps.sql, async (tx) => {
        if (auth !== null && projectId !== undefined) {
          await loadRestProject(tx, auth, projectId, { write: true });
        }
        const run = await getRun(tx, organizationId, runId);
        if (run === null || run.projectId !== (projectId ?? null)) return null;
        return deleteRunInTx(tx, { organizationId, runId, actor });
      });
      if (result === null || !result.deleted) {
        return notFound(c, 'Run not found', 'RUN_NOT_FOUND');
      }
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };
  app.delete('/runs/:runId', deleteRun);
  app.delete('/projects/:id/runs/:runId', deleteRun);

  return app;
}
