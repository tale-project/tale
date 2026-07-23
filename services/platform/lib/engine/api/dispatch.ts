/**
 * The single method table behind every surface — HTTP JSON-RPC, the platform
 * MCP endpoint, and the builder session loop all call `dispatch()`, so
 * behavior can't diverge between interfaces. A text protocol is the measured
 * common denominator; native tool-calling and constrained decoding both fare
 * worse for small models.
 *
 * Live execution is host-gated: `run_workflow {mode: "live"}` and
 * `run_deployed` require the host to pass `allowLive: true`; a builder loop
 * cannot reach real backends from a test session.
 *
 * The store is injected (not a module singleton), because the host owns
 * persistence — the selftest passes an in-memory store, the automations host
 * passes a Convex-backed one. Reads use the same `StoreAdapter` the executor
 * resolves subworkflows through; the write operations extend it.
 */

import { execute } from '../core/execute';
import type { StoreAdapter } from '../core/slots';
import { nodeTypes } from '../core/slots';
import type { RunResult, Workflow } from '../core/types';
import { validate } from '../core/validate';
import { searchCatalog } from './catalog-search';
import { agentDocs } from './docs';
import { runWorkflowTests } from './tests';

export const METHODS = [
  'get_docs',
  'get_catalog',
  'search_catalog',
  'validate_workflow',
  'run_workflow',
  'test_workflow',
  'save_workflow',
  'get_workflow',
  'list_workflows',
  'deploy_workflow',
  'set_trigger',
  'run_deployed',
] as const;

export type Method = (typeof METHODS)[number];

/** A trigger binding the host persists and acts on. The engine only records
 * it; scheduling and delivery are the host's job. */
export interface TriggerSpec {
  kind: 'schedule' | 'webhook' | 'event' | 'api-key';
  [k: string]: unknown;
}

/**
 * The persistence surface dispatch needs: the executor's read adapter plus
 * the writes the authoring loop performs. `setTrigger`/`recordRun` are
 * optional — a bare selftest store need not implement them, and dispatch
 * reports when a called capability is unavailable rather than throwing.
 */
export interface DispatchStore extends StoreAdapter {
  save(
    workflow: Workflow,
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
}

export interface DispatchContext {
  store: DispatchStore;
  /** Enable live integration calls — deployments/hosts only, never a builder
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
        if (t.integration) {
          entry.input_schema = t.integration.inputSchema;
          entry.output = t.integration.outputSignature;
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

    case 'validate_workflow': {
      if (!p.workflow) return { error: 'missing params.workflow' };
      const { errors, warnings } = await validate(p.workflow);
      return { valid: errors.length === 0, errors, warnings };
    }

    case 'run_workflow': {
      if (!p.workflow) {
        return {
          error: 'missing params.workflow',
          hint: 'call as {method: run_workflow, params: {workflow: {...}, input: {...}}}',
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
      const { errors, warnings } = await validate(p.workflow);
      if (errors.length > 0) {
        return {
          status: 'invalid',
          trace: [],
          effects: [],
          validation: { errors, warnings },
        } satisfies RunResult;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
      const result = await execute(p.workflow as Workflow, {
        input: p.input ?? {},
        mode,
      });
      if (warnings.length > 0) result.validation = { errors: [], warnings };
      return result;
    }

    case 'test_workflow': {
      if (!p.workflow) {
        return {
          error: 'missing params.workflow',
          hint: 'call as {method: test_workflow, params: {workflow: {...with tests...}}}',
        };
      }
      const { errors, warnings } = await validate(p.workflow);
      if (errors.length > 0) return { status: 'invalid', errors, warnings };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
      return await runWorkflowTests(p.workflow as Workflow);
    }

    case 'save_workflow': {
      if (!p.workflow) return { error: 'missing params.workflow' };
      const { errors } = await validate(p.workflow);
      if (errors.length > 0) {
        return {
          error: 'workflow failed validation — fix errors before saving',
          errors,
        };
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated above
      return await store.save(p.workflow as Workflow, asString(p.message));
    }

    case 'get_workflow': {
      const name = asString(p.name);
      const found = await store.get(
        name,
        p.version === undefined ? undefined : Number(p.version),
      );
      return found ?? { error: `no saved workflow named "${name}"` };
    }

    case 'list_workflows':
      return { workflows: await store.list() };

    case 'deploy_workflow': {
      // The deploy gate: a version only becomes live-eligible if it still
      // validates AND its tests pass, so triggers never run a broken flow.
      const name = asString(p.name);
      const version = Number(p.version);
      const saved = await store.get(name, version);
      if (!saved) {
        return { error: `no saved workflow "${name}@${String(p.version)}"` };
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store contents were validated at save time
      const workflow = saved.workflow as Workflow;
      const { errors } = await validate(workflow);
      if (errors.length > 0) {
        return {
          error: 'this version no longer validates; it cannot be deployed',
          errors,
        };
      }
      if (workflow.tests && workflow.tests.length > 0) {
        const report = await runWorkflowTests(workflow);
        if ('failed' in report && report.failed > 0) {
          return {
            error: 'deploy gate: the workflow has failing tests',
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
          hint: '{method: set_trigger, params: {name, trigger: {kind: "schedule"|"webhook"|"event"|"api-key", …}}}',
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
          hint: 'save_workflow then deploy_workflow first',
        };
      }
      const found = await store.get(name, version);
      if (!found)
        return { error: `deployed version ${name}@${version} is missing` };
      const mode = ctx.allowLive ? 'live' : 'mock';
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store contents were validated at save time
      const result = await execute(found.workflow as Workflow, {
        input: p.input ?? {},
        mode,
      });
      if (store.recordRun) await store.recordRun(name, version, result, mode);
      return { version, ...result };
    }

    default:
      return {
        error: `unknown method "${method}"`,
        hint: `available methods: ${METHODS.join(', ')}`,
      };
  }
}
