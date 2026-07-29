/**
 * The single method table behind every surface — HTTP JSON-RPC, the platform
 * MCP endpoint, and the builder session loop all call `dispatch()`, so
 * behavior can't diverge between interfaces. A text protocol is the measured
 * common denominator; native tool-calling and constrained decoding both fare
 * worse for small models.
 *
 * Live execution is host-gated: `run_automation {mode: "live"}` and
 * `run_deployed` require the host to pass `allowLive: true`; a builder loop
 * cannot reach real backends from a test session.
 *
 * The store is injected (not a module singleton), because the host owns
 * persistence — the selftest passes an in-memory store, the automations host
 * passes a Convex-backed one. Reads use the same `StoreAdapter` the executor
 * resolves subautomations through; the write operations extend it.
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

import { execute } from '../core/execute';
import type { StoreAdapter } from '../core/slots';
import { nodeTypes } from '../core/slots';
import type { Automation, RunResult } from '../core/types';
import { validate } from '../core/validate';
import { searchCatalog } from './catalog-search';
import { agentDocs } from './docs';
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
  status: string;
  mode: string;
  startedBy: string;
  detail?: string;
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
  name: string;
  kind: string;
  cron?: string;
  timezone?: string;
  event?: string;
  /** Whether a webhook token was ever minted, WITHOUT revealing it. */
  hasToken: boolean;
  enabled: boolean;
  lastFiredAt?: number;
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
  deploy(
    name: string,
    version: number,
  ): Promise<{ name: string; version: number }>;
  setTrigger?(name: string, trigger: TriggerSpec): Promise<void>;
  recordRun?(
    name: string,
    version: number,
    result: RunResult,
    mode: 'mock' | 'live',
  ): Promise<void>;
  /** Hand a run to the host's durable runner. Returns the handle to poll, or
   * null when the automation has no version to run. */
  startRun?(
    name: string,
    input: unknown,
    mode: 'mock' | 'live',
    version?: number,
  ): Promise<{ runId: string; version: number } | null>;
  listRuns?(options: { name?: string; limit?: number }): Promise<RunSummary[]>;
  getRun?(runId: string): Promise<RunDetail | null>;
  cancelRun?(runId: string): Promise<{ cancelled: boolean }>;
  listVersions?(name: string): Promise<VersionSummary[]>;
  listTriggers?(name?: string): Promise<TriggerView[]>;
  deleteTrigger?(name: string): Promise<void>;
}

export interface DispatchContext {
  store: DispatchStore;
  /** Enable live connector calls — deployments/hosts only, never a builder
   * test loop. */
  allowLive?: boolean;
}

/** Coerce an unknown param to a string without an object ever stringifying
 * to "[object Object]" — non-strings that aren't numbers/booleans become
 * empty, which the callers treat as "missing". */
function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
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
      return { docs: agentDocs() };

    case 'get_catalog': {
      const node_types = [];
      for (const t of nodeTypes().values()) {
        const entry: Record<string, unknown> = {
          type: t.type,
          kind: t.kind,
          description: t.description,
          outputKind: t.outputKind,
          fields: [
            'id',
            'type',
            ...t.allowedFields.map((f) =>
              t.requiredFields.includes(f) ? f : `${f}?`,
            ),
          ],
        };
        if (t.connector) {
          entry.input_schema = t.connector.inputSchema;
          entry.output = t.connector.outputSignature;
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
          hint: '{method: search_catalog, params: {query: "send email"}}',
        };
      }
      const matches = searchCatalog(query);
      return {
        matches,
        ...(matches.length === 0 && {
          hint: 'no matches — try different capability keywords (verbs + objects)',
        }),
      };
    }

    case 'validate_automation': {
      if (!p.automation) return { error: 'missing params.automation' };
      const { errors, warnings } = await validate(p.automation);
      return { valid: errors.length === 0, errors, warnings };
    }

    case 'run_automation': {
      if (!p.automation) {
        return {
          error: 'missing params.automation',
          hint: 'call as {method: run_automation, params: {automation: {...}, input: {...}}}',
        };
      }
      const mode = p.mode ?? 'mock';
      if (mode !== 'mock' && mode !== 'live') {
        return {
          error: `unknown mode "${String(p.mode)}"`,
          hint: 'mode is "mock" (default) or "live"',
        };
      }
      if (mode === 'live' && !ctx.allowLive) {
        return {
          error: 'live mode is not enabled in this environment',
          hint: 'test against mocks; live execution is enabled on deployment (host sets allowLive)',
        };
      }
      const { errors, warnings } = await validate(p.automation);
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
      });
      if (warnings.length > 0) result.validation = { errors: [], warnings };
      return result;
    }

    case 'test_automation': {
      if (!p.automation) {
        return {
          error: 'missing params.automation',
          hint: 'call as {method: test_automation, params: {automation: {...with tests...}}}',
        };
      }
      const { errors, warnings } = await validate(p.automation);
      if (errors.length > 0) return { status: 'invalid', errors, warnings };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
      return await runAutomationTests(p.automation as Automation);
    }

    case 'save_automation': {
      if (!p.automation) return { error: 'missing params.automation' };
      const { errors } = await validate(p.automation);
      if (errors.length > 0) {
        return {
          error: 'automation failed validation — fix errors before saving',
          errors,
        };
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
      return await store.save(p.automation as Automation, asString(p.message));
    }

    case 'get_automation': {
      const name = asString(p.name);
      const found = await store.get(
        name,
        p.version === undefined ? undefined : Number(p.version),
      );
      return found ?? { error: `no saved automation named "${name}"` };
    }

    case 'list_automations':
      return { automations: await store.list() };

    case 'deploy_automation': {
      // The deploy gate: a version only becomes live-eligible if it still
      // validates AND its tests pass, so triggers never run a broken flow.
      const name = asString(p.name);
      const version = Number(p.version);
      const saved = await store.get(name, version);
      if (!saved) {
        return { error: `no saved automation "${name}@${String(p.version)}"` };
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store contents were validated at save time
      const automation = saved.automation as Automation;
      const { errors } = await validate(automation);
      if (errors.length > 0) {
        return {
          error: 'this version no longer validates; it cannot be deployed',
          errors,
        };
      }
      if (automation.tests && automation.tests.length > 0) {
        const report = await runAutomationTests(automation);
        if ('failed' in report && report.failed > 0) {
          return {
            error: 'deploy gate: the automation has failing tests',
            report,
          };
        }
      }
      try {
        const deployed = await store.deploy(name, version);
        return {
          deployed,
          note: 'this version is now live-eligible via run_deployed and triggers',
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'set_trigger': {
      if (!store.setTrigger) {
        return { error: 'triggers are not supported in this environment' };
      }
      const trigger = p.trigger;
      if (!trigger || typeof trigger !== 'object') {
        return {
          error: 'missing params.trigger',
          hint: '{method: set_trigger, params: {name, trigger: {kind: "schedule"|"webhook"|"event", …}}}',
        };
      }
      try {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape guarded by the host on persist
        await store.setTrigger(asString(p.name), trigger as TriggerSpec);
        return {
          ok: true,
          note: 'trigger recorded; the host schedules and delivers it',
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'run_deployed': {
      const name = asString(p.name);
      const version = await store.deployedVersion(name);
      if (!version) {
        return {
          error: `"${name}" has no deployed version`,
          hint: 'save_automation then deploy_automation first',
        };
      }
      const found = await store.get(name, version);
      if (!found)
        return { error: `deployed version ${name}@${version} is missing` };
      const mode = ctx.allowLive ? 'live' : 'mock';
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store contents were validated at save time
      const result = await execute(found.automation as Automation, {
        input: p.input ?? {},
        mode,
      });
      if (store.recordRun) await store.recordRun(name, version, result, mode);
      return { version, ...result };
    }

    case 'start_run': {
      if (!store.startRun) {
        return { error: 'durable runs are not supported in this environment' };
      }
      const name = asString(p.name);
      if (!name) {
        return {
          error: 'missing params.name',
          hint: '{method: start_run, params: {name: "billing/dunning", input: {…}}}',
        };
      }
      const version = p.version === undefined ? undefined : Number(p.version);
      if (version !== undefined && !Number.isInteger(version)) {
        return {
          error: `params.version must be a whole number — got "${String(p.version)}"`,
          hint: 'omit it to run the deployed version',
        };
      }
      // The host's own execution mode: a deployment runs live, a test session
      // runs against mocks — the same rule `run_deployed` follows.
      const mode = ctx.allowLive ? 'live' : 'mock';
      try {
        const started = await store.startRun(
          name,
          p.input ?? {},
          mode,
          version,
        );
        if (!started) {
          return {
            error: `"${name}" has no version to run`,
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
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'list_runs': {
      if (!store.listRuns) {
        return { error: 'run history is not supported in this environment' };
      }
      const name = asString(p.name);
      const limit = p.limit === undefined ? undefined : Number(p.limit);
      return {
        runs: await store.listRuns({
          ...(name !== '' && { name }),
          ...(limit !== undefined && Number.isFinite(limit) && { limit }),
        }),
      };
    }

    case 'get_run': {
      if (!store.getRun) {
        return { error: 'run history is not supported in this environment' };
      }
      const runId = asString(p.runId);
      if (!runId) {
        return {
          error: 'missing params.runId',
          hint: 'start_run returns the runId; list_runs lists the recent ones',
        };
      }
      const run = await store.getRun(runId);
      return run ? { run } : { error: `no run "${runId}"` };
    }

    case 'cancel_run': {
      if (!store.cancelRun) {
        return {
          error: 'cancelling a run is not supported in this environment',
        };
      }
      const runId = asString(p.runId);
      if (!runId) return { error: 'missing params.runId' };
      try {
        const { cancelled } = await store.cancelRun(runId);
        return {
          cancelled,
          note: cancelled
            ? 'the run stops at its next node boundary; work already performed is not undone'
            : 'the run had already finished — nothing to cancel',
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }

    case 'list_versions': {
      if (!store.listVersions) {
        return {
          error: 'version history is not supported in this environment',
        };
      }
      const name = asString(p.name);
      if (!name) return { error: 'missing params.name' };
      return { versions: await store.listVersions(name) };
    }

    case 'list_triggers': {
      if (!store.listTriggers) {
        return { error: 'triggers are not supported in this environment' };
      }
      const name = asString(p.name);
      return {
        triggers: await store.listTriggers(name === '' ? undefined : name),
      };
    }

    case 'delete_trigger': {
      if (!store.deleteTrigger) {
        return { error: 'triggers are not supported in this environment' };
      }
      const name = asString(p.name);
      if (!name) return { error: 'missing params.name' };
      try {
        await store.deleteTrigger(name);
        return {
          ok: true,
          note: 'the automation no longer starts on its own; its versions and run history stay',
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }

    default:
      return {
        error: `unknown method "${method}"`,
        hint: `available methods: ${METHODS.join(', ')}`,
      };
  }
}
