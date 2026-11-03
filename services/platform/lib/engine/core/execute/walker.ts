/**
 * The walk of an automation's steps: their order, which of them run (the
 * skip rules of `./decide`), a `forEach` step's items, a `repeatUntil`
 * step's passes, and each step's body. What a body calls outside the walk —
 * a transform's code, a model, a connector action, an agent turn, a called
 * automation's document — and the time the walk reads come from its host
 * through the ports of `../walk/ports`. `execute()` (`./index`) is its first
 * host.
 *
 * The walker lives here, beside `./decide`, and not in `../walk/`: the skip
 * rules, a `forEach` step's list and a `repeatUntil` step's settle evaluate
 * templates, and `../walk/` loads no parser (`selftest/purity.test.ts`).
 */

import type { ValidateFunction } from 'ajv';

import { connectorIdempotencyKey, subautomationPathPrefix } from '../protocol';
import {
  classifyStepFailure,
  connectorFailureOf,
  reasonFamily,
  failureCauseOf,
} from '../record/failure';
import type { RunRecorder } from '../record/recorder';
import type { StepFailure, UnitKey } from '../record/types';
import { type AgentTurnRequest, type ConnectorLike, nodeTypes } from '../slots';
import { ptr } from '../syntax/pointer';
import {
  evalTemplates,
  evalTemplatesRendered,
  explainFailure,
  ExprError,
  type RenderedSpan,
} from '../template';
import {
  type Automation,
  type Effect,
  effectPlace,
  type Issue,
  type Json,
  nestedEffectPlace,
  type NodeTrace,
  type RunResult,
} from '../types';
import { compileSchema } from '../validate/schema';
import { MAX_SUBAUTOMATION_DEPTH, maxRepeatsOf } from '../walk/limits';
import type { WalkPorts } from '../walk/ports';
import type { SkipReason } from '../walk/progress';
import {
  type BenchPlan,
  CALL_AS_WRITTEN,
  itemOutOfRange,
  refusalIssue,
  scenarioMatches,
} from './bench';
import { topoSort } from './controlflow';
import { decideNode, repeatSettled, resolveForEach } from './decide';
import {
  failsTheRun,
  isolatesItemFailures,
  itemFailureNote,
} from './item-errors';
import {
  asPromptText,
  cloneData,
  makeScope,
  mockAgentText,
  mockLlmText,
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

/** The connector a connector node calls, by its slug (`slack` for
 * `slack.list_channels`): what the durable runtime names in a step's record
 * and its failure, and what the run view looks up in the catalog. */
function connectorSlugOf(type: string, connector: ConnectorLike): string {
  if (connector.display !== undefined) return connector.display.connector;
  const dot = type.indexOf('.');
  return dot > 0 ? type.slice(0, dot) : type;
}

/** A run stopped between steps, items or passes: by its time limit or by
 * its caller. Not a failure of the step it was in, so `onError` never
 * catches it. */
class RunStopped extends Error {
  constructor(readonly by: 'time_limit' | 'cancelled') {
    super(by === 'cancelled' ? 'stopped' : 'stopped at the time limit');
  }
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

type RunError = NonNullable<RunResult['error']>;

/** A called automation's own run, as the walk asks its host for it. */
export interface CalledRun {
  input: unknown;
  nesting: number;
  within: { runId: string; pathPrefix: string; docRef: string };
}

/** One walk of a document's steps. */
export interface Walk {
  doc: Automation;
  /** The run's input, checked against its contract by the host. */
  input: unknown;
  mode: 'mock' | 'live' | undefined;
  ports: WalkPorts;
  rec: RunRecorder;
  /** The run's trace and effects: the walk appends its steps' rows. */
  trace: NodeTrace[];
  effects: Effect[];
  runId: string;
  /** Where the steps' paths start: empty for a run's own steps. */
  pathPrefix: string;
  /** The document the steps come from (`name@version`), inside a called
   * automation. */
  docRef: string | undefined;
  /** How deep in called automations the walk is. */
  nesting: number;
  /** The execution guard: step executions, items and passes included. */
  maxExecutions: number;
  /** When the run started, by `ports.clock.now()`. */
  startedAt: number;
  /** Epoch ms: past it the walk stops at its next step, item or pass. */
  deadline: number | undefined;
  /** Once aborted, the walk stops at its next step, item or pass. */
  signal: AbortSignal | undefined;
  /** A step test's narrower scope and its stand-ins (`./bench`). */
  plan: BenchPlan | undefined;
  /** The steps whose stand-in or pinned data the walk used. */
  used: Set<string>;
  /** Run a called automation as its own run: its host checks its input,
   * walks it and evaluates its output. */
  runCalled(automation: Automation, run: CalledRun): Promise<RunResult>;
}

export type WalkOutcome =
  /** Every step was walked: what each produced. */
  | { kind: 'walked'; outputs: Record<string, { output: unknown }> }
  /** A step failed, or the document has no order; the rest did not run. */
  | { kind: 'failed'; error: RunError }
  /** The run stopped between steps, items or passes. */
  | { kind: 'stopped'; by: 'time_limit' | 'cancelled'; error: RunError }
  /** A step test that picked an item the list does not have. */
  | { kind: 'refused'; issue: Issue };

/** Walk `walk.doc`'s steps in their order, appending to the run's trace,
 * effects and record. */
export async function walkSteps(walk: Walk): Promise<WalkOutcome> {
  const { doc, input, ports, rec, trace, effects, plan, used } = walk;
  const { clock } = ports;

  /** A step the run does not get to. One a step test leaves out says so,
   * whether the run ended before it or not: it would not have run anyway. */
  const notRun = (node: { id: string; type: string }): NodeTrace =>
    plan?.call(node.id).kind === 'left-out'
      ? {
          node: node.id,
          type: node.type,
          status: 'not_run',
          bench: 'left-out',
          note: 'left out of this test',
        }
      : { node: node.id, type: node.type, status: 'not_run' };

  /** Whether the run must stop before its next step, item or pass. */
  const stopCause = (): 'time_limit' | 'cancelled' | undefined => {
    if (walk.signal?.aborted === true) return 'cancelled';
    if (walk.deadline !== undefined && clock.now() >= walk.deadline) {
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
  ): WalkOutcome => {
    const message =
      by === 'cancelled'
        ? 'stopped'
        : `stopped after ${Math.round((clock.now() - walk.startedAt) / 1000)} s — this run has a time limit`;
    if (inside !== undefined) {
      inside.status = 'error';
      inside.error = message;
    }
    for (const node of rest) trace.push(notRun(node));
    return {
      kind: 'stopped',
      by,
      error: {
        ...(inside !== undefined && { nodeId: inside.node }),
        message,
      },
    };
  };

  const ordered = topoSort(doc.nodes);
  if (!ordered) {
    return {
      kind: 'failed',
      error: {
        message: 'circular reference between nodes (see validate_automation)',
      },
    };
  }

  const nodeOutputs: Record<string, { output: unknown }> = {};
  const skipped = new Set<string>();
  const whenSkipped = new Set<string>();
  const { runId, pathPrefix, maxExecutions } = walk;
  let executions = 0;
  const rankOf = new Map(ordered.map((node, index) => [node.id, index]));
  const state = {
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
      // record — the record reads it as not run, its trace says why.
      trace.push(notRun(n));
      continue;
    }
    const def = nodeTypes().get(n.type);
    const t0 = clock.monotonic();
    const entry: NodeTrace = { node: n.id, type: n.type, status: 'ok' };
    trace.push(entry);
    const path = `${pathPrefix}${n.id}`;
    const pointer = `/nodes/${doc.nodes.indexOf(n)}`;
    const nodeKey: UnitKey = { path, item: -1, pass: -1 };
    // The units of this step still open, outermost first: a failure ends
    // each of them.
    const openUnits: UnitKey[] = [nodeKey];
    rec.unitStarted(nodeKey, { nodeId: n.id, nodeType: n.type });
    if (walk.docRef !== undefined) {
      rec.meta(nodeKey, { docRef: walk.docRef });
    }
    const finish = () => {
      entry.ms = Math.round((clock.monotonic() - t0) * 10) / 10;
    };
    /** A failure of this step, or of one of its items, in the words the
     * trace and the record use. */
    const describeFailure = (
      e: unknown,
    ): { message: string; hint?: string; failure: StepFailure } => {
      const message = e instanceof Error ? e.message : String(e);
      const hint = /is not defined/.test(message)
        ? 'in templates and code, only `input` and `nodes.<id>.output` are available'
        : /Cannot read propert/.test(message)
          ? 'a referenced value is null/undefined — check the exact output shape in the trace of the upstream node'
          : undefined;
      const cause = failureCauseOf(e);
      const failure = classifyStepFailure(e, {
        code: reasonFamily(cause?.reason ?? 'UNKNOWN', cause?.params),
        message,
        ...(hint !== undefined && { hint }),
        pointer,
      });
      return { message, ...(hint !== undefined && { hint }), failure };
    };
    if (call.kind === 'pinned') {
      // Data a step test hands the node it runs alone: its output, with
      // nothing of it evaluated.
      const pin = cloneData(call.output);
      entry.output = pin;
      entry.bench = 'pinned';
      entry.note = 'pinned data';
      used.add(n.id);
      nodeOutputs[n.id] = { output: pin };
      finish();
      rec.meta(nodeKey, { bench: 'pinned' });
      rec.unitFinished(nodeKey, { status: 'ok', output: pin });
      continue;
    }
    const markSkipped = (
      note: string,
      reason: Exclude<SkipReason, 'error'>,
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
          state,
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
          state,
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
      // only once the skip rules let the node run, and it is marked where
      // it takes a call's place — a node that runs per item over no items
      // makes no call, and its stand-in goes unused. A list of scenarios
      // can fail a later call where an earlier one answered: once one of
      // the node's calls failed, it is marked failed.
      const markStandIn = (
        mark: 'mocked' | 'failed' = call.kind === 'mock' ? 'mocked' : 'failed',
      ): void => {
        if (
          used.has(n.id) &&
          !(mark === 'failed' && entry.bench === 'mocked')
        ) {
          return;
        }
        used.add(n.id);
        entry.bench = mark;
        rec.meta(nodeKey, { bench: entry.bench });
      };
      /** How many calls of the node took one of the scenarios the test
       * picks for it: its next call can take the one after them, or the
       * last once the list is used up. */
      let scenariosTaken = 0;

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
        if (call.kind === 'fail') {
          markStandIn();
          throw simulatedFailure(n.id, call.message);
        }
        if (call.kind !== 'mock') return undefined;
        markStandIn();
        if (itemMocks !== undefined) {
          return { output: cloneData(itemMocks[Number(extra.index ?? 0)]) };
        }
        return { output: cloneData(call.output) };
      };

      /** Run the node once for one scope (per item under forEach); a
       * recorded run's failing expression is evaluated once more with
       * probes, so the failure says which value was missing. */
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
          out = await ports.calls.transform(
            n.code ?? '',
            {
              input: resolved,
              nodes: scope().nodes,
              item: extra.item,
              index: extra.index,
            },
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
          const service = ports.calls.llm();
          if (stood !== undefined) {
            out = stood.output;
          } else if (walk.mode === 'live' && service) {
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
            if (record && walk.mode === 'live' && !service) {
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
          const service = ports.agent.service();
          if (stood !== undefined) {
            out = stood.output;
          } else if (walk.mode === 'live' && service) {
            const reply = await service(agentInput);
            out = {
              text: reply.text,
              files: reply.files ?? [],
              status: reply.status ?? 'ok',
            };
          } else {
            if (record && walk.mode === 'live' && !service) {
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
          const loader = ports.loader;
          if (!loader) {
            throw new ExprError(
              'subautomation',
              'no automation store was supplied for this run — the host must pass one for subautomation nodes',
            );
          }
          const automationAt = { pointer: `${pointer}/automation` };
          const [subName, subVerRaw] = ref.split('@');
          const found = await loader.load(
            subName,
            subVerRaw ? Number(subVerRaw) : undefined,
          );
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
          const depth = walk.nesting;
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
          const sub = await walk.runCalled(found.automation as Automation, {
            input: resolved,
            nesting: depth + 1,
            within: {
              runId,
              pathPrefix: subautomationPathPrefix(
                `${pathPrefix}${n.id}`,
                Number(extra.index ?? 0),
                pass,
              ),
              docRef: `${subName}@${found.version}`,
            },
          });
          // What the called automation did happened, whether it finished,
          // failed or was stopped: its effects are this step's, under its
          // path — as the durable runtime folds them before it reads the
          // sub-run's outcome.
          for (const ef of sub.effects) {
            effects.push({
              node: `${n.id}/${ef.node}`,
              connector: ef.connector,
              input: ef.input,
              ...nestedEffectPlace(ef),
            });
          }
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
                  version: found.version,
                  childPath: sub.error?.nodeId ?? '',
                },
                at: automationAt,
              },
            );
          }
          out = sub.output;
        } else if (def.connector && connectorCheck) {
          const resolved = await resolve(n.input ?? {}, `${pointer}/input`);
          noteRendered();
          if (record) entry.input = resolved;
          noteInput(unit, resolved);
          const slug = connectorSlugOf(n.type, def.connector);
          rec.meta(unit, {
            connector: slug,
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
                  connector: slug,
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
          const live = ports.calls.connector(def.connector);
          const scenario =
            call.kind === 'scenario'
              ? call.scenarios[
                  Math.min(scenariosTaken, call.scenarios.length - 1)
                ]
              : undefined;
          if (stood !== undefined) {
            out = stood.output;
          } else if (walk.mode === 'live' && live) {
            try {
              out = await live(
                resolved,
                connectorIdempotencyKey(
                  runId,
                  `${pathPrefix}${n.id}`,
                  Number(extra.index ?? 0),
                  pass,
                ),
              );
            } catch (e) {
              // A failure names the connector by its slug, as the durable
              // runtime does; a test's own node type has none.
              throw new ExprError(
                n.type,
                `live call failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`,
                {
                  ...connectorFailureOf(e, slug, n.type),
                  at: { pointer },
                },
              );
            }
          } else if (
            scenario !== undefined &&
            scenarioMatches(scenario, resolved)
          ) {
            // The scenario the test picked answers in the mock's place, and
            // the node's next call can take the one after it: its output as
            // the call's, or its error, classified as the live call's
            // failure above is (by the status it names), so a test proves
            // what the run does with that failure.
            scenariosTaken += 1;
            if (scenario.error !== undefined) {
              markStandIn('failed');
              const { message, status } = scenario.error;
              const raised = Object.assign(
                new Error(message),
                status !== undefined ? { status } : {},
              );
              throw new ExprError(
                n.type,
                `${message} (the "${scenario.name}" scenario of ${n.type}, simulated by the test)`,
                {
                  ...connectorFailureOf(
                    raised,
                    def.connector.display?.connector ?? def.connector.name,
                    n.type,
                  ),
                  at: { pointer },
                },
              );
            }
            markStandIn('mocked');
            out = cloneData(scenario.output);
          } else {
            if (walk.mode === 'live' && record) {
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
            state,
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
          state,
          { key: nodeKey, pointer },
          rec,
        );
        entry.input = { forEach: `${arr.length} item(s)` };
        // Run alone with one item picked, the node runs that item only, and
        // its output is that item's.
        const picked =
          focus?.kind === 'only' && focus.node === n.id
            ? focus.item
            : undefined;
        if (picked !== undefined && picked >= arr.length) {
          // Only now is the list known: the bench is refused as it would
          // have been before the run, with nothing of the run kept.
          return {
            kind: 'refused',
            issue: refusalIssue(
              itemOutOfRange(n.id, picked, arr.length),
              ptr('bench', 'item'),
            ),
          };
        }
        if (call.kind === 'mock' && plan !== undefined) {
          // A forEach stand-in is a list: item i returns entry i — of the
          // items that run.
          const fits = plan.itemOutputs(n.id, arr.length, picked);
          if (!fits.ok) {
            // The stand-in is what the node fails on.
            markStandIn();
            throw new ExprError(n.id, fits.message);
          }
          itemMocks = fits.outputs;
        }
        // A step test that picked one item runs that item as written.
        const isolates = picked === undefined && isolatesItemFailures(n);
        const failedItems: number[] = [];
        let lastItemFailure: unknown;
        const outs: unknown[] = [];
        for (const [index, item] of arr.entries()) {
          if (picked !== undefined && index !== picked) continue;
          const itemStop = outs.length === 0 ? undefined : stopCause();
          if (itemStop !== undefined) throw new RunStopped(itemStop);
          const itemKey: UnitKey = { path, item: index, pass: -1 };
          rec.unitStarted(itemKey, { nodeId: n.id, nodeType: n.type });
          const itemDepth = openUnits.length;
          openUnits.push(itemKey);
          let out: unknown;
          try {
            out = await runWithRepeat({ item, index }, false, itemKey);
          } catch (error) {
            if (
              !isolates ||
              error instanceof RunStopped ||
              failsTheRun(error)
            ) {
              throw error;
            }
            // The item and the pass it was on failed; the next item runs.
            const { failure } = describeFailure(error);
            const open = openUnits.splice(itemDepth);
            for (const unit of open.slice(1).toReversed()) {
              rec.unitFinished(unit, { status: 'failed', failure });
            }
            rec.decision(itemKey, { kind: 'onError', policy: 'continue' });
            rec.unitFinished(itemKey, { status: 'failed', failure });
            failedItems.push(index);
            lastItemFailure = error;
            outs.push(null);
            continue;
          }
          openUnits.pop();
          rec.unitFinished(itemKey, { status: 'ok', output: out });
          outs.push(out);
        }
        // Every item failed: the step failed, and its onError decides.
        if (failedItems.length > 0 && failedItems.length === arr.length) {
          throw lastItemFailure;
        }
        if (failedItems.length > 0) {
          entry.note = itemFailureNote(failedItems, arr.length);
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
      const { message, hint, failure } = describeFailure(e);
      entry.status = 'error';
      entry.error = message;
      finish();
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
        trace.push(notRun(rest));
      }
      return {
        kind: 'failed',
        error: { nodeId: n.id, message, ...(hint && { hint }), failure },
      };
    }
  }

  return { kind: 'walked', outputs: nodeOutputs };
}
