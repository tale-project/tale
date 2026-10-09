/**
 * The executor: run a validated automation against an input, producing
 * `{status, output, trace, effects}`.
 *
 * The trace records every node's RESOLVED input and actual output — it is
 * the author's runtime feedback, and together with the effects log it is
 * what the fast feedback loop is made of. Modes: `mock` (default) runs
 * deterministic connector/llm mocks so runs are repeatable and acceptance
 * tests can compute expected values; `live` calls connector.live() and the
 * installed LlmService (host-gated upstream).
 */

import type { ValidateFunction } from 'ajv';

import { connectorIdempotencyKey, subautomationPathPrefix } from '../protocol';
import {
  classifyStepFailure,
  connectorFailureOf,
  reasonFamily,
  failureCauseOf,
} from '../record/failure';
import { noRecorder, type RunRecorder } from '../record/recorder';
import { END_PATH, START_PATH, type UnitKey } from '../record/types';
import type {
  AgentTurnRequest,
  ConnectorHostCapabilities,
  ConnectorLike,
  StoreAdapter,
} from '../slots';
import { agentService, llmService, nodeTypes } from '../slots';
import { ptr } from '../syntax/pointer';
import {
  evalTemplates,
  evalTemplatesRendered,
  explainFailure,
  ExprError,
  type RenderedSpan,
  runCode,
} from '../template';
import {
  type Automation,
  type Effect,
  effectPlace,
  type Issue,
  type Json,
  nestedEffectPlace,
  type NodeTrace,
  type RunBench,
  type RunResult,
} from '../types';
import { MAX_SUBAUTOMATION_DEPTH } from '../typing/children';
import { compileSchema, inputRefusalMessage } from '../validate/schema';
import {
  type BenchPlan,
  CALL_AS_WRITTEN,
  itemOutOfRange,
  planBench,
  refusalIssue,
  refusalPath,
} from './bench';
import { maxRepeatsOf, topoSort } from './controlflow';
import { decideNode, repeatSettled, resolveForEach } from './decide';
import {
  cloneData,
  makeScope,
  mockAgentText,
  mockLlmText,
  newRunId,
  stubFromSchema,
} from './scope';

/**
 * One compiled validator per registered connector, for the life of the
 * registration. A connector's input schema is static, so compiling it on
 * every node of every run only grew the Ajv cache by one entry per run —
 * and a schema carrying an `$id` threw "already exists" on the second run.
 * Keyed weakly so a re-registered catalog does not pin the old validators.
 */
const connectorValidators = new WeakMap<ConnectorLike, ValidateFunction>();

function connectorValidator(connector: ConnectorLike): ValidateFunction {
  let check = connectorValidators.get(connector);
  if (check === undefined) {
    check = compileSchema(connector.inputSchema);
    connectorValidators.set(connector, check);
  }
  return check;
}

/** A resolved template destined for prompt text: strings pass through,
 * structured values render as JSON (never "[object Object]"), and absent
 * values become empty text. */
function asPromptText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return JSON.stringify(v);
}

export interface ExecuteOptions {
  /** The runtime input, validated against the automation's `inputs` schema. */
  input?: unknown;
  /** `mock` (default): deterministic mocks. `live`: real side effects. */
  mode?: 'mock' | 'live';
  /** Per-connector secret maps, handed to live() calls only. */
  secrets?: Record<string, Record<string, string>>;
  /**
   * The mediated capabilities a live connector call may reach — HTTP,
   * blob storage, base64, and the per-credential endpoint. The engine never
   * implements these: the host supplies them so it can enforce the host
   * allowlist, inject credentials, and account for the work. Absent in mock
   * mode, and its absence is why a live run without a host falls back to the
   * deterministic mock rather than reaching the network.
   */
  connectorHost?: (connector: string) => ConnectorHostCapabilities;
  /**
   * Where `subautomation` nodes resolve the documents they reference. Threaded
   * per call — never a process-global slot — because a store is scoped to one
   * organization while one process serves many. Without it a subautomation
   * node fails with guidance instead of reading another tenant's store.
   */
  store?: StoreAdapter;
  /** Transform-code timeout override. */
  timeoutMs?: number;
  /** Guard against runaway documents: total node EXECUTIONS including
   * forEach items (default 100). */
  maxNodes?: number;
  /** Subautomation nesting depth (internal; hosts leave it unset). */
  nesting?: number;
  /** The calling run and the path prefix of a subautomation's own nodes
   * (internal; hosts leave it unset): a nested call presents the key the
   * durable stepper gives the same call, `<run>:<parent>[<item>:<pass>]/<id>:…`.
   * `docRef` names the document the nested nodes come from (`name@version`). */
  within?: { runId: string; pathPrefix: string; docRef?: string };
  /**
   * Where the run's record goes: what each unit of work decided, read,
   * received and returned. Without one the run executes exactly as before
   * and its result carries no record; with one, the result's `record` holds
   * every unit the recorder kept.
   */
  recorder?: RunRecorder;
  /**
   * What stands in for some nodes' calls, and the narrower scope of a step
   * test (`./bench`): a test's simulated outputs and failures, `upTo`,
   * `only` with its pinned data, `item`. Mock runs only — a live run with a
   * bench is refused — and the automation's own nodes only: a called
   * automation runs as written.
   */
  bench?: RunBench;
  /** Epoch ms: past it the run stops at its next step, item or pass. */
  deadline?: number;
  /** Once aborted, the run stops at its next step, item or pass. */
  signal?: AbortSignal;
}

const DEFAULT_MAX_NODE_EXECUTIONS = 100;

/** A run stopped between steps, items or passes: by its time limit or by
 * its caller. Not a failure of the step it was in, so `onError` never
 * catches it. */
class RunStopped extends Error {
  constructor(readonly by: 'time_limit' | 'cancelled') {
    super(by === 'cancelled' ? 'stopped' : 'stopped at the time limit');
  }
}

/** A run that is refused before any step: an invalid bench. */
function refusedRun(issue: Issue): RunResult {
  return {
    status: 'invalid',
    trace: [],
    effects: [],
    validation: { errors: [issue], warnings: [] },
  };
}

/** The failure a test simulates for a step: the test's message, as the
 * step's English and as the param its readers word it with. */
function simulatedFailure(nodeId: string, message: string): ExprError {
  return new ExprError(
    nodeId,
    message === ''
      ? 'a failure simulated by the test'
      : `${message} (simulated by the test)`,
    {
      reason: 'SIMULATED_FAILURE',
      params: message === '' ? {} : { message },
    },
  );
}

export async function execute(
  doc: Automation,
  opts: ExecuteOptions = {},
): Promise<RunResult> {
  const input = opts.input;
  const trace: NodeTrace[] = [];
  const effects: Effect[] = [];
  const rec = opts.recorder ?? noRecorder;
  // A nested run records into its caller's recorder; only the outermost run
  // records the run's own input and output, and answers the record.
  const outermost = opts.within === undefined;

  // The bench stands in for the automation's own nodes only: a called
  // automation runs as written, and its stand-in, if any, replaces it whole.
  let plan: BenchPlan | undefined;
  if (outermost && opts.bench !== undefined) {
    if (opts.mode === 'live') {
      return refusedRun({
        level: 'error',
        code: 'BENCH_MOCK_ONLY',
        message:
          'simulated outputs, simulated failures and narrower scopes apply to mock runs only',
        hint: 'run in mock mode — a live run calls every node as written',
        at: { pointer: '/bench' },
        params: {},
      });
    }
    const planned = planBench(doc.nodes, opts.bench);
    if (!planned.ok) {
      return refusedRun(
        refusalIssue(planned, ptr('bench', ...refusalPath(planned.refusal))),
      );
    }
    plan = planned.plan;
  }

  /** What a run with a bench says beside its outcome: its scope, and the
   * stand-ins it never used because their nodes were skipped or left out. */
  const benchFacts = (): Pick<RunResult, 'focus' | 'unusedMocks'> => {
    if (plan === undefined) return {};
    const statusOf = new Map(trace.map((e) => [e.node, e.status]));
    const unused = plan.standIns.filter((id) => {
      const status = statusOf.get(id);
      return (
        status === undefined || status === 'skipped' || status === 'not_run'
      );
    });
    return {
      ...(plan.focus !== undefined && { focus: plan.focus }),
      ...(unused.length > 0 && { unusedMocks: unused }),
    };
  };
  const withRecord = (result: RunResult): RunResult => {
    const told = { ...result, ...benchFacts() };
    return outermost && opts.recorder !== undefined
      ? { ...told, record: rec.snapshot() }
      : told;
  };
  const fail = (error: RunResult['error']): RunResult =>
    withRecord({
      status: 'error',
      error,
      trace,
      effects,
    });

  const startedAt = Date.now();
  /** Whether the run must stop before its next step, item or pass. */
  const stopCause = (): 'time_limit' | 'cancelled' | undefined => {
    if (opts.signal?.aborted === true) return 'cancelled';
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) {
      return 'time_limit';
    }
    return undefined;
  };
  /** The run stopped: what it was in the middle of reads failed, and every
   * step after it did not run. An open unit of the record stays open, so
   * the record reads it as stopped. */
  const stopped = (
    by: 'time_limit' | 'cancelled',
    rest: readonly { id: string; type: string }[],
    inside?: NodeTrace,
  ): RunResult => {
    const message =
      by === 'cancelled'
        ? 'stopped'
        : `stopped after ${Math.round((Date.now() - startedAt) / 1000)} s — this run has a time limit`;
    if (inside !== undefined) {
      inside.status = 'error';
      inside.error = message;
    }
    for (const node of rest) {
      trace.push({ node: node.id, type: node.type, status: 'not_run' });
    }
    return {
      ...fail({
        ...(inside !== undefined && { nodeId: inside.node }),
        message,
      }),
      stoppedBy: by,
    };
  };

  if (outermost) {
    const startKey = { path: START_PATH, item: -1, pass: -1 };
    rec.unitStarted(startKey, { nodeId: START_PATH, nodeType: 'input' });
    rec.unitFinished(startKey, { status: 'ok', output: input });
  }

  // Runtime input contract. An unparseable inputs schema is validation's
  // finding, not a run failure — skip the check rather than crash here.
  // compileSchema clears the Ajv cache per compile, so a long-lived process
  // does not retain one validator per run and an `$id` compiles every time.
  if (doc.inputs) {
    try {
      const check = compileSchema(doc.inputs);
      if (!check(input)) {
        return fail({
          message: inputRefusalMessage(check.errors),
          hint: `you passed: ${JSON.stringify(input)}`,
        });
      }
    } catch (err) {
      console.warn(
        '[engine] skipping run-input check (unparseable inputs schema — validate_automation reports it):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const ordered = topoSort(doc.nodes);
  if (!ordered) {
    return fail({
      message: 'circular reference between nodes (see validate_automation)',
    });
  }

  const nodeOutputs: Record<string, { output: unknown }> = {};
  const skipped = new Set<string>();
  const whenSkipped = new Set<string>();
  const runId = opts.within?.runId ?? newRunId();
  const pathPrefix = opts.within?.pathPrefix ?? '';
  const maxExecutions = opts.maxNodes ?? DEFAULT_MAX_NODE_EXECUTIONS;
  let executions = 0;
  const rankOf = new Map(ordered.map((node, index) => [node.id, index]));
  const walk = {
    outputs: nodeOutputs,
    skipped,
    whenSkipped,
    rank: (id: string) => rankOf.get(id) ?? Number.MAX_SAFE_INTEGER,
  };

  const focus = plan?.focus;
  for (const [position, n] of ordered.entries()) {
    const stop = stopCause();
    if (stop !== undefined) return stopped(stop, ordered.slice(position));
    const call = plan?.call(n.id) ?? CALL_AS_WRITTEN;
    if (call.kind === 'left-out') {
      // Outside the step test's scope: nothing of it runs, and it has no
      // record — the record reads it as not run, the run's focus says why.
      trace.push({
        node: n.id,
        type: n.type,
        status: 'not_run',
        bench: 'left-out',
        note: 'left out of this test',
      });
      continue;
    }
    const def = nodeTypes().get(n.type);
    const t0 = performance.now();
    const entry: NodeTrace = { node: n.id, type: n.type, status: 'ok' };
    trace.push(entry);
    const path = `${pathPrefix}${n.id}`;
    const pointer = `/nodes/${doc.nodes.indexOf(n)}`;
    const nodeKey: UnitKey = { path, item: -1, pass: -1 };
    // The units of this step still open, outermost first: a failure ends
    // each of them.
    const openUnits: UnitKey[] = [nodeKey];
    rec.unitStarted(nodeKey, { nodeId: n.id, nodeType: n.type });
    if (opts.within?.docRef !== undefined) {
      rec.meta(nodeKey, { docRef: opts.within.docRef });
    }
    const finish = () => {
      entry.ms = Math.round((performance.now() - t0) * 10) / 10;
    };
    if (call.kind === 'pinned') {
      // Data a step test hands the node it runs alone: its output, with
      // nothing of it evaluated.
      const pin = cloneData(call.output);
      entry.output = pin;
      entry.bench = 'pinned';
      entry.note = 'pinned data';
      nodeOutputs[n.id] = { output: pin };
      finish();
      rec.meta(nodeKey, { bench: 'pinned' });
      rec.unitFinished(nodeKey, { status: 'ok', output: pin });
      continue;
    }
    const markSkipped = (
      note: string,
      reason: 'upstream' | 'else' | 'when',
      via?: string[],
    ) => {
      entry.status = 'skipped';
      entry.note = note;
      skipped.add(n.id);
      nodeOutputs[n.id] = { output: null };
      finish();
      rec.unitFinished(nodeKey, {
        status: 'skipped',
        skip: { reason, ...(via !== undefined && { via }) },
      });
    };

    try {
      if (!def) throw new ExprError(n.type, `unknown node type "${n.type}"`);

      if (focus?.kind === 'only' && focus.node === n.id) {
        // Run alone, the node runs whatever its condition says: it is
        // evaluated against the pinned data, and a false one is noted. Its
        // alternative's partner is not consulted.
        const { elseOf: _elseOf, ...alone } = n;
        const decision = await decideNode(
          alone,
          input,
          walk,
          { key: nodeKey, pointer },
          rec,
        );
        if (decision.kind === 'skip') {
          entry.whenWouldSkip = true;
          rec.meta(nodeKey, { whenWouldSkip: true });
        }
      } else {
        // The skip rules: data dependencies first, then the else-branch
        // rule, then the node's own condition.
        const decision = await decideNode(
          n,
          input,
          walk,
          { key: nodeKey, pointer },
          rec,
        );
        if (decision.kind === 'skip') {
          if (decision.reason === 'when') whenSkipped.add(n.id);
          markSkipped(decision.note, decision.reason, decision.via);
          continue;
        }
      }
      // A stand-in replaces the node's call, never the node: it applies
      // only once the skip rules let the node run.
      if (call.kind === 'mock' || call.kind === 'fail') {
        entry.bench = call.kind === 'mock' ? 'mocked' : 'failed';
        rec.meta(nodeKey, { bench: entry.bench });
      }

      const connectorCheck = def.connector
        ? connectorValidator(def.connector)
        : null;

      /** The forEach node's simulated outputs, one per item, once its list
       * is known. */
      let itemMocks: readonly Json[] | undefined;
      /** What stands in for this unit's call: the simulated output, or the
       * failure the test simulates (thrown, after the unit's input was
       * resolved); undefined for a call that runs as written. */
      const standIn = (
        extra: Record<string, unknown>,
      ): { output: unknown } | undefined => {
        if (call.kind === 'fail') throw simulatedFailure(n.id, call.message);
        if (call.kind !== 'mock') return undefined;
        if (itemMocks !== undefined) {
          return { output: cloneData(itemMocks[Number(extra.index ?? 0)]) };
        }
        return { output: cloneData(call.output) };
      };

      /** Run the node's behavior once for one scope (per item under
       * forEach). */
      /** Run the node once for one scope; a recorded run's failing
       * expression is evaluated once more with probes, so the failure says
       * which value was missing. */
      const runOnce = async (
        extra: Record<string, unknown>,
        record: boolean,
        pass: number,
        unit: UnitKey,
      ): Promise<unknown> => {
        try {
          return await runBody(extra, record, pass, unit);
        } catch (error) {
          if (rec.enabled) {
            await explainFailure(error, makeScope(input, nodeOutputs, extra));
          }
          throw error;
        }
      };

      const runBody = async (
        extra: Record<string, unknown>,
        record: boolean,
        pass: number,
        unit: UnitKey,
      ): Promise<unknown> => {
        executions++;
        if (executions > maxExecutions) {
          throw new ExprError(
            n.id,
            `run exceeded the ${maxExecutions}-execution guard — a forEach over a huge array or a runaway repeat; split the automation or raise maxNodes deliberately`,
            { reason: 'EXECUTION_LIMIT', params: { limit: maxExecutions } },
          );
        }
        const scope = () => makeScope(input, nodeOutputs, extra);
        // Where each `{{ }}` unit landed in the text a step sends: a recorded
        // run keeps it beside the text.
        const rendered: Record<string, RenderedSpan[]> = {};
        const resolve = async (
          value: unknown,
          at: string,
        ): Promise<unknown> => {
          if (!rec.enabled) return await evalTemplates(value, scope(), at);
          const answer = await evalTemplatesRendered(value, scope(), at);
          Object.assign(rendered, answer.rendered);
          return answer.value;
        };
        const noteRendered = (): void => {
          if (Object.keys(rendered).length > 0) rec.meta(unit, { rendered });
        };
        // A pass's input is also its item's or step's: the row shows what
        // its latest pass worked on.
        const noteInput = (at: UnitKey, value: unknown): void => {
          rec.unitInput(at, value);
          if (at.pass >= 0) {
            rec.unitInput(
              at.item >= 0 ? { path, item: at.item, pass: -1 } : nodeKey,
              value,
            );
          }
        };
        let out: unknown;

        if (n.type === 'transform') {
          const resolved = await evalTemplates(
            n.input ?? {},
            scope(),
            `${pointer}/input`,
          );
          if (record) entry.input = resolved;
          noteInput(unit, resolved);
          const stood = standIn(extra);
          if (stood !== undefined) return stood.output;
          out = await runCode(
            n.code ?? '',
            {
              input: resolved,
              nodes: scope().nodes,
              item: extra.item,
              index: extra.index,
            },
            opts.timeoutMs,
            `${pointer}/code`,
          );
          if (out === undefined || out === null) {
            throw new ExprError(
              '[code]',
              'transform code returned nothing — it must return a value',
              {
                reason: 'CODE_NO_RESULT',
                params: {},
                at: { pointer: `${pointer}/code` },
              },
            );
          }
        } else if (n.type === 'llm') {
          const model = n.model ?? '';
          const prompt = asPromptText(
            await resolve(n.prompt ?? '', `${pointer}/prompt`),
          );
          const system = n.system
            ? asPromptText(await resolve(n.system, `${pointer}/system`))
            : undefined;
          noteRendered();
          const llmInput = {
            model,
            prompt,
            ...(system !== undefined && { system }),
          };
          if (record) entry.input = llmInput;
          noteInput(unit, llmInput);
          rec.meta(unit, { model });
          const stood = standIn(extra);
          const service = llmService();
          if (stood !== undefined) {
            out = stood.output;
          } else if (opts.mode === 'live' && service) {
            const reply = await service({
              model,
              prompt,
              ...(system !== undefined && { system }),
              ...(n.outputSchema !== undefined && {
                outputSchema: n.outputSchema,
              }),
            });
            if (n.outputSchema !== undefined) {
              if ('data' in reply) {
                out = reply.data;
              } else {
                throw new ExprError(
                  n.id,
                  'the llm service returned plain text for a node with outputSchema — structured output was required',
                  {
                    reason: 'LLM_OUTPUT_INVALID',
                    params: { model },
                    at: { pointer: `${pointer}/outputSchema` },
                  },
                );
              }
            } else {
              out = 'text' in reply ? { text: reply.text } : reply.data;
            }
          } else {
            if (record && opts.mode === 'live' && !service) {
              entry.note = 'no llm service installed — deterministic mock used';
            }
            out =
              n.outputSchema !== undefined
                ? stubFromSchema(n.outputSchema)
                : { text: mockLlmText(model, prompt) };
          }
          effects.push({
            node: n.id,
            connector: 'llm',
            input: llmInput,
            ...effectPlace(unit),
          });
        } else if (n.type === 'agent') {
          const model = n.model ?? '';
          const prompt = asPromptText(
            await resolve(n.prompt ?? '', `${pointer}/prompt`),
          );
          const system = n.system
            ? asPromptText(await resolve(n.system, `${pointer}/system`))
            : undefined;
          noteRendered();
          const files =
            n.files === undefined
              ? undefined
              : // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- evalTemplates preserves the record shape of `files`
                ((await evalTemplates(
                  n.files,
                  scope(),
                  `${pointer}/files`,
                )) as Record<string, unknown>);
          const context =
            n.input === undefined
              ? undefined
              : await evalTemplates(n.input, scope(), `${pointer}/input`);
          const agentInput: AgentTurnRequest = {
            model,
            ...(n.modelProvider !== undefined && {
              modelProvider: n.modelProvider,
            }),
            prompt,
            ...(system !== undefined && { system }),
            ...(n.harness !== undefined && { harness: n.harness }),
            ...(n.skills !== undefined && { skills: n.skills }),
            ...(n.connectors !== undefined && { connectors: n.connectors }),
            ...(n.tools !== undefined && { tools: n.tools }),
            ...(n.secrets !== undefined && { secrets: n.secrets }),
            ...(files !== undefined && { files }),
            ...(context !== undefined && { input: context }),
          };
          if (record) entry.input = agentInput;
          noteInput(unit, agentInput);
          rec.meta(unit, { model });
          const stood = standIn(extra);
          const service = agentService();
          if (stood !== undefined) {
            out = stood.output;
          } else if (opts.mode === 'live' && service) {
            const reply = await service(agentInput);
            out = {
              text: reply.text,
              files: reply.files ?? [],
              status: reply.status ?? 'ok',
            };
          } else {
            if (record && opts.mode === 'live' && !service) {
              entry.note =
                'no agent service installed — deterministic mock used';
            }
            out = {
              text: mockAgentText(model, prompt),
              files: [],
              status: 'ok',
            };
          }
          effects.push({
            node: n.id,
            connector: 'agent',
            input: agentInput,
            ...effectPlace(unit),
          });
        } else if (n.type === 'subautomation' && call.kind !== 'call') {
          // A stand-in replaces the whole called automation: its input is
          // resolved, and nothing of it runs or is looked up.
          const ref = n.automation ?? '';
          const resolved = await evalTemplates(
            n.input ?? {},
            scope(),
            `${pointer}/input`,
          );
          if (record) entry.input = { automation: ref, input: resolved };
          noteInput(unit, { automation: ref, input: resolved });
          out = standIn(extra)?.output;
        } else if (n.type === 'subautomation') {
          const ref = n.automation ?? '';
          const store = opts.store;
          if (!store) {
            throw new ExprError(
              'subautomation',
              'no automation store was supplied for this run — the host must pass one for subautomation nodes',
            );
          }
          const automationAt = { pointer: `${pointer}/automation` };
          const [subName, subVerRaw] = ref.split('@');
          const subVer = subVerRaw
            ? Number(subVerRaw)
            : ((await store.deployedVersion(subName)) ?? undefined);
          const found = await store.get(subName, subVer);
          if (!found) {
            throw new ExprError(
              'subautomation',
              `no saved automation "${ref}" — save_automation it first`,
              {
                reason: 'SUBAUTOMATION_NOT_FOUND',
                params: { automation: ref },
                at: automationAt,
              },
            );
          }
          const depth = opts.nesting ?? 0;
          if (depth >= MAX_SUBAUTOMATION_DEPTH) {
            throw new ExprError(
              'subautomation',
              `subautomations nest at most ${MAX_SUBAUTOMATION_DEPTH} levels deep`,
              {
                reason: 'SUBAUTOMATION_TOO_DEEP',
                params: { max: MAX_SUBAUTOMATION_DEPTH },
                at: { pointer },
              },
            );
          }
          const resolved = await evalTemplates(
            n.input ?? {},
            scope(),
            `${pointer}/input`,
          );
          if (record) entry.input = { automation: ref, input: resolved };
          noteInput(unit, { automation: ref, input: resolved });
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store contents were validated at save time
          const sub = await execute(found.automation as Automation, {
            ...opts,
            input: resolved,
            nesting: depth + 1,
            within: {
              runId,
              pathPrefix: subautomationPathPrefix(
                `${pathPrefix}${n.id}`,
                Number(extra.index ?? 0),
                pass,
              ),
              docRef: `${subName}@${found.meta.version}`,
            },
          });
          // A stop inside the called automation stops this run too; it is no
          // failure of this step.
          if (sub.stoppedBy !== undefined) throw new RunStopped(sub.stoppedBy);
          if (sub.status !== 'success') {
            throw new ExprError(
              'subautomation',
              `subautomation "${ref}" ${sub.status}: ${sub.error?.message ?? 'see its validation errors'}`,
              {
                reason: 'SUBAUTOMATION_FAILED',
                params: {
                  automation: subName,
                  version: found.meta.version,
                  childPath: sub.error?.nodeId ?? '',
                },
                at: automationAt,
              },
            );
          }
          for (const ef of sub.effects) {
            effects.push({
              node: `${n.id}/${ef.node}`,
              connector: ef.connector,
              input: ef.input,
              ...nestedEffectPlace(ef),
            });
          }
          out = sub.output;
        } else if (def.connector && connectorCheck) {
          const resolved = await resolve(n.input ?? {}, `${pointer}/input`);
          noteRendered();
          if (record) entry.input = resolved;
          noteInput(unit, resolved);
          rec.meta(unit, {
            connector: def.connector.name,
            action: n.type,
            effect: def.connector.hasEffect ? 'write' : 'read',
          });
          if (!connectorCheck(resolved)) {
            const errors = connectorCheck.errors ?? [];
            const msg = errors
              .map((e) => `input${e.instancePath} ${e.message}`)
              .join('; ');
            const first = errors[0];
            // The sentence names the action and what is wrong, never the
            // input itself: the step's record shows that, with its secrets
            // withheld, where this text would have carried them whole.
            throw new ExprError(
              n.type,
              `resolved input does not match the ${n.type} schema: ${msg}`,
              {
                reason: 'CONNECTOR_INPUT_REFUSED',
                params: {
                  connector: def.connector.name,
                  action: n.type,
                  ...(first !== undefined && {
                    keyword: first.keyword,
                    property: first.instancePath,
                  }),
                  detail: msg,
                },
                at: {
                  pointer: `${pointer}/input${first?.instancePath ?? ''}`,
                },
              },
            );
          }
          const stood = standIn(extra);
          const host = opts.connectorHost?.(def.connector.name);
          if (stood !== undefined) {
            out = stood.output;
          } else if (opts.mode === 'live' && def.connector.live && host) {
            const secretMap = opts.secrets?.[def.connector.name] ?? {};
            try {
              out = await def.connector.live(resolved, {
                secrets: {
                  get: (name: string) => secretMap[name] ?? '',
                },
                idempotencyKey: connectorIdempotencyKey(
                  runId,
                  `${pathPrefix}${n.id}`,
                  Number(extra.index ?? 0),
                  pass,
                ),
                endpoint: host.endpoint,
                config: host.config,
                http: host.http,
                files: host.files,
                base64Encode: host.base64Encode,
                base64Decode: host.base64Decode,
              });
            } catch (e) {
              throw new ExprError(
                n.type,
                `live call failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`,
                {
                  ...connectorFailureOf(e, def.connector.name, n.type),
                  at: { pointer },
                },
              );
            }
          } else {
            if (opts.mode === 'live' && record) {
              entry.note = def.connector.live
                ? 'no connector host supplied — deterministic mock used'
                : 'live backend not implemented — deterministic mock used';
            }
            out = await def.connector.mock(resolved);
          }
          if (def.connector.hasEffect) {
            effects.push({
              node: n.id,
              connector: n.type,
              input: resolved,
              ...effectPlace(unit),
            });
          }
        } else {
          throw new ExprError(
            n.type,
            `node type "${n.type}" is not executable`,
          );
        }
        return out;
      };

      /** Apply repeatUntil around a single runOnce invocation. */
      const runWithRepeat = async (
        extra: Record<string, unknown>,
        record: boolean,
        unit: UnitKey,
      ): Promise<unknown> => {
        const repeatUntil = n.repeatUntil;
        if (typeof repeatUntil !== 'string') {
          return runOnce(extra, record, 0, unit);
        }
        const max = maxRepeatsOf(n);
        let out: unknown;
        let iters = 0;
        let done = false;
        for (; iters < max; iters++) {
          const passStop = iters === 0 ? undefined : stopCause();
          if (passStop !== undefined) throw new RunStopped(passStop);
          const passKey: UnitKey = { path, item: unit.item, pass: iters };
          rec.unitStarted(passKey, { nodeId: n.id, nodeType: n.type });
          openUnits.push(passKey);
          out = await runOnce(extra, record && iters === 0, iters, passKey);
          // The in-flight result is visible BOTH as `output` and as this
          // node's own nodes.<id>.output — authors naturally write either.
          const settled = await repeatSettled(
            n,
            repeatUntil,
            input,
            walk,
            { key: passKey, pointer, index: iters, max, extra, output: out },
            rec,
          );
          openUnits.pop();
          rec.unitFinished(passKey, { status: 'ok', output: out });
          if (settled) {
            done = true;
            iters++;
            break;
          }
        }
        if (record) {
          entry.note = `repeatUntil ran ${iters}x${done ? '' : ' (maxRepeats hit before the condition became true)'}`;
        }
        return out;
      };

      let output: unknown;
      if (typeof n.forEach === 'string') {
        const arr = await resolveForEach(
          n.forEach,
          input,
          walk,
          { key: nodeKey, pointer },
          rec,
        );
        entry.input = { forEach: `${arr.length} item(s)` };
        if (call.kind === 'mock' && plan !== undefined) {
          // A forEach stand-in is a list: item i returns entry i.
          const fits = plan.itemOutputs(n.id, arr.length);
          if (!fits.ok) throw new ExprError(n.id, fits.message);
          itemMocks = fits.outputs;
        }
        // Run alone with one item picked, the node runs that item only, and
        // its output is that item's.
        const picked =
          focus?.kind === 'only' && focus.node === n.id
            ? focus.item
            : undefined;
        if (picked !== undefined && picked >= arr.length) {
          // Only now is the list known: the bench is refused as it would
          // have been before the run, with nothing of the run kept.
          return refusedRun(
            refusalIssue(
              itemOutOfRange(n.id, picked, arr.length),
              ptr('bench', 'item'),
            ),
          );
        }
        const outs: unknown[] = [];
        for (const [index, item] of arr.entries()) {
          if (picked !== undefined && index !== picked) continue;
          const itemStop = outs.length === 0 ? undefined : stopCause();
          if (itemStop !== undefined) throw new RunStopped(itemStop);
          const itemKey: UnitKey = { path, item: index, pass: -1 };
          rec.unitStarted(itemKey, { nodeId: n.id, nodeType: n.type });
          openUnits.push(itemKey);
          const out = await runWithRepeat({ item, index }, false, itemKey);
          openUnits.pop();
          rec.unitFinished(itemKey, { status: 'ok', output: out });
          outs.push(out);
        }
        output = picked !== undefined ? outs[0] : outs;
      } else {
        output = await runWithRepeat({}, true, nodeKey);
      }

      entry.output = output;
      nodeOutputs[n.id] = { output };
      finish();
      rec.unitFinished(nodeKey, { status: 'ok', output });
    } catch (e) {
      if (e instanceof RunStopped) {
        finish();
        return stopped(e.by, ordered.slice(position + 1), entry);
      }
      const message = e instanceof Error ? e.message : String(e);
      entry.status = 'error';
      entry.error = message;
      finish();
      const hint = /is not defined/.test(message)
        ? 'in templates and code, only `input` and `nodes.<id>.output` are available'
        : /Cannot read propert/.test(message)
          ? 'a referenced value is null/undefined — check the exact output shape in the trace of the upstream node'
          : undefined;
      const failure = classifyStepFailure(e, {
        code: reasonFamily(failureCauseOf(e)?.reason ?? 'UNKNOWN'),
        message,
        ...(hint !== undefined && { hint }),
        pointer,
      });
      // The item or pass it was on failed with it.
      for (const unit of openUnits.slice(1).toReversed()) {
        rec.unitFinished(unit, { status: 'failed', failure });
      }
      if (n.onError === 'continue') {
        entry.note = 'onError: continue — dependents are skipped';
        skipped.add(n.id);
        nodeOutputs[n.id] = { output: null };
        rec.decision(nodeKey, { kind: 'onError', policy: 'continue' });
        rec.unitFinished(nodeKey, {
          status: 'skipped',
          skip: { reason: 'error' },
          failure,
        });
        continue;
      }
      rec.unitFinished(nodeKey, { status: 'failed', failure });
      for (const rest of ordered.slice(position + 1)) {
        trace.push({ node: rest.id, type: rest.type, status: 'not_run' });
      }
      return fail({ nodeId: n.id, message, ...(hint && { hint }), failure });
    }
  }

  if (focus !== undefined) {
    // A step test's run answers its node's output; the document output is
    // not evaluated, so it has no record either.
    return withRecord({
      status: 'success',
      output: nodeOutputs[focus.node]?.output ?? null,
      trace,
      effects,
    });
  }

  const endKey: UnitKey = { path: END_PATH, item: -1, pass: -1 };
  if (outermost) {
    rec.unitStarted(endKey, { nodeId: END_PATH, nodeType: 'output' });
  }
  try {
    const output =
      doc.output !== undefined
        ? await evalTemplates(
            cloneData(doc.output),
            makeScope(input, nodeOutputs),
            '/output',
          )
        : null;
    if (outermost) rec.unitFinished(endKey, { status: 'ok', output });
    return withRecord({ status: 'success', output, trace, effects });
  } catch (e) {
    const message = `failed to evaluate automation "output": ${e instanceof Error ? e.message : String(e)}`;
    if (outermost && rec.enabled) {
      await explainFailure(e, makeScope(input, nodeOutputs));
    }
    const failure = classifyStepFailure(e, {
      code: 'node_error',
      message,
      pointer: '/output',
    });
    if (outermost) rec.unitFinished(endKey, { status: 'failed', failure });
    return fail({ message, failure });
  }
}
