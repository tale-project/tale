/**
 * The single method table behind every surface — HTTP JSON-RPC, the platform
 * MCP endpoint, and the builder session loop all call `dispatch()`, so
 * behavior can't diverge between interfaces. A text protocol is the measured
 * common denominator; native tool-calling and constrained decoding both fare
 * worse for small models.
 *
 * Live execution is host-gated: `run_automation {mode: "live"}` and
 * `run_deployed` require the host to pass `allowLive: true`; a builder loop
 * cannot reach real backends from a test session. Enabling live is not the
 * same as being able to execute live IN-PROCESS: the executor only reaches a
 * connector's live body through a `connectorHost`, and a host that has none
 * (every platform host today) must not run the deterministic mocks and call
 * the outcome a live run. So without a connector host `run_deployed` hands the
 * run to the store's durable runner (`startRun`, the same lane `start_run`
 * uses, where the host executes connectors live and records the run) and
 * waits a bounded time for it, and `run_automation {mode: "live"}` — an
 * unsaved document, which no durable runner can take — is refused as data.
 *
 * The store is injected (not a module singleton), because the host owns
 * persistence — the selftest passes an in-memory store, the automations host
 * passes a Postgres-backed one. Reads use the same `StoreAdapter` the executor
 * resolves subautomations through; the write operations extend it. Because a
 * store is scoped to one organization, dispatch threads it into every
 * `validate()`, `execute()` and test run as an option — there is no
 * process-global store slot for a host to forget.
 *
 * The table covers two jobs, and the split matters when reading it: the
 * AUTHORING methods (validate/run/test/save/deploy/get/list) work on documents,
 * while the MANAGEMENT methods (start_run/list_runs/get_run/cancel_run/
 * list_versions/list_triggers/delete_trigger) work on what the host has
 * persisted. Management is optional per store — a store that cannot host
 * durable runs answers "not supported in this environment" instead of
 * pretending, so the same table serves a bare test harness and a full
 * deployment.
 */

import { execute, type ExecuteOptions } from '../core/execute';
import type { StoreAdapter } from '../core/slots';
import { nodeTypes } from '../core/slots';
import type { Automation, RunResult } from '../core/types';
import { validate } from '../core/validate';
import { searchCatalog } from './catalog-search';
import { authoringReference } from './docs';
import { runAutomationTests } from './tests';

export const METHODS = [
  'get_docs',
  'get_catalog',
  'search_catalog',
  'validate_automation',
  'run_automation',
  'test_automation',
  'save_automation',
  'get_automation',
  'list_automations',
  'deploy_automation',
  'set_trigger',
  'run_deployed',
  'start_run',
  'list_runs',
  'get_run',
  'cancel_run',
  'list_versions',
  'list_triggers',
  'delete_trigger',
] as const;

export type Method = (typeof METHODS)[number];

/** A trigger binding the host persists and acts on. The engine only records
 * it; scheduling and delivery are the host's job. */
export interface TriggerSpec {
  kind: 'schedule' | 'webhook' | 'event';
  [k: string]: unknown;
}

/** One run as the management methods report it. Ids are strings here: the
 * engine addresses a run by whatever handle the host minted, without learning
 * what a host's identifier is made of. */
export interface RunSummary {
  runId: string;
  name: string;
  version: number;
  /** The project the run operates in — null for an organization run. A
   * host that scopes reads by project (the REST door does) needs it to
   * build the run's URL. */
  projectId?: string | null;
  status: string;
  mode: string;
  startedBy: string;
  detail?: string;
  /** What a `waiting` run is parked on — `approval` (a person's decision),
   * `ask` (a question a person has to answer), `agent` (an agent turn
   * still running), `repeat` (a node polling until its condition holds).
   * Only the first two need a human; present only while waiting. */
  waitingFor?: 'approval' | 'ask' | 'agent' | 'repeat';
  startedAt: number;
  finishedAt?: number;
}

/** One run in full — what `get_run` answers with once the host has recorded
 * the outcome. The trace and effects are the engine's own result fields, so a
 * polled run reads exactly like a synchronous one. */
export interface RunDetail extends RunSummary {
  input?: unknown;
  output?: unknown;
  trace?: unknown;
  effects?: unknown;
}

/** One entry of an automation's immutable version history. */
export interface VersionSummary {
  version: number;
  message?: string;
  testsPassed?: boolean;
  createdBy: string;
  createdAt: number;
}

/** A trigger as a caller may see it — never the secret that verifies it. */
export interface TriggerView {
  /** The binding's id — what a run's `startedBy` (`trigger:<id>`) names.
   * A host without durable ids (the selftest store) leaves it out. */
  id?: string;
  name: string;
  kind: string;
  cron?: string;
  timezone?: string;
  event?: string;
  /** Whether a webhook token was ever minted, WITHOUT revealing it. */
  hasToken: boolean;
  enabled: boolean;
  /** The last time this binding started a run — `lastRunId` names it. */
  lastFiredAt?: number;
  lastRunId?: string;
  /** The last time the binding came due and started nothing, and why:
   * `not_deployed`, `unusable_cron` or `start_refused`. */
  lastSkippedAt?: number;
  lastSkipReason?: string;
}

/** What binding a trigger changed besides recording it: `revoked` names a
 * live webhook URL the bind replaced with another kind. */
export interface SetTriggerOutcome {
  revoked?: 'webhook';
}

/**
 * The persistence surface dispatch needs: the executor's read adapter, the
 * writes the authoring loop performs, and the run/version/trigger management
 * an operator surface performs.
 *
 * Everything past `deploy` is OPTIONAL — a bare selftest store need not host
 * durable runs, and dispatch reports that a called capability is unavailable
 * in this environment rather than throwing.
 */
export interface DispatchStore extends StoreAdapter {
  save(
    automation: Automation,
    message?: string,
  ): Promise<{ name: string; version: number }>;
  /** Promote a saved version. `options.testsPassed` is set when the deploy
   * gate just ran the version's tests and they passed — a host that keeps a
   * per-version verdict stamps it, so the version reads as tested. */
  deploy(
    name: string,
    version: number,
    options?: { testsPassed?: boolean },
  ): Promise<{ name: string; version: number }>;
  /** Record a trigger binding. A host that revokes something by doing so (a
   * live webhook URL replaced by another kind) says so in the outcome; a
   * host with nothing to add answers nothing. */
  setTrigger?(
    name: string,
    trigger: TriggerSpec,
  ): Promise<SetTriggerOutcome | undefined>;
  /** Host authorization before an in-process deployed run starts executing. */
  authorizeRun?(name: string, mode: 'mock' | 'live'): Promise<void>;
  recordRun?(
    name: string,
    version: number,
    result: RunResult,
    mode: 'mock' | 'live',
  ): Promise<void>;
  /** Hand a run to the host's durable runner. Returns the handle to poll, or
   * null when the automation has no version to run. `projectId`, when given,
   * is the project the run operates in — the host validates it against the
   * automation's bindings and the actor's access. A project-aware host can
   * pin the scope; otherwise omission requests an organization run. */
  startRun?(
    name: string,
    input: unknown,
    mode: 'mock' | 'live',
    version?: number,
    projectId?: string,
  ): Promise<{
    runId: string;
    version: number;
    /** The project the run operates in (null: organization-wide) — the
     * scope a host that reads runs by project needs to build its URL. */
    projectId?: string | null;
  } | null>;
  listRuns?(options: { name?: string; limit?: number }): Promise<RunSummary[]>;
  getRun?(runId: string): Promise<RunDetail | null>;
  cancelRun?(runId: string): Promise<{ cancelled: boolean }>;
  listVersions?(name: string): Promise<VersionSummary[]>;
  listTriggers?(name?: string): Promise<TriggerView[]>;
  /** Unbind the automation's trigger. `deleted` says whether one was bound —
   * an unbind that found nothing is not a change, and the caller must be
   * able to tell. */
  deleteTrigger?(name: string): Promise<{ deleted: boolean }>;
}

/**
 * The refusal for a trigger call that names an automation the store has never
 * saved. A trigger binds to a NAME, and the host persists it without looking
 * the automation up, so without this check a typo would either record an
 * orphan binding or report an unbind that unbound nothing — both read as
 * success to the caller.
 */
async function missingAutomation(
  store: DispatchStore,
  name: string,
): Promise<{ error: string; code: string; hint: string } | null> {
  if ((await store.get(name)) !== null) return null;
  return {
    error: `no saved automation named "${name}"`,
    code: 'AUTOMATION_NOT_FOUND',
    hint: LIST_AUTOMATIONS_HINT,
  };
}

/**
 * The refusal vocabulary of THIS table — the codes dispatch itself mints,
 * beside the host's own (`AutomationError`, `ActorAuthError`, lifted by
 * {@link refusalFrom}). Every refusal carries one, and a `hint` saying
 * what to do, so a calling model can branch and self-correct without
 * parsing the sentence. MCP-only vocabulary: the REST door never answers
 * these, so they live in the MCP docs, not the REST registry.
 */
export const DISPATCH_REFUSAL_CODES = [
  /** A parameter is missing or malformed (a host that validates arguments
   * against the tool schema, like the MCP endpoint, refuses these at the
   * transport instead). */
  'INVALID_PARAMS',
  /** The method is not in the table. */
  'UNKNOWN_METHOD',
  /** The document fails validation where a valid one is needed. */
  'AUTOMATION_INVALID',
  /** The deploy gate: the version's own tests fail. */
  'AUTOMATION_TESTS_FAILING',
  /** Live execution is not enabled, or has no lane, in this environment. */
  'LIVE_MODE_UNAVAILABLE',
  /** The store behind this host lacks the capability (runs, versions,
   * triggers). */
  'NOT_SUPPORTED',
  'AUTOMATION_NOT_FOUND',
  'AUTOMATION_VERSION_UNKNOWN',
  'AUTOMATION_NOT_DEPLOYED',
  'RUN_NOT_FOUND',
] as const;

const LIST_AUTOMATIONS_HINT = 'list_automations shows the saved ones';
const RUN_ID_HINT =
  'start_run returns the runId; list_runs lists the recent ones';
const LIST_VERSIONS_HINT =
  'list_versions shows the saved versions of an automation';

/** The refusal for a capability the store behind this host does not have —
 * a bare selftest store keeps no runs, versions or triggers. */
function notSupported(what: string): {
  error: string;
  code: 'NOT_SUPPORTED';
  hint: string;
} {
  return {
    error: `${what} not supported in this environment`,
    code: 'NOT_SUPPORTED',
    hint: 'this host keeps no durable runs, versions or triggers — a platform host serves them; test against mocks here',
  };
}

/**
 * A host refusal as data: the message, the stable `code` the host's own
 * error classes carry (`AutomationError`, `ActorAuthError`) so a client
 * can branch on it, and — where the host attached them — the `hint` that
 * says what to do and the structured `data` (the schema problems of a
 * refused run input). The catch sites used to keep only the sentence. A
 * thrown value without a code stays a bare message.
 */
function refusalFrom(error: unknown): {
  error: string;
  code?: string;
  hint?: string;
  data?: Record<string, unknown>;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (error === null || typeof error !== 'object') return { error: message };
  const code: unknown = Reflect.get(error, 'code');
  const hint: unknown = Reflect.get(error, 'hint');
  const data: unknown = Reflect.get(error, 'data');
  return {
    error: message,
    ...(typeof code === 'string' && code !== '' && { code }),
    ...(typeof hint === 'string' && hint !== '' && { hint }),
    ...(data !== null &&
      typeof data === 'object' &&
      !Array.isArray(data) && {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
        data: data as Record<string, unknown>,
      }),
  };
}

export interface DispatchContext {
  store: DispatchStore;
  /** Enable live connector calls — deployments/hosts only, never a builder
   * test loop. */
  allowLive?: boolean;
  /**
   * The mediated capabilities a live connector call reaches when the host
   * executes IN-PROCESS (`ExecuteOptions.connectorHost`). Absent, a live
   * one-piece run is never executed here: `run_deployed` goes through the
   * store's durable runner and `run_automation {mode: "live"}` is refused.
   */
  connectorHost?: ExecuteOptions['connectorHost'];
  /** How long `run_deployed` waits for a durable live run before answering
   * with the run handle instead of the result. Hosts keep the defaults;
   * tests shorten them. */
  liveRunWait?: { timeoutMs?: number; pollMs?: number };
}

/** The default patience of a one-piece live run: long enough for the quick
 * automations `run_deployed` is meant for, short enough that a tool call
 * answers before an MCP client gives up on it. */
const LIVE_RUN_WAIT_TIMEOUT_MS = 30_000;
const LIVE_RUN_WAIT_POLL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `run_deployed` on a host without an in-process connector host: start the
 * deployed version on the durable runner (which authorizes the actor and
 * executes connectors live) and wait a bounded time for it to finish. A run
 * that finishes in time answers like a synchronous run — status, output,
 * trace, effects — plus its `runId`; one that outlives the wait answers with
 * the handle to poll, never with an unfinished result dressed as one.
 */
async function runDeployedDurably(
  ctx: DispatchContext,
  name: string,
  version: number,
  input: unknown,
): Promise<unknown> {
  const { store } = ctx;
  if (!store.startRun || !store.getRun) {
    return {
      error: 'live execution is not available in this environment',
      code: 'LIVE_MODE_UNAVAILABLE',
      hint: 'this host has neither an in-process connector host nor a durable runner; test against mocks instead',
    };
  }
  let started: { runId: string; version: number } | null;
  try {
    started = await store.startRun(name, input, 'live', version);
  } catch (e) {
    return refusalFrom(e);
  }
  if (!started)
    return {
      error: `deployed version ${name}@${version} is missing`,
      code: 'AUTOMATION_VERSION_UNKNOWN',
      hint: `the deployed version is gone — deploy_automation a saved one (${LIST_VERSIONS_HINT})`,
    };
  const timeoutMs = ctx.liveRunWait?.timeoutMs ?? LIVE_RUN_WAIT_TIMEOUT_MS;
  const pollMs = ctx.liveRunWait?.pollMs ?? LIVE_RUN_WAIT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let run = await store.getRun(started.runId);
  while (run?.finishedAt === undefined && Date.now() < deadline) {
    await sleep(pollMs);
    run = await store.getRun(started.runId);
  }
  if (run?.finishedAt === undefined) {
    return {
      runId: started.runId,
      version: started.version,
      mode: 'live',
      status: run?.status ?? 'queued',
      note: `the run is still going after ${Math.round(timeoutMs / 1000)}s — poll get_run {runId} for its status, output, trace and effects`,
    };
  }
  return {
    runId: run.runId,
    version: run.version,
    mode: 'live',
    status: run.status,
    ...(run.output !== undefined && { output: run.output }),
    ...(run.detail !== undefined && { error: { message: run.detail } }),
    trace: run.trace ?? [],
    effects: run.effects ?? [],
  };
}

/** Coerce an unknown param to a string without an object ever stringifying
 * to "[object Object]" — non-strings that aren't numbers/booleans become
 * empty, which the callers treat as "missing". */
function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/**
 * Read a present `params.version`: a whole number (or its string form) is the
 * version, anything else is a refusal the caller returns as-is. Never
 * forwards NaN — a store binds the value into a query, and a raw database
 * error would blame the storage layer for a bad param. Callers that accept
 * an omitted version branch on `undefined` before asking.
 */
function versionParam(
  v: unknown,
  hint: string,
): { value: number } | { error: string; code: 'INVALID_PARAMS'; hint: string } {
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isInteger(n)) {
    return {
      error: `params.version must be a whole number — got ${JSON.stringify(v)}`,
      code: 'INVALID_PARAMS',
      hint,
    };
  }
  return { value: n };
}

function paramsObject(params: unknown): Record<string, unknown> {
  return params !== null && typeof params === 'object' && !Array.isArray(params)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
      (params as Record<string, unknown>)
    : {};
}

export async function dispatch(
  method: string,
  params: unknown,
  ctx: DispatchContext,
): Promise<unknown> {
  const p = paramsObject(params);
  const { store } = ctx;

  switch (method) {
    case 'get_docs':
      // The authoring REFERENCE — not the builder session's system prompt,
      // which wraps this same reference in the session's own protocol and
      // persona (`automations_builder/policy.ts`). Served to MCP clients,
      // it must teach the endpoint's own dialect and instruct nobody.
      return { docs: authoringReference() };

    case 'get_catalog': {
      // The whole catalog with every input schema runs past 100 KB;
      // `kind` narrows it to one node kind and `compact` drops the
      // schemas, so a client can discover without reading it all.
      const kind = asString(p.kind);
      const compact = p.compact === true;
      const node_types = [];
      for (const t of nodeTypes().values()) {
        if (kind !== '' && t.kind !== kind) continue;
        const entry: Record<string, unknown> = {
          type: t.type,
          kind: t.kind,
          description: t.description,
          outputKind: t.outputKind,
        };
        if (!compact) {
          entry.fields = [
            'id',
            'type',
            ...t.allowedFields.map((f) =>
              t.requiredFields.includes(f) ? f : `${f}?`,
            ),
          ];
          if (t.connector) {
            entry.input_schema = t.connector.inputSchema;
            entry.output = t.connector.outputSignature;
          }
        }
        node_types.push(entry);
      }
      return { node_types };
    }

    case 'search_catalog': {
      const query = asString(p.query).trim();
      if (!query) {
        return {
          error: 'missing params.query',
          code: 'INVALID_PARAMS',
          hint: 'search_catalog takes {query: "send email"} — capability keywords, verbs and objects',
        };
      }
      const matches = searchCatalog(query);
      if (matches.length > 0) return { matches };
      // The catalog is the CONNECTOR surface; the core node kinds (transform,
      // llm, agent, subautomation) are the grammar get_docs teaches, so a
      // search for one of them must point there instead of answering "nothing".
      const coreKind = [...nodeTypes().values()].find(
        (def) => def.kind !== 'connector' && def.type === query.toLowerCase(),
      );
      return {
        matches,
        hint: coreKind
          ? `"${coreKind.type}" is a core node kind, not a catalog capability — get_docs describes it`
          : 'no matches — try different capability keywords (verbs + objects)',
      };
    }

    case 'validate_automation': {
      if (!p.automation) {
        return {
          error: 'missing params.automation',
          code: 'INVALID_PARAMS',
          hint: 'validate_automation takes {automation: <the automation document>}',
        };
      }
      const { errors, warnings } = await validate(p.automation, { store });
      return { valid: errors.length === 0, errors, warnings };
    }

    case 'run_automation': {
      if (!p.automation) {
        return {
          error: 'missing params.automation',
          code: 'INVALID_PARAMS',
          hint: 'run_automation takes {automation: <the automation document>, input: <its runtime input>}',
        };
      }
      const mode = p.mode ?? 'mock';
      if (mode !== 'mock' && mode !== 'live') {
        return {
          error: `unknown mode "${String(p.mode)}"`,
          code: 'INVALID_PARAMS',
          hint: 'mode is "mock" (default) or "live"',
        };
      }
      if (mode === 'live' && !ctx.allowLive) {
        return {
          error: 'live mode is not enabled in this environment',
          code: 'LIVE_MODE_UNAVAILABLE',
          hint: 'test against mocks; live execution is enabled on deployment (host sets allowLive)',
        };
      }
      if (mode === 'live' && !ctx.connectorHost) {
        // An unsaved document has no durable-runner lane, and running the
        // deterministic mocks under the name "live" would be a lie.
        return {
          error:
            'live mode is not available for an unsaved document in this environment',
          code: 'LIVE_MODE_UNAVAILABLE',
          hint: 'run it in mock mode, or save_automation + deploy_automation and run it live with run_deployed or start_run',
        };
      }
      const { errors, warnings } = await validate(p.automation, { store });
      if (errors.length > 0) {
        return {
          status: 'invalid',
          trace: [],
          effects: [],
          validation: { errors, warnings },
        } satisfies RunResult;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
      const result = await execute(p.automation as Automation, {
        input: p.input ?? {},
        mode,
        store,
        ...(ctx.connectorHost !== undefined && {
          connectorHost: ctx.connectorHost,
        }),
      });
      if (warnings.length > 0) result.validation = { errors: [], warnings };
      return result;
    }

    case 'test_automation': {
      if (!p.automation) {
        return {
          error: 'missing params.automation',
          code: 'INVALID_PARAMS',
          hint: 'test_automation takes {automation: <the automation document, with its tests: block>}',
        };
      }
      const { errors, warnings } = await validate(p.automation, { store });
      if (errors.length > 0) return { status: 'invalid', errors, warnings };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
      return await runAutomationTests(p.automation as Automation, { store });
    }

    case 'save_automation': {
      if (!p.automation) {
        return {
          error: 'missing params.automation',
          code: 'INVALID_PARAMS',
          hint: 'save_automation takes {automation: <the automation document>, message?: "why this version"}',
        };
      }
      const { errors } = await validate(p.automation, { store });
      if (errors.length > 0) {
        return {
          error: 'automation failed validation — fix errors before saving',
          code: 'AUTOMATION_INVALID',
          hint: 'fix what errors lists, then save again — validate_automation checks a document without saving it',
          errors,
        };
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
      const automation = p.automation as Automation;
      try {
        return await store.save(automation, asString(p.message));
      } catch (e) {
        // The host's own refusals — a name it reserves for its fixed routes,
        // a name another owner holds — are refusals, not protocol errors:
        // they come back as data so the caller can rename and retry.
        return refusalFrom(e);
      }
    }

    case 'get_automation': {
      const name = asString(p.name);
      const version =
        p.version === undefined
          ? { value: undefined }
          : versionParam(p.version, 'omit it to read the latest saved version');
      if ('error' in version) return version;
      const found = await store.get(name, version.value);
      return (
        found ?? {
          error: `no saved automation named "${name}"`,
          code: 'AUTOMATION_NOT_FOUND',
          hint: LIST_AUTOMATIONS_HINT,
        }
      );
    }

    case 'list_automations':
      return { automations: await store.list() };

    case 'deploy_automation': {
      // The deploy gate: a version only becomes live-eligible if it still
      // validates AND its tests pass, so triggers never run a broken flow.
      const name = asString(p.name);
      if (p.version === undefined) {
        return {
          error: 'missing params.version',
          code: 'INVALID_PARAMS',
          hint: 'deploy_automation takes {name: "billing/dunning", version: 3} — list_versions shows the saved ones',
        };
      }
      const wanted = versionParam(
        p.version,
        'name one saved version to promote — list_versions shows them',
      );
      if ('error' in wanted) return wanted;
      const version = wanted.value;
      const saved = await store.get(name, version);
      if (!saved) {
        return {
          error: `no saved automation "${name}@${version}"`,
          code: 'AUTOMATION_VERSION_UNKNOWN',
          hint: `${LIST_VERSIONS_HINT}; ${LIST_AUTOMATIONS_HINT}`,
        };
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store contents were validated at save time
      const automation = saved.automation as Automation;
      const { errors } = await validate(automation, { store });
      if (errors.length > 0) {
        return {
          error: 'this version no longer validates; it cannot be deployed',
          code: 'AUTOMATION_INVALID',
          hint: 'fix what errors lists, save_automation the corrected document as a new version and deploy that one',
          errors,
        };
      }
      let testsPassed: boolean | undefined;
      if (automation.tests && automation.tests.length > 0) {
        const report = await runAutomationTests(automation, { store });
        if ('failed' in report && report.failed > 0) {
          return {
            error: 'deploy gate: the automation has failing tests',
            code: 'AUTOMATION_TESTS_FAILING',
            hint: 'read report.results, fix the automation or its tests (test_automation runs them without deploying), save a new version and deploy that one',
            report,
          };
        }
        testsPassed = true;
      }
      try {
        const deployed = await store.deploy(
          name,
          version,
          testsPassed === undefined ? undefined : { testsPassed },
        );
        return {
          deployed,
          note: 'this version is now live-eligible via run_deployed and triggers',
        };
      } catch (e) {
        return refusalFrom(e);
      }
    }

    case 'set_trigger': {
      if (!store.setTrigger) return notSupported('triggers are');
      const trigger = p.trigger;
      if (!trigger || typeof trigger !== 'object') {
        return {
          error: 'missing params.trigger',
          code: 'INVALID_PARAMS',
          hint: 'set_trigger takes {name, trigger: {kind: "schedule"|"webhook"|"event", …}}',
        };
      }
      const name = asString(p.name);
      if (!name) {
        return {
          error: 'missing params.name',
          code: 'INVALID_PARAMS',
          hint: LIST_AUTOMATIONS_HINT,
        };
      }
      const missing = await missingAutomation(store, name);
      if (missing) return missing;
      try {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape guarded by the host on persist
        const outcome = await store.setTrigger(name, trigger as TriggerSpec);
        return {
          ok: true,
          note: 'trigger recorded; the host schedules and delivers it',
          // A bind that replaced a live webhook with another kind killed
          // its URL: the caller hears it here, as the REST door's answer
          // does, instead of learning it from a partner's failed deliveries.
          ...(outcome?.revoked !== undefined
            ? {
                revoked: outcome.revoked,
                note: 'trigger recorded; the webhook URL it replaced is revoked and cannot be recovered — the host schedules and delivers the new one',
              }
            : {}),
        };
      } catch (e) {
        return refusalFrom(e);
      }
    }

    case 'run_deployed': {
      const name = asString(p.name);
      const version = await store.deployedVersion(name);
      if (!version) {
        return {
          error: `"${name}" has no deployed version`,
          code: 'AUTOMATION_NOT_DEPLOYED',
          hint: 'save_automation then deploy_automation first',
        };
      }
      const found = await store.get(name, version);
      if (!found)
        return {
          error: `deployed version ${name}@${version} is missing`,
          code: 'AUTOMATION_VERSION_UNKNOWN',
          hint: `the deployed version is gone — deploy_automation a saved one (${LIST_VERSIONS_HINT})`,
        };
      const mode = ctx.allowLive ? 'live' : 'mock';
      if (mode === 'live' && !ctx.connectorHost) {
        return await runDeployedDurably(ctx, name, version, p.input ?? {});
      }
      try {
        await store.authorizeRun?.(name, mode);
      } catch (error) {
        return refusalFrom(error);
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store contents were validated at save time
      const result = await execute(found.automation as Automation, {
        input: p.input ?? {},
        mode,
        store,
        ...(ctx.connectorHost !== undefined && {
          connectorHost: ctx.connectorHost,
        }),
      });
      if (store.recordRun) await store.recordRun(name, version, result, mode);
      return { version, ...result };
    }

    case 'start_run': {
      if (!store.startRun) return notSupported('durable runs are');
      const name = asString(p.name);
      if (!name) {
        return {
          error: 'missing params.name',
          code: 'INVALID_PARAMS',
          hint: 'start_run takes {name: "billing/dunning", input: {…}, projectId?: "…"}',
        };
      }
      const wanted =
        p.version === undefined
          ? { value: undefined }
          : versionParam(p.version, 'omit it to run the deployed version');
      if ('error' in wanted) return wanted;
      const version = wanted.value;
      // The host's own execution mode: a deployment runs live, a test session
      // runs against mocks — the same rule `run_deployed` follows.
      const mode = ctx.allowLive ? 'live' : 'mock';
      const projectId = asString(p.projectId) || undefined;
      try {
        // An absent input is an empty one; a null input is the null the
        // caller sent, for the schema to accept or refuse.
        const started = await store.startRun(
          name,
          p.input === undefined ? {} : p.input,
          mode,
          version,
          projectId,
        );
        if (!started) {
          return {
            error: `"${name}" has no version to run`,
            code: 'AUTOMATION_NOT_DEPLOYED',
            hint: 'save_automation then deploy_automation first, or name an existing version with params.version',
          };
        }
        return {
          ...started,
          mode,
          note: 'the run continues in the background — poll get_run {runId} for its status, output, trace and effects',
          hint: 'use run_deployed instead when you want the finished result in a single call',
        };
      } catch (e) {
        return refusalFrom(e);
      }
    }

    case 'list_runs': {
      if (!store.listRuns) return notSupported('run history is');
      const name = asString(p.name);
      if (name !== '') {
        // A name that exists with no runs and a name that does not exist
        // used to read the same ({runs: []}); the second is a refusal.
        const missing = await missingAutomation(store, name);
        if (missing) return missing;
      }
      const limit = p.limit === undefined ? undefined : Number(p.limit);
      return {
        runs: await store.listRuns({
          ...(name !== '' && { name }),
          ...(limit !== undefined && Number.isFinite(limit) && { limit }),
        }),
      };
    }

    case 'get_run': {
      if (!store.getRun) return notSupported('run history is');
      const runId = asString(p.runId);
      if (!runId) {
        return {
          error: 'missing params.runId',
          code: 'INVALID_PARAMS',
          hint: RUN_ID_HINT,
        };
      }
      const run = await store.getRun(runId);
      return run
        ? { run }
        : {
            error: `no run "${runId}"`,
            code: 'RUN_NOT_FOUND',
            hint: RUN_ID_HINT,
          };
    }

    case 'cancel_run': {
      if (!store.cancelRun) return notSupported('cancelling a run is');
      const runId = asString(p.runId);
      if (!runId) {
        return {
          error: 'missing params.runId',
          code: 'INVALID_PARAMS',
          hint: RUN_ID_HINT,
        };
      }
      try {
        const { cancelled } = await store.cancelRun(runId);
        return {
          cancelled,
          note: cancelled
            ? 'the run stops at its next node boundary; work already performed is not undone'
            : 'the run had already finished — nothing to cancel',
        };
      } catch (e) {
        return refusalFrom(e);
      }
    }

    case 'list_versions': {
      if (!store.listVersions) return notSupported('version history is');
      const name = asString(p.name);
      if (!name) {
        return {
          error: 'missing params.name',
          code: 'INVALID_PARAMS',
          hint: LIST_AUTOMATIONS_HINT,
        };
      }
      // An unknown name is a refusal, as it is for get_automation — never
      // an empty history a caller reads as "exists, nothing saved yet".
      const missing = await missingAutomation(store, name);
      if (missing) return missing;
      return { versions: await store.listVersions(name) };
    }

    case 'list_triggers': {
      if (!store.listTriggers) return notSupported('triggers are');
      const name = asString(p.name);
      if (name !== '') {
        const missing = await missingAutomation(store, name);
        if (missing) return missing;
      }
      return {
        triggers: await store.listTriggers(name === '' ? undefined : name),
      };
    }

    case 'delete_trigger': {
      if (!store.deleteTrigger) return notSupported('triggers are');
      const name = asString(p.name);
      if (!name) {
        return {
          error: 'missing params.name',
          code: 'INVALID_PARAMS',
          hint: 'list_triggers shows what is bound',
        };
      }
      const missing = await missingAutomation(store, name);
      if (missing) return missing;
      try {
        const { deleted } = await store.deleteTrigger(name);
        return deleted
          ? {
              ok: true,
              deleted: true,
              note: 'the automation no longer starts on its own; its versions and run history stay',
            }
          : {
              ok: true,
              deleted: false,
              note: `no trigger was bound to "${name}" — nothing changed`,
            };
      } catch (e) {
        return refusalFrom(e);
      }
    }

    default:
      return {
        error: `unknown method "${method}"`,
        code: 'UNKNOWN_METHOD',
        hint: `available methods: ${METHODS.join(', ')}`,
      };
  }
}
