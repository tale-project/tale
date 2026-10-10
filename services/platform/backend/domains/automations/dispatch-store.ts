import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { triggerInputSample } from '../../../lib/automations/trigger-input.ts';
import type {
  DeploymentEntry,
  DispatchStore,
  RunAsk,
  RunDetail,
  RunPage,
  RunSummary,
  TriggerView,
  VersionSummary,
  VersionView,
} from '../../../lib/engine/api/dispatch.ts';
import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { runStarterUserId } from '../../../lib/shared/run-starter.ts';
import {
  boundRunTrace,
  truncateRunDetail,
} from '../../core/automations/bound_run_payload.ts';
import { walkLlmServing } from '../../core/automations/llm_call.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import {
  mintCursorFor,
  verifyCursorFor,
} from '../../core/lib/signed_cursor.ts';
import { toJson } from '../../db/sql.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import {
  assertWritable,
  getProjectAuthContext,
  type ProjectAuthContext,
} from '../projects/service.ts';
import {
  credentialShimHandlers,
  listServingCredentialFacts,
} from '../provider_credentials/service.ts';
import { answerRunAskAs } from './ask-answer.ts';
import { listDeployments } from './audit.ts';
import { readOrgFacts } from './org-facts.ts';
import {
  automationVisible,
  readableProject,
  readableProjectIds,
  runControlAccess,
} from './project-visibility.ts';
import {
  AutomationError,
  assertAutomationName,
  type AutomationWriteVia,
  bindingProjectIds,
  bindProjectInTx,
  lockAutomationProjectBindingsInTx,
  deleteAutomationCascade,
  listRunsPage,
  unbindProjectInTx,
  beginRun,
  beginRunInTx,
  cancelRun,
  cancelRunInTx,
  decodeRunInput,
  deleteTrigger,
  deployedVersion,
  deploy as deployVersion,
  getPendingAskForRun,
  getRun,
  listAutomations,
  listRuns,
  listTriggers,
  listVersions,
  recordTestVerdict,
  resolveRunProject,
  saveVersion,
  setTrigger,
  toRunSummary,
  versionRow,
  type TriggerInput,
  beginRunIdempotent,
  beginRunIdempotentInTx,
} from './store.ts';
import { markAutomationWriterInTx } from './writer-protocol.ts';

/**
 * The engine's `DispatchStore` over the 0.5 automations store — what the
 * platform MCP endpoint's engine tools and App authoring doors drive
 * (`dispatch()` from `lib/engine/api/dispatch`). The 0.4
 * `automationActionStore` twin: reads/writes hop through the same store
 * functions every other caller uses, and the run-control methods AUTHORIZE
 * the actor (an API key proves who is calling; the role decides what the
 * call may do — live start/cancel/trigger-unbind need the developer
 * capability, mock start needs membership).
 */

class ActorAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ActorAuthError';
    this.code = code;
  }
}

/** The user an actor string names (`api-key:<userId>` → `<userId>`, a bare
 * id as itself) — read through the one parser of the starter format, so a
 * value that names nobody (a `trigger:` or an unknown door) is refused
 * as unauthenticated rather than mistaken for a user id. */
function actorUserId(actor: string): string {
  return runStarterUserId(actor) ?? '';
}

/** What a run this store starts records as its starter. An actor that
 * already names its door (`api-key:<userId>`) is recorded as is; a bare
 * user id — the App authoring and chat capability actor — is
 * recorded as `user:<userId>`, the form the app door writes, so every run
 * carries one of the documented prefixes and the erasure of a user finds
 * the runs they started. */
function runStarter(actor: string): string {
  return actor.includes(':') ? actor : `user:${actor}`;
}

/** The 0.4 `authorizeActorRun`: membership resolved from the (org, user)
 * pair; `developer` additionally needs the developer-settings capability. */
export async function authorizeActorRun(
  sql: Sql | TransactionSql,
  organizationId: string,
  actor: string,
  need: 'membership' | 'developer',
): Promise<ProjectAuthContext> {
  const userId = actorUserId(actor);
  if (userId === '') {
    throw new ActorAuthError(
      'UNAUTHENTICATED',
      'The caller could not be identified.',
    );
  }
  const rows = await sql<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    LIMIT 1
  `;
  const role = rows[0]?.role;
  if (role === undefined || role === 'disabled') {
    throw new ActorAuthError(
      'ORG_FORBIDDEN',
      'The caller is not a member of this organization.',
    );
  }
  if (
    need === 'developer' &&
    defineAbilityFor(role).cannot('read', 'developerSettings')
  ) {
    throw new ActorAuthError(
      'FORBIDDEN_DEVELOPER_SETTINGS',
      `Role "${role}" lacks the developer-settings capability required to perform this action.`,
    );
  }
  return getProjectAuthContext(sql, { organizationId, userId, role });
}

async function writableActorProject(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<void> {
  const project = await readableProject(sql, auth, projectId);
  if (project === null) {
    throw new ActorAuthError('PROJECT_NOT_FOUND', 'Project not found.');
  }
  assertWritable(project, auth);
  if (project.archivedAt !== null) {
    throw new ActorAuthError('PROJECT_ARCHIVED', 'Project is archived.');
  }
}

const TRIGGER_KINDS = new Set(['schedule', 'webhook', 'event']);

/** How long one model's serving walk may take before the validator gives
 * up on it: the walk reads live provider catalogs, and a save waiting on a
 * stalled one is worse than a warning not given. */
export const MODEL_AVAILABILITY_BUDGET_MS = 5_000;

/** How long the validator waits for what the organization has (its
 * skills, connectors, secrets, runtimes, the trigger's event) before it
 * stops asking: the same idiom as the model check — a slow read is a
 * warning not given, never a save held. */
export const ORG_FACTS_BUDGET_MS = 5_000;

/** `work()`'s answer, or `undefined` ("cannot tell") once the budget is
 * spent — the work itself is not cancelled, only no longer waited for. */
function withinBudget<T>(
  budgetMs: number,
  work: () => Promise<T>,
  what = 'model availability',
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[automations] ${what} not answered within ${budgetMs} ms; cannot tell`,
      );
      resolve(undefined);
    }, budgetMs);
  });
  return Promise.race([work(), expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export interface PgStoreScope {
  organizationId: string;
  /** Who saves/runs are attributed to (`api-key:<userId>` or a user id). */
  actor: string;
  /** The API key an `api-key:` actor authenticated with — recorded on the
   * runs this store starts so their spend books to the key as well, and on
   * the versions it saves. */
  apiKeyId?: string;
  projectId?: string;
  /** The door this store's saves come through, recorded on each version
   * (0181); absent, a version records none. */
  via?: AutomationWriteVia;
  /** The name the caller's client gave itself, recorded beside `via`. */
  clientName?: string;
  /** Answer reads as the app's listing would for the actor: an automation
   * installed only in projects the actor cannot read is "not found" on
   * every read (`automationVisible`). The machine doors set it. */
  visibleOnly?: boolean;
}

/** A run listing's position as `nextCursor` carries it, signed for the
 * listing that answered it — `<startedAt>:<runId>`. */
function runPosition(raw: string | null): { at: number; id: string } | null {
  if (raw === null) return null;
  const split = raw.indexOf(':');
  if (split <= 0 || split === raw.length - 1) return null;
  const stamp = raw.slice(0, split);
  if (!/^\d{1,15}$/.test(stamp)) return null;
  const at = Number(stamp);
  return Number.isSafeInteger(at) ? { at, id: raw.slice(split + 1) } : null;
}

export function pgAutomationStore(
  sql: Sql,
  scope: PgStoreScope,
): DispatchStore {
  const { organizationId, actor } = scope;
  // Who reads, and which projects they can read — asked once per store
  // (one dispatch call), however many automations the call reads.
  let viewer:
    | Promise<{ auth: ProjectAuthContext; readable: Set<string> }>
    | undefined;
  const viewerOf = () => {
    viewer ??= (async () => {
      const auth = await authorizeActorRun(
        sql,
        organizationId,
        actor,
        'membership',
      );
      return { auth, readable: new Set(await readableProjectIds(sql, auth)) };
    })();
    return viewer;
  };
  /** Whether a read of `name` answers "not found" for this actor. */
  const hidden = async (name: string): Promise<boolean> => {
    if (scope.visibleOnly !== true) return false;
    const bindings = await bindingProjectIds(sql, organizationId, name);
    if (bindings.length === 0) return false;
    return !automationVisible(bindings, (await viewerOf()).readable);
  };
  const authorizeInlineRun = async (
    handle: Sql | TransactionSql,
    name: string,
    mode: 'mock' | 'live',
  ): Promise<string | null> => {
    const auth = await authorizeActorRun(
      handle,
      organizationId,
      actor,
      mode === 'live' ? 'developer' : 'membership',
    );
    if (scope.projectId !== undefined) {
      await writableActorProject(handle, auth, scope.projectId);
    }
    return resolveRunProject(handle, {
      organizationId,
      name,
      ...(scope.projectId !== undefined
        ? { projectId: scope.projectId }
        : { requireOrgScope: true }),
    });
  };
  // The validator's model check: the llm node's own serving walk (the
  // direct connectors, their catalogs), so a warning names exactly what a
  // live run would refuse. Answered once per model per store instance — a
  // store lives for one dispatch call, so this is the per-validation cache.
  // An agent node may also be served by a subscription lane the direct walk
  // does not cover: when one is connected the answer is "cannot tell", never
  // a false warning. Any failure (an unreachable catalog, the database) is
  // "cannot tell" too — availability is a warning, never a refusal. So is
  // a walk that outlasts its budget: a slow catalog must not hold a save.
  const modelAnswers = new Map<string, Promise<boolean | undefined>>();
  const modelAvailability = (
    modelId: string,
    nodeType: 'llm' | 'agent',
  ): Promise<boolean | undefined> => {
    const key = `${nodeType}:${modelId}`;
    let pending = modelAnswers.get(key);
    if (pending === undefined) {
      pending = withinBudget(MODEL_AVAILABILITY_BUDGET_MS, async () => {
        const shim = createCtxShim({
          ...chatShimHandlers(sql),
          ...credentialShimHandlers(sql),
        });
        const walk = await walkLlmServing(
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 walk; its ctx reads (the org slug, the default credential rows) are covered by these handlers
          shim as unknown as ActionCtx,
          organizationId,
          modelId,
        );
        if (walk.target !== null) return true;
        if (walk.unreachable.length > 0) return undefined;
        if (nodeType === 'agent') {
          const facts = await listServingCredentialFacts(sql, organizationId);
          const subscription = facts.some(
            (fact) =>
              fact.authMethod === 'subscription-key' ||
              fact.authMethod === 'subscription-broker',
          );
          if (subscription) return undefined;
        }
        return false;
      }).catch((error: unknown) => {
        console.warn(
          '[automations] model availability could not be answered:',
          error instanceof Error ? error.message : error,
        );
        return undefined;
      });
      modelAnswers.set(key, pending);
    }
    return pending;
  };
  return {
    // The deployed version and the installations ride along: `latest` alone
    // hid whether an automation was live at all, and the bindings are the
    // one thing a caller needs to start a project-bound automation.
    list: async () => {
      const auth = await authorizeActorRun(
        sql,
        organizationId,
        actor,
        'membership',
      );
      const visible = new Set(await readableProjectIds(sql, auth));
      // An automation bound only to projects the member cannot read is left
      // out (`automationVisible`).
      return (await listAutomations(sql, organizationId)).flatMap((row) =>
        automationVisible(row.projectIds, visible)
          ? [
              {
                name: row.name,
                latest: row.latestVersion,
                deployedVersion: row.deployedVersion,
                projectIds: row.projectIds.filter((id) => visible.has(id)),
              },
            ]
          : [],
      );
    },
    get: async (name, version) => {
      if (await hidden(name)) return null;
      const row = await versionRow(sql, organizationId, name, version);
      return row
        ? { meta: { version: row.version }, automation: row.document }
        : null;
    },
    deployedVersion: async (name) =>
      (await hidden(name))
        ? null
        : ((await deployedVersion(sql, organizationId, name)) ?? null),
    modelAvailable: (modelId, nodeType) => modelAvailability(modelId, nodeType),
    // What the organization has of what the document names — read once per
    // validation, as the actor: secret names only for a role that may list
    // them, and the skills of the installations the actor may read.
    orgFacts: async (query) =>
      (await withinBudget(
        ORG_FACTS_BUDGET_MS,
        () =>
          readOrgFacts(sql, organizationId, query, async () => {
            const { auth, readable } = await viewerOf();
            return {
              role: auth.role,
              readable: scope.visibleOnly === true ? readable : null,
            };
          }),
        'organization facts',
      )) ?? {},
    // What the automation's enabled trigger sends — what the validator
    // checks the inputs schema and the fixed input against. The same sample
    // the store's save and deploy warnings check.
    triggerInput: async (name) => {
      const row = (await listTriggers(sql, organizationId, name))[0];
      if (row === undefined || !row.enabled) return null;
      return triggerInputSample(row, Date.now());
    },
    save: async (automation, message, options) => {
      const name = assertAutomationName(automation.name ?? '');
      // Ownership travels with the scope: a project-scoped authoring caller
      // pins its first save to that project; a caller naming one installs a
      // new automation there — a write on the project, so it must be one
      // they may edit, as the REST install requires.
      const projectId = scope.projectId ?? options?.projectId;
      const named = options?.projectId;
      if (
        named !== undefined &&
        scope.projectId !== undefined &&
        named !== scope.projectId
      ) {
        throw new ActorAuthError('PROJECT_NOT_FOUND', 'Project not found.');
      }
      // Who saves, and what they can read — resolved before the
      // transaction, judged inside it under the name lock (`authorize`).
      const saver =
        named !== undefined || scope.visibleOnly === true
          ? await viewerOf()
          : undefined;
      const authorize = async (
        tx: TransactionSql,
        latest: number | null,
      ): Promise<void> => {
        if (saver === undefined) return;
        if (latest === null) {
          // Only a save that creates the automation installs it in the
          // project it names; a version of one that exists ignores it, so
          // it is not checked there either.
          if (named !== undefined)
            await writableActorProject(tx, saver.auth, named);
          return;
        }
        // A version on top of an automation the person cannot see would
        // change it unseen — and the answer (its version, what it carried)
        // would reveal it. Refused as the name being taken, the answer a
        // create of an existing name gets (MCP-R9).
        if (scope.visibleOnly !== true) return;
        const bindings = await bindingProjectIds(tx, organizationId, name);
        if (
          bindings.length > 0 &&
          !automationVisible(bindings, saver.readable)
        ) {
          throw new AutomationError(
            'AUTOMATION_NAME_TAKEN',
            `An automation named "${name}" already exists — pick a different name.`,
            409,
          );
        }
      };
      const metadata = options?.metadata;
      return saveVersion(sql, {
        organizationId,
        name,
        document: automation,
        actor,
        authorize,
        ...(message !== undefined && message !== '' ? { message } : {}),
        ...(options?.testsPassed !== undefined
          ? { testsPassed: options.testsPassed }
          : {}),
        ...(options?.baseVersion !== undefined
          ? { baseVersion: options.baseVersion }
          : {}),
        ...(options?.create === true ? { create: true } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
        // The engine's caller names only what it changes: the version
        // fields it leaves out are kept from the latest version.
        ...(metadata === undefined
          ? {}
          : {
              metadataMode: 'carry' as const,
              ...(metadata.settings !== undefined
                ? { settings: metadata.settings }
                : {}),
              ...(metadata.taskContract !== undefined
                ? { taskContract: metadata.taskContract }
                : {}),
              ...(metadata.presentation !== undefined
                ? { presentation: metadata.presentation }
                : {}),
            }),
        ...(scope.via === undefined
          ? {}
          : {
              origin: {
                via: scope.via,
                ...(scope.apiKeyId === undefined
                  ? {}
                  : { apiKeyId: scope.apiKeyId }),
                ...(scope.clientName === undefined
                  ? {}
                  : { clientName: scope.clientName }),
              },
            }),
      });
    },
    recordTestVerdict: (name, version, testsPassed) =>
      recordTestVerdict(sql, { organizationId, name, version, testsPassed }),
    deploy: (name, version, options) =>
      deployVersion(sql, {
        organizationId,
        name,
        version,
        actor,
        ...(options?.testsPassed !== undefined
          ? { testsPassed: options.testsPassed }
          : {}),
        ...(options?.expectedDeployedVersion !== undefined
          ? { expectedDeployedVersion: options.expectedDeployedVersion }
          : {}),
      }),
    setTrigger: async (name, trigger) => {
      const automation = assertAutomationName(name);
      if (!TRIGGER_KINDS.has(trigger.kind)) {
        throw new Error(
          `unknown trigger kind "${trigger.kind}" — one of schedule, webhook, event`,
        );
      }
      // Cron/timezone/event validation lives in the store's `setTrigger`
      // (`assertTriggerValid`) so this engine door and the HTTP door converge
      // on ONE validation — a schedule that cannot parse is refused there with
      // an actionable AutomationError rather than saving green.
      // The store may mint a webhook token; its plaintext travels back
      // ONCE, to the caller that minted it — a machine door is exactly a
      // surface that can carry a secret once (the REST trigger door does),
      // and withholding it left the binding unusable from MCP alone
      // (2026-09-14 evaluation, h9).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kind was validated above; the store validates the rest
      const input = trigger as unknown as TriggerInput;
      const outcome = await setTrigger(sql, {
        organizationId,
        name: automation,
        trigger: input,
        actor,
      });
      return Object.keys(outcome).length === 0 ? undefined : outcome;
    },
    authorizeRun: async (name, mode) => {
      await authorizeInlineRun(sql, name, mode);
    },
    recordRun: async (name, version, result, mode) => {
      // A one-piece run (`run_deployed`) is born terminal — this insert IS
      // its exactly-once terminal transition, so a LIVE one also writes the
      // provenance audit row (the 0.4 contract). Dispatch only executes in
      // one piece when the host supplies an in-process connector host; this
      // host has none, so a live `run_deployed` arrives through `startRun`
      // (the durable stepper authorizes, executes and records it) and this
      // path sees mock runs only.
      const now = Date.now();
      const status = result.status === 'success' ? 'success' : 'failed';
      const detail =
        result.error?.message !== undefined
          ? truncateRunDetail(result.error.message)
          : undefined;
      await transactSerializable(sql, async (tx) => {
        await markAutomationWriterInTx(tx);
        const projectId = await authorizeInlineRun(tx, name, mode);
        const inserted = await tx<{ id: string }[]>`
          INSERT INTO app.automation_runs (
            org_id, name, version, project_id, status, mode, started_by,
            api_key_id, input, output,
            checkpoints, trace, effects, detail, claim_epoch, started_at_ms,
            finished_at_ms
          ) VALUES (
            ${organizationId}, ${name}, ${version}, ${projectId}, ${status}, ${mode},
            ${runStarter(actor)}, ${scope.apiKeyId ?? null},
            ${tx.json(toJson(JSON.stringify(null)))},
            ${result.output === undefined ? null : tx.json(toJson(result.output))},
            ${tx.json(toJson({ nodes: {}, executions: 0 }))},
            ${tx.json(toJson(boundRunTrace(result.trace)))},
            ${tx.json(toJson(result.effects))}, ${detail ?? null}, 0, ${now},
            ${now}
          )
          RETURNING id
        `;
        const runId = inserted[0]?.id;
        if (!runId) throw new Error('run insert failed');
        if (mode === 'live') {
          await createAuditLog(tx, {
            organizationId,
            actorId: actor,
            actorType: 'system',
            action: `automation.run.${status}`,
            category: 'ai',
            resourceType: 'automation_run',
            resourceId: runId,
            resourceName: `${name}@${version}`,
            status: status === 'success' ? 'success' : 'failure',
            ...(detail !== undefined ? { errorMessage: detail } : {}),
            metadata: { effectsCount: result.effects.length, executions: 0 },
          });
        }
      });
    },
    startRun: async (name, input, mode, version, projectId, options) => {
      const auth = await authorizeActorRun(
        sql,
        organizationId,
        actor,
        mode === 'live' ? 'developer' : 'membership',
      );
      if (
        scope.projectId !== undefined &&
        projectId !== undefined &&
        scope.projectId !== projectId
      ) {
        throw new ActorAuthError('PROJECT_NOT_FOUND', 'Project not found.');
      }
      const effectiveProjectId = scope.projectId ?? projectId;
      const args = {
        organizationId,
        name,
        // An absent input is an empty one; a null input is the null the
        // caller sent, for the inputs schema to accept or refuse.
        input: input === undefined ? {} : input,
        mode,
        startedBy: runStarter(actor),
        ...(scope.apiKeyId !== undefined ? { apiKeyId: scope.apiKeyId } : {}),
        ...(version !== undefined ? { version } : {}),
      };
      // The caller's idempotency key rides the REST door's own ledger —
      // one key, one run, across both dialects (2026-09-14 evaluation, h9).
      const key = options?.idempotencyKey;
      // The handle names its scope too: a project run is read back at the
      // project URL, an organization run at the flat one.
      if (effectiveProjectId !== undefined) {
        const started = await transactSerializable(sql, async (tx) => {
          await writableActorProject(tx, auth, effectiveProjectId);
          const scoped = { ...args, projectId: effectiveProjectId };
          return key === undefined
            ? beginRunInTx(tx, scoped)
            : beginRunIdempotentInTx(tx, scoped, { key });
        });
        return started === null
          ? null
          : { ...started, projectId: effectiveProjectId };
      }
      const orgArgs = { ...args, requireOrgScope: true };
      const started =
        key === undefined
          ? await beginRun(sql, orgArgs)
          : await beginRunIdempotent(sql, orgArgs, { key });
      return started === null ? null : { ...started, projectId: null };
    },
    cancelRun: async (runId) => {
      const auth = await authorizeActorRun(
        sql,
        organizationId,
        actor,
        'developer',
      );
      const row = await getRun(sql, organizationId, runId);
      if (
        row === null ||
        (scope.projectId !== undefined && row.projectId !== scope.projectId)
      ) {
        return { cancelled: false };
      }
      if (row.projectId !== null) {
        const projectId = row.projectId;
        return transactSerializable(sql, async (tx) => {
          await writableActorProject(tx, auth, projectId);
          return cancelRunInTx(tx, organizationId, runId, auth.userId);
        });
      }
      // The store answers `{ cancelled: false }` for a missing or terminal
      // run and never null; a throw here is a real failure (audit write,
      // session stop, the database) and must surface as such, not be
      // laundered into `no run`.
      return cancelRun(sql, organizationId, runId, auth.userId);
    },
    deleteTrigger: async (name) => {
      await authorizeActorRun(sql, organizationId, actor, 'developer');
      return {
        deleted: await deleteTrigger(sql, organizationId, name, actor),
      };
    },
    listRuns: async (options) => {
      const auth = await authorizeActorRun(
        sql,
        organizationId,
        actor,
        'membership',
      );
      if (
        scope.projectId !== undefined &&
        (await readableProject(sql, auth, scope.projectId)) === null
      )
        return [];
      const visibleProjectIds = await readableProjectIds(sql, auth);
      return (
        await listRuns(sql, organizationId, {
          ...(options.name !== undefined ? { name: options.name } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
          ...(scope.projectId !== undefined
            ? { projectId: scope.projectId }
            : {}),
          visibleProjectIds,
        })
      ).map(toRunSummary);
    },
    getRun: async (runId): Promise<RunDetail | null> => {
      const auth = await authorizeActorRun(
        sql,
        organizationId,
        actor,
        'membership',
      );
      const row = await getRun(sql, organizationId, runId);
      if (!row) return null;
      if (scope.projectId !== undefined && row.projectId !== scope.projectId)
        return null;
      if (
        row.projectId !== null &&
        (await readableProject(sql, auth, row.projectId)) === null
      )
        return null;
      const summary = toRunSummary(row);
      /** The question the run waits on — the askId `answer_run_ask` needs,
       * read only for a run that waits on one (the REST door's
       * `GET /runs/{id}/ask`, folded into the run). */
      const waitingAsk = async (run: RunSummary): Promise<{ ask?: RunAsk }> => {
        if (run.status !== 'waiting' || run.waitingFor !== 'ask') return {};
        const pending = await getPendingAskForRun(sql, organizationId, runId);
        if (pending === null) return {};
        const { runId: _sameRun, ...ask } = pending;
        return { ask };
      };
      return {
        ...summary,
        input: decodeRunInput(row.input),
        ...(row.output !== null && row.output !== undefined
          ? { output: row.output }
          : {}),
        ...(row.trace !== null && row.trace !== undefined
          ? { trace: row.trace }
          : {}),
        ...(row.effects !== null && row.effects !== undefined
          ? { effects: row.effects }
          : {}),
        ...(await waitingAsk(summary)),
      };
    },
    listVersions: async (name): Promise<VersionSummary[]> => {
      if (await hidden(name)) return [];
      const versions: VersionSummary[] = [];
      for (const row of await listVersions(sql, organizationId, name)) {
        const version: VersionSummary = {
          version: row.version,
          createdBy: row.createdBy,
          createdAt: row.createdAt,
          createdVia: row.createdVia,
          clientName: row.clientName,
        };
        if (row.message !== null) version.message = row.message;
        if (row.testsPassed !== null) version.testsPassed = row.testsPassed;
        if (row.testsCheckedAt !== null) {
          version.testsCheckedAt = row.testsCheckedAt;
        }
        versions.push(version);
      }
      return versions;
    },
    listTriggers: async (name): Promise<TriggerView[]> => {
      const views: TriggerView[] = [];
      for (const row of await listTriggers(sql, organizationId, name)) {
        // A trigger of an automation the actor cannot see is not theirs to
        // read either.
        if (await hidden(row.name)) continue;
        const view: TriggerView = {
          id: row.id,
          name: row.name,
          kind: row.kind,
          hasToken: row.hasToken,
          enabled: row.enabled,
        };
        if (row.cron !== null) view.cron = row.cron;
        if (row.repeat !== null) view.repeat = row.repeat;
        if (row.startDate !== null) view.startDate = row.startDate;
        if (row.timezone !== null) view.timezone = row.timezone;
        if (row.catchUp !== null) view.catchUp = row.catchUp;
        if (row.input !== null) view.input = row.input;
        if (row.event !== null) view.event = row.event;
        if (row.nextRunAt !== null) view.nextRunAt = row.nextRunAt;
        if (row.lastFiredAt !== null) view.lastFiredAt = row.lastFiredAt;
        if (row.lastRunId !== null) view.lastRunId = row.lastRunId;
        if (row.lastSkippedAt !== null) view.lastSkippedAt = row.lastSkippedAt;
        if (row.lastSkipReason !== null) {
          view.lastSkipReason = row.lastSkipReason;
        }
        if (row.lastSkipDetail !== null) {
          view.lastSkipDetail = row.lastSkipDetail;
        }
        view.consecutiveFailures = row.consecutiveFailures;
        if (row.lastFailedAt !== null) view.lastFailedAt = row.lastFailedAt;
        if (row.lastFailureCode !== null) {
          view.lastFailureCode = row.lastFailureCode;
        }
        if (row.lastFailedRunId !== null) {
          view.lastFailedRunId = row.lastFailedRunId;
        }
        views.push(view);
      }
      return views;
    },
    getVersionView: async (name, version): Promise<VersionView | null> => {
      if (await hidden(name)) return null;
      const row = await versionRow(sql, organizationId, name, version);
      if (row === null) return null;
      const latest =
        version === undefined
          ? row
          : await versionRow(sql, organizationId, name, undefined);
      const { readable } = await viewerOf();
      const [live, bindings, triggers] = await Promise.all([
        deployedVersion(sql, organizationId, name),
        bindingProjectIds(sql, organizationId, name),
        listTriggers(sql, organizationId, name),
      ]);
      const trigger = triggers[0];
      return {
        name: row.name,
        version: row.version,
        latestVersion: latest?.version ?? row.version,
        deployedVersion: live ?? null,
        document: row.document,
        settings: row.settings ?? null,
        taskContract: row.taskContract ?? null,
        presentation: row.presentation ?? null,
        message: row.message,
        testsPassed: row.testsPassed,
        testsCheckedAt: row.testsCheckedAt,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        createdVia: row.createdVia,
        clientName: row.clientName,
        // The installations the caller can see, never a hidden project.
        projectIds: bindings.filter((id) => readable.has(id)),
        // What starts it — never the webhook secret.
        trigger:
          trigger === undefined
            ? null
            : {
                id: trigger.id,
                name: trigger.name,
                kind: trigger.kind,
                ...(trigger.cron === null ? {} : { cron: trigger.cron }),
                ...(trigger.timezone === null
                  ? {}
                  : { timezone: trigger.timezone }),
                ...(trigger.event === null ? {} : { event: trigger.event }),
                hasToken: trigger.hasToken,
                enabled: trigger.enabled,
              },
      };
    },
    listDeployments: async (name): Promise<DeploymentEntry[]> =>
      (await hidden(name)) ? [] : listDeployments(sql, organizationId, name),
    deleteAutomation: async (name, expectedLatestVersion) => {
      await authorizeActorRun(sql, organizationId, actor, 'developer');
      if (await hidden(name)) {
        throw new AutomationError(
          'AUTOMATION_NOT_FOUND',
          `no saved automation named "${name}"`,
          404,
        );
      }
      return deleteAutomationCascade(sql, {
        organizationId,
        name,
        actor,
        expectedLatestVersion,
      });
    },
    setAutomationProjects: async (name, change) => {
      const auth = await authorizeActorRun(
        sql,
        organizationId,
        actor,
        'developer',
      );
      // One transaction: every project's edit gate, then every change — a
      // refusal of any leaves the installations as they were.
      return transactSerializable(sql, async (tx) => {
        const installed = new Set(
          await bindingProjectIds(tx, organizationId, name),
        );
        const added: string[] = [];
        const removed: string[] = [];
        const unchanged: string[] = [];
        for (const projectId of new Set([...change.add, ...change.remove])) {
          await writableActorProject(tx, auth, projectId);
        }
        await lockAutomationProjectBindingsInTx(tx, { organizationId, name }, [
          ...new Set([...change.add, ...change.remove]),
        ]);
        for (const projectId of new Set(change.remove)) {
          if (!installed.has(projectId)) {
            throw new AutomationError(
              'AUTOMATION_NOT_INSTALLED',
              `"${name}" is not installed in project ${projectId} — nothing to remove.`,
              404,
              { projectId },
            );
          }
          await unbindProjectInTx(tx, {
            organizationId,
            name,
            projectId,
            actor,
          });
          removed.push(projectId);
        }
        for (const projectId of new Set(change.add)) {
          const { bound } = await bindProjectInTx(tx, {
            organizationId,
            name,
            projectId,
            actor,
          });
          (bound ? added : unchanged).push(projectId);
        }
        return { added, removed, unchanged };
      });
    },
    answerAsk: async (runId, askId, answer) => {
      const auth = await authorizeActorRun(
        sql,
        organizationId,
        actor,
        'membership',
      );
      const run = await getRun(sql, organizationId, runId);
      // The run must be one the actor can see; a project run's question is
      // answered by someone who may edit the project (the app's gate and
      // the REST door's).
      const access =
        run === null ||
        (scope.projectId !== undefined && run.projectId !== scope.projectId)
          ? 'hidden'
          : await runControlAccess(sql, auth, run);
      if (run === null || access === 'hidden') {
        throw new AutomationError('RUN_NOT_FOUND', `no run "${runId}"`, 404);
      }
      if (run.projectId !== null) {
        await writableActorProject(sql, auth, run.projectId);
      }
      return answerRunAskAs(sql, {
        organizationId,
        run,
        askId,
        answer,
        // The key holder answers as themselves, like a REST answer without
        // an `actor`: the ask records the door, the audit row the person.
        answeredBy: runStarter(actor),
        author: auth,
      });
    },
    listRunsPage: async (options): Promise<RunPage | null> => {
      const auth = (await viewerOf()).auth;
      const list = `mcp-runs:${scope.projectId ?? 'all'}:${options.name ?? ''}:${options.mode ?? ''}:${(options.statuses ?? []).join(',')}`;
      const before =
        options.cursor === undefined
          ? null
          : runPosition(verifyCursorFor(organizationId, list, options.cursor));
      if (options.cursor !== undefined && before === null) return null;
      if (
        scope.projectId !== undefined &&
        (await readableProject(sql, auth, scope.projectId)) === null
      ) {
        return { runs: [], nextCursor: null };
      }
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const page = await listRunsPage(sql, organizationId, {
        ...(options.name !== undefined ? { name: options.name } : {}),
        ...(scope.projectId !== undefined
          ? { projectId: scope.projectId }
          : {}),
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
        ...(options.statuses !== undefined
          ? { statuses: options.statuses }
          : {}),
        visibleProjectIds: [...(await viewerOf()).readable],
        ...(before === null ? {} : { before }),
        limit,
      });
      return {
        runs: page.runs.map(toRunSummary),
        nextCursor:
          page.next === null
            ? null
            : mintCursorFor(
                organizationId,
                list,
                `${page.next.at}:${page.next.id}`,
              ),
      };
    },
  } satisfies DispatchStore;
}
