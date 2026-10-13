import { REPLAY_KINDS } from '@tale/shared/automation-replay';
import { appReplayRequestSchema } from '@tale/shared/schemas/automation-replay';
import { templateAnswersSchema } from '@tale/shared/schemas/automation-template';
import { triggerWriteSchema } from '@tale/shared/schemas/automation-trigger';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { registerConnector } from '../../../lib/connectors/registry.ts';
import { dispatch } from '../../../lib/engine/api/dispatch.ts';
import { nodeTypes } from '../../../lib/engine/core/slots.ts';
import type { Automation } from '../../../lib/engine/core/types.ts';
import { validate } from '../../../lib/engine/core/validate/index.ts';
import { AppError } from '../../../lib/shared/errors/app-error';
import {
  benchOversize,
  runBenchSchema,
} from '../../../lib/shared/schemas/automation-bench.ts';
import type { NodeTypeCatalog } from '../../../lib/shared/schemas/node-type-catalog.ts';
import { jsonBytes } from '../../../lib/shared/utils/json-bytes.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminOrDeveloperRole, isAdminRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { assembleAutomationAuthoringHost } from '../../core/automations/authoring_host.ts';
import {
  connectorIconUrl,
  findConnector,
  loadConnectorDefinitions,
} from '../../core/connector_credentials/connector_catalog.ts';
import { resolveWorkflowAgentServing } from '../../core/lib/providers/agent_serving.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import {
  invalidBodyIssuesResponse,
  invalidBodyResponse,
} from '../../lib/invalid-body-response.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import { RateLimitExceededError } from '../../lib/rate-limit.ts';
import { appOrigin, type WriteOrigin } from '../../lib/write-origin.ts';
import { knowledgeShimHandlers } from '../knowledge/service.ts';
import {
  getProjectAuthContext,
  assertWritable,
  ProjectError,
} from '../projects/service.ts';
import { SKILL_ERROR_STATUS } from '../skills/errors.ts';
import { auditIfPublishRefused } from '../skills/publish.ts';
import {
  readApprovalAllowanceRows,
  setApprovalAllowances,
} from './approval-allowances.ts';
import { refusalDataOf } from './authoring-refusal.ts';
import { admitBenchRuns, runTestsByHand, tryRun } from './bench.ts';
import {
  deploymentEventWire,
  listDeploymentEvents,
  liveDeploymentWire,
} from './deployments.ts';
import { pgAutomationStore } from './dispatch-store.ts';
import { legacyRunStopSchema } from './legacy-quarantine.ts';
import {
  managedAutomationKindSchema,
  managedAutomationWriteSchema,
  readManagedAutomation,
  writeManagedAutomation,
} from './managed-configuration';
import { getOrgAutomationMetrics } from './metrics.ts';
import {
  readOpenInDoubt,
  resolveInDoubtInTx,
  type InDoubtAttempt,
} from './node-attempts.ts';
import {
  canReadRun,
  readableProject,
  readableProjectIds,
  runControlAccess,
} from './project-visibility.ts';
import { readReplayPlan, replayRunInTx } from './replay.ts';
import {
  readNodeDetail,
  readNodePage,
  readRunComparison,
  readRunRecord,
} from './run-record.ts';
import {
  AutomationError,
  answerAsk,
  recordTestVerdict,
  automationTombstone,
  beginRun,
  cancelRun,
  requestLegacyRunStopInTx,
  deleteAutomationCascade,
  deleteTrigger,
  getAskRunId,
  getPendingAskForRun,
  getRun,
  listAutomationsForApp,
  listRuns,
  listRunsPage,
  listTriggerRuns,
  listTriggers,
  saveVersion,
  setAutomationProjects,
  setTrigger,
  toRunDetail,
  toRunSummary,
  triggerBodyRefusal,
  versionRow,
  deployedVersion,
  bindingProjectIds,
  type DeployResult,
  type SavedVersion,
} from './store.ts';
import { listTemplateCards, prepareTemplateInstance } from './templates.ts';
import { uploadAutomationPg } from './upload.ts';
import {
  listVersionHistory,
  readTestReport,
  versionHistoryWire,
} from './versions.ts';

/**
 * The open in-doubt write as the app reads it: the ledger's attempt, plus
 * the connector it was sending to in words — its display name from the
 * shipped catalog, or its slug once nothing ships it — and the action.
 */
function describeInDoubt(attempt: InDoubtAttempt) {
  const separator = attempt.nodeType.indexOf('.');
  const slug =
    separator > 0 ? attempt.nodeType.slice(0, separator) : attempt.nodeType;
  const action = separator > 0 ? attempt.nodeType.slice(separator + 1) : '';
  return {
    ...attempt,
    connector: findConnector(slug)?.displayName ?? slug,
    action,
  };
}

/**
 * /api/app/automations — the automation store surface: immutable versions,
 * explicit deploys behind the tests gate, name-bound triggers/bindings, and
 * the durable runs (start manual runs, watch them, cancel them). Authoring
 * writes and live runs need the admin/developer role; mock runs and reads
 * are member surfaces, mirroring the 0.4 gates.
 */

/** The largest draft a run that is never stored takes, as UTF-8 JSON. */
const BENCH_DOCUMENT_BYTES_MAX = 1_048_576;

/** A try: the draft or a saved version, the input it runs with, and what
 * stands in for some of its nodes (a test's or a step test's stand-ins). */
const trySchema = z
  .object({
    document: z.unknown().optional(),
    version: z.number().int().min(1).optional(),
    input: z.unknown().optional(),
    bench: runBenchSchema.optional(),
  })
  .strict();

/** Tests run by hand: those of the draft or of a saved version, all of
 * them or those named by their place, with each run's detail by default. */
const runTestsSchema = z
  .object({
    document: z.unknown().optional(),
    version: z.number().int().min(1).optional(),
    tests: z.array(z.number().int().min(0).max(49)).max(50).optional(),
    detail: z.boolean().optional(),
  })
  .strict();

/** The part of a bench request past what a door takes; null when it fits. */
function oversizedPart(body: {
  document?: unknown;
  bench?: { mocks?: Record<string, unknown> } | undefined;
}): { field: string; limitBytes: number } | null {
  if (
    body.document !== undefined &&
    jsonBytes(body.document) > BENCH_DOCUMENT_BYTES_MAX
  ) {
    return { field: 'document', limitBytes: BENCH_DOCUMENT_BYTES_MAX };
  }
  if (body.bench === undefined) return null;
  const over = benchOversize(body.bench);
  if (over === null) return null;
  return {
    field: over.node === undefined ? 'bench' : `bench.mocks.${over.node}`,
    limitBytes: over.limitBytes,
  };
}

const saveSchema = z.object({
  document: z.unknown(),
  message: z.string().max(500).optional(),
  taskContract: z.unknown().optional(),
  settings: z.unknown().optional(),
  presentation: z.unknown().optional(),
  // The wizard's create-only save: a colliding slug is refused (409) rather
  // than appended to.
  create: z.boolean().optional(),
  // Install target for a NEW automation (capped like every project-id door;
  // the store validates it exists in the org and binds only version 1).
  projectId: z.string().min(1).max(128).optional(),
  // The version the editor's draft started from; the store refuses the save
  // (409 AUTOMATION_VERSION_STALE) when another version landed since.
  baseVersion: z.number().int().min(1).optional(),
  // The version the draft was built from, recorded on the new version without
  // a check — "save anyway" after a stale refusal saves without a base, but
  // its draft still started from that version.
  basedOnVersion: z.number().int().min(1).optional(),
});

const deploySchema = z.object({
  version: z.number().int().min(1),
  // Compare-and-set on the live version: the one the caller read as live
  // (`null`: nothing deployed). Another one live refuses the deploy (409
  // AUTOMATION_DEPLOYMENT_STALE, naming who put it live). Absent, no check.
  expectedDeployedVersion: z.number().int().min(1).nullable().optional(),
});

// An older version brought back as the newest: the message it gets ("Restore
// vN" when left out), and the latest version the caller read — a version
// saved since refuses the restore, as it does a save.
const restoreSchema = z.object({
  version: z.number().int().min(1),
  message: z.string().trim().min(1).max(500).optional(),
  baseVersion: z.number().int().min(1).optional(),
});

/** A history page's size and position from the query string: `limit` a
 * whole number from 1, `before` what the last page answered. Absent or
 * unreadable, none. */
function pageLimit(raw: string | undefined): number | undefined {
  const limit = Number(raw ?? Number.NaN);
  return Number.isInteger(limit) && limit >= 1 ? limit : undefined;
}

// A draft checked without saving it: the document as the editor holds it, and
// which parts of the analysis to answer beside the issues (the analysis by
// default; the inferred types only when asked, since they are the bulky part).
const validateSchema = z.object({
  document: z.unknown(),
  detail: z
    .array(z.enum(['analysis', 'types']))
    .max(2)
    .optional(),
});

/** The whole set of write actions an automation may make without a
 * person: step types such as `slack.send_message`. */
const approvalAllowancesSchema = z.object({
  allowed: z.array(z.string().min(3).max(200)).max(100),
});

const projectsSchema = z.object({
  projectIds: z.array(z.string().min(1)).max(100),
});

const answerSchema = z.object({ answer: z.string().min(1).max(20_000) });

/** A person's choice about a write that may already have happened, and the
 * attempt of it the choice is about: a write run again keeps its row and
 * takes the next number, so a choice about an earlier attempt is refused
 * (409) instead of deciding a later one. The ledger's `attempt` is an int. */
const inDoubtResolutionSchema = z
  .object({
    resolution: z.enum(['retry', 'skip', 'fail']),
    attempt: z.number().int().min(1).max(2_147_483_647),
  })
  .strict();

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

/**
 * The audience refusals a carried skill can answer, which keep the skill
 * door's statuses so both upload lanes agree (403 for a team the caller is
 * not in, and for an organization-wide skill the caller may not publish).
 * Every other coded refusal of this lane stays a 400.
 */
const AUDIENCE_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'TEAM_NOT_IN_ORG',
  'TEAM_ACCESS_DENIED',
  'SKILL_PUBLISH_FORBIDDEN',
]);

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ProjectError)
    return c.json({ error: error.code, message: error.message }, error.status);
  if (error instanceof AutomationError) {
    // The structured detail rides beside the sentence (`data`), the shape
    // the app's fetch layer already reads — a stale save names the version
    // that landed, so the editor can offer "save anyway" on top of it.
    return c.json(
      {
        error: error.code,
        message: error.message,
        ...(error.data !== undefined && { data: error.data }),
      },
      error.status,
    );
  }
  // The shared upload lane refuses with the 0.4 `AppError({code,message})`
  // contract — surface it as the structured 4xx the dialog maps.
  if (error instanceof AppError) {
    const data: unknown = error.data;
    if (data !== null && typeof data === 'object') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object; string-typeof guards gate the reads
      const record = data as Record<string, unknown>;
      const code = typeof record.code === 'string' ? record.code : 'REFUSED';
      // A document the checks refused carries its problems: they ride
      // beside the sentence (`data`), as a refused save's do.
      const issues = {
        ...(Array.isArray(record.errors) && { errors: record.errors }),
        ...(Array.isArray(record.warnings) && { warnings: record.warnings }),
      };
      return c.json(
        {
          error: code,
          message:
            typeof record.message === 'string'
              ? record.message
              : 'The request was refused.',
          ...(Object.keys(issues).length > 0 && { data: issues }),
        },
        (AUDIENCE_REFUSAL_CODES.has(code)
          ? SKILL_ERROR_STATUS[code]
          : undefined) ?? 400,
      );
    }
  }
  throw error;
}

/** A time in epoch milliseconds, as a query parameter. */
const epochMsParam = z
  .string()
  .regex(/^\d{1,15}$/)
  .transform(Number);

/** A unit's item or pass: -1 for the step itself. */
const unitIndexParam = z
  .string()
  .regex(/^-?\d{1,9}$/)
  .transform(Number)
  .pipe(z.number().int().min(-1));

const recordQuerySchema = z.object({
  since: epochMsParam.optional(),
  include: z.string().max(64).optional(),
});

const nodeQuerySchema = z.object({
  node: z.string().min(1).max(512),
  item: unitIndexParam.optional(),
  pass: unitIndexParam.optional(),
});

const itemsQuerySchema = z.object({
  node: z.string().min(1).max(512),
  cursor: z.string().max(32).optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(200))
    .optional(),
  status: z.enum(['all', 'failed']).optional(),
});

/** The statuses a page of runs may be narrowed to. */
const RUN_PAGE_STATUSES = new Set([
  'queued',
  'running',
  'waiting',
  'quarantined',
  'success',
  'failed',
  'cancelled',
]);

/**
 * A page of one automation's runs, as the Runs table asks for it: its
 * name, the project it is read in, the statuses and mode it is narrowed to,
 * and where the previous page ended (`<startedAt>|<id>`).
 */
const runPageQuerySchema = z.object({
  name: z.string().min(1).max(512),
  projectId: z.string().min(1).max(128).optional(),
  status: z
    .string()
    .max(200)
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : value.split(',').filter((status) => RUN_PAGE_STATUSES.has(status)),
    ),
  mode: z.enum(['mock', 'live']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .regex(/^\d{1,16}\|[\w-]{1,64}$/)
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const [at, id] = value.split('|');
      return { at: Number(at), id: id ?? '' };
    }),
});

/** A replay's plan, asked for in the query: the same request a replay
 * takes, its version a keyword or a number. */
const replayQuerySchema = z.object({
  kind: z.enum(REPLAY_KINDS),
  from: z.string().trim().min(1).max(200).optional(),
  version: z
    .string()
    .regex(/^(same|deployed|latest|[1-9]\d{0,6})$/)
    .transform((v) =>
      v === 'same' || v === 'deployed' || v === 'latest' ? v : Number(v),
    )
    .optional(),
  mode: z.enum(['mock', 'live']).optional(),
});

/**
 * The app and MCP authoring doors share the engine's validation/test gate.
 *
 * A refusal keeps its fields at the top level, where other readers of this
 * door find them, and nests the structured part again under `data`: the
 * app's fetch layer carries only `data` beside the code and the sentence, so
 * a refused save or deploy reaches the editor with every issue and where it
 * is, not as one flattened message.
 */
export function authoringRefusalBody(
  result: unknown,
): { body: Record<string, unknown>; status: 400 | 404 | 409 } | null {
  if (!isRecord(result) || typeof result.error !== 'string') return null;
  const code =
    typeof result.code === 'string' ? result.code : 'AUTOMATION_INVALID';
  const status =
    code === 'AUTOMATION_VERSION_UNKNOWN' || code === 'AUTOMATION_NOT_FOUND'
      ? 404
      : code === 'AUTOMATION_NAME_TAKEN' ||
          code === 'AUTOMATION_TESTS_FAILING' ||
          code === 'AUTOMATION_DEPLOY_REJECTED'
        ? 409
        : 400;
  const data = refusalDataOf(result);
  return {
    body: {
      ...result,
      error: code,
      message: result.error,
      ...(data !== undefined && { data }),
    },
    status,
  };
}

function authoringRefusal(
  c: Context<OrgEnv>,
  result: unknown,
): Response | null {
  const refusal = authoringRefusalBody(result);
  return refusal === null ? null : c.json(refusal.body, refusal.status);
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

  /** The signed-in person changing an automation in the editor — the
   * origin every definition write of the app's own routes records
   * (`write-origin.ts`); the upload and the managed configuration doors
   * name theirs. */
  const editorOrigin = (c: Context<OrgEnv>): WriteOrigin =>
    appOrigin(c.get('sessionBundle').user.id);

  // Runs, bindings and project-scoped listings follow the project's read
  // rule, like the REST and engine doors: a member outside a team-restricted
  // project learns nothing of what ran there, and a hidden run answers
  // exactly like a missing one.
  const projectAuth = (c: Context<OrgEnv>) =>
    getProjectAuthContext(deps.sql, {
      organizationId: c.get('orgId'),
      userId: c.get('sessionBundle').user.id,
      role: c.get('orgMember').role,
    });
  const visibleRun = async (c: Context<OrgEnv>, runId: string) => {
    const run = await getRun(deps.sql, c.get('orgId'), runId);
    if (run === null) return null;
    return (await canReadRun(deps.sql, await projectAuth(c), run)) ? run : null;
  };
  // Cancelling a run and answering its question are WRITES: a project run
  // needs the project's write gate, not merely read access (`runControlAccess`
  // — the same rule the REST run door and the task workflow door apply), while
  // an organization run keeps its member-level control. `absent` = no such run;
  // `hidden` = a project the caller cannot read (answers like a missing one);
  // `forbidden` = readable but read-only (a member without write).
  const controllableRun = async (
    c: Context<OrgEnv>,
    runId: string,
  ): Promise<'ok' | 'absent' | 'forbidden'> => {
    const run = await getRun(deps.sql, c.get('orgId'), runId);
    if (run === null) return 'absent';
    const access = await runControlAccess(deps.sql, await projectAuth(c), run);
    return access === 'hidden' ? 'absent' : access;
  };
  const forbiddenControl = (c: Context<OrgEnv>): Response =>
    c.json({ error: 'RBAC_FORBIDDEN', message: 'Editor role required' }, 403);
  // The APP listing (0.4 wire): deployed-version behaviour fields + scope.
  app.get('/listing', async (c) => {
    const projectId = c.req.query('projectId');
    const auth = await projectAuth(c);
    if (
      projectId !== undefined &&
      (await readableProject(deps.sql, auth, projectId)) === null
    ) {
      return c.json({ automations: [] });
    }
    const visible = new Set(await readableProjectIds(deps.sql, auth));
    const automations = await listAutomationsForApp(deps.sql, c.get('orgId'), {
      ...(projectId !== undefined ? { projectId } : {}),
      includeProjectBound: c.req.query('includeProjectBound') === 'true',
    });
    // A row bound only to projects outside the viewer's view is dropped,
    // not listed with no bindings: an empty list reads as organization
    // scope, where the automation cannot run.
    return c.json({
      automations: automations.flatMap((automation) => {
        const projectIds = automation.projectIds.filter((id) =>
          visible.has(id),
        );
        return automation.projectIds.length > 0 && projectIds.length === 0
          ? []
          : [{ ...automation, projectIds }];
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
   * only; the editor folds its own core floor over these). Each action
   * carries its connector and its title in every language it ships in; each
   * connector, once, its display name and its icon as a data URL, so a node
   * reads "GitHub · List issues" in the reader's language. */
  app.get('/catalog/node-types', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const definitions = loadConnectorDefinitions();
    for (const connector of definitions) {
      registerConnector(connector);
    }
    const nodeTypeRows: NodeTypeCatalog['nodeTypes'] = [];
    for (const def of nodeTypes().values()) {
      if (def.kind !== 'connector') continue;
      const display = def.connector?.display;
      nodeTypeRows.push({
        type: def.type,
        kind: def.kind,
        description: def.description,
        allowedFields: [...def.allowedFields],
        requiredFields: [...def.requiredFields],
        outputKind: def.outputKind,
        hasEffect: def.connector?.hasEffect ?? false,
        ...(display !== undefined && { connector: display.connector }),
        ...(display?.title !== undefined && { title: display.title }),
        ...(display?.i18n !== undefined && { i18n: display.i18n }),
      });
    }
    nodeTypeRows.sort((a, b) => a.type.localeCompare(b.type));
    const connectors: NodeTypeCatalog['connectors'] = [];
    for (const connector of definitions) {
      const row: NodeTypeCatalog['connectors'][number] = {
        name: connector.name,
        displayName: connector.displayName,
      };
      if (connector.i18n !== undefined) row.i18n = connector.i18n;
      const iconUrl = connectorIconUrl(connector.name);
      if (iconUrl !== undefined) row.iconUrl = iconUrl;
      connectors.push(row);
    }
    connectors.sort((a, b) => a.name.localeCompare(b.name));
    const body: NodeTypeCatalog = { nodeTypes: nodeTypeRows, connectors };
    return c.json(body);
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
    if (!body.success) return invalidBodyResponse(c, body.error);
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
            email: c.get('sessionBundle').user.email,
            role: c.get('orgMember').role,
          },
          body.data,
        ),
      );
    } catch (error) {
      // A carried skill shared with the whole organization the uploader may
      // not publish: the refusal is audited as denied, as on the skill doors.
      const user = c.get('sessionBundle').user;
      await auditIfPublishRefused(deps.sql, error, {
        organizationId: c.get('orgId'),
        actor: {
          id: user.id,
          email: user.email,
          role: c.get('orgMember').role,
        },
        via: 'automation_package',
      });
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
    const runId = c.req.param('runId');
    if ((await visibleRun(c, runId)) === null) return c.json({ ask: null });
    return c.json({
      ask: await getPendingAskForRun(deps.sql, c.get('orgId'), runId),
    });
  });

  // Answering resumes the run, so it is a WRITE: a project run's question is
  // answerable by a project WRITER (like the REST answer door), an
  // organization run's by any member (the 0.4 "the agent asked a PERSON"
  // gate). A hidden run's question is "not found"; a read-only member who can
  // see the question is refused rather than told it does not exist. The
  // answer records and the resume job rides its transaction.
  app.post('/asks/:askId/answer', async (c) => {
    const body = answerSchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const askId = c.req.param('askId');
      const runId = await getAskRunId(deps.sql, c.get('orgId'), askId);
      if (runId === null) {
        throw new AutomationError(
          'HUMAN_ASK_NOT_FOUND',
          'this question does not exist',
          404,
        );
      }
      const control = await controllableRun(c, runId);
      if (control === 'absent') {
        throw new AutomationError(
          'HUMAN_ASK_NOT_FOUND',
          'this question does not exist',
          404,
        );
      }
      if (control === 'forbidden') return forbiddenControl(c);
      await answerAsk(deps.sql, {
        organizationId: c.get('orgId'),
        askId,
        answer: body.data.answer,
        answeredBy: c.get('sessionBundle').user.id,
        // Pin the answer to the run whose visibility was just checked.
        runId,
      });
    } catch (error) {
      return handleError(c, error);
    }
    return c.json({ ok: true });
  });

  // The write a run waits on a person about — a call that may already have
  // reached its service when the run was interrupted. Membership-gated like
  // every run read; null when nothing of the kind waits.
  app.get('/runs/:runId/in-doubt', async (c) => {
    const runId = c.req.param('runId');
    if ((await visibleRun(c, runId)) === null) return c.json({ inDoubt: null });
    const attempt = await readOpenInDoubt(deps.sql, c.get('orgId'), runId);
    return c.json({
      inDoubt: attempt === null ? null : describeInDoubt(attempt),
    });
  });

  // A run step by step: its record, one unit of it whole, a page of a
  // step's items and passes, and two runs side by side. Each is read like
  // the run itself (AUTO-R2, AUTO-R40): a hidden or missing run is not
  // found, and two runs compare only when both are readable.
  const runNotFound = (): AutomationError =>
    new AutomationError('RUN_NOT_FOUND', 'this run does not exist', 404);

  app.get('/runs/:runId/record', async (c) => {
    const query = recordQuerySchema.safeParse(c.req.query());
    if (!query.success) return invalidBodyResponse(c, query.error);
    try {
      const runId = c.req.param('runId');
      if ((await visibleRun(c, runId)) === null) throw runNotFound();
      const include = new Set((query.data.include ?? '').split(','));
      const record = await readRunRecord(deps.sql, {
        organizationId: c.get('orgId'),
        runId,
        ...(query.data.since !== undefined && { since: query.data.since }),
        travels: include.has('travels'),
      });
      if (record === null) throw runNotFound();
      return c.json({ record });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/runs/:runId/record/node', async (c) => {
    const query = nodeQuerySchema.safeParse(c.req.query());
    if (!query.success) return invalidBodyResponse(c, query.error);
    try {
      const runId = c.req.param('runId');
      if ((await visibleRun(c, runId)) === null) throw runNotFound();
      const node = await readNodeDetail(deps.sql, {
        organizationId: c.get('orgId'),
        runId,
        path: query.data.node,
        ...(query.data.item !== undefined && { item: query.data.item }),
        ...(query.data.pass !== undefined && { pass: query.data.pass }),
      });
      if (node === null) {
        throw new AutomationError(
          'NODE_RUN_NOT_FOUND',
          'this run has no record of that step',
          404,
        );
      }
      return c.json({ node });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/runs/:runId/record/items', async (c) => {
    const query = itemsQuerySchema.safeParse(c.req.query());
    if (!query.success) return invalidBodyResponse(c, query.error);
    try {
      const runId = c.req.param('runId');
      if ((await visibleRun(c, runId)) === null) throw runNotFound();
      const page = await readNodePage(deps.sql, {
        organizationId: c.get('orgId'),
        runId,
        path: query.data.node,
        ...(query.data.cursor !== undefined && { cursor: query.data.cursor }),
        ...(query.data.limit !== undefined && { limit: query.data.limit }),
        ...(query.data.status !== undefined && { status: query.data.status }),
      });
      if (page === null) throw runNotFound();
      return c.json({ page });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/runs/:runId/compare/:otherRunId', async (c) => {
    try {
      const runId = c.req.param('runId');
      const otherRunId = c.req.param('otherRunId');
      if (
        (await visibleRun(c, runId)) === null ||
        (await visibleRun(c, otherRunId)) === null
      ) {
        throw runNotFound();
      }
      const diff = await readRunComparison(deps.sql, {
        organizationId: c.get('orgId'),
        runId,
        otherRunId,
      });
      if (diff === null) throw runNotFound();
      return c.json({ diff });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Running a run again: its plan — what it reuses, runs again and sends out
  // a second time — then the replay, born in the source's project. Both are
  // read like the run itself; a live replay needs an author, as a live
  // start does (AUTO-R41).
  const mayStartLive = (c: Context<OrgEnv>): boolean =>
    isAdminOrDeveloperRole(c.get('orgMember').role);

  app.get('/runs/:runId/replay', async (c) => {
    const query = replayQuerySchema.safeParse(c.req.query());
    if (!query.success) return invalidBodyResponse(c, query.error);
    try {
      const runId = c.req.param('runId');
      if ((await visibleRun(c, runId)) === null) throw runNotFound();
      const plan = await readReplayPlan(deps.sql, {
        organizationId: c.get('orgId'),
        sourceRunId: runId,
        request: query.data,
        canStartLive: mayStartLive(c),
      });
      if (plan === null) throw runNotFound();
      return c.json({ plan });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/runs/:runId/replay', async (c) => {
    const body = appReplayRequestSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const runId = c.req.param('runId');
      const run = await visibleRun(c, runId);
      if (run === null) throw runNotFound();
      const { requestId, ...request } = body.data;
      if ((request.mode ?? run.mode) === 'live') {
        const denied = requireAuthor(c);
        if (denied) return denied;
      }
      const visibleProjectIds = await readableProjectIds(
        deps.sql,
        await projectAuth(c),
      );
      const started = await deps.sql.begin((tx) =>
        replayRunInTx(tx, {
          organizationId: c.get('orgId'),
          sourceRunId: runId,
          request,
          startedBy: `user:${c.get('sessionBundle').user.id}`,
          canStartLive: mayStartLive(c),
          visibleProjectIds,
          ...(requestId !== undefined && { idempotencyKey: requestId }),
        }),
      );
      if (started === null) throw runNotFound();
      return c.json(started, started.duplicate === true ? 200 : 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Deciding resumes (or fails) the run, so it is a WRITE with the stop's
  // gate: a project run needs the project's write access, an organization
  // run member-level control. A hidden or missing run is "not found". The
  // decision, its audit row and the run's wake commit together.
  app.post('/runs/:runId/in-doubt/:attemptId', async (c) => {
    const body = inDoubtResolutionSchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const runId = c.req.param('runId');
      const control = await controllableRun(c, runId);
      if (control === 'absent') {
        throw new AutomationError(
          'RUN_NOT_FOUND',
          'this run does not exist',
          404,
        );
      }
      if (control === 'forbidden') return forbiddenControl(c);
      const actor = c.get('sessionBundle').user.id;
      await deps.sql.begin((tx) =>
        resolveInDoubtInTx(tx, {
          organizationId: c.get('orgId'),
          runId,
          attemptId: c.req.param('attemptId'),
          attempt: body.data.attempt,
          resolution: body.data.resolution,
          actor,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
    return c.json({ ok: true });
  });

  app.post('/runs/:runId/legacy-quarantine', async (c) => {
    const body = legacyRunStopSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const runId = c.req.param('runId');
      const control = await controllableRun(c, runId);
      if (control === 'absent')
        throw new AutomationError(
          'RUN_NOT_FOUND',
          'this run does not exist',
          404,
        );
      if (control === 'forbidden') return forbiddenControl(c);
      return c.json(
        await deps.sql.begin((tx) =>
          requestLegacyRunStopInTx(tx, {
            organizationId: c.get('orgId'),
            runId,
            actor: c.get('sessionBundle').user.id,
            request: body.data,
          }),
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/runs/:runId/cancel', async (c) => {
    try {
      const runId = c.req.param('runId');
      const control = await controllableRun(c, runId);
      // A hidden or missing run answers like a missing one: nothing to stop.
      if (control === 'absent') return c.json({ cancelled: false });
      // Cancelling is a write — a read-only member who can see the run may not
      // stop it (the app must not bypass the project write gate).
      if (control === 'forbidden') return forbiddenControl(c);
      return c.json(
        await cancelRun(
          deps.sql,
          c.get('orgId'),
          runId,
          c.get('sessionBundle').user.id,
        ),
      );
    } catch (error) {
      // cancelRun is now a terminal door (audit row + session stop) — surface
      // a rare terminal-write failure structured rather than as a bare 500.
      return handleError(c, error);
    }
  });

  // Both run reads answer the read model (`waitingFor`, `startedVia`), never
  // the raw row: the app names what a run waits on and what started it in
  // words, and the row's ask fact is the read's own input.
  // One page of an automation's runs, newest first, narrowed as the Runs
  // table asks; registered before `/runs/:runId`, which would read `page` as
  // a run id.
  app.get('/runs/page', async (c) => {
    const query = runPageQuerySchema.safeParse(c.req.query());
    if (!query.success) return invalidBodyResponse(c, query.error);
    const { name, projectId, status, mode, limit, cursor } = query.data;
    const auth = await projectAuth(c);
    if (
      projectId !== undefined &&
      (await readableProject(deps.sql, auth, projectId)) === null
    ) {
      return c.json({ items: [], next: null });
    }
    const page = await listRunsPage(deps.sql, c.get('orgId'), {
      name,
      ...(projectId !== undefined ? { projectId } : {}),
      visibleProjectIds: await readableProjectIds(deps.sql, auth),
      ...(status !== undefined && status.length > 0
        ? { statuses: status }
        : {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(cursor !== undefined ? { before: cursor } : {}),
      limit,
    });
    return c.json({ items: page.runs.map(toRunSummary), next: page.next });
  });

  app.get('/runs/:runId', async (c) => {
    const run = await visibleRun(c, c.req.param('runId'));
    return run === null
      ? c.json({ error: 'run not found' }, 404)
      : c.json({ run: toRunDetail(run) });
  });

  app.get('/runs', async (c) => {
    const name = c.req.query('name');
    const projectId = c.req.query('projectId');
    const limitRaw = Number(c.req.query('limit') ?? '50');
    const auth = await projectAuth(c);
    if (
      projectId !== undefined &&
      (await readableProject(deps.sql, auth, projectId)) === null
    ) {
      return c.json({ runs: [] });
    }
    const rows = await listRuns(deps.sql, c.get('orgId'), {
      ...(name !== undefined ? { name } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
      ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
      visibleProjectIds: await readableProjectIds(deps.sql, auth),
    });
    // The full rows, not summaries: the editor overlays the last run's
    // trace and checkpoints on the canvas from this listing.
    return c.json({ runs: rows.map(toRunDetail) });
  });

  // Managed configuration uses the same authoring permissions and native
  // writer gates. Existing project identity is adopted, never inferred by name.
  app.get('/:name{.+}/configuration', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const kind = managedAutomationKindSchema.safeParse(c.req.query('kind'));
    const projectId = c.req.query('projectId');
    if (!kind.success || !projectId || projectId.length > 128)
      return c.json({ error: 'INVALID_INPUT' }, 400);
    try {
      const auth = await projectAuth(c);
      const project = await readableProject(deps.sql, auth, projectId);
      if (project === null || project.archivedAt !== null)
        return c.json({ error: 'PROJECT_NOT_FOUND' }, 404);
      assertWritable(project, auth);
      return c.json(
        await readManagedAutomation(
          deps.sql,
          {
            organizationId: c.get('orgId'),
            name: nameFrom(c, 'configuration'),
            projectId,
          },
          kind.data,
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:name{.+}/configuration', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = managedAutomationWriteSchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    const { config, kind } = body.data.resource;
    const name = nameFrom(c, 'configuration');
    if (!('name' in config) || config.name !== name)
      return c.json({ error: 'AUTOMATION_NAME_INVALID' }, 400);
    try {
      const auth = await projectAuth(c);
      const project = await readableProject(deps.sql, auth, config.projectId);
      if (project === null || project.archivedAt !== null)
        return c.json({ error: 'PROJECT_NOT_FOUND' }, 404);
      assertWritable(project, auth);
      // Also refuses tombstones, unrelated project bindings and wrong trigger
      // kinds before tests or mutation. The writer repeats CAS under its lock.
      await readManagedAutomation(
        deps.sql,
        {
          organizationId: c.get('orgId'),
          name,
          projectId: config.projectId,
        },
        managedAutomationKindSchema.parse(kind),
      );
      const result = await writeManagedAutomation(
        deps.sql,
        c.get('orgId'),
        appOrigin(c.get('sessionBundle').user.id, 'managed'),
        body.data,
      );
      return authoringRefusal(c, result) ?? c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:name{.+}/save', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = saveSchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    if (body.data.document === undefined) {
      return invalidBodyIssuesResponse(c, [
        { path: 'document', message: 'is required' },
      ]);
    }
    try {
      assembleAutomationAuthoringHost();
      const scope = {
        organizationId: c.get('orgId'),
        origin: editorOrigin(c),
      };
      const store = pgAutomationStore(deps.sql, scope);
      let storeError: unknown;
      let saved: SavedVersion | undefined;
      /** How the tests the save ran went, for the editor to say. */
      let checked: { passed: number; failed: number } | undefined;
      const result = await dispatch(
        'save_automation',
        {
          automation: body.data.document,
          message: body.data.message,
        },
        {
          store: {
            ...store,
            save: (automation, message, options) => {
              if (options?.testReport !== undefined) {
                checked = {
                  passed: options.testReport.passed,
                  failed: options.testReport.failed,
                };
              }
              return saveVersion(deps.sql, {
                ...scope,
                name: nameFrom(c, 'save'),
                document: automation,
                ...(message !== undefined ? { message } : {}),
                ...(options?.testsPassed !== undefined
                  ? { testsPassed: options.testsPassed }
                  : {}),
                ...(options?.testReport !== undefined
                  ? { testReport: options.testReport }
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
                ...(body.data.create !== undefined
                  ? { create: body.data.create }
                  : {}),
                ...(body.data.projectId !== undefined
                  ? { projectId: body.data.projectId }
                  : {}),
                ...(body.data.baseVersion !== undefined
                  ? { baseVersion: body.data.baseVersion }
                  : {}),
                ...(body.data.basedOnVersion !== undefined
                  ? { basedOnVersion: body.data.basedOnVersion }
                  : {}),
              }).then(
                (answer) => {
                  saved = answer;
                  return answer;
                },
                (error: unknown) => {
                  storeError = error;
                  throw error;
                },
              );
            },
          },
        },
      );
      if (storeError !== undefined) throw storeError;
      // What the new version changed, and how many of its tests passed,
      // beside the engine's answer.
      return (
        authoringRefusal(c, result) ??
        c.json(
          isRecord(result)
            ? {
                ...result,
                ...(saved?.changes !== undefined && { changes: saved.changes }),
                ...(checked !== undefined && {
                  tests: {
                    ...checked,
                    total: checked.passed + checked.failed,
                  },
                }),
              }
            : result,
          201,
        )
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Check a draft without saving it — the editor's Problems panel. A suffix
  // route like every per-automation verb, never a fixed first segment, so it
  // takes no name away from authors. Read-only: it writes and audits nothing,
  // but it reads the organization's other automations and triggers to check
  // the calls between them, so it takes the authoring roles like a save.
  app.post('/:name{.+}/validate', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = validateSchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    if (body.data.document === undefined) {
      return invalidBodyIssuesResponse(c, [
        { path: 'document', message: 'is required' },
      ]);
    }
    try {
      assembleAutomationAuthoringHost();
      const store = pgAutomationStore(deps.sql, {
        organizationId: c.get('orgId'),
        origin: editorOrigin(c),
      });
      const result = await dispatch(
        'validate_automation',
        {
          automation: body.data.document,
          detail: body.data.detail ?? ['analysis'],
        },
        { store },
      );
      return authoringRefusal(c, result) ?? c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Runs that are never stored — a try of a draft or a saved version, the
  // tests run by hand — execute in this process: charged to the
  // organization's bench budget (a suite by its tests), held to a few at a
  // time per process, and stopped when the caller leaves.
  const admitBench = async (
    c: Context<OrgEnv>,
    executions: number,
  ): Promise<(() => void) | Response> => {
    try {
      return await admitBenchRuns(deps.sql, c.get('orgId'), executions);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return rateLimitedResponse(c, error);
      }
      throw error;
    }
  };

  /** The document a bench request runs: its draft, or the saved version it
   * names — one of the two. */
  const benchDocument = async (
    c: Context<OrgEnv>,
    name: string,
    body: { document?: unknown; version?: number | undefined },
    store: ReturnType<typeof pgAutomationStore>,
  ): Promise<{ document: unknown; version?: number } | Response> => {
    if ((body.document === undefined) === (body.version === undefined)) {
      return invalidBodyIssuesResponse(c, [
        {
          path: 'document',
          message: 'give the draft or a saved version — one of the two',
        },
      ]);
    }
    if (body.version === undefined) return { document: body.document };
    const stored = await store.get(name, body.version);
    if (stored === null) {
      throw new AutomationError(
        'AUTOMATION_VERSION_UNKNOWN',
        `"${name}" has no version ${body.version}.`,
        404,
      );
    }
    return { document: stored.automation, version: body.version };
  };

  /** A document the checks refuse: its problems, as a refused save's. */
  const invalidDocument = (
    c: Context<OrgEnv>,
    issues: Awaited<ReturnType<typeof validate>>,
  ): Response =>
    c.json(
      {
        error: 'AUTOMATION_INVALID',
        code: 'AUTOMATION_INVALID',
        message: 'The automation does not pass the checks.',
        data: { errors: issues.errors, warnings: issues.warnings },
      },
      400,
    );

  const tooLarge = (
    c: Context<OrgEnv>,
    part: { field: string; limitBytes: number },
  ): Response =>
    c.json(
      {
        error: 'PAYLOAD_TOO_LARGE',
        code: 'PAYLOAD_TOO_LARGE',
        message: `${part.field} is larger than ${part.limitBytes} bytes.`,
        data: part,
      },
      413,
    );

  // Run the draft or a saved version once, in mock mode, with the input and
  // stand-ins given; nothing is stored. The editor's try and step tests.
  app.post('/:name{.+}/try', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = trySchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    const oversized = oversizedPart(body.data);
    if (oversized !== null) return tooLarge(c, oversized);
    try {
      assembleAutomationAuthoringHost();
      const store = pgAutomationStore(deps.sql, {
        organizationId: c.get('orgId'),
        origin: editorOrigin(c),
      });
      const target = await benchDocument(
        c,
        nameFrom(c, 'try'),
        body.data,
        store,
      );
      if (target instanceof Response) return target;
      const issues = await validate(target.document, { store });
      if (issues.errors.length > 0) return invalidDocument(c, issues);
      const admitted = await admitBench(c, 1);
      if (admitted instanceof Response) return admitted;
      try {
        const run = await tryRun({
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
          document: target.document as Automation,
          store,
          signal: c.req.raw.signal,
          ...(target.version !== undefined && { version: target.version }),
          ...(body.data.input !== undefined && { input: body.data.input }),
          ...(body.data.bench !== undefined && { bench: body.data.bench }),
        });
        // A bench the run could not take — a stand-in for a node the
        // document lacks, say — is the request's fault, not the run's.
        const refusal = run.validation?.errors.find((issue) =>
          issue.code.startsWith('BENCH_'),
        );
        if (run.status === 'invalid' && refusal !== undefined) {
          return c.json(
            {
              error: 'BENCH_INVALID',
              code: 'BENCH_INVALID',
              message: refusal.message,
              data: { issue: refusal },
            },
            400,
          );
        }
        return c.json({ run, warnings: issues.warnings });
      } finally {
        admitted();
      }
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Run the tests of the draft or of a saved version by hand — all of them
  // or those named by their place — and answer each with its run. The
  // whole suite of a saved version is its new verdict, recorded as made by
  // hand, by whom.
  app.post('/:name{.+}/run-tests', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = runTestsSchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    const oversized = oversizedPart(body.data);
    if (oversized !== null) return tooLarge(c, oversized);
    try {
      assembleAutomationAuthoringHost();
      const organizationId = c.get('orgId');
      const origin = editorOrigin(c);
      const store = pgAutomationStore(deps.sql, { organizationId, origin });
      const name = nameFrom(c, 'run-tests');
      const target = await benchDocument(c, name, body.data, store);
      if (target instanceof Response) return target;
      const issues = await validate(target.document, { store });
      if (issues.errors.length > 0) return invalidDocument(c, issues);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
      const document = target.document as Automation;
      const count = body.data.tests?.length ?? document.tests?.length ?? 0;
      if (count === 0) {
        return c.json({ report: { passed: 0, failed: 0, results: [] } });
      }
      const admitted = await admitBench(c, count);
      if (admitted instanceof Response) return admitted;
      try {
        const report = await runTestsByHand({
          document,
          store,
          detail: body.data.detail ?? true,
          signal: c.req.raw.signal,
          ...(target.version !== undefined && { version: target.version }),
          ...(body.data.tests !== undefined && { select: body.data.tests }),
        });
        // Only a saved version's whole suite, run to its end, is a verdict.
        if (
          target.version === undefined ||
          body.data.tests !== undefined ||
          report.notRun !== undefined
        ) {
          return c.json({ report });
        }
        const checkedAt = Date.now();
        const testsPassed = report.failed === 0;
        await recordTestVerdict(deps.sql, {
          organizationId,
          name,
          version: target.version,
          testsPassed,
          check: { report, via: 'manual', by: origin.actor },
          at: checkedAt,
        });
        return c.json({
          report,
          recorded: { version: target.version, testsPassed, checkedAt },
        });
      } finally {
        admitted();
      }
    } catch (error) {
      return handleError(c, error);
    }
  });

  // What a saved version's tests found the last time they ran: the verdict,
  // when, which act made it and who, and the report — none when the
  // verdict has no report of its own.
  app.get('/:name{.+}/test-report', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const version = Number(c.req.query('version'));
    if (!Number.isInteger(version) || version < 1) {
      return invalidBodyIssuesResponse(c, [
        { path: 'version', message: 'a saved version number is required' },
      ]);
    }
    try {
      const name = nameFrom(c, 'test-report');
      const found = await readTestReport(
        deps.sql,
        c.get('orgId'),
        name,
        version,
      );
      if (found === undefined) {
        throw new AutomationError(
          'AUTOMATION_VERSION_UNKNOWN',
          `"${name}" has no version ${version}.`,
          404,
        );
      }
      return c.json(found);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:name{.+}/deploy', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = deploySchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      assembleAutomationAuthoringHost();
      const store = pgAutomationStore(deps.sql, {
        organizationId: c.get('orgId'),
        origin: editorOrigin(c),
      });
      let storeError: unknown;
      let deployed: DeployResult | undefined;
      const result = await dispatch(
        'deploy_automation',
        {
          name: nameFrom(c, 'deploy'),
          version: body.data.version,
          ...(body.data.expectedDeployedVersion !== undefined && {
            expectedDeployedVersion: body.data.expectedDeployedVersion,
          }),
        },
        {
          store: {
            ...store,
            deploy: (...args) =>
              store.deploy(...args).then(
                (answer) => {
                  deployed = answer;
                  return answer;
                },
                (error: unknown) => {
                  storeError = error;
                  throw error;
                },
              ),
          },
        },
      );
      if (storeError !== undefined) throw storeError;
      // The store's whole answer: what was live before, whether it rolled
      // back or changed nothing, and the trigger that starts the version now
      // — the editor's notice when that trigger is off.
      return (
        authoringRefusal(c, result) ??
        c.json(deployed ?? (isRecord(result) ? result.deployed : result))
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Bring an older version back as the newest: the engine's own restore
  // (`save_automation` with `restoreVersion`), the call a coding agent makes.
  // The version's document passes the save's checks and runs its own tests,
  // as any save does, and is saved restored from that version (201) — or
  // nothing is saved when its content is the latest already (200,
  // `unchanged`). Never a deploy: the live version stays live.
  app.post('/:name{.+}/restore', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = restoreSchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      assembleAutomationAuthoringHost();
      const name = nameFrom(c, 'restore');
      const store = pgAutomationStore(deps.sql, {
        organizationId: c.get('orgId'),
        origin: editorOrigin(c),
      });
      // The store's own refusals (a base version saved since, 409) keep
      // their status: they are thrown on, not answered as data.
      let storeError: unknown;
      const result = await dispatch(
        'save_automation',
        {
          name,
          restoreVersion: body.data.version,
          ...(body.data.message !== undefined && {
            message: body.data.message,
          }),
          ...(body.data.baseVersion !== undefined && {
            baseVersion: body.data.baseVersion,
          }),
        },
        {
          store: {
            ...store,
            save: (automation, message, options) =>
              store
                .save(automation, message, options)
                .catch((error: unknown) => {
                  storeError = error;
                  throw error;
                }),
          },
        },
      );
      if (storeError !== undefined) throw storeError;
      const refused = authoringRefusal(c, result);
      if (refused !== null) return refused;
      if (!isRecord(result) || typeof result.version !== 'number') {
        throw new Error('the restore passed its checks but saved nothing');
      }
      const unchanged = result.unchanged === true;
      return c.json(
        {
          name,
          version: result.version,
          restoredFrom: body.data.version,
          ...(unchanged && { unchanged: true }),
          ...(typeof result.testsPassed === 'boolean'
            ? { testsPassed: result.testsPassed }
            : {}),
          ...(Array.isArray(result.warnings)
            ? { warnings: result.warnings }
            : {}),
        },
        unchanged ? 200 : 201,
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  // The shared trigger contract, the REST door's twin: one strict shape
  // per kind, so a key of another kind (or an unknown one) is refused
  // instead of stored. A rule of the trigger answers the store's own coded
  // refusal, which the editor words per field.
  app.post('/:name{.+}/trigger', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const raw: unknown = await c.req.json();
    const body = triggerWriteSchema.safeParse(raw);
    if (!body.success) {
      const refusal = triggerBodyRefusal(body.error, raw);
      return refusal === null
        ? invalidBodyResponse(c, body.error)
        : handleError(c, refusal);
    }
    try {
      return c.json(
        await setTrigger(deps.sql, {
          organizationId: c.get('orgId'),
          name: nameFrom(c, 'trigger'),
          trigger: body.data,
          origin: editorOrigin(c),
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
        editorOrigin(c),
      ),
    });
  });

  app.post('/:name{.+}/projects', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = projectsSchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      await setAutomationProjects(deps.sql, {
        organizationId: c.get('orgId'),
        name: nameFrom(c, 'projects'),
        projectIds: body.data.projectIds,
        origin: editorOrigin(c),
        // The editor saves the bindings it was shown; bindings to projects
        // outside the author's view survive the save.
        visibleProjectIds: await readableProjectIds(
          deps.sql,
          await projectAuth(c),
        ),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:name{.+}/start', async (c) => {
    const body = startSchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    const mode = body.data.mode ?? 'mock';
    if (mode === 'live') {
      const denied = requireAuthor(c);
      if (denied) return denied;
    }
    try {
      const visibleProjectIds = await readableProjectIds(
        deps.sql,
        await projectAuth(c),
      );
      // A hidden project answers exactly like a missing one, before
      // anything about the automation's version or input is revealed.
      if (
        body.data.projectId !== undefined &&
        !visibleProjectIds.includes(body.data.projectId)
      ) {
        throw new AutomationError(
          'PROJECT_NOT_FOUND',
          'Project not found.',
          404,
        );
      }
      const started = await beginRun(deps.sql, {
        organizationId: c.get('orgId'),
        name: nameFrom(c, 'start'),
        input: body.data.input === undefined ? {} : body.data.input,
        mode,
        startedBy: `user:${c.get('sessionBundle').user.id}`,
        // Admission checks the binding it actually resolves, including a
        // sole inferred project and all bindings of an organization run.
        visibleProjectIds,
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

  // The version history, newest first: who saved each version, through
  // which door, what it was based on and changed, its tests, whether it is
  // live. `limit` asks for a page (`before`: the oldest version the last
  // page answered); without it the answer holds every version, as the
  // version picker has always read it.
  app.get('/:name{.+}/versions', async (c) => {
    const orgId = c.get('orgId');
    const name = nameFrom(c, 'versions');
    const limit = pageLimit(c.req.query('limit'));
    const before = pageLimit(c.req.query('before'));
    if (limit !== undefined) {
      const page = await listVersionHistory(deps.sql, orgId, name, {
        limit,
        ...(before !== undefined && { before }),
      });
      return c.json({
        versions: page.versions.map(versionHistoryWire),
        nextBefore: page.nextBefore,
        latestVersion: page.latestVersion,
        deployedVersion: page.deployedVersion,
      });
    }
    const all = await listVersionHistory(deps.sql, orgId, name, {
      limit: 200,
    });
    const versions = [...all.versions];
    let next = all.nextBefore;
    while (next !== null) {
      const page = await listVersionHistory(deps.sql, orgId, name, {
        limit: 200,
        before: next,
      });
      versions.push(...page.versions);
      next = page.nextBefore;
    }
    return c.json({
      versions: versions.map(versionHistoryWire),
      nextBefore: null,
      latestVersion: all.latestVersion,
      deployedVersion: all.deployedVersion,
    });
  });

  // When each version went live, newest first, a page at a time (`before`:
  // `<at>:<id>` of the oldest event the last page answered), and what is
  // live now with its runs still going.
  app.get('/:name{.+}/deployments', async (c) => {
    const raw = c.req.query('before') ?? '';
    const split = raw.indexOf(':');
    const at = Number(split > 0 ? raw.slice(0, split) : Number.NaN);
    const before =
      Number.isSafeInteger(at) && split < raw.length - 1
        ? { at, id: raw.slice(split + 1) }
        : undefined;
    const limit = pageLimit(c.req.query('limit'));
    const history = await listDeploymentEvents(
      deps.sql,
      c.get('orgId'),
      nameFrom(c, 'deployments'),
      {
        ...(limit !== undefined && { limit }),
        ...(before !== undefined && { before }),
      },
    );
    return c.json({
      live: history.live === null ? null : liveDeploymentWire(history.live),
      deployments: history.events.map(deploymentEventWire),
      nextBefore: history.nextBefore,
    });
  });

  // The runs the bound trigger started, newest first, with the webhook
  // delivery lane of each while its ledger row lives — the trigger panel's
  // recent deliveries. A run in a project the member cannot read is left
  // out, as on every run read.
  app.get('/:name{.+}/trigger/runs', async (c) => {
    const limit = Number(c.req.query('limit') ?? Number.NaN);
    return c.json({
      runs: await listTriggerRuns(deps.sql, c.get('orgId'), {
        name: nameFrom(c, 'trigger/runs'),
        ...(Number.isFinite(limit) ? { limit } : {}),
        visibleProjectIds: await readableProjectIds(
          deps.sql,
          await projectAuth(c),
        ),
      }),
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
    const visible = new Set(
      await readableProjectIds(deps.sql, await projectAuth(c)),
    );
    const projectIds = await bindingProjectIds(
      deps.sql,
      c.get('orgId'),
      nameFrom(c, 'projects'),
    );
    return c.json({ projectIds: projectIds.filter((id) => visible.has(id)) });
  });

  // The writes the automation may make without a person approving each run:
  // what its General tab lists. Authors read them; only an owner or admin
  // changes them (`canGrant` tells the tab which it is).
  app.get('/:name{.+}/approval-allowances', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const actions = await readApprovalAllowanceRows(deps.sql, {
      organizationId: c.get('orgId'),
      automation: nameFrom(c, 'approval-allowances'),
    });
    return c.json({
      actions,
      canGrant: isAdminRole(c.get('orgMember').role),
    });
  });

  app.put('/:name{.+}/approval-allowances', async (c) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'owner or admin role required' }, 403);
    }
    const body = approvalAllowancesSchema.safeParse(await c.req.json());
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const userId = c.get('sessionBundle').user.id;
      return c.json(
        await setApprovalAllowances(deps.sql, {
          organizationId: c.get('orgId'),
          automation: nameFrom(c, 'approval-allowances'),
          allowed: body.data.allowed,
          origin: editorOrigin(c),
          grantedBy: userId,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:name{.+}', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    try {
      await deleteAutomationCascade(deps.sql, {
        organizationId: c.get('orgId'),
        name: nameFrom(c, ''),
        origin: editorOrigin(c),
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
      // `?version=N` on an automation that EXISTS is a missing version, not
      // a missing automation: the editor used to show "Automation not found"
      // under the automation's own tabs. The REST door's code for the same
      // case, with the latest version the client can fall back to.
      if (Number.isFinite(versionParam)) {
        const latest = await versionRow(deps.sql, orgId, name, undefined);
        if (latest) {
          return handleError(
            c,
            new AutomationError(
              'AUTOMATION_VERSION_UNKNOWN',
              `version ${versionParam} of ${name} does not exist — the latest is ${latest.version}`,
              404,
              { latestVersion: latest.version },
            ),
          );
        }
      }
      // A deleted automation is not "not found": its runs are kept until
      // retention removes them, and a run page must be able to say so — a
      // run link used to open a blank page under repeated 404s
      // (2026-09-26 evaluation, D-14). Still a 404, with the date.
      const tombstone = await automationTombstone(deps.sql, orgId, name);
      if (tombstone !== null) {
        return handleError(
          c,
          new AutomationError(
            'AUTOMATION_DELETED',
            `"${name}" was deleted — its run history stays until retention removes it`,
            404,
            { deletedAt: tombstone.deletedAt },
          ),
        );
      }
      return c.json({ error: 'automation not found' }, 404);
    }
    // `deployedVersion` answers undefined (never null) for an undeployed
    // automation; `versionRow` reads an omitted version as "the latest", so
    // the guard must be on undefined or the draft's agents would be reported
    // as the deployed version's warning.
    const deployed = await deployedVersion(deps.sql, orgId, name);
    const deployedRow =
      deployed === undefined
        ? null
        : deployed === row.version
          ? row
          : await versionRow(deps.sql, orgId, name, deployed);
    const unpinned =
      deployedRow === null ? [] : unpinnedAgentNodeIds(deployedRow.document);
    // The shown version as its history reads it: the door it was saved
    // through, its lineage and what it changed; and which version is the
    // latest, so a reader of an older one knows it is not.
    const history = await listVersionHistory(deps.sql, orgId, name, {
      before: row.version + 1,
      limit: 1,
    });
    const shown = history.versions[0];
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
      ...(row.taskContract !== null && row.taskContract !== undefined
        ? { taskContract: row.taskContract }
        : {}),
      ...(deployed !== undefined ? { deployedVersion: deployed } : {}),
      ...(unpinned.length > 0 ? { deployedUnpinnedAgentNodes: unpinned } : {}),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      ...(history.latestVersion !== null && {
        latestVersion: history.latestVersion,
      }),
      ...(shown?.version === row.version && {
        createdVia: shown.via,
        viaInferred: shown.viaInferred,
        clientName: shown.clientName,
        basedOnVersion: shown.basedOnVersion,
        restoredFromVersion: shown.restoredFromVersion,
        changes: shown.changes,
      }),
    });
  });

  return app;
}

/** A create from a starter: the automation's name and shown name, the
 * answers to the starter's questions, and the creator's language. */
const instantiateSchema = z.object({
  name: z.string().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  answers: templateAnswersSchema,
  locale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
  /** Set the starter's trigger on; it starts runs once a version is
   * deployed. Off when left out. */
  enableTrigger: z.boolean().optional(),
});

/**
 * The starters a person creates an automation from (`templates.ts`), at
 * `/api/app/automation-templates` — beside the automations' own routes, so
 * no automation name is taken from authors. Authors list them and create
 * from one: the first version is saved through the editor's save — checked,
 * its tests run — installed in the project the answers name, and the
 * starter's trigger is set: on when the create asks, off otherwise.
 */
export function createAutomationTemplateRoutes(deps: {
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
    const denied = requireAuthor(c);
    if (denied) return denied;
    return c.json({
      templates: await listTemplateCards(deps.sql, c.get('orgId')),
    });
  });

  app.post('/:slug/instantiate', async (c) => {
    const denied = requireAuthor(c);
    if (denied) return denied;
    const body = instantiateSchema.safeParse(await c.req.json());
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const organizationId = c.get('orgId');
      const actor = c.get('sessionBundle').user.id;
      const prepared = await prepareTemplateInstance(deps.sql, {
        organizationId,
        slug: c.req.param('slug'),
        name: body.data.name,
        displayName: body.data.displayName,
        answers: body.data.answers,
        ...(body.data.locale !== undefined && { locale: body.data.locale }),
        visibleProjectIds: await readableProjectIds(
          deps.sql,
          await getProjectAuthContext(deps.sql, {
            organizationId,
            userId: actor,
            role: c.get('orgMember').role,
          }),
        ),
      });
      assembleAutomationAuthoringHost();
      const scope = { organizationId, origin: appOrigin(actor) };
      const store = pgAutomationStore(deps.sql, scope);
      let storeError: unknown;
      const result = await dispatch(
        'save_automation',
        { automation: prepared.document, message: prepared.message },
        {
          store: {
            ...store,
            save: (automation, message, options) =>
              saveVersion(deps.sql, {
                ...scope,
                name: body.data.name,
                document: automation,
                create: true,
                presentation: prepared.presentation,
                ...(message !== undefined ? { message } : {}),
                ...(options?.testsPassed !== undefined
                  ? { testsPassed: options.testsPassed }
                  : {}),
                ...(options?.testReport !== undefined
                  ? { testReport: options.testReport }
                  : {}),
                ...(prepared.projectId !== undefined
                  ? { projectId: prepared.projectId }
                  : {}),
              }).catch((error: unknown) => {
                storeError = error;
                throw error;
              }),
          },
        },
      );
      if (storeError !== undefined) throw storeError;
      const refused = authoringRefusal(c, result);
      if (refused !== null) return refused;
      // A webhook's address is minted by this bind and shown once: the
      // answer carries it, as the trigger route's does.
      const trigger =
        prepared.trigger === undefined
          ? undefined
          : await setTrigger(deps.sql, {
              organizationId,
              name: body.data.name,
              trigger: {
                ...prepared.trigger,
                enabled: body.data.enableTrigger === true,
              },
              origin: scope.origin,
            });
      return c.json(
        {
          ...(isRecord(result) ? result : {}),
          ...(trigger !== undefined && { trigger }),
        },
        201,
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
