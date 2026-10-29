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

import { isRecord } from '../../utils/type-utils';
import { diffAutomationDocuments } from '../core/diff/automation';
import type { ChangeSummary } from '../core/diff/changes';
import { execute, type ExecuteOptions } from '../core/execute';
import { createRecorder, type NodeRunWrite } from '../core/record/recorder';
import { recordBudget, redactTrace } from '../core/record/value';
import type { StoreAdapter } from '../core/slots';
import { nodeTypes } from '../core/slots';
import { BENCH_RUN_DEADLINE_MS } from '../core/test-limits';
import {
  type Automation,
  isJson,
  type Issue,
  type Json,
  type RunBench,
  type RunResult,
} from '../core/types';
import { connectorOutputShape } from '../core/typing/signature';
import { validate, type ValidateOptions } from '../core/validate';
import { closestName } from '../core/validate/similar';
import { searchCatalog } from './catalog-search';
import {
  authoringReference,
  CORE_NODE_KIND_REFERENCE,
  type CoreNodeKind,
} from './docs';
import { documentYaml } from './document-yaml';
import { METHODS } from './methods';
import { isCodedRefusal, structuredRefusal } from './refusal';
import { REPORT_DETAILS, type ReportDetail } from './report-details';
import { boundedReport, reportWithDetail } from './report-shape';
import { ACTIVE_RUN_STATUSES } from './run-statuses';
import { runAutomationTests, type TestReport } from './tests';
import { unifiedPatch } from './version-patch';

export { METHODS, type Method } from './methods';

/** A trigger binding the host persists and acts on. The engine only records
 * it; scheduling and delivery are the host's job. */
export interface TriggerSpec {
  kind: 'schedule' | 'webhook' | 'event';
  [k: string]: unknown;
}

/** One run as the management methods report it. Ids are strings here: the
 * engine addresses a run by whatever handle the host minted, without learning
 * what a host's identifier is made of. */
export interface LegacyRunQuarantine {
  reason: 'legacy_execution_unproven';
  observedAt: number;
  claimEpoch: number;
  priorStatus: 'queued' | 'running' | 'waiting';
  /** An operator requested owned cancellation; external outcome and cleanup
   * remain unproven. This does not release the hold or restart the run. */
  resolution: { action: 'stop'; actor: string; at: number } | null;
}

export interface RunSummary {
  /** The run id — `runId` repeats it: a listing row named the run `runId`
   * where the single read names it `id`, so a client had two names for
   * one value. */
  id: string;
  runId: string;
  name: string;
  version: number;
  /** The project the run operates in — null for an organization run. A
   * host that scopes reads by project (the REST door does) needs it to
   * build the run's URL. */
  projectId?: string | null;
  status: string;
  legacyQuarantine?: LegacyRunQuarantine;
  mode: string;
  startedBy: string;
  /** Which kind of trigger started a `trigger:<id>` run — read off the
   * run's own input, so it stays true after the binding changes kind.
   * Absent on a run a person or an API key started. */
  startedVia?: 'schedule' | 'webhook' | 'event';
  detail?: string;
  /** Why a `failed` run failed, as a stable code to branch on — `detail`
   * carries the sentence, which is not contractual. Present only when
   * `status` is `failed` and the run failed on a build that records it. */
  failureCode?: string;
  /** What a `waiting` run is parked on — `approval` (a person's decision),
   * `ask` (a question a person has to answer), `in_doubt` (a write the run
   * was making when its server stopped may already have happened; a person
   * decides how to continue), `agent` (an agent turn still running), `room`
   * (an agent turn waiting for sandbox room to start), `repeat` (a node
   * polling until its condition holds). The first three need a human;
   * present only while waiting. */
  waitingFor?: 'approval' | 'ask' | 'in_doubt' | 'agent' | 'room' | 'repeat';
  /** How often another server took the run over or a stopping one handed
   * it on; absent while it never was. */
  resumeCount?: number;
  /** Why and when the run was last handed on: `shutdown` (its server was
   * updated or restarted and handed it on) or `lease_expired` (its server
   * stopped responding and another took over). Absent while it never was. */
  lastResume?: { reason: 'shutdown' | 'lease_expired'; at: number };
  /** True while a running run waits for a server to take it over after its
   * own stopped; absent otherwise. */
  stalled?: boolean;
  startedAt: number;
  finishedAt?: number;
}

/** The question a run waits on a person to answer (`waitingFor: "ask"`):
 * what `answer_run_ask` answers, by `askId`. */
export interface RunAsk {
  askId: string;
  /** The node that asked. */
  nodeId: string;
  question: string;
  /** The structured questions, when the step asked several at once. */
  questions?: unknown;
  createdAt: number;
  /** When the run goes on without an answer, epoch ms. */
  expiresAt: number;
  /** The task the question is mirrored on, when there is one. */
  taskId?: string;
}

/** One run in full — what `get_run` answers with once the host has recorded
 * the outcome. The trace and effects are the engine's own result fields, so a
 * polled run reads exactly like a synchronous one. */
export interface RunDetail extends RunSummary {
  input?: unknown;
  output?: unknown;
  trace?: unknown;
  effects?: unknown;
  /** The question the run waits on, while it waits on one: the one place an
   * agent learns the `askId` and what to answer. */
  ask?: RunAsk;
}

/** One entry of an automation's immutable version history. */
export interface VersionSummary {
  version: number;
  /** Whether this is the version that runs — `list_versions` marks it, so a
   * caller learns in one call which document is live. */
  deployed?: boolean;
  message?: string;
  /** The last run of the version's tests — the save's or the deploy
   * gate's, the latest winning; absent while no run was recorded. */
  testsPassed?: boolean;
  /** When `testsPassed` was judged, epoch ms; absent with it. */
  testsCheckedAt?: number;
  createdBy: string;
  createdAt: number;
  /** The door the version was saved through (`app`, `upload`, `mcp`,
   * `rest`, `managed`, `system`); null for a version saved before the host
   * recorded it. A host that keeps no door leaves it out. */
  createdVia?: string | null;
  /** The name the saving agent's client gave itself; null when none. */
  clientName?: string | null;
  /** `createdVia` was read from `createdBy`: the version is older than the
   * record of doors. */
  viaInferred?: boolean;
  /** The saving person's name when they are still a member, null when they
   * are not (or `createdBy` names the system). Never an e-mail address. */
  createdByName?: string | null;
  /** The version the edit started from; null when none was recorded. */
  basedOnVersion?: number | null;
  /** The version this one brings back; null for a version that restores
   * none. */
  restoredFromVersion?: number | null;
  /** What it changed against the version saved before it — counts and
   * flags, never content; null when the host kept none. */
  changes?: ChangeSummary | null;
  /** Its latest test check summed up; null while none was recorded. */
  tests?: VersionTests | null;
  /** When it last went live, epoch ms; null when it never did. */
  lastDeployedAt?: number | null;
}

/** A version's latest test check in counts: how many passed and failed out
 * of how many, which act ran them and who. */
export interface VersionTests {
  passed: number;
  failed: number;
  total: number;
  via?: 'save' | 'deploy' | 'manual';
  by?: string;
}

/** One page of an automation's version history, newest first. */
export interface VersionPage {
  versions: VersionSummary[];
  /** Pass it back as `before` for the next page; null on the last one. */
  nextBefore: number | null;
  latestVersion: number | null;
  deployedVersion: number | null;
}

/** One version in full — what `get_automation` answers on a host that keeps
 * the version's metadata: the document, the fields the editor saves beside
 * it, who saved it through which door, and where it stands. */
export interface VersionView {
  name: string;
  version: number;
  latestVersion: number;
  deployedVersion: number | null;
  document: unknown;
  settings: unknown;
  taskContract: unknown;
  presentation: unknown;
  message: string | null;
  testsPassed: boolean | null;
  testsCheckedAt: number | null;
  createdBy: string;
  createdAt: number;
  createdVia: string | null;
  clientName: string | null;
  /** The projects it is installed in that the caller can see. */
  projectIds: string[];
  trigger: TriggerView | null;
}

/** One time a version was put live — the history `list_versions` answers
 * beside the versions, newest first. */
export interface DeploymentEntry {
  version: number;
  /** What was live before it; null for the first deploy. */
  previousVersion: number | null;
  deployedAt: number;
  /** The person who deployed it. */
  deployedBy: string;
  /** The door it came through — `app`, `upload`, `mcp`, `rest`, `managed`
   * or `system` — when the host recorded it; null otherwise. */
  via: string | null;
}

/** The version fields a save sends beside the document. On a host that
 * keeps them, a field the caller left out keeps the latest version's value,
 * `null` stores none, and a value stores itself. */
export interface VersionMetadata {
  settings?: unknown;
  taskContract?: unknown;
  presentation?: unknown;
}

/** What a save asks for beyond the document and its message. */
export interface SaveOptions {
  /** The save's own tests verdict, when the document carries tests. */
  testsPassed?: boolean;
  /** The report that verdict came from, for a host that keeps it. */
  testReport?: TestReport;
  /** The version the edit started from: another version saved since
   * refuses the save (`AUTOMATION_VERSION_STALE`). */
  baseVersion?: number;
  /** Refuse (`AUTOMATION_NAME_TAKEN`) when the name already has versions. */
  create?: boolean;
  /** The project a NEW automation is installed in (its first version). */
  projectId?: string;
  metadata?: VersionMetadata;
  /** The saved version this save brings back as the newest: the host
   * records the version as based on and restored from it, and saves
   * nothing — answering `unchanged` — when the latest version already is
   * that content. */
  restoredFrom?: number;
  /** The automation the version is saved under, where that is not the
   * document's own `name`: a restore saves under the automation it was
   * asked to restore, whatever name an old version's document carries —
   * it never lands a version on another automation. */
  name?: string;
}

/** One page of a run listing, newest first, and where the next one starts. */
export interface RunPage {
  runs: RunSummary[];
  /** Pass it back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

/** A trigger as a caller may see it — never the secret that verifies it. */
export interface TriggerView {
  /** The binding's id — what a run's `startedBy` (`trigger:<id>`) names.
   * A host without durable ids (the selftest store) leaves it out. */
  id?: string;
  name: string;
  kind: string;
  cron?: string;
  /** A schedule's repeat rule, in the host's shape (`ScheduleRule`). */
  repeat?: Readonly<Record<string, unknown>>;
  /** The day the repeat rule starts on, `YYYY-MM-DD` in its zone. */
  startDate?: string;
  timezone?: string;
  /** What a schedule does with occurrences it missed. */
  catchUp?: 'latest' | 'skip';
  /** The fixed input every run it starts receives. */
  input?: Readonly<Record<string, unknown>>;
  event?: string;
  /** Whether a webhook token was ever minted, WITHOUT revealing it. */
  hasToken: boolean;
  enabled: boolean;
  /** A schedule's next start; absent while it is off or not a schedule. */
  nextRunAt?: number;
  /** The last time this binding started a run — `lastRunId` names it. */
  lastFiredAt?: number;
  lastRunId?: string;
  /** The last time the binding came due and started nothing, and why:
   * `not_deployed`, `unusable_cron` or `start_refused` — or when a schedule
   * paused itself, `paused_after_failures`. */
  lastSkippedAt?: number;
  lastSkipReason?: string;
  /** The facts behind `lastSkipReason`, in the host's shape — the
   * occurrence, a refusal's code and version, the occurrences missed. */
  lastSkipDetail?: Readonly<Record<string, unknown>>;
  /** Permanent failures in a row among the runs it started since it was
   * last saved; a schedule pauses itself when they reach the threshold.
   * A host that keeps no streak (the selftest store) leaves it out. */
  consecutiveFailures?: number;
  /** The last of those failures: when, its `failureCode`, and its run. */
  lastFailedAt?: number;
  lastFailureCode?: string;
  lastFailedRunId?: string;
}

/** What binding a trigger changed besides recording it: `revoked` names a
 * live webhook URL the bind replaced with another kind; `token` is a
 * webhook trigger's plaintext token, minted by this bind and shown ONCE —
 * the REST door answers it the same way, and a tool that withheld it left
 * the binding a dead end from MCP alone (2026-09-14 evaluation, h9). */
export interface SetTriggerOutcome {
  revoked?: 'webhook';
  token?: string;
  /** A schedule's next start; null while it is switched off. */
  nextRunAt?: number | null;
  /** What the deployed version would make of what the trigger sends — a
   * warning never refuses the bind. */
  warnings?: Issue[];
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
  /** Append a version. `options.testsPassed` is the save's own verdict
   * when the document carries tests and dispatch ran them — a host that
   * keeps a per-version verdict records it, so a version saved with
   * failing tests reads so from the moment it exists. */
  save(
    automation: Automation,
    message?: string,
    options?: SaveOptions,
  ): Promise<{
    name: string;
    version: number;
    /** Which of `metadata`'s fields the host kept from the latest version
     * because the caller left them out. */
    carried?: string[];
    /** A save with `restoredFrom` that found the latest version already
     * holding that content: nothing was saved, `version` is the latest. */
    unchanged?: true;
  }>;
  /** Promote a saved version. `options.testsPassed` is set when the deploy
   * gate just ran the version's tests and they passed — a host that keeps a
   * per-version verdict stamps it, so the version reads as tested.
   * `options.expectedDeployedVersion` is compare-and-set on the live version
   * (`null`: nothing live): another one live refuses the deploy
   * (`AUTOMATION_DEPLOYMENT_STALE`). */
  deploy(
    name: string,
    version: number,
    options?: {
      testsPassed?: boolean;
      /** The report the gate's verdict came from. */
      testReport?: TestReport;
      expectedDeployedVersion?: number | null;
    },
  ): Promise<{
    name: string;
    version: number;
    /** What was live before; null when nothing was. */
    previousVersion?: number | null;
    /** What the deploy did, when the host records it: `deploy` put a newer
     * version (or the first) live, `rollback` an older one, `unchanged`
     * found it live already. A host that leaves it out has it read from
     * `previousVersion`. */
    kind?: 'deploy' | 'rollback' | 'unchanged';
  }>;
  /** Record the deploy gate's verdict on a saved version WITHOUT deploying
   * it — the refusal's `false`, so the version reads as failing rather than
   * as never tested; the latest verdict wins. A host without a per-version
   * verdict leaves it out. */
  recordTestVerdict?(
    name: string,
    version: number,
    testsPassed: boolean,
    /** The report the verdict came from, and whether the deploy gate or
     * someone running the tests made it. */
    check?: { report?: TestReport; via: 'deploy' | 'manual' },
  ): Promise<void>;
  /** A place for runs this process executes and never stores — a run in one
   * call, the tests of an automation — asked for before they start: the
   * host charges `executions` of them to the organization's budget and holds
   * the process to a few at once. The answer is the release to call when the
   * runs are over, or how long to wait (`retryAfterMs`) when the budget is
   * spent or every place is taken. A host that leaves it out runs them
   * unmetered. */
  admitBench?(
    executions: number,
  ): Promise<(() => void) | { retryAfterMs: number }>;
  /** Record a trigger binding. A host that revokes something by doing so (a
   * live webhook URL replaced by another kind) says so in the outcome; a
   * host with nothing to add answers nothing. */
  setTrigger?(
    name: string,
    trigger: TriggerSpec,
  ): Promise<SetTriggerOutcome | undefined>;
  /** Host authorization before an in-process deployed run starts executing. */
  authorizeRun?(name: string, mode: 'mock' | 'live'): Promise<void>;
  /** Keep a run that executed in one call: its result, and — so it can be
   * read step by step and run again — its input and its record's rows. */
  recordRun?(
    name: string,
    version: number,
    result: RunResult,
    mode: 'mock' | 'live',
    run?: { input: unknown; nodeRuns: NodeRunWrite[] },
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
    options?: {
      /** The caller's idempotency key — the REST `Idempotency-Key` ledger:
       * a repeat answers the run it already started (`duplicate: true`), a
       * repeat with a different request is a refusal. */
      idempotencyKey?: string;
    },
  ): Promise<{
    runId: string;
    version: number;
    /** The project the run operates in (null: organization-wide) — the
     * scope a host that reads runs by project needs to build its URL. */
    projectId?: string | null;
    /** True when `options.idempotencyKey` named a start this host already
     * made — no new run. */
    duplicate?: boolean;
  } | null>;
  listRuns?(options: { name?: string; limit?: number }): Promise<RunSummary[]>;
  /** One page of runs, newest first. `cursor` is a `nextCursor` this host
   * answered; null when it is not one (forged, from another listing). */
  listRunsPage?(options: {
    name?: string;
    limit?: number;
    mode?: 'mock' | 'live';
    statuses?: string[];
    cursor?: string;
  }): Promise<RunPage | null>;
  getRun?(runId: string): Promise<RunDetail | null>;
  /** A run step by step — the host's run record (the REST
   * `GET …/runs/{runId}/record`); null when the run does not exist or the
   * caller cannot read it. */
  getRunRecord?(
    runId: string,
    options: { travels: boolean },
  ): Promise<Record<string, unknown> | null>;
  /** One unit of a run read whole: a step, or one of its items or passes.
   * Null when the run does not exist or is hidden; a unit the record does
   * not hold is refused (`NODE_RUN_NOT_FOUND`). */
  getRunNode?(
    runId: string,
    unit: { node: string; item?: number; pass?: number },
  ): Promise<Record<string, unknown> | null>;
  /** Two runs of one automation side by side. Null when either does not
   * exist or is hidden; runs of different automations are refused
   * (`RUN_COMPARE_MISMATCH`). */
  compareRuns?(
    runId: string,
    otherRunId: string,
  ): Promise<Record<string, unknown> | null>;
  /** What running a run again would do: what it reuses, runs again and
   * sends out a second time, or why it cannot start. Null when the run does
   * not exist or is hidden. */
  planReplay?(
    runId: string,
    request: ReplayRequestArgs,
  ): Promise<Record<string, unknown> | null>;
  /** Run a run again, in its own project. Null when the run does not exist
   * or is hidden; a replay its plan refuses throws the plan's refusal. */
  replayRun?(
    runId: string,
    request: ReplayRequestArgs,
    options: { idempotencyKey?: string },
  ): Promise<Record<string, unknown> | null>;
  /** Stop a run. `cancelled: false` with a terminal `status` is a run that
   * had already finished; `cancelled: false` with NO `status` is a run that
   * does not exist (answered RUN_NOT_FOUND, like `get_run` and REST). */
  cancelRun?(runId: string): Promise<{ cancelled: boolean; status?: string }>;
  listVersions?(name: string): Promise<VersionSummary[]>;
  /** A page of the version history, newest first, each row with its door,
   * what it was based on and changed, and its tests. `before` is the oldest
   * version the last page answered; `limit` is at most 200. A host that
   * keeps only whole histories leaves it out and `listVersions` serves. */
  listVersionHistory?(
    name: string,
    page?: { limit?: number; before?: number },
  ): Promise<VersionPage>;
  /** The times a version of the automation was put live, newest first. */
  listDeployments?(name: string): Promise<DeploymentEntry[]>;
  listTriggers?(name?: string): Promise<TriggerView[]>;
  /** Unbind the automation's trigger. `deleted` says whether one was bound —
   * an unbind that found nothing is not a change, and the caller must be
   * able to tell. */
  deleteTrigger?(name: string): Promise<{ deleted: boolean }>;
  /** One version in full (the latest when `version` is omitted), or null
   * when the automation or the version does not exist for this caller. */
  getVersionView?(name: string, version?: number): Promise<VersionView | null>;
  /** Remove the automation — every version, its trigger, its
   * installations; its runs stay. `expectedLatestVersion` is
   * compare-and-set: a version saved since refuses the delete
   * (`AUTOMATION_VERSION_STALE`). */
  deleteAutomation?(
    name: string,
    expectedLatestVersion: number,
  ): Promise<{ versions: number }>;
  /** Install the automation in projects and remove it from others, in one
   * transaction; a project it is not installed in refuses the removal
   * (`AUTOMATION_NOT_INSTALLED`). */
  setAutomationProjects?(
    name: string,
    change: { add: string[]; remove: string[] },
  ): Promise<{ added: string[]; removed: string[]; unchanged: string[] }>;
  /** Answer the question a run asked a person; the run resumes on it. */
  answerAsk?(
    runId: string,
    askId: string,
    answer: string,
  ): Promise<{ runId: string; askId: string; taskId: string | null }>;
}

/**
 * The refusal for a trigger call that names an automation the store has never
 * saved. A trigger binds to a NAME, and the host persists it without looking
 * the automation up, so without this check a typo would either record an
 * orphan binding or report an unbind that unbound nothing — both read as
 * success to the caller.
 */
/** The sentence that sends a caller naming a core node kind (`transform`,
 * `llm`, `agent`, `subautomation`) to get_docs, or undefined for any other
 * word — shared by get_catalog and search_catalog. */
function coreKindHint(word: string): string | undefined {
  const wanted = word.trim().toLowerCase();
  const coreKind = [...nodeTypes().values()].find(
    (def) => def.kind !== 'connector' && def.type === wanted,
  );
  return coreKind === undefined
    ? undefined
    : `"${coreKind.type}" is a core node kind, not a catalog capability — get_docs describes it`;
}

function isCoreNodeKind(kind: string): kind is CoreNodeKind {
  return Object.hasOwn(CORE_NODE_KIND_REFERENCE, kind);
}

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
  /** A `cursor` that is not a `nextCursor` this listing answered. */
  'INVALID_CURSOR',
  /** An answer to a run's question with nothing in it. */
  'EMPTY_ANSWER',
  /** A run in one call or a suite of tests found no place: the
   * organization's budget for runs that are never stored is spent, or the
   * server runs as many as it takes at once. `data.retryAfterMs` is the
   * wait. */
  'RATE_LIMITED',
  /** The stand-ins or scope a run was given cannot be taken: `data.issue`
   * is the engine's own refusal, with its code, its place and its fix. */
  'BENCH_INVALID',
] as const;

const LIST_AUTOMATIONS_HINT = 'list_automations shows the saved ones';
const RUN_ID_HINT =
  'start_run returns the runId; list_runs lists the recent ones';

/**
 * What to do about a refusal the HOST raises (its own `AutomationError`
 * codes) that carries no hint of its own — a calling model reads the code
 * and this sentence and corrects itself. A host hint, when it sends one,
 * wins.
 */
const HOST_REFUSAL_HINTS: Readonly<Record<string, string>> = {
  NODE_RUN_NOT_FOUND:
    'get_run {runId, include: ["record"]} lists the steps under record.nodes; a step’s items and passes carry item and pass',
  RUN_COMPARE_MISMATCH:
    'compare two runs of the same automation: list_runs {name} lists them',
  REPLAY_RUN_NOT_FINISHED:
    'wait for the run to finish (get_run {runId, detail: []}), or run it again whole with kind "again"',
  REPLAY_NODE_UNKNOWN:
    'name a step both versions have, as get_run {runId, include: ["record"]} lists it',
  REPLAY_GRAPH_CHANGED:
    'run it again whole (kind "again"), or from a step that comes before data.nodes, or in the version it ran (version "same")',
  REPLAY_MODE_MISMATCH:
    'run a mock run again from a step in mode "mock", or run it again whole in mode "live"',
  REPLAY_PROGRESS_UNREADABLE: 'run it again whole with kind "again"',
  REPLAY_INPUT_UNAVAILABLE:
    'run it again with the input you mean: kind "edited" with input',
  AUTOMATION_NAME_TAKEN:
    'the name is in use, perhaps by an automation you cannot see: pick another name. To change one get_automation reads, save without create and with its version as baseVersion',
  AUTOMATION_NAME_RESERVED:
    'start the name with another segment, for example "ops/<name>"',
  AUTOMATION_DEPLOYMENT_STALE:
    'list_versions shows what is live (deployedVersion); deploy again with expectedDeployedVersion set to it if you still mean to replace it',
  AUTOMATION_HAS_ACTIVE_RUNS: `cancel_run the runs still going (list_runs with statuses [${ACTIVE_RUN_STATUSES.map((status) => `"${status}"`).join(', ')}] shows them), or let them finish, then delete again`,
  AUTOMATION_NOT_INSTALLED:
    'list_automations shows the projects each automation is installed in (projectIds)',
  AUTOMATION_PROJECT_UNKNOWN:
    'list_automations shows the projects an automation is installed in; the project must exist in this organization',
  HUMAN_ASK_NOT_FOUND:
    'get_run {runId} answers the question the run waits on as run.ask (its askId and the question); no run.ask means it waits on none',
  HUMAN_ASK_NOT_PENDING:
    'the question was answered or closed already — get_run {runId} shows where the run stands',
  HUMAN_ASK_EXPIRED:
    'the run went on without the answer — get_run {runId} shows where it stands',
  // The project gates every write that names a project goes through
  // (set_automation_projects, a save's projectId, answering a project
  // run's question): `ActorAuthError` / `ProjectError` carry no hint.
  PROJECT_NOT_FOUND:
    'list_projects shows the projects you can see; use one of their ids',
  PROJECT_ARCHIVED:
    'the project is archived — list_projects shows the active ones; ask the person to restore it in Tale if it is the one they mean',
  RBAC_FORBIDDEN:
    'the person cannot edit that project — list_projects marks the ones they can edit; tell them, or ask a project editor',
  RUN_NOT_FOUND: RUN_ID_HINT,
};
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
 * refused run input). A structured refusal (the platform's `AppError`)
 * is lifted from its payload, never from its `message`, which serializes
 * the whole payload.
 *
 * Anything that is not a refusal (`refusal.ts`) is a FAULT and is thrown
 * on: a store whose database is unreachable must not answer the socket's
 * sentence as a refusal. The host answers a fault its own way — the MCP
 * endpoint as `INTERNAL_ERROR` with the request id, logged and reported, or
 * as `DATABASE_UNAVAILABLE` with the wait when the database is not
 * answering; the app's routes as their 500, or their 503.
 */
function refusalFrom(error: unknown): {
  error: string;
  code: string;
  hint?: string;
  data?: Record<string, unknown>;
} {
  const structured = structuredRefusal(error);
  if (structured !== null) {
    const hint = HOST_REFUSAL_HINTS[structured.code];
    return {
      error: structured.message,
      code: structured.code,
      ...(hint !== undefined && { hint }),
      ...(structured.data !== undefined && { data: structured.data }),
    };
  }
  if (!isCodedRefusal(error)) throw error;
  const { code } = error;
  const own: unknown = Reflect.get(error, 'hint');
  const hint =
    typeof own === 'string' && own !== '' ? own : HOST_REFUSAL_HINTS[code];
  const data: unknown = Reflect.get(error, 'data');
  return {
    error: error.message,
    code,
    ...(hint !== undefined && { hint }),
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
  /**
   * The host's further references `get_docs {topic}` serves beside the
   * engine's own authoring reference (the MCP endpoint's triggers,
   * validation and skill texts): the text of a topic, or undefined for one
   * the host does not serve. Absent, only the authoring reference is served.
   */
  docs?: (topic: string) => string | undefined;
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
  idempotencyKey?: string,
): Promise<unknown> {
  const { store } = ctx;
  if (!store.startRun || !store.getRun) {
    return {
      error: 'live execution is not available in this environment',
      code: 'LIVE_MODE_UNAVAILABLE',
      hint: 'this host has neither an in-process connector host nor a durable runner; test against mocks instead',
    };
  }
  let started: { runId: string; version: number; duplicate?: boolean } | null;
  try {
    started =
      idempotencyKey === undefined
        ? await store.startRun(name, input, 'live', version)
        : await store.startRun(name, input, 'live', version, undefined, {
            idempotencyKey,
          });
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
  // The ledger's answer rides every shape: a repeated key names the run the
  // first attempt started and starts nothing — the caller must be able to
  // tell that from a fresh start, as it can on start_run and REST.
  const duplicate = started.duplicate === true ? { duplicate: true } : {};
  if (run?.finishedAt === undefined) {
    return {
      runId: started.runId,
      version: started.version,
      mode: 'live',
      status: run?.status ?? 'queued',
      ...duplicate,
      note: `the run is still going after ${Math.round(timeoutMs / 1000)}s — poll get_run {runId, detail: []} for its status, then get_run {runId} once it finished for its output, trace and effects`,
    };
  }
  return {
    runId: run.runId,
    version: run.version,
    mode: 'live',
    status: run.status,
    ...duplicate,
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

/** The largest version number a text is read as: the largest the store can hold. */
const MAX_VERSION = 2_147_483_647;

/** The most versions or deployments one page of a history holds. */
const HISTORY_PAGE_MAX = 200;

type ParamRefusal = { error: string; code: 'INVALID_PARAMS'; hint: string };

/** `params.limit` of a history page: a whole number from 1 to the most a
 * page holds, or left out for the whole history. */
function historyLimitParam(
  v: unknown,
): { value: number | undefined } | ParamRefusal {
  if (v === undefined) return { value: undefined };
  if (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 1 &&
    v <= HISTORY_PAGE_MAX
  ) {
    return { value: v };
  }
  return {
    error: `params.limit must be a whole number from 1 to ${HISTORY_PAGE_MAX} — got ${JSON.stringify(v)}`,
    code: 'INVALID_PARAMS',
    hint: `leave limit out for the whole history, or ask for a page of 1 to ${HISTORY_PAGE_MAX} and pass nextBefore back as before`,
  };
}

/** `params.before` of a version page: the version a page ended at. */
function versionPageStartParam(
  v: unknown,
): { value: number | undefined } | ParamRefusal {
  if (v === undefined) return { value: undefined };
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1)
    return { value: v };
  return {
    error: `params.before must be a version number — got ${JSON.stringify(v)}`,
    code: 'INVALID_PARAMS',
    hint: 'pass nextBefore from the previous page as before, with the same limit; leave both out for the whole history',
  };
}

/** Which version a comparison names: a number, the newest, or the live
 * one — and, for `from`, the one saved before `to`. */
type VersionRef = number | 'latest' | 'deployed';

function versionRefParam<Fallback extends VersionRef | 'previous'>(
  v: unknown,
  field: 'from' | 'to',
  fallback: Fallback,
): { value: VersionRef | Fallback } | ParamRefusal {
  if (v === undefined) return { value: fallback };
  if (v === 'latest' || v === 'deployed') return { value: v };
  if (v === 'previous' && fallback === 'previous') {
    return { value: fallback };
  }
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1) {
    return { value: v };
  }
  // A REST query string hands a number over as text.
  if (
    typeof v === 'string' &&
    /^[1-9]\d*$/.test(v) &&
    Number(v) <= MAX_VERSION
  ) {
    return { value: Number(v) };
  }
  return {
    error: `params.${field} must be a version number, "latest", "deployed"${field === 'from' ? ' or "previous"' : ''} — got ${JSON.stringify(v)}`,
    code: 'INVALID_PARAMS',
    hint:
      field === 'from'
        ? 'leave from out to compare with the version saved before to'
        : 'leave to out to compare the latest version; list_versions shows the numbers',
  };
}

const DIFF_FORMATS = ['changes', 'unified', 'both'] as const;

/** A saved version as a comparison or a restore reads it: its document,
 * and — on a host that keeps them — what it keeps beside it. */
async function readSavedVersion(
  store: DispatchStore,
  name: string,
  version: number,
): Promise<{ document: unknown; kept?: Record<string, unknown> } | null> {
  if (store.getVersionView) {
    const view = await store.getVersionView(name, version);
    if (view === null) return null;
    return {
      document: view.document,
      kept: {
        settings: view.settings,
        taskContract: view.taskContract,
        presentation: view.presentation,
      },
    };
  }
  const found = await store.get(name, version);
  return found === null ? null : { document: found.automation };
}

const VALIDATION_DETAIL = ['analysis', 'types'] as const;

/**
 * Read `params.detail` of validate_automation: what to return beside the
 * issues. Omitted, it is everything — the MCP door never sends it (its
 * argument schema stays strict), so an agent always gets the analysis and
 * the types; a host that renders only part of them (the editor) asks for
 * less.
 */
function detailParam(
  v: unknown,
):
  | { value: NonNullable<ValidateOptions['detail']> }
  | { error: string; code: 'INVALID_PARAMS'; hint: string } {
  if (v === undefined) return { value: VALIDATION_DETAIL };
  const known = new Set<unknown>(VALIDATION_DETAIL);
  if (Array.isArray(v) && v.every((d) => known.has(d))) {
    return { value: VALIDATION_DETAIL.filter((d) => v.includes(d)) };
  }
  return {
    error: `params.detail must list "analysis" and/or "types" — got ${JSON.stringify(v)}`,
    code: 'INVALID_PARAMS',
    hint: 'omit detail to get both, or pass detail: ["analysis"]',
  };
}

/** What an answer holds of the runs of one suite: each run, and all of them
 * together, as UTF-8 JSON. A run with its record is read by a model, so it
 * is kept as far as a client holds an answer inline; past it, a run is left
 * out and its test is run alone. */
const TEST_ANSWER_LIMITS = { runBytes: 262_144, totalBytes: 393_216 } as const;

/** The most test names a refusal lists. */
const TEST_NAMES_LISTED = 10;

/** `0`, `0 and 2`, `0, 2 and 5`. */
function listed(items: readonly (string | number)[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${String(items.at(-1))}`;
}

/**
 * The tests a `test_automation` call names — by name, as the document's
 * `tests:` block gives them — as their places in it. A name no test bears is
 * refused with the names there are, and so is one several tests bear: with
 * where they stand, since a place is all the runner takes.
 */
function testSelection(
  names: unknown,
  tests: readonly { name: string }[],
): { select: number[] } | ParamRefusal {
  if (
    !Array.isArray(names) ||
    names.length === 0 ||
    !names.every((n) => typeof n === 'string' && n !== '')
  ) {
    return {
      error: `params.tests must list the names of tests — got ${JSON.stringify(names)}`,
      code: 'INVALID_PARAMS',
      hint: 'name tests as the document’s tests: block does, or leave tests out to run them all',
    };
  }
  if (tests.length === 0) {
    return {
      error: 'the automation has no tests',
      code: 'INVALID_PARAMS',
      hint: 'add a top-level tests: [{name, input, mocks?, failures?, expect?}] block, or run_automation to try it on one input',
    };
  }
  const select = new Set<number>();
  for (const name of names) {
    const at = tests.flatMap((test, i) => (test.name === name ? [i] : []));
    const first = at[0];
    if (first === undefined) {
      const shown = tests.slice(0, TEST_NAMES_LISTED).map((t) => t.name);
      const more = tests.length - shown.length;
      const near = closestName(
        name,
        tests.map((t) => t.name),
      );
      return {
        error: `the automation has no test named ${JSON.stringify(name)}`,
        code: 'INVALID_PARAMS',
        hint: `${near === undefined ? '' : `did you mean ${JSON.stringify(near)}? `}its tests are ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}; test names are matched exactly`,
      };
    }
    if (at.length > 1) {
      return {
        error: `${at.length} tests are named ${JSON.stringify(name)}`,
        code: 'INVALID_PARAMS',
        hint: `they stand at ${listed(at)} in tests (from 0) — give every test its own name, then name it`,
      };
    }
    select.add(first);
  }
  return { select: [...select].toSorted((a, b) => a - b) };
}

/** What of each test's run a call asks to keep: some of output, effects and
 * trace, or nothing. */
function testDetailParam(
  v: unknown,
): { value: ReadonlySet<ReportDetail> } | ParamRefusal {
  if (v === undefined) return { value: new Set() };
  const known = new Set<unknown>(REPORT_DETAILS);
  if (Array.isArray(v) && v.every((d) => known.has(d))) {
    return { value: new Set(REPORT_DETAILS.filter((d) => v.includes(d))) };
  }
  return {
    error: `params.detail must list some of ${REPORT_DETAILS.map((d) => `"${d}"`).join(', ')} — got ${JSON.stringify(v)}`,
    code: 'INVALID_PARAMS',
    hint: 'omit detail for the verdicts alone, or pass detail: ["output"] to read what each test’s run returned',
  };
}

/** The params of a run on stand-ins. */
const BENCH_PARAMS = ['mocks', 'failures', 'upTo', 'only', 'item'] as const;

/**
 * The stand-ins and scope a `run_automation` call carries, as the executor
 * takes them — none when it names none. A param of the wrong type is
 * refused; which nodes it may name, and how its scopes combine, the
 * executor decides, with a refusal of its own for each.
 */
function benchParams(
  p: Record<string, unknown>,
): { value: RunBench | undefined } | ParamRefusal {
  if (BENCH_PARAMS.every((field) => p[field] === undefined)) {
    return { value: undefined };
  }
  const refuse = (field: string, wants: string): ParamRefusal => ({
    error: `params.${field} must be ${wants} — got ${JSON.stringify(p[field])}`,
    code: 'INVALID_PARAMS',
    hint: 'a run on stand-ins takes mocks {node: its simulated output}, failures {node: a message}, upTo or only (a node id) and item (with only)',
  });
  const { mocks, failures, upTo, only, item } = p;
  if (mocks !== undefined && !isJsonRecord(mocks)) {
    return refuse(
      'mocks',
      'an object of node ids and their simulated outputs, as JSON',
    );
  }
  if (failures !== undefined && !isMessageRecord(failures)) {
    return refuse('failures', 'an object of node ids and a message each');
  }
  if (upTo !== undefined && typeof upTo !== 'string') {
    return refuse('upTo', 'a node id');
  }
  if (only !== undefined && typeof only !== 'string') {
    return refuse('only', 'a node id');
  }
  if (item !== undefined && !(Number.isInteger(item) && Number(item) >= 0)) {
    return refuse('item', 'a whole number from 0');
  }
  return {
    value: {
      ...(mocks !== undefined && { mocks }),
      ...(failures !== undefined && { failures }),
      ...(typeof upTo === 'string' && { upTo }),
      ...(typeof only === 'string' && { only }),
      ...(typeof item === 'number' && { item }),
    },
  };
}

/** An object of JSON values. */
function isJsonRecord(v: unknown): v is Record<string, Json> {
  return isRecord(v) && Object.values(v).every((value) => isJson(value));
}

/** An object of strings. */
function isMessageRecord(v: unknown): v is Record<string, string> {
  return (
    isRecord(v) && Object.values(v).every((value) => typeof value === 'string')
  );
}

/**
 * A place for `executions` runs this process executes and never stores, to be
 * released when they are done — or the refusal that says how long to wait.
 * A store with no meter admits every run.
 */
async function admitBench(
  store: DispatchStore,
  executions: number,
): Promise<
  | (() => void)
  | {
      error: string;
      code: 'RATE_LIMITED';
      hint: string;
      data: { retryAfterMs: number };
    }
> {
  if (store.admitBench === undefined || executions < 1) return () => {};
  const admitted = await store.admitBench(executions);
  if (typeof admitted === 'function') return admitted;
  const seconds = Math.ceil(admitted.retryAfterMs / 100) / 10;
  return {
    error: `no room for ${executions === 1 ? 'this run' : 'these runs'} right now: the organization’s budget for runs that are never stored is spent, or this server is running as many of them as it can at once`,
    code: 'RATE_LIMITED',
    hint: `wait data.retryAfterMs (${seconds} s), then call again`,
    data: { retryAfterMs: admitted.retryAfterMs },
  };
}

/** What `get_run` can answer beside the run's status, each the size of the
 * run's own data. */
const RUN_DETAIL = ['input', 'output', 'trace', 'effects'] as const;

/** What `get_run` can add: the run's record, step by step, and the data
 * that travelled between its steps (which brings the record with it). */
const RUN_INCLUDES = ['record', 'travels'] as const;

function runIncludeParam(
  v: unknown,
):
  | { value: ReadonlySet<string> }
  | { error: string; code: 'INVALID_PARAMS'; hint: string } {
  if (v === undefined) return { value: new Set() };
  const known = new Set<unknown>(RUN_INCLUDES);
  if (Array.isArray(v) && v.every((d) => known.has(d))) {
    return { value: new Set(v.map(String)) };
  }
  return {
    error: `params.include must list some of ${RUN_INCLUDES.map((d) => `"${d}"`).join(', ')} — got ${JSON.stringify(v)}`,
    code: 'INVALID_PARAMS',
    hint: 'pass include: ["record"] to read the run step by step',
  };
}

/** What `replay_run` asks for: how to run the run again, which version, in
 * which mode, and an edited replay's input. */
export interface ReplayRequestArgs {
  kind: 'again' | 'edited' | 'from';
  from?: string;
  version?: 'same' | 'deployed' | 'latest' | number;
  mode?: 'mock' | 'live';
  input?: unknown;
}

/** `replay_run`'s request from its params; a refusal when it is not one. */
function replayRequestParam(
  p: Record<string, unknown>,
):
  | { value: ReplayRequestArgs }
  | { error: string; code: 'INVALID_PARAMS'; hint: string } {
  const kind = p.kind;
  if (kind !== 'again' && kind !== 'edited' && kind !== 'from') {
    return {
      error: `params.kind must be "again", "edited" or "from" — got ${JSON.stringify(kind)}`,
      code: 'INVALID_PARAMS',
      hint: '"again" runs it with its own input, "edited" with input, "from" from a step',
    };
  }
  const from = asString(p.from);
  if (kind === 'from' && !from) {
    return {
      error: 'missing params.from',
      code: 'INVALID_PARAMS',
      hint: 'name the step to run again from, as get_run {include: ["record"]} lists it',
    };
  }
  const version = p.version;
  const versionOk =
    version === undefined ||
    version === 'same' ||
    version === 'deployed' ||
    version === 'latest' ||
    (typeof version === 'number' && Number.isInteger(version) && version >= 1);
  if (!versionOk) {
    return {
      error: `params.version must be "same", "deployed", "latest" or a version number — got ${JSON.stringify(version)}`,
      code: 'INVALID_PARAMS',
      hint: 'leave it out to run the version the run ran',
    };
  }
  const mode = p.mode;
  if (mode !== undefined && mode !== 'mock' && mode !== 'live') {
    return {
      error: `params.mode must be "mock" or "live" — got ${JSON.stringify(mode)}`,
      code: 'INVALID_PARAMS',
      hint: 'leave it out to run in the run’s own mode',
    };
  }
  return {
    value: {
      kind,
      ...(kind === 'from' && { from }),
      ...(version !== undefined && { version }),
      ...(mode !== undefined && { mode }),
      ...(kind === 'edited' && 'input' in p && { input: p.input }),
    },
  };
}

/** A unit's item or pass: -1 for the step itself. */
function unitIndexParam(v: unknown): number | undefined | null {
  if (v === undefined) return undefined;
  return typeof v === 'number' && Number.isInteger(v) && v >= -1 ? v : null;
}

/**
 * Read `params.detail` of get_run: which of the run's own data to answer.
 * Omitted, all of it; `[]` the status alone — what a caller polling a long
 * run reads, instead of its whole trace on every poll.
 */
function runDetailParam(
  v: unknown,
):
  | { value: ReadonlySet<string> }
  | { error: string; code: 'INVALID_PARAMS'; hint: string } {
  if (v === undefined) return { value: new Set(RUN_DETAIL) };
  const known = new Set<unknown>(RUN_DETAIL);
  if (Array.isArray(v) && v.every((d) => known.has(d))) {
    return { value: new Set(v.map(String)) };
  }
  return {
    error: `params.detail must list some of ${RUN_DETAIL.map((d) => `"${d}"`).join(', ')} — got ${JSON.stringify(v)}`,
    code: 'INVALID_PARAMS',
    hint: 'omit detail to get them all, or pass detail: [] for the status alone',
  };
}

function paramsObject(params: unknown): Record<string, unknown> {
  return params !== null && typeof params === 'object' && !Array.isArray(params)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
      (params as Record<string, unknown>)
    : {};
}

/** The version fields a save sent beside the document — each only when
 * the caller named it, so a host that carries can tell "left out" from
 * "cleared" (`null`). */
function versionMetadata(p: Record<string, unknown>): VersionMetadata {
  return {
    ...('settings' in p &&
      p.settings !== undefined && { settings: p.settings }),
    ...('taskContract' in p &&
      p.taskContract !== undefined && { taskContract: p.taskContract }),
    ...('presentation' in p &&
      p.presentation !== undefined && { presentation: p.presentation }),
  };
}

/** A list of non-blank strings, or undefined when `v` is not one. */
function stringList(v: unknown): string[] | undefined {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return undefined;
  const items = v.map(asString);
  return items.every((item) => item.trim() !== '') ? items : undefined;
}

/** The saved version a `version` param names on a stored-version call:
 * omitted = the latest saved one, `"deployed"` = the live one. A refusal
 * when it names none. */
async function storedVersion(
  store: DispatchStore,
  name: string,
  version: unknown,
): Promise<
  | { version: number; automation: Automation }
  | { error: string; code: string; hint: string }
> {
  let wanted: number | undefined;
  if (version === 'deployed') {
    const live = await store.deployedVersion(name);
    if (live === null) {
      const missing = await missingAutomation(store, name);
      if (missing) return missing;
      return {
        error: `"${name}" has no deployed version`,
        code: 'AUTOMATION_VERSION_UNKNOWN',
        hint: 'omit version to use the latest saved one — list_versions shows them',
      };
    }
    wanted = live;
  } else if (version !== undefined) {
    const parsed = versionParam(version, 'omit it to use the latest saved one');
    if ('error' in parsed) return parsed;
    wanted = parsed.value;
  }
  const found = await store.get(name, wanted);
  if (found === null) {
    const missing = await missingAutomation(store, name);
    if (missing) return missing;
    return {
      error: `no saved automation "${name}@${String(wanted)}"`,
      code: 'AUTOMATION_VERSION_UNKNOWN',
      hint: LIST_VERSIONS_HINT,
    };
  }
  return {
    version: found.meta.version,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store contents were validated at save time
    automation: found.automation as Automation,
  };
}

/** A save refused because another version landed after the edit began, in
 * the words an agent acts on: which version to read and merge into. The
 * host's sentence is the editor's ("Reload to see it"). */
function staleSave(
  name: string,
  refusal: ReturnType<typeof refusalFrom>,
): Record<string, unknown> {
  const latest: unknown = refusal.data?.latestVersion;
  const base: unknown = refusal.data?.baseVersion;
  if (typeof latest !== 'number') {
    return {
      ...refusal,
      error: `"${name}" has no version any more — your edit started from v${String(base)}`,
      hint: 'save it without baseVersion to recreate the automation from your document, or under a new name',
    };
  }
  return {
    ...refusal,
    error: `v${latest} of "${name}" was saved after your edit started from v${String(base)}`,
    hint: `get_automation {name: "${name}"} reads v${latest}; merge your change into it and save again with baseVersion: ${latest}`,
  };
}

/** A delete refused because a version was saved after the one the agent
 * read, in the words an agent acts on: it must not delete what it has not
 * seen, so it reads the newer version and asks again — a save's "merge and
 * save again" does not apply. */
function staleDelete(
  name: string,
  refusal: ReturnType<typeof refusalFrom>,
): Record<string, unknown> {
  const latest: unknown = refusal.data?.latestVersion;
  if (typeof latest !== 'number') {
    return {
      ...refusal,
      error: `"${name}" has no version any more — it was deleted meanwhile`,
      hint: 'nothing is left to delete; list_automations shows what exists',
    };
  }
  return {
    ...refusal,
    hint: `get_automation {name: "${name}"} reads v${latest}, saved after the version you read; tell the person what changed, then delete again with expectedLatestVersion: ${latest} if they still want it gone`,
  };
}

/** A restore refused because a version was saved after the one the agent
 * read, in the words an agent acts on: it reads the latest, and — if the
 * person still wants the older content back — restores again over it. */
function staleRestore(
  name: string,
  refusal: ReturnType<typeof refusalFrom>,
): Record<string, unknown> {
  const latest: unknown = refusal.data?.latestVersion;
  if (typeof latest !== 'number') return refusal;
  return {
    ...refusal,
    error: `v${latest} of "${name}" was saved after the version you read`,
    hint: `get_automation {name: "${name}", version: ${latest}, against: "previous"} shows what v${latest} changed; restore again with baseVersion: ${latest} if the person still wants the older content back`,
  };
}

/** A stored document as the diff and the YAML read it: an object, or
 * nothing. */
function asDocument(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** `get_automation` on a host that keeps a version's metadata: the
 * document under the keys every client already reads (`meta`,
 * `automation`), and beside them what the editor saves with it, who saved
 * it through which door, and where it stands. */
async function versionView(
  store: DispatchStore,
  name: string,
  p: Record<string, unknown>,
): Promise<unknown> {
  let wanted: number | undefined;
  if (p.version === 'deployed') {
    const live = await store.deployedVersion(name);
    if (live === null) {
      const missing = await missingAutomation(store, name);
      if (missing) return missing;
      return {
        error: `"${name}" has no deployed version`,
        code: 'AUTOMATION_VERSION_UNKNOWN',
        hint: 'deploy_automation a saved version first — list_versions shows them',
      };
    }
    wanted = live;
  } else if (p.version !== undefined) {
    const parsed = versionParam(
      p.version,
      'omit it to read the latest saved version',
    );
    if ('error' in parsed) return parsed;
    wanted = parsed.value;
  }
  const view = (await store.getVersionView?.(name, wanted)) ?? null;
  if (view === null) {
    const missing = await missingAutomation(store, name);
    if (missing) return missing;
    return {
      error: `no saved automation "${name}@${String(wanted)}"`,
      code: 'AUTOMATION_VERSION_UNKNOWN',
      hint: LIST_VERSIONS_HINT,
    };
  }
  const { document, ...rest } = view;
  return {
    meta: { version: view.version },
    automation: document,
    ...rest,
    deployed: view.deployedVersion === view.version,
  };
}

/** `get_automation`: one saved version as the host answers it — the
 * document, and on a host that keeps them the version's metadata. */
async function getAutomationCall(
  store: DispatchStore,
  p: Record<string, unknown>,
): Promise<unknown> {
  const name = asString(p.name);
  if (store.getVersionView) return await versionView(store, name, p);
  // "deployed" reads the version that actually runs — the REST door's
  // `?version=deployed`, which MCP lacked (2026-09-14 evaluation, h9).
  if (p.version === 'deployed') {
    const live = await store.deployedVersion(name);
    if (live === null) {
      const missing = await missingAutomation(store, name);
      if (missing) return missing;
      return {
        error: `"${name}" has no deployed version`,
        code: 'AUTOMATION_VERSION_UNKNOWN',
        hint: 'deploy_automation a saved version first — list_versions shows them',
      };
    }
    return (
      (await store.get(name, live)) ?? {
        error: `deployed version ${name}@${live} is missing`,
        code: 'AUTOMATION_VERSION_UNKNOWN',
        hint: `the deployed version is gone — deploy_automation a saved one (${LIST_VERSIONS_HINT})`,
      }
    );
  }
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

/** What `compareVersions` is asked: which two versions of an automation to
 * compare, and in which format. The versions are read as `get_automation`
 * reads them — a number, "latest", "deployed", and for `from` "previous". */
export interface CompareVersionsRequest {
  name: string;
  from?: unknown;
  to?: unknown;
  format?: unknown;
}

/**
 * Two saved versions of an automation compared: what the second changed
 * against the first — node by node, in the input schema, the output, the
 * description and the tests, and in what a version keeps beside its
 * document where the host has it — or a unified patch over their YAML.
 * `from` defaults to the version saved before `to` (null for the first
 * version, which compares with nothing) and `to` to the latest. The REST
 * compare endpoint and `get_automation {against}` both answer through it,
 * so the two doors read alike.
 */
export async function compareVersions(
  store: DispatchStore,
  request: CompareVersionsRequest,
): Promise<Record<string, unknown>> {
  const { name } = request;
  const fromRef = versionRefParam(request.from, 'from', 'previous');
  if ('error' in fromRef) return fromRef;
  const toRef = versionRefParam(request.to, 'to', 'latest');
  if ('error' in toRef) return toRef;
  const format = request.format ?? 'changes';
  const knownFormat = DIFF_FORMATS.find((candidate) => candidate === format);
  if (knownFormat === undefined) {
    return {
      error: `the format must be "changes", "unified" or "both" — got ${JSON.stringify(format)}`,
      code: 'INVALID_PARAMS',
      hint: '"changes" lists what changed node by node (the default), "unified" is a patch over the two versions’ YAML',
    };
  }
  const latest = await store.get(name);
  if (latest === null) {
    return {
      error: `no saved automation named "${name}"`,
      code: 'AUTOMATION_NOT_FOUND',
      hint: LIST_AUTOMATIONS_HINT,
    };
  }
  const notDeployed = {
    error: `"${name}" has no deployed version`,
    code: 'AUTOMATION_NOT_DEPLOYED',
    hint: 'deploy_automation a saved version first, or name the versions to compare — list_versions shows them',
  };
  const live = await store.deployedVersion(name);
  let to: number;
  if (toRef.value === 'latest') to = latest.meta.version;
  else if (toRef.value === 'deployed') {
    if (live === null) return notDeployed;
    to = live;
  } else to = toRef.value;
  let from: number | null;
  if (fromRef.value === 'previous') from = to > 1 ? to - 1 : null;
  else if (fromRef.value === 'latest') from = latest.meta.version;
  else if (fromRef.value === 'deployed') {
    if (live === null) return notDeployed;
    from = live;
  } else from = fromRef.value;
  const unknown = (version: number) => ({
    error: `"${name}" has no saved version ${String(version)}`,
    code: 'AUTOMATION_VERSION_UNKNOWN',
    hint: LIST_VERSIONS_HINT,
  });
  const after = await readSavedVersion(store, name, to);
  if (after === null) return unknown(to);
  const before =
    from === null ? null : await readSavedVersion(store, name, from);
  if (from !== null && before === null) return unknown(from);
  const diff = diffAutomationDocuments(
    asDocument(before?.document ?? null),
    asDocument(after.document) ?? {},
    {
      ...(before?.kept !== undefined && { beforePackage: before.kept }),
      ...(after.kept !== undefined && { afterPackage: after.kept }),
    },
  );
  const head = { name, from, to };
  if (knownFormat === 'changes') return { ...head, ...diff };
  const patch = unifiedPatch(
    before === null ? '' : documentYaml(asDocument(before.document) ?? {}),
    documentYaml(asDocument(after.document) ?? {}),
    {
      fromLabel: from === null ? 'nothing' : `v${String(from)}`,
      toLabel: `v${String(to)}`,
    },
  );
  const unified = {
    unified: patch.patch,
    ...(patch.truncated && { truncated: true }),
  };
  return knownFormat === 'both'
    ? { ...head, ...diff, ...unified }
    : { ...head, first: diff.first, identical: diff.identical, ...unified };
}

/** The save arguments a restore does not take: it brings back what the
 * version was, so a document, new package data or a creation are refused. */
const RESTORE_REFUSES = [
  'automation',
  'settings',
  'taskContract',
  'presentation',
  'create',
  'projectId',
] as const;

/**
 * `save_automation {name, restoreVersion}`: an older version brought back as
 * the newest. Its document passes the save's own checks and runs its own
 * tests as any save does, and is saved restored from that version with
 * what the version kept beside it; nothing is saved — `unchanged` — when the
 * latest version already holds that content. Never a deploy: the live
 * version stays live.
 */
async function restoreVersionCall(
  ctx: DispatchContext,
  p: Record<string, unknown>,
): Promise<unknown> {
  const { store } = ctx;
  const name = asString(p.name);
  if (!name) {
    return {
      error: 'missing params.name',
      code: 'INVALID_PARAMS',
      hint: 'restoring takes {name: "billing/dunning", restoreVersion: 3} — list_versions shows the saved versions',
    };
  }
  const given = RESTORE_REFUSES.filter((key) => p[key] !== undefined);
  if (given.length > 0) {
    return {
      error: `a restore brings back a saved version as it was — ${given.join(', ')} cannot be sent with restoreVersion`,
      code: 'INVALID_PARAMS',
      hint: 'to change the document, get_automation it, edit it and save_automation the result; restoreVersion takes name, message and baseVersion only',
    };
  }
  const wanted = versionParam(
    p.restoreVersion,
    'name the saved version to bring back — list_versions shows them',
  );
  if ('error' in wanted) return wanted;
  const baseVersion =
    p.baseVersion === undefined
      ? { value: undefined }
      : versionParam(
          p.baseVersion,
          'name the latest version you read — list_versions answers it as latestVersion',
        );
  if ('error' in baseVersion) return baseVersion;
  const missing = await missingAutomation(store, name);
  if (missing) return missing;
  const source = await readSavedVersion(store, name, wanted.value);
  if (source === null) {
    return {
      error: `"${name}" has no saved version ${String(wanted.value)} to restore`,
      code: 'AUTOMATION_VERSION_UNKNOWN',
      hint: LIST_VERSIONS_HINT,
    };
  }
  // The save's own checks: a version a newer engine no longer accepts is
  // refused, as saving its document would be.
  const { errors, warnings } = await validate(source.document, { store });
  if (errors.length > 0) {
    return {
      error: 'this version no longer validates; it cannot be restored',
      code: 'AUTOMATION_INVALID',
      hint: 'fix what errors lists, then save_automation the corrected document as a new version',
      errors,
      warnings,
    };
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
  const automation = source.document as Automation;
  let testsPassed: boolean | undefined;
  let testReport: TestReport | undefined;
  if (automation.tests && automation.tests.length > 0) {
    const report = await runAutomationTests(automation, { store });
    testsPassed = 'failed' in report && report.failed === 0;
    if ('failed' in report) testReport = report;
  }
  try {
    const saved = await store.save(
      automation,
      asString(p.message) || `Restore v${String(wanted.value)}`,
      {
        ...(testsPassed !== undefined && { testsPassed }),
        ...(testReport !== undefined && { testReport }),
        ...(baseVersion.value !== undefined && {
          baseVersion: baseVersion.value,
        }),
        restoredFrom: wanted.value,
        name,
        ...(source.kept !== undefined && { metadata: source.kept }),
      },
    );
    return {
      name: saved.name,
      version: saved.version,
      restoredFrom: wanted.value,
      ...(saved.unchanged === true && { unchanged: true }),
      ...(testsPassed !== undefined && { testsPassed }),
      warnings,
      note:
        saved.unchanged === true
          ? `nothing was saved: the latest version, v${String(saved.version)}, already holds that content`
          : `saved as the newest version; it is not live — deploy_automation {name, version: ${String(saved.version)}} puts it live`,
    };
  } catch (e) {
    const refusal = refusalFrom(e);
    if (refusal.code === 'AUTOMATION_VERSION_STALE') {
      return staleRestore(name, refusal);
    }
    return refusal;
  }
}

export async function dispatch(
  method: string,
  params: unknown,
  ctx: DispatchContext,
): Promise<unknown> {
  const p = paramsObject(params);
  const { store } = ctx;

  switch (method) {
    case 'get_docs': {
      // The authoring reference serves MCP clients in the endpoint's own
      // dialect; it does not impose a host's system prompt or persona.
      const topic = asString(p.topic) || 'authoring';
      if (topic === 'authoring') return { docs: authoringReference() };
      const docs = ctx.docs?.(topic);
      if (docs !== undefined) return { docs };
      return {
        error: `no reference on "${topic}" here`,
        code: 'INVALID_PARAMS',
        hint: 'omit topic for the authoring reference — the topics this host serves are listed in the tool schema',
      };
    }

    case 'get_catalog': {
      // The whole catalog with every input schema runs past 100 KB;
      // `kind` narrows it to one node kind and `compact` drops the
      // schemas, so a client can discover without reading it all.
      const kind = asString(p.kind);
      const compact = p.compact === true;
      // The four core kinds the enum offers (transform, llm, agent,
      // subautomation) are the grammar get_docs teaches, not catalog
      // entries: narrowing to one answered an empty list with no word of
      // why (2026-09-19 evaluation, K8-4) — now the same hint search_catalog
      // gives.
      const core = kind === '' ? undefined : coreKindHint(kind);
      if (core !== undefined) {
        // The kind's own section of the reference rides along, so a
        // narrowed read (and the `tale://catalog/<kind>` resource built on
        // it) answers what the kind is, not only where to look.
        return {
          node_types: [],
          hint: core,
          ...(isCoreNodeKind(kind)
            ? { reference: CORE_NODE_KIND_REFERENCE[kind] }
            : {}),
        };
      }
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
            // The same signature as a JSON Schema — what validation types
            // a reference to this node's output against.
            entry.outputSchema = connectorOutputShape(t.connector);
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
      return {
        matches,
        hint:
          coreKindHint(query) ??
          'no matches — try different capability keywords (verbs + objects)',
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
      const detail = detailParam(p.detail);
      if ('error' in detail) return detail;
      const { errors, warnings, analysis, types } = await validate(
        p.automation,
        { store, detail: detail.value },
      );
      return {
        valid: errors.length === 0,
        errors,
        warnings,
        ...(analysis !== undefined && { analysis }),
        ...(types !== undefined && { types }),
      };
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
      const bench = benchParams(p);
      if ('error' in bench) return bench;
      const { errors, warnings } = await validate(p.automation, { store });
      if (errors.length > 0) {
        return {
          status: 'invalid',
          trace: [],
          effects: [],
          validation: { errors, warnings },
        } satisfies RunResult;
      }
      // A run on the mocks executes in this process: it takes a place among
      // the runs that are never stored, and stops at its next step once it
      // has run past its time limit.
      const metered = mode === 'mock';
      const admitted = metered ? await admitBench(store, 1) : () => {};
      if (typeof admitted !== 'function') return admitted;
      let result: RunResult;
      try {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
        result = await execute(p.automation as Automation, {
          input: p.input ?? {},
          mode,
          store,
          ...(ctx.connectorHost !== undefined && {
            connectorHost: ctx.connectorHost,
          }),
          ...(bench.value !== undefined && { bench: bench.value }),
          ...(metered && { deadline: Date.now() + BENCH_RUN_DEADLINE_MS }),
        });
      } finally {
        admitted();
      }
      // A bench the document cannot take is the request's fault, not the
      // run's: the refusal names the issue.
      const refused =
        result.status === 'invalid'
          ? result.validation?.errors.find((issue) =>
              issue.code.startsWith('BENCH_'),
            )
          : undefined;
      if (refused !== undefined) {
        return {
          error: refused.message,
          code: 'BENCH_INVALID',
          hint:
            refused.hint ??
            'fix the stand-ins or the scope data.issue names, then run again',
          data: { issue: refused },
        };
      }
      if (warnings.length > 0) result.validation = { errors: [], warnings };
      return { ...result, trace: redactTrace(result.trace) };
    }

    case 'test_automation': {
      const name = asString(p.name);
      if (p.automation === undefined && name === '') {
        return {
          error: 'missing params.automation',
          code: 'INVALID_PARAMS',
          hint: 'test_automation takes {automation: <the automation document, with its tests: block>} or {name, version?} of a saved one',
        };
      }
      if (p.automation !== undefined && name !== '') {
        return {
          error: 'params.automation and params.name both given',
          code: 'INVALID_PARAMS',
          hint: 'send the document to test a draft, or name a saved version — not both',
        };
      }
      const detail = testDetailParam(p.detail);
      if ('error' in detail) return detail;
      // A saved version is tested as saved, and its verdict is recorded on
      // it, so the version history reads as tested — the deploy gate's own
      // write; a draft has no version to hold one.
      let automation: Automation;
      let saved: { name: string; version: number } | undefined;
      if (p.automation === undefined) {
        const stored = await storedVersion(store, name, p.version);
        if ('error' in stored) return stored;
        const { errors, warnings } = await validate(stored.automation, {
          store,
        });
        if (errors.length > 0) {
          return {
            status: 'invalid',
            name,
            version: stored.version,
            errors,
            warnings,
          };
        }
        automation = stored.automation;
        saved = { name, version: stored.version };
      } else {
        const { errors, warnings } = await validate(p.automation, { store });
        if (errors.length > 0) return { status: 'invalid', errors, warnings };
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
        automation = p.automation as Automation;
      }
      const tests = automation.tests ?? [];
      let select: number[] | undefined;
      if (p.tests !== undefined) {
        const picked = testSelection(p.tests, tests);
        if ('error' in picked) return picked;
        select = picked.select;
      }
      const admitted = await admitBench(store, select?.length ?? tests.length);
      if (typeof admitted !== 'function') return admitted;
      let report: Awaited<ReturnType<typeof runAutomationTests>>;
      try {
        report = await runAutomationTests(automation, {
          store,
          ...(select !== undefined && { select }),
          ...(detail.value.size > 0 && { detail: true }),
          ...(saved !== undefined && { version: saved.version }),
        });
      } finally {
        admitted();
      }
      // Only the whole suite of a saved version, run to its end, is a
      // verdict on it: a part of the suite says nothing of the rest, and
      // tests the suite's time never reached are not tests that failed.
      let recorded: { version: number; testsPassed: boolean } | undefined;
      if (
        saved !== undefined &&
        select === undefined &&
        tests.length > 0 &&
        'failed' in report &&
        report.notRun === undefined &&
        store.recordTestVerdict !== undefined
      ) {
        const testsPassed = report.failed === 0;
        await store.recordTestVerdict(saved.name, saved.version, testsPassed, {
          report,
          via: 'manual',
        });
        recorded = { version: saved.version, testsPassed };
      }
      return {
        ...saved,
        ...('failed' in report
          ? boundedReport(
              reportWithDetail(report, detail.value),
              TEST_ANSWER_LIMITS,
            )
          : report),
        ...(recorded !== undefined && { recorded }),
      };
    }

    case 'save_automation': {
      if (p.restoreVersion !== undefined)
        return await restoreVersionCall(ctx, p);
      if (!p.automation) {
        return {
          error: 'missing params.automation',
          code: 'INVALID_PARAMS',
          hint: 'save_automation takes {automation: <the automation document>, message?: "why this version"}',
        };
      }
      // Warnings never refuse a save; they ride along with its answer, so
      // the author hears about them at the moment the version lands.
      const { errors, warnings } = await validate(p.automation, { store });
      if (errors.length > 0) {
        return {
          error: 'automation failed validation — fix errors before saving',
          code: 'AUTOMATION_INVALID',
          hint: 'fix what errors lists, then save again — validate_automation checks a document without saving it',
          errors,
          warnings,
        };
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
      const automation = p.automation as Automation;
      // The document's own tests are the save's verdict: a version saved
      // with failing tests reads `testsPassed: false` from the moment it
      // exists — the contract's promise — where the row used to read null
      // until a deploy gate, which persisted nothing either. A document
      // without tests records no verdict.
      let testsPassed: boolean | undefined;
      let testReport: TestReport | undefined;
      if (automation.tests && automation.tests.length > 0) {
        const report = await runAutomationTests(automation, { store });
        testsPassed = 'failed' in report && report.failed === 0;
        if ('failed' in report) testReport = report;
      }
      const baseVersion =
        p.baseVersion === undefined
          ? { value: undefined }
          : versionParam(
              p.baseVersion,
              'name the version your edit started from — get_automation answers it as version',
            );
      if ('error' in baseVersion) return baseVersion;
      const projectId = asString(p.projectId) || undefined;
      try {
        const saved = await store.save(automation, asString(p.message), {
          ...(testsPassed !== undefined && { testsPassed }),
          ...(testReport !== undefined && { testReport }),
          ...(baseVersion.value !== undefined && {
            baseVersion: baseVersion.value,
          }),
          ...(p.create === true && { create: true }),
          ...(projectId !== undefined && { projectId }),
          metadata: versionMetadata(p),
        });
        return {
          name: saved.name,
          version: saved.version,
          ...(testsPassed !== undefined && { testsPassed }),
          warnings,
          // What the host kept from the latest version because the call
          // left it out — the agent sees the effect of every save.
          carried: saved.carried ?? [],
          baseVersionChecked: baseVersion.value !== undefined,
        };
      } catch (e) {
        // The host's own refusals — a name it reserves for its fixed routes,
        // a name another owner holds, a version saved since the edit began —
        // are refusals, not protocol errors: they come back as data so the
        // caller can rename, merge and retry.
        const refusal = refusalFrom(e);
        if (refusal.code === 'AUTOMATION_VERSION_STALE') {
          return staleSave(asString(automation.name), refusal);
        }
        return refusal;
      }
    }

    case 'get_automation': {
      const read = await getAutomationCall(store, p);
      if (p.against === undefined || !isRecord(read)) return read;
      const readVersion = isRecord(read.meta) ? read.meta.version : undefined;
      if (typeof readVersion !== 'number') return read;
      // What the version read changed against another: the answer keeps the
      // version and adds the comparison beside it.
      const diff = await compareVersions(store, {
        name: asString(p.name),
        from: p.against,
        to: readVersion,
        format: p.diffFormat,
      });
      return typeof diff.error === 'string' ? diff : { ...read, diff };
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
      const expected = p.expectedDeployedVersion;
      if (
        expected !== undefined &&
        expected !== null &&
        !Number.isInteger(expected)
      ) {
        return {
          error: `params.expectedDeployedVersion must be a whole number or null — got ${JSON.stringify(expected)}`,
          code: 'INVALID_PARAMS',
          hint: 'list_versions answers deployedVersion — pass it as read, null while nothing is deployed',
        };
      }
      let testsPassed: boolean | undefined;
      let testReport: TestReport | undefined;
      if (automation.tests && automation.tests.length > 0) {
        const report = await runAutomationTests(automation, { store });
        if ('failed' in report && report.failed > 0) {
          // The refusal is persisted as the version's verdict: the row
          // used to keep `null` after the gate said no, so a client could
          // not tell a version without tests apart from one whose tests
          // fail.
          await store.recordTestVerdict?.(name, version, false, {
            report,
            via: 'deploy',
          });
          return {
            error: 'deploy gate: the automation has failing tests',
            code: 'AUTOMATION_TESTS_FAILING',
            hint: 'read report.results, fix the automation or its tests (test_automation runs them without deploying), save a new version and deploy that one',
            report,
          };
        }
        testsPassed = true;
        if ('failed' in report) testReport = report;
      }
      try {
        const deployed = await store.deploy(name, version, {
          ...(testsPassed !== undefined && { testsPassed }),
          ...(testReport !== undefined && { testReport }),
          ...(expected !== undefined && {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a whole number or null, checked above
            expectedDeployedVersion: expected as number | null,
          }),
        });
        const previousVersion = deployed.previousVersion ?? null;
        return {
          deployed: { name: deployed.name, version: deployed.version },
          // What was live before: deploy it again to undo this one.
          previousVersion,
          // What it did: put a newer version live, an older one (a
          // rollback), or found it live already.
          kind:
            deployed.kind ??
            (previousVersion === deployed.version
              ? 'unchanged'
              : previousVersion !== null && deployed.version < previousVersion
                ? 'rollback'
                : 'deploy'),
          note:
            previousVersion === null || previousVersion === deployed.version
              ? 'this version is now live-eligible via run_deployed and triggers'
              : `this version is now live-eligible via run_deployed and triggers; v${previousVersion} was live before — deploy_automation it again to roll back`,
        };
      } catch (e) {
        return refusalFrom(e);
      }
    }

    case 'delete_automation': {
      if (!store.deleteAutomation)
        return notSupported('deleting automations is');
      const name = asString(p.name);
      if (!name) {
        return {
          error: 'missing params.name',
          code: 'INVALID_PARAMS',
          hint: LIST_AUTOMATIONS_HINT,
        };
      }
      const expected = versionParam(
        p.expectedLatestVersion,
        'name the latest version you read — get_automation answers it as latestVersion',
      );
      if ('error' in expected) return expected;
      const missing = await missingAutomation(store, name);
      if (missing) return missing;
      try {
        const { versions } = await store.deleteAutomation(name, expected.value);
        return {
          deleted: true,
          name,
          versions,
          note: 'every version, the trigger and the installations are gone; the run history stays',
        };
      } catch (e) {
        const refusal = refusalFrom(e);
        if (refusal.code === 'AUTOMATION_VERSION_STALE') {
          return staleDelete(name, refusal);
        }
        return refusal;
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
        // Whether deliveries will run: a binding on an undeployed
        // automation is recorded and fires nothing — the REST door says so
        // beside the token, and so does this one.
        const deployed = (await store.deployedVersion(name)) !== null;
        return {
          ok: true,
          deployed,
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
          // A webhook trigger's token, shown once: list_triggers never
          // returns it, so the caller that minted it is the one that
          // learns it (the REST door answers it the same way).
          ...(outcome?.token !== undefined
            ? {
                token: outcome.token,
                note: `trigger recorded; the webhook token is shown once — list_triggers never returns it, and rotateToken: true mints a new one${deployed ? '' : '. The automation has no deployed version, so deliveries are refused until one is deployed'}`,
              }
            : {}),
          ...(outcome?.nextRunAt !== undefined
            ? { nextRunAt: outcome.nextRunAt }
            : {}),
          // Saved either way; what the deployed version would refuse in
          // every run the trigger starts, said now rather than at the first
          // occurrence.
          ...(outcome?.warnings !== undefined && outcome.warnings.length > 0
            ? { warnings: outcome.warnings }
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
        return await runDeployedDurably(
          ctx,
          name,
          version,
          p.input ?? {},
          asString(p.idempotencyKey) || undefined,
        );
      }
      try {
        await store.authorizeRun?.(name, mode);
      } catch (error) {
        return refusalFrom(error);
      }
      const input = p.input ?? {};
      // The run is kept, so it keeps its record: what each step decided,
      // read and returned.
      const recorder = createRecorder({
        now: () => Date.now(),
        budget: recordBudget(),
      });
      const { record: _record, ...result } = await execute(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store contents were validated at save time
        found.automation as Automation,
        {
          input,
          mode,
          store,
          recorder,
          ...(ctx.connectorHost !== undefined && {
            connectorHost: ctx.connectorHost,
          }),
        },
      );
      if (store.recordRun) {
        await store.recordRun(name, version, result, mode, {
          input,
          nodeRuns: recorder.drain(),
        });
      }
      return { version, ...result, trace: redactTrace(result.trace) };
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
      // Live by default, as on the REST door; a host that does not run live
      // (a test session) defaults to the mocks, and refuses live.
      const mode = p.mode ?? (ctx.allowLive ? 'live' : 'mock');
      if (mode !== 'mock' && mode !== 'live') {
        return {
          error: `unknown mode "${String(p.mode)}"`,
          code: 'INVALID_PARAMS',
          hint: 'mode is "live" (the deployed version, real effects) or "mock" (any saved version, against the mocks)',
        };
      }
      if (mode === 'live' && !ctx.allowLive) {
        return {
          error: 'live mode is not enabled in this environment',
          code: 'LIVE_MODE_UNAVAILABLE',
          hint: 'start it with mode: "mock"; live execution is enabled on deployment',
        };
      }
      // A mock start runs the latest SAVED version unless one is named — the
      // version being built, not the one that is live.
      let version = wanted.value;
      if (mode === 'mock' && version === undefined) {
        const latest = await store.get(name);
        if (latest === null) {
          const missing = await missingAutomation(store, name);
          if (missing) return missing;
        }
        version = latest?.meta.version;
      }
      const projectId = asString(p.projectId) || undefined;
      const idempotencyKey = asString(p.idempotencyKey) || undefined;
      try {
        // An absent input is an empty one; a null input is the null the
        // caller sent, for the schema to accept or refuse.
        const started = await store.startRun(
          name,
          p.input === undefined ? {} : p.input,
          mode,
          version,
          projectId,
          idempotencyKey === undefined ? undefined : { idempotencyKey },
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
          note:
            started.duplicate === true
              ? 'this idempotencyKey already started this run — no new run was started; poll get_run {runId, detail: []} for its status, then get_run {runId} once it finished for its output, trace and effects'
              : mode === 'mock'
                ? 'the mock run continues in the background against the mocks — nothing leaves Tale, and it is recorded in the run history; poll get_run {runId, detail: []} for its status, then get_run {runId} once it finished for its output, trace and effects'
                : 'the run continues in the background — poll get_run {runId, detail: []} for its status, then get_run {runId} once it finished for its output, trace and effects',
          hint:
            mode === 'mock'
              ? 'start_run with mode "live" runs the deployed version for real'
              : 'use run_deployed instead when you want the finished result in a single call',
        };
      } catch (e) {
        const refusal = refusalFrom(e);
        // The store's sentence is the REST door's ("use mock mode"): this
        // tool has no mode — the mock path is run_automation (2026-09-19
        // evaluation, K8-4).
        if (refusal.code === 'AUTOMATION_VERSION_NOT_DEPLOYED') {
          return {
            ...refusal,
            error: `"${name}@${String(version)}" is not the deployed version, and a live start runs only that one`,
            hint: 'omit version to run the deployed version, deploy_automation {name, version} first, or start it with mode: "mock" to try that version against the mocks',
          };
        }
        return refusal;
      }
    }

    case 'list_runs': {
      if (!store.listRuns && !store.listRunsPage) {
        return notSupported('run history is');
      }
      const name = asString(p.name);
      const limit = p.limit === undefined ? undefined : Number(p.limit);
      const cursor = asString(p.cursor) || undefined;
      const statuses = stringList(p.statuses);
      const mode = p.mode === 'mock' || p.mode === 'live' ? p.mode : undefined;
      let runs: RunSummary[];
      let nextCursor: string | null = null;
      if (store.listRunsPage) {
        const page = await store.listRunsPage({
          ...(name !== '' && { name }),
          ...(limit !== undefined && Number.isFinite(limit) && { limit }),
          ...(mode !== undefined && { mode }),
          ...(statuses !== undefined && statuses.length > 0 && { statuses }),
          ...(cursor !== undefined && { cursor }),
        });
        if (page === null) {
          return {
            error: 'params.cursor is not a nextCursor this listing answered',
            code: 'INVALID_CURSOR',
            hint: 'pass the nextCursor list_runs answered, unchanged and with the same name, or omit cursor for the first page',
          };
        }
        runs = page.runs;
        nextCursor = page.nextCursor;
      } else if (store.listRuns) {
        runs = await store.listRuns({
          ...(name !== '' && { name }),
          ...(limit !== undefined && Number.isFinite(limit) && { limit }),
        });
      } else {
        return notSupported('run history is');
      }
      if (name !== '' && runs.length === 0) {
        // A name that exists with no runs and a name that does not exist
        // used to read the same ({runs: []}); the second is a refusal —
        // unless runs bear the name: a deleted automation keeps its run
        // history, and this door used to say it never existed
        // (2026-09-19 evaluation, K8-5).
        const missing = await missingAutomation(store, name);
        if (missing) return missing;
      }
      return { runs, nextCursor };
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
      const detail = runDetailParam(p.detail);
      if ('error' in detail) return detail;
      const include = runIncludeParam(p.include);
      if ('error' in include) return include;
      if (include.value.size > 0 && !store.getRunRecord) {
        return notSupported('a run’s record is');
      }
      const run = await store.getRun(runId);
      if (!run) {
        return {
          error: `no run "${runId}"`,
          code: 'RUN_NOT_FOUND',
          hint: RUN_ID_HINT,
        };
      }
      // The run's own data the caller left out of `detail` is dropped; its
      // status, its scope and the question it waits on always stay.
      const dropped = RUN_DETAIL.filter((key) => !detail.value.has(key));
      const answer: Record<string, unknown> = {
        run: Object.fromEntries(
          Object.entries(run).filter(
            ([key]) => !(dropped as readonly string[]).includes(key),
          ),
        ),
      };
      if (include.value.size > 0 && store.getRunRecord) {
        const record = await store.getRunRecord(runId, {
          travels: include.value.has('travels'),
        });
        if (record !== null) answer.record = record;
      }
      return answer;
    }

    case 'get_run_node': {
      if (!store.getRunNode) return notSupported('a run’s record is');
      const runId = asString(p.runId);
      const node = asString(p.node);
      if (!runId || !node) {
        return {
          error: !runId ? 'missing params.runId' : 'missing params.node',
          code: 'INVALID_PARAMS',
          hint: !runId
            ? RUN_ID_HINT
            : 'name a step by its path, as get_run {runId, include: ["record"]} lists it under record.nodes',
        };
      }
      const item = unitIndexParam(p.item);
      const pass = unitIndexParam(p.pass);
      if (item === null || pass === null) {
        return {
          error: 'params.item and params.pass are whole numbers from -1',
          code: 'INVALID_PARAMS',
          hint: 'leave them out (or -1) for the step itself',
        };
      }
      try {
        const unit = await store.getRunNode(runId, {
          node,
          ...(item !== undefined && { item }),
          ...(pass !== undefined && { pass }),
        });
        if (unit === null) {
          return {
            error: `no run "${runId}"`,
            code: 'RUN_NOT_FOUND',
            hint: RUN_ID_HINT,
          };
        }
        return { node: unit };
      } catch (e) {
        return refusalFrom(e);
      }
    }

    case 'compare_runs': {
      if (!store.compareRuns) return notSupported('comparing runs is');
      const a = asString(p.a);
      const b = asString(p.b);
      if (!a || !b) {
        return {
          error: !a ? 'missing params.a' : 'missing params.b',
          code: 'INVALID_PARAMS',
          hint: 'name two runs of one automation, as list_runs lists them',
        };
      }
      try {
        const diff = await store.compareRuns(a, b);
        if (diff === null) {
          return {
            error: `no run "${a}" or "${b}" to compare`,
            code: 'RUN_NOT_FOUND',
            hint: RUN_ID_HINT,
          };
        }
        return { diff };
      } catch (e) {
        return refusalFrom(e);
      }
    }

    case 'replay_run': {
      if (!store.replayRun || !store.planReplay) {
        return notSupported('running a run again is');
      }
      const runId = asString(p.runId);
      if (!runId) {
        return {
          error: 'missing params.runId',
          code: 'INVALID_PARAMS',
          hint: RUN_ID_HINT,
        };
      }
      const request = replayRequestParam(p);
      if ('error' in request) return request;
      try {
        if (p.dryRun === true) {
          const plan = await store.planReplay(runId, request.value);
          if (plan === null) {
            return {
              error: `no run "${runId}"`,
              code: 'RUN_NOT_FOUND',
              hint: RUN_ID_HINT,
            };
          }
          return { plan };
        }
        const key = asString(p.idempotencyKey);
        const started = await store.replayRun(
          runId,
          request.value,
          key ? { idempotencyKey: key } : {},
        );
        if (started === null) {
          return {
            error: `no run "${runId}"`,
            code: 'RUN_NOT_FOUND',
            hint: RUN_ID_HINT,
          };
        }
        return {
          run: started,
          note: 'the replay runs in the background — poll get_run {runId, detail: []} for its status, then get_run {runId, include: ["record"]} once it finished',
        };
      } catch (e) {
        return refusalFrom(e);
      }
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
        const outcome = await store.cancelRun(runId);
        // A run that does not exist is RUN_NOT_FOUND, the same code `get_run`
        // and REST cancel answer — not the "already finished" note, which a
        // cancel-until-refusal loop reads as success and never learns the id
        // is wrong (2026-09-18 evaluation, J8-1). The store reports it by
        // `cancelled: false` with no terminal `status`.
        if (!outcome.cancelled && outcome.status === undefined) {
          return {
            error: `no run "${runId}"`,
            code: 'RUN_NOT_FOUND',
            hint: RUN_ID_HINT,
          };
        }
        return {
          cancelled: outcome.cancelled,
          note: outcome.cancelled
            ? 'the run stops at its next node boundary; work already performed is not undone'
            : 'the run had already finished — nothing to cancel',
        };
      } catch (e) {
        return refusalFrom(e);
      }
    }

    case 'list_versions': {
      if (!store.listVersionHistory && !store.listVersions) {
        return notSupported('version history is');
      }
      const name = asString(p.name);
      if (!name) {
        return {
          error: 'missing params.name',
          code: 'INVALID_PARAMS',
          hint: LIST_AUTOMATIONS_HINT,
        };
      }
      const limit = historyLimitParam(p.limit);
      if ('error' in limit) return limit;
      const before = versionPageStartParam(p.before);
      if ('error' in before) return before;
      // An unknown name is a refusal, as it is for get_automation — never
      // an empty history a caller reads as "exists, nothing saved yet".
      const missing = await missingAutomation(store, name);
      if (missing) return missing;
      // When each version went live, and what was live before it — the
      // history a rollback (deploy_automation of an older version) reads;
      // `list_deployments` pages through all of it.
      const deployments = store.listDeployments
        ? { deployments: await store.listDeployments(name) }
        : {};
      if (store.listVersionHistory) {
        const page = await store.listVersionHistory(name, {
          ...(limit.value !== undefined && { limit: limit.value }),
          ...(before.value !== undefined && { before: before.value }),
        });
        return {
          deployedVersion: page.deployedVersion,
          latestVersion: page.latestVersion,
          versions: page.versions,
          nextBefore: page.nextBefore,
          ...deployments,
        };
      }
      // A host that lists whole histories only: the page is cut here.
      // Which of them runs: the REST listing marks it, and a model reading
      // the history had to join two calls to learn it (2026-09-14
      // evaluation, h9).
      const deployedVersion = await store.deployedVersion(name);
      const everything = (await store.listVersions?.(name)) ?? [];
      const older = everything.filter(
        (version) =>
          before.value === undefined || version.version < before.value,
      );
      const shown =
        limit.value === undefined ? older : older.slice(0, limit.value);
      const versions = shown.map((version) =>
        Object.assign(version, {
          deployed: version.version === deployedVersion,
        }),
      );
      const last = versions.at(-1);
      return {
        deployedVersion,
        latestVersion:
          everything.length === 0
            ? null
            : Math.max(...everything.map((version) => version.version)),
        versions,
        nextBefore:
          last !== undefined && shown.length < older.length
            ? last.version
            : null,
        ...deployments,
      };
    }

    case 'set_automation_projects': {
      if (!store.setAutomationProjects) {
        return notSupported('installing automations in projects is');
      }
      const name = asString(p.name);
      const add = stringList(p.add);
      const remove = stringList(p.remove);
      if (!name || add === undefined || remove === undefined) {
        return {
          error:
            'set_automation_projects takes {name, add?: [projectId], remove?: [projectId]}',
          code: 'INVALID_PARAMS',
          hint: 'list_automations shows the projects each automation is installed in (projectIds)',
        };
      }
      if (add.length === 0 && remove.length === 0) {
        return {
          error: 'nothing to change — add and remove are both empty',
          code: 'INVALID_PARAMS',
          hint: 'name at least one project to install it in (add) or remove it from (remove)',
        };
      }
      const missing = await missingAutomation(store, name);
      if (missing) return missing;
      try {
        return {
          name,
          ...(await store.setAutomationProjects(name, { add, remove })),
        };
      } catch (e) {
        return refusalFrom(e);
      }
    }

    case 'answer_run_ask': {
      if (!store.answerAsk) return notSupported('answering a run is');
      const runId = asString(p.runId);
      const askId = asString(p.askId);
      if (!runId || !askId) {
        return {
          error: 'answer_run_ask takes {runId, askId, answer}',
          code: 'INVALID_PARAMS',
          hint: 'get_run {runId} answers the question a waiting run asks as run.ask (askId, question)',
        };
      }
      const answer = asString(p.answer).trim();
      if (answer === '') {
        return {
          error: 'the answer is blank — send the text the run should resume on',
          code: 'EMPTY_ANSWER',
          hint: 'answer the question in words; the run reads them as the person’s answer',
        };
      }
      try {
        const answered = await store.answerAsk(runId, askId, answer);
        return {
          answered: true,
          runId: answered.runId,
          askId: answered.askId,
          taskId: answered.taskId,
          note: 'the run resumes on the answer — poll get_run {runId} for where it goes next',
        };
      } catch (e) {
        return refusalFrom(e);
      }
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
