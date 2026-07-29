'use node';

/**
 * The durable executor.
 *
 * `lib/engine/core/execute` runs an automation in one call: it is synchronous from
 * the caller's point of view, holds every node's output in memory, and is what
 * the authoring loop and the acceptance tests want. A DEPLOYED run cannot work
 * that way. It outlives the time window of a single action, it performs real
 * side effects, and it waits — on a poll that is not finished, on a human who
 * has not decided yet. So a deployed run is stepped instead: one node at a
 * time, each completed node written into `automationRuns.checkpoints` before the
 * next one starts.
 *
 * That single rule is what makes re-entry safe. On resume the stepper rebuilds
 * the scope from the checkpoints and continues at the first node that has no
 * entry — a node that already completed is never reached again, so its side
 * effect cannot repeat. The window that remains is a crash BETWEEN performing a
 * node's effect and writing its checkpoint; there the node is retried, and the
 * retry carries the same `<runId>:<node>:<index>` idempotency key the executor
 * derives, because the run id is the durable run's own id rather than a value
 * minted per invocation. The vendor therefore sees the retry as the same
 * attempt.
 *
 * The node behaviours are NOT reimplemented here. Templates, conditions and
 * transform bodies go through the engine's own evaluator; every integration
 * call goes through `integrations/execute_action`, the platform's single door
 * to a connector (catalog, schema validation, credentials, host allowlist,
 * audit). What this module owns is the part the in-memory executor has no
 * concept of: order, persistence, suspension, hand-off and cancellation.
 *
 * Continuation is `ctx.scheduler` — deliberately not an automation component. A
 * run's state lives in one row that operators can read, and the resume protocol
 * is the checkpoint format documented in `checkpoints.ts`.
 */

import { v } from 'convex/values';

import { refsOf, topoSort } from '../../lib/engine/core/execute/controlflow';
import {
  cloneData,
  makeScope,
  mockAgentText,
  mockLlmText,
  stubFromSchema,
} from '../../lib/engine/core/execute/scope';
import { hasCodeRunner, setCodeRunner } from '../../lib/engine/core/runner';
import {
  evalCondition,
  evalTemplates,
  runCode,
} from '../../lib/engine/core/template';
import type {
  Effect,
  NodeDef,
  NodeTrace,
  Automation,
} from '../../lib/engine/core/types';
import { nodeVmRunner } from '../../lib/engine/runners/node-vm';
import { findIntegrationConnector } from '../../lib/integrations/catalog';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import {
  automationAgentHost,
  type AutomationAgentHost,
  type WorkflowAgentRequest,
} from './agent_host';
import type {
  AgentCursor,
  NodeCheckpoint,
  NodeCursor,
  RunCheckpoints,
} from './checkpoints';
import {
  effectsFrom,
  outputsFrom,
  readCheckpoints,
  skippedFrom,
  traceFrom,
  whenSkippedFrom,
} from './checkpoints';
import { automationLlmCall, type AutomationLlmCall } from './llm_call';

/**
 * How long one invocation works before handing the run back to the scheduler.
 * Convex bounds an action well above this; stepping out early means a long node
 * started near the end of a turn still has room to finish inside the platform's
 * ceiling instead of being killed mid-effect.
 *
 * Read per turn, and overridable with `TALE_AUTOMATION_STEP_BUDGET_MS`, so a
 * deployment with a tighter action ceiling can shorten it — and so the
 * hand-off path is exercisable at a budget of zero, which steps exactly one
 * node per invocation.
 */
const DEFAULT_STEP_BUDGET_MS = 60_000;

function stepBudgetMs(): number {
  const configured = Number(process.env.TALE_AUTOMATION_STEP_BUDGET_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_STEP_BUDGET_MS;
}

/** Pause between `repeatUntil` passes. Long enough that a poll-style loop costs
 * nothing while it waits, short enough to feel immediate. */
const REPEAT_DELAY_MS = 5_000;

/** How often a run parked on a human decision re-checks it. */
const APPROVAL_POLL_MS = 30_000;

/** Poll backstop for a parked agent turn — the settle pokes the run the
 * moment it lands, so this only catches a lost poke. */
const AGENT_POLL_MS = 30_000;

// These mirror the in-memory executor's guards (`core/execute/index.ts`). They
// are duplicated rather than imported because the executor keeps them private;
// changing one means changing both, and the stepper tests pin the behaviour.
const MAX_SUBAUTOMATION_DEPTH = 3;
const DEFAULT_MAX_REPEATS = 5;
const REPEATS_HARD_CAP = 20;
const DEFAULT_MAX_NODE_EXECUTIONS = 100;

/** The four node types the engine implements itself; everything else is a
 * connector action addressed as `<connector>.<action>`. */
const CORE_TYPES = new Set(['transform', 'llm', 'agent', 'subautomation']);

// -------------------------------------------------------------- approvals

/**
 * The human gate a live effectful node passes through before it touches the
 * outside world.
 *
 * A seam rather than an inline call so the approvals domain stays out of this
 * module's imports and so a test can drive suspension and resume without it.
 * `stepRun` installs the real gate for the run it is stepping (see
 * {@link automationApprovalGate}); with no gate installed a live node runs
 * ungated, which is why `startRun` requires the developer capability for a live
 * run.
 */
export interface AutomationApprovalGate {
  check(request: {
    organizationId: string;
    automation: string;
    runId: string;
    nodeId: string;
    nodeType: string;
  }): Promise<
    { status: 'allowed' } | { status: 'required'; approvalId?: string }
  >;
}

let approvalGate: AutomationApprovalGate | null = null;

/** Install the gate. `stepRun` installs the real one per turn; passing `null`
 * takes it back out (what a test does when it is finished with it). */
export function setAutomationApprovalGate(
  gate: AutomationApprovalGate | null,
): void {
  approvalGate = gate;
}

/**
 * How a run gets its llm door. A seam like the approval gate's, but held as a
 * factory: the real door reaches the network, which the stepper suite forbids,
 * so a test substitutes a recording factory. `stepRun` builds each turn's
 * instance from whichever factory is installed and carries it on the run
 * context, so the closure is always over that turn's ctx and organization.
 */
export type AutomationLlmCallFactory = (
  ctx: ActionCtx,
  organizationId: string,
) => AutomationLlmCall;

let llmCallFactory: AutomationLlmCallFactory | null = null;

/** Install a substitute llm door factory; `null` restores the real one. */
export function setAutomationLlmCallFactory(
  factory: AutomationLlmCallFactory | null,
): void {
  llmCallFactory = factory;
}

/** How a run gets its agent door — the llm seam's sibling: the real host
 * reaches the sandbox, which the stepper suite forbids, so a test installs a
 * recording factory. */
export type AutomationAgentHostFactory = (
  ctx: ActionCtx,
  organizationId: string,
) => AutomationAgentHost;

let agentHostFactory: AutomationAgentHostFactory | null = null;

/** Install a substitute agent host factory; `null` restores the real one. */
export function setAutomationAgentHostFactory(
  factory: AutomationAgentHostFactory | null,
): void {
  agentHostFactory = factory;
}

/** A connector node's declared effect, read from the shipped catalog. `read`
 * changes nothing so it is never gated; an unresolvable type cannot perform a
 * real effect (the dispatcher refuses an unknown connector) so it is not gated
 * here either — only a declared `write` waits on a human. */
function nodeEffect(nodeType: string): 'read' | 'write' | 'unknown' {
  const separator = nodeType.indexOf('.');
  if (separator <= 0 || separator === nodeType.length - 1) return 'unknown';
  const connector = findIntegrationConnector(nodeType.slice(0, separator));
  const action = connector?.actions.find(
    (candidate) => candidate.name === nodeType.slice(separator + 1),
  );
  return action ? action.effects : 'unknown';
}

/**
 * Whether the node's write stays inside the tenant's own platform surface —
 * true for a connector declaring `auth: platform` (tasks, documents, the
 * organization's sandbox), which by schema never also holds vendor
 * credentials. The approvals policy uses it to tell an internal write from one
 * leaving the tenant; an unresolvable connector reads as outbound, the strict
 * side.
 */
function nodeIsPlatformInternal(nodeType: string): boolean {
  const separator = nodeType.indexOf('.');
  if (separator <= 0) return false;
  const connector = findIntegrationConnector(nodeType.slice(0, separator));
  return (
    connector?.auth.some((method) => method.method === 'platform') === true
  );
}

/**
 * The real gate for one run: a live effectful node is decided by the approvals
 * domain, which records a pending approval keyed to this run and node and
 * reports its state on every re-entry. Built per turn so it acts only for the
 * organization whose run is being stepped; the request's organization is
 * checked against that as belt-and-braces, and a rejected approval fails the
 * node rather than looping.
 */
function automationApprovalGate(
  ctx: ActionCtx,
  organizationId: string,
): AutomationApprovalGate {
  return {
    check: async (request) => {
      if (request.organizationId !== organizationId) {
        throw new Error(
          'approval gate was asked to decide for a different organization than the run it was assembled for',
        );
      }
      if (nodeEffect(request.nodeType) !== 'write') {
        return { status: 'allowed' };
      }
      const separator = request.nodeType.indexOf('.');
      const decision = await ctx.runMutation(
        internal.approvals.gate.evaluateApprovalGate,
        {
          organizationId,
          source: 'automation',
          resourceKey: `${request.runId}:${request.nodeId}`,
          connector: request.nodeType.slice(0, separator),
          action: request.nodeType.slice(separator + 1),
          effect: 'write',
          platformInternal: nodeIsPlatformInternal(request.nodeType),
          runId: request.runId,
          nodeId: request.nodeId,
          nodeType: request.nodeType,
          automation: request.automation,
        },
      );
      if (decision.decision === 'allow') return { status: 'allowed' };
      if (decision.decision === 'needs-approval') {
        return { status: 'required', approvalId: decision.approvalId };
      }
      throw new Error(
        `approval for "${request.nodeType}" was rejected — the run cannot perform it`,
      );
    },
  };
}

// ------------------------------------------------------------------- sinks

/** What the walk does with a finished node, a wait, and a spent budget. The
 * durable sink persists and reschedules; the inline sink (a `subautomation`
 * node's own nodes) keeps everything in memory and never suspends. */
interface RunSink {
  /** Persist one finished node, or just the in-node cursor. Returns the run's
   * status so cancellation stops the walk at the next node boundary. */
  commit(args: {
    nodeId?: string;
    checkpoint?: NodeCheckpoint;
    cursor?: NodeCursor;
    executions: number;
  }): Promise<'running' | 'cancelled'>;
  /** Park the run. `continue` means the caller should loop in place instead —
   * what an inline sub-run does, matching the in-memory executor. */
  wait(args: {
    detail: string;
    cursor?: NodeCursor;
    executions: number;
    resumeInMs: number;
  }): Promise<'suspended' | 'continue' | 'cancelled'>;
  /** Whether this turn should stop and let a fresh invocation continue. */
  shouldHandOff(): boolean;
  /** Hand the run to the scheduler. */
  handOff(): Promise<void>;
}

const inlineSink: RunSink = {
  async commit() {
    return 'running';
  },
  async wait() {
    return 'continue';
  },
  shouldHandOff() {
    return false;
  },
  async handOff() {
    // Nothing to hand off: a sub-run is one step of its parent.
  },
};

// -------------------------------------------------------------- walk result

type WalkResult =
  | { kind: 'done'; output: unknown }
  | {
      kind: 'failed';
      nodeId?: string;
      message: string;
      hint?: string;
      /** The failing node's trace entry. A hard failure is deliberately NOT
       * checkpointed — a resumed run must not step over it as though it had
       * been handled — so its trace travels with the result instead. */
      trace?: NodeTrace;
    }
  | { kind: 'suspended' }
  | { kind: 'handed-off' }
  | { kind: 'cancelled' };

interface RunContext {
  ctx: ActionCtx;
  organizationId: string;
  /** The durable run id — the stable prefix of every idempotency key. */
  runId: string;
  automation: string;
  mode: 'mock' | 'live';
  deadline: number;
  /** The llm door for this run's organization; live llm nodes go through it. */
  llm: AutomationLlmCall;
  /** The agent door for this run's organization; live agent nodes kick, poll
   * and cancel their sandbox turns through it. */
  agent: AutomationAgentHost;
}

/** A resolved template destined for prompt text: strings pass through,
 * structured values render as JSON, absent values become empty text. */
function asPromptText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

// --------------------------------------------------------------- node bodies

interface BodyArgs {
  run: RunContext;
  node: NodeDef;
  /** `item`/`index` under forEach; empty otherwise. */
  extra: Record<string, unknown>;
  outputs: Record<string, { output: unknown }>;
  input: unknown;
  /** Whether this invocation's resolved input goes into the trace (the
   * executor records the single run, not each forEach item). */
  record: boolean;
  trace: NodeTrace;
  effects: Effect[];
  depth: number;
}

/**
 * Run one node once, for one scope. Every branch delegates: transform code and
 * templates to the engine's evaluator, connector actions to the platform's
 * integration door, a subautomation to a nested walk.
 */
async function runNodeBody(args: BodyArgs): Promise<unknown> {
  const { run, node, extra, outputs, input, record, trace, effects } = args;
  const scope = () => makeScope(input, outputs, extra);

  if (node.type === 'transform') {
    const resolved = await evalTemplates(node.input ?? {}, scope());
    if (record) trace.input = resolved;
    const out = await runCode(node.code ?? '', {
      input: resolved,
      nodes: scope().nodes,
      item: extra.item,
      index: extra.index,
    });
    if (out === undefined || out === null) {
      throw new Error(
        'transform code returned nothing — it must return a value',
      );
    }
    return out;
  }

  if (node.type === 'llm') {
    const model = node.model ?? '';
    const prompt = asPromptText(
      await evalTemplates(node.prompt ?? '', scope()),
    );
    const system = node.system
      ? asPromptText(await evalTemplates(node.system, scope()))
      : undefined;
    const llmInput = {
      model,
      prompt,
      ...(system !== undefined && { system }),
    };
    if (record) trace.input = llmInput;
    effects.push({ node: node.id, integration: 'llm', input: llmInput });
    if (run.mode === 'live') {
      const reply = await run.llm({
        model,
        prompt,
        ...(system !== undefined && { system }),
        ...(node.outputSchema !== undefined && {
          outputSchema: node.outputSchema,
        }),
      });
      if (node.outputSchema !== undefined) {
        if (!('data' in reply)) {
          throw new Error(
            'the llm call returned plain text for a node with outputSchema — structured output was required',
          );
        }
        return reply.data;
      }
      return 'text' in reply ? { text: reply.text } : reply.data;
    }
    return node.outputSchema !== undefined
      ? stubFromSchema(node.outputSchema)
      : { text: mockLlmText(model, prompt) };
  }

  if (node.type === 'agent') {
    const model = node.model ?? '';
    const prompt = asPromptText(
      await evalTemplates(node.prompt ?? '', scope()),
    );
    const system = node.system
      ? asPromptText(await evalTemplates(node.system, scope()))
      : undefined;
    const files =
      node.files === undefined
        ? undefined
        : await evalTemplates(node.files, scope());
    const agentInput = {
      model,
      prompt,
      ...(system !== undefined && { system }),
      ...(node.harness !== undefined && { harness: node.harness }),
      ...(node.skills !== undefined && { skills: node.skills }),
      ...(node.connectors !== undefined && { connectors: node.connectors }),
      ...(files !== undefined && { files }),
    };
    if (record) trace.input = agentInput;
    effects.push({ node: node.id, integration: 'agent', input: agentInput });
    if (run.mode === 'live') {
      // Unreachable: stepNode routes live agent nodes to stepAgentNode before
      // any body runs. Kept as a guard so a future path cannot silently mock
      // a step the author expects to act.
      throw new Error(
        'internal: a live agent node reached the mock body — stepAgentNode should have handled it',
      );
    }
    return { text: mockAgentText(model, prompt), files: [], status: 'ok' };
  }

  if (node.type === 'subautomation') {
    const ref = node.automation ?? '';
    if (args.depth >= MAX_SUBAUTOMATION_DEPTH) {
      throw new Error(
        `subautomations nest at most ${MAX_SUBAUTOMATION_DEPTH} levels deep`,
      );
    }
    const [subName, subVersion] = ref.split('@');
    const found = await run.ctx.runQuery(
      internal.automations.queries.loadAutomationDocument,
      {
        organizationId: run.organizationId,
        name: subName,
        ...(subVersion !== undefined && subVersion !== ''
          ? { version: Number(subVersion) }
          : {}),
      },
    );
    if (!found) {
      throw new Error(
        `no saved automation "${ref}" — save and deploy it first`,
      );
    }
    const resolved = await evalTemplates(node.input ?? {}, scope());
    if (record) trace.input = { automation: ref, input: resolved };
    // A sub-run is ONE durable step of its parent: its nodes run inline and are
    // not individually checkpointed, so an interrupted sub-run restarts. Its
    // effects are folded into the parent's log under `<node>/<subnode>`, the
    // same addressing the in-memory executor uses.
    const subEffects: Effect[] = [];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- documents are validated before they are saved
    const sub = found.document as Automation;
    const result = await walkAutomation({
      run,
      automation: sub,
      input: resolved,
      checkpoints: { nodes: {}, executions: 0 },
      sink: inlineSink,
      effects: subEffects,
      depth: args.depth + 1,
    });
    for (const effect of subEffects) {
      effects.push({
        node: `${node.id}/${effect.node}`,
        integration: effect.integration,
        input: effect.input,
      });
    }
    if (result.kind !== 'done') {
      throw new Error(
        `subautomation "${ref}" ${result.kind}: ${result.kind === 'failed' ? result.message : 'did not complete'}`,
      );
    }
    return result.output;
  }

  // Everything else is a connector action. It is dispatched through the
  // platform's one integration door, which owns the catalog, the input schema,
  // credentials, the host allowlist and the audit record — including in `mock`
  // mode, where the connector's deterministic mock body runs and nothing
  // reaches the network.
  const separator = node.type.indexOf('.');
  if (separator <= 0 || separator === node.type.length - 1) {
    throw new Error(
      `unknown node type "${node.type}" — expected transform, llm, agent, subautomation, or a connector action "<connector>.<action>"`,
    );
  }
  const connector = node.type.slice(0, separator);
  const action = node.type.slice(separator + 1);
  const resolved = await evalTemplates(node.input ?? {}, scope());
  if (record) trace.input = resolved;
  const index = typeof extra.index === 'number' ? extra.index : 0;
  const result = await run.ctx.runAction(
    internal.integrations.execute_action.runIntegrationAction,
    {
      organizationId: run.organizationId,
      connector,
      action,
      input: resolved,
      mode: run.mode,
      caller: { kind: 'workflow', runId: run.runId, nodeId: node.id },
      // Retry-stable by construction: the run id is durable and the node and
      // item are positional, so a re-attempted step presents the key the first
      // attempt used.
      idempotencyKey: `${run.runId}:${node.id}:${index}`,
    },
  );
  if (result.status !== 'ok') {
    throw new Error(result.message);
  }
  if (result.effects === 'write') {
    effects.push({ node: node.id, integration: node.type, input: resolved });
  }
  return result.output;
}

// ---------------------------------------------------------------- the walk

interface WalkArgs {
  run: RunContext;
  automation: Automation;
  input: unknown;
  checkpoints: RunCheckpoints;
  sink: RunSink;
  /** Effects in execution order. A resumed durable run starts it from the
   * checkpoints already recorded, so the finished run's log is complete
   * however many turns produced it. */
  effects: Effect[];
  depth: number;
}

/**
 * Walk the graph, one node at a time, persisting through the sink.
 *
 * The loop always asks the same question — "which node has no checkpoint yet?"
 * — so it behaves identically whether it starts on a fresh run or resumes one
 * with half its nodes already recorded.
 */
async function walkAutomation(args: WalkArgs): Promise<WalkResult> {
  const { run, automation, input, checkpoints, sink, depth } = args;
  const ordered = topoSort(automation.nodes);
  if (!ordered) {
    return {
      kind: 'failed',
      message: 'circular reference between nodes (see validate_automation)',
    };
  }

  let stepped = 0;
  for (;;) {
    const node = ordered.find((candidate) => !checkpoints.nodes[candidate.id]);
    if (!node) break;

    // Hand off BETWEEN nodes only: a node that has started must finish inside
    // this turn, otherwise its effect and its checkpoint could straddle the
    // ceiling the hand-off exists to avoid. A turn always advances at least one
    // node, so a budget that is already spent slows a run down instead of
    // livelocking it.
    const resuming = checkpoints.cursor?.node === node.id;
    if (stepped > 0 && !resuming && sink.shouldHandOff()) {
      await sink.handOff();
      return { kind: 'handed-off' };
    }
    stepped++;

    const outcome = await stepNode({
      run,
      node,
      input,
      checkpoints,
      sink,
      effects: args.effects,
      depth,
    });

    if (outcome.kind === 'suspended' || outcome.kind === 'cancelled') {
      return outcome;
    }
    if (outcome.kind === 'handed-off') return outcome;
    if (outcome.kind === 'failed') return outcome;
  }

  // Every node is recorded: evaluate the document's output expression.
  try {
    const output =
      automation.output !== undefined
        ? await evalTemplates(
            cloneData(automation.output),
            makeScope(input, outputsFrom(checkpoints)),
          )
        : null;
    return { kind: 'done', output };
  } catch (error) {
    return {
      kind: 'failed',
      message: `failed to evaluate automation "output": ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

interface StepArgs {
  run: RunContext;
  node: NodeDef;
  input: unknown;
  checkpoints: RunCheckpoints;
  sink: RunSink;
  effects: Effect[];
  depth: number;
}

type StepOutcome =
  | { kind: 'recorded' }
  | { kind: 'suspended' }
  | { kind: 'handed-off' }
  | { kind: 'cancelled' }
  | {
      kind: 'failed';
      nodeId: string;
      message: string;
      hint?: string;
      trace: NodeTrace;
    };

/**
 * Advance one node as far as this turn allows: to its checkpoint, to a wait, or
 * to a hand-off. Mutates `checkpoints` so the walk's in-memory view matches
 * what the sink persisted.
 */
async function stepNode(args: StepArgs): Promise<StepOutcome> {
  const { run, node, input, checkpoints, sink, depth } = args;
  const outputs = outputsFrom(checkpoints);
  const skipped = skippedFrom(checkpoints);
  const whenSkipped = whenSkippedFrom(checkpoints);
  const started = performance.now();
  const trace: NodeTrace = { node: node.id, type: node.type, status: 'ok' };
  const effects: Effect[] = [];

  /** Record the node as finished and mirror it into the walk's own view. */
  const record = async (checkpoint: NodeCheckpoint): Promise<StepOutcome> => {
    checkpoint.trace.ms = Math.round((performance.now() - started) * 10) / 10;
    const status = await sink.commit({
      nodeId: node.id,
      checkpoint,
      executions: checkpoints.executions,
    });
    checkpoints.nodes[node.id] = checkpoint;
    delete checkpoints.cursor;
    args.effects.push(...checkpoint.effects);
    return status === 'cancelled'
      ? { kind: 'cancelled' }
      : { kind: 'recorded' };
  };

  const skip = async (
    reason: NodeCheckpoint['reason'],
    note: string,
  ): Promise<StepOutcome> =>
    await record({
      status: 'skipped',
      ...(reason !== undefined && { reason }),
      output: null,
      trace: { ...trace, status: 'skipped', note },
      effects: [],
    });

  try {
    // The skip rules, in the executor's order: data dependencies first, then
    // the else-branch rule, then the node's own condition.
    const upstream = [...refsOf(node).data].filter((ref) => skipped.has(ref));
    if (upstream.length > 0) {
      return await skip(
        'upstream',
        `skipped: reads from skipped node(s) ${upstream.join(', ')}`,
      );
    }
    if (typeof node.elseOf === 'string' && !whenSkipped.has(node.elseOf)) {
      return await skip('else', `skipped: elseOf partner "${node.elseOf}" ran`);
    }
    if (typeof node.when === 'string') {
      const condition = await evalCondition(
        node.when,
        makeScope(input, outputs),
      );
      if (!condition) {
        return await skip(
          'when',
          `skipped: when=${JSON.stringify(node.when)} was falsy`,
        );
      }
    }

    // A live effectful step asks the human gate before it acts. The answer is
    // re-checked on every re-entry, so an approval granted later simply lets
    // the next turn through.
    if (run.mode === 'live' && !CORE_TYPES.has(node.type) && approvalGate) {
      const decision = await approvalGate.check({
        organizationId: run.organizationId,
        automation: run.automation,
        runId: run.runId,
        nodeId: node.id,
        nodeType: node.type,
      });
      if (decision.status === 'required') {
        const waited = await sink.wait({
          detail: `approval:${decision.approvalId ?? node.id}`,
          ...(checkpoints.cursor !== undefined && {
            cursor: checkpoints.cursor,
          }),
          executions: checkpoints.executions,
          resumeInMs: APPROVAL_POLL_MS,
        });
        return waited === 'cancelled'
          ? { kind: 'cancelled' }
          : { kind: 'suspended' };
      }
    }

    // A live agent node runs as an asynchronous sandbox turn spanning
    // suspensions — its own step path, the approval park's sibling. Mock mode
    // falls through to the deterministic body below.
    if (run.mode === 'live' && node.type === 'agent') {
      return await stepAgentNode({
        run,
        node,
        input,
        checkpoints,
        sink,
        outputs,
        trace,
        effects,
        record,
      });
    }

    // Where in the node this turn starts: mid-array and mid-repeat when a
    // previous turn parked here, at the beginning otherwise.
    const cursor: NodeCursor =
      checkpoints.cursor?.node === node.id
        ? { ...checkpoints.cursor, outs: [...checkpoints.cursor.outs] }
        : { node: node.id, index: 0, passes: 0, outs: [] };

    let items: unknown[] | null = null;
    if (typeof node.forEach === 'string') {
      const resolved = await evalTemplates(
        node.forEach,
        makeScope(input, outputs),
      );
      if (!Array.isArray(resolved)) {
        throw new Error(
          `forEach must resolve to an array, got ${resolved === undefined ? 'undefined' : typeof resolved} — check the referenced path`,
        );
      }
      items = resolved;
      trace.input = { forEach: `${resolved.length} item(s)` };
    }

    const maxRepeats = Math.min(
      node.maxRepeats ?? DEFAULT_MAX_REPEATS,
      REPEATS_HARD_CAP,
    );
    let { index, passes } = cursor;
    const outs = cursor.outs;
    let single: unknown;

    for (;;) {
      if (items !== null && index >= items.length) break;

      checkpoints.executions++;
      if (checkpoints.executions > DEFAULT_MAX_NODE_EXECUTIONS) {
        throw new Error(
          `run exceeded the ${DEFAULT_MAX_NODE_EXECUTIONS}-execution guard — a forEach over a huge array or a runaway repeat; split the automation`,
        );
      }

      const extra: Record<string, unknown> =
        items === null ? {} : { item: items[index], index };
      const output = await runNodeBody({
        run,
        node,
        extra,
        outputs,
        input,
        record: items === null && passes === 0,
        trace,
        effects,
        depth,
      });

      if (typeof node.repeatUntil === 'string') {
        passes++;
        const withSelf = { ...outputs, [node.id]: { output } };
        const condition = await evalCondition(
          node.repeatUntil,
          makeScope(input, withSelf, { ...extra, output }),
        );
        trace.note = `repeatUntil ran ${passes}x${condition ? '' : ' (maxRepeats hit before the condition became true)'}`;
        if (!condition && passes < maxRepeats) {
          // The pass did not settle it. Park rather than spin: a poll that has
          // not finished must not hold an action open.
          const waited = await sink.wait({
            detail: `repeat:${node.id}`,
            cursor: { node: node.id, index, passes, outs },
            executions: checkpoints.executions,
            resumeInMs: REPEAT_DELAY_MS,
          });
          if (waited === 'cancelled') return { kind: 'cancelled' };
          if (waited === 'suspended') {
            checkpoints.cursor = { node: node.id, index, passes, outs };
            return { kind: 'suspended' };
          }
          continue;
        }
      }

      if (items === null) {
        single = output;
        break;
      }
      outs.push(output);
      index++;
      passes = 0;
      if (index >= items.length) break;
      // Between items is a safe place to stop: everything sent so far is in the
      // cursor, so the next turn continues at the item after it.
      if (sink.shouldHandOff()) {
        const status = await sink.commit({
          cursor: { node: node.id, index, passes: 0, outs },
          executions: checkpoints.executions,
        });
        if (status === 'cancelled') return { kind: 'cancelled' };
        checkpoints.cursor = { node: node.id, index, passes: 0, outs };
        await sink.handOff();
        return { kind: 'handed-off' };
      }
    }

    trace.status = 'ok';
    const output = items === null ? single : outs;
    trace.output = output;
    return await record({ status: 'ok', output, trace, effects });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace.status = 'error';
    trace.error = message;
    if (node.onError === 'continue') {
      return await record({
        status: 'skipped',
        reason: 'error',
        output: null,
        trace: {
          ...trace,
          note: 'onError: continue — dependents are skipped',
        },
        effects,
      });
    }
    // A hard failure is NOT checkpointed: a checkpoint means "this node is
    // done", and a run resumed by the recovery sweep must not step over a node
    // that failed as though it had been handled. Whatever the node did before
    // it threw is still logged, and its trace entry travels with the result so
    // the author sees the resolved input that produced the failure.
    trace.ms = Math.round((performance.now() - started) * 10) / 10;
    args.effects.push(...effects);
    const hint = /is not defined/.test(message)
      ? 'in templates and code, only `input` and `nodes.<id>.output` are available'
      : /Cannot read propert/.test(message)
        ? 'a referenced value is null/undefined — check the exact output shape in the trace of the upstream node'
        : undefined;
    return {
      kind: 'failed',
      nodeId: node.id,
      message,
      ...(hint !== undefined && { hint }),
      trace,
    };
  }
}

interface AgentStepArgs {
  run: RunContext;
  node: NodeDef;
  input: unknown;
  checkpoints: RunCheckpoints;
  sink: RunSink;
  outputs: Record<string, { output: unknown }>;
  trace: NodeTrace;
  effects: Effect[];
  record: (checkpoint: NodeCheckpoint) => Promise<StepOutcome>;
}

/**
 * Advance a LIVE agent node: kick the sandbox turn and park the run, keep
 * parking while it runs, and consume the settled result the agent host wrote
 * into the cursor. The turn spans suspensions, so this is stepNode's async
 * sibling rather than a runNodeBody branch — a body must finish inside its
 * turn, and an agent turn by definition does not.
 */
async function stepAgentNode(args: AgentStepArgs): Promise<StepOutcome> {
  const { run, node, checkpoints, sink, outputs, trace, effects, record } =
    args;
  if (
    typeof node.forEach === 'string' ||
    typeof node.repeatUntil === 'string'
  ) {
    throw new Error(
      'an agent node cannot iterate (forEach/repeatUntil) yet — give each item its own agent node',
    );
  }

  const parked =
    checkpoints.cursor?.node === node.id ? checkpoints.cursor.agent : undefined;

  if (parked === undefined) {
    // First entry: resolve the request and kick the turn.
    const scope = makeScope(args.input, outputs);
    const model = node.model ?? '';
    const prompt = asPromptText(await evalTemplates(node.prompt ?? '', scope));
    const system = node.system
      ? asPromptText(await evalTemplates(node.system, scope))
      : undefined;
    const files =
      node.files === undefined
        ? undefined
        : await evalTemplates(node.files, scope);
    const request: WorkflowAgentRequest = {
      model,
      prompt,
      ...(system !== undefined && { system }),
      ...(node.harness !== undefined && { harness: node.harness }),
      ...(node.skills !== undefined && { skills: node.skills }),
      ...(node.connectors !== undefined && { connectors: node.connectors }),
      ...(files !== undefined && {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- evalTemplates preserves the record shape of `files`
        files: files as Record<string, unknown>,
      }),
    };
    checkpoints.executions++;
    if (checkpoints.executions > DEFAULT_MAX_NODE_EXECUTIONS) {
      throw new Error(
        `run exceeded the ${DEFAULT_MAX_NODE_EXECUTIONS}-execution guard — a forEach over a huge array or a runaway repeat; split the automation`,
      );
    }
    const kicked = await run.agent.kick({
      runId: run.runId,
      nodeId: node.id,
      request,
    });
    const agent: AgentCursor = {
      execId: kicked.execId,
      sessionId: kicked.sessionId,
      deadlineAt: kicked.deadlineAt,
      providerSlug: kicked.providerSlug,
      gatewayModel: kicked.gatewayModel,
      harness: kicked.harness,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolved request is plain JSON by construction
      input: request as unknown as Record<string, unknown>,
    };
    const cursor: NodeCursor = {
      node: node.id,
      index: 0,
      passes: 0,
      outs: [],
      agent,
    };
    const waited = await sink.wait({
      detail: `agent:${node.id}`,
      cursor,
      executions: checkpoints.executions,
      resumeInMs: AGENT_POLL_MS,
    });
    if (waited === 'cancelled') return { kind: 'cancelled' };
    if (waited === 'suspended') {
      checkpoints.cursor = cursor;
      return { kind: 'suspended' };
    }
    // 'continue' is the inline sink — a subautomation cannot park its parent.
    throw new Error(
      'an agent node cannot run inside a subautomation — hoist it to the top level of the calling automation',
    );
  }

  // Parked: the resolved request recorded at kick time is this entry's trace
  // input and effect, whatever happens next — the turn ran either way.
  trace.input = parked.input;
  effects.push({ node: node.id, integration: 'agent', input: parked.input });

  // The settle may have landed after this turn loaded its checkpoints, so a
  // missing in-memory result polls fresh once before parking again.
  const settled =
    parked.result ??
    (await run.agent.poll({ runId: run.runId, execId: parked.execId })) ??
    undefined;

  if (settled === undefined) {
    if (Date.now() > parked.deadlineAt) {
      await run.agent.cancel({
        sessionId: parked.sessionId,
        execId: parked.execId,
      });
      throw new Error('the agent turn ran past its time limit and was stopped');
    }
    const waited = await sink.wait({
      detail: `agent:${node.id}`,
      cursor: checkpoints.cursor ?? {
        node: node.id,
        index: 0,
        passes: 0,
        outs: [],
        agent: parked,
      },
      executions: checkpoints.executions,
      resumeInMs: AGENT_POLL_MS,
    });
    if (waited === 'cancelled') return { kind: 'cancelled' };
    if (waited === 'suspended') return { kind: 'suspended' };
    throw new Error(
      'an agent node cannot run inside a subautomation — hoist it to the top level of the calling automation',
    );
  }

  if (settled.errored) {
    throw new Error(
      settled.reason ??
        (settled.text !== ''
          ? `the agent turn failed: ${settled.text.slice(0, 300)}`
          : 'the agent turn ended without producing a reply'),
    );
  }
  const output = {
    text: settled.text,
    files: settled.files,
    status: settled.status ?? 'ok',
  };
  trace.status = 'ok';
  trace.output = output;
  return await record({ status: 'ok', output, trace, effects });
}

// ------------------------------------------------------------------- action

/**
 * Execute one turn of a run: claim it, step it until it finishes, waits, or
 * runs out of budget, and leave the row in a state the next turn can read.
 *
 * Every exit path is a status a human can act on — nothing is left `running`
 * with no continuation except an actual crash, which the recovery sweep in
 * `triggers.ts` picks back up.
 */
export const stepRun = internalAction({
  args: {
    organizationId: v.string(),
    runId: v.id('automationRuns'),
  },
  returns: v.object({ status: v.string() }),
  // The return type is written out because this action's own reference reaches
  // back here: it schedules itself through the mutations it calls, and TypeScript
  // needs one annotation to break the cycle.
  handler: async (ctx, args): Promise<{ status: string }> => {
    // The engine's sandbox seam for untrusted JavaScript (templates, transform
    // bodies). The bundled backend is deterministic and data-only; a deployment
    // that installs a real sandbox backend keeps it.
    if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());

    const claim = await ctx.runMutation(
      internal.automations.mutations.claimRun,
      { organizationId: args.organizationId, runId: args.runId },
    );
    if (!claim.claimed) return { status: claim.status };

    const loaded = await ctx.runQuery(
      internal.automations.queries.loadRunForStep,
      { organizationId: args.organizationId, runId: args.runId },
    );
    if (!loaded) {
      console.error(
        `[automations] run ${args.runId} has no document to execute`,
      );
      return { status: 'missing' };
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- documents are validated before they are saved
    const automation = loaded.document as Automation;
    const checkpoints = readCheckpoints(loaded.run.checkpoints);
    const run: RunContext = {
      ctx,
      organizationId: args.organizationId,
      runId: args.runId,
      automation: loaded.run.name,
      mode: loaded.run.mode,
      deadline: Date.now() + stepBudgetMs(),
      // Built fresh every turn, like the approval gate below: the door closes
      // over this invocation's ctx and the run's own organization.
      llm: (llmCallFactory ?? automationLlmCall)(ctx, args.organizationId),
      agent: (agentHostFactory ?? automationAgentHost)(
        ctx,
        args.organizationId,
      ),
    };

    // Install the real approval gate for THIS run before any node is stepped,
    // so a live effectful node consults the approvals domain for the run's own
    // organization. Re-installed every turn because the closure carries this
    // invocation's ctx, matching how the connector host is assembled per turn.
    setAutomationApprovalGate(automationApprovalGate(ctx, args.organizationId));

    const sink = durableSink(
      ctx,
      args.organizationId,
      args.runId,
      run.deadline,
    );
    const order = (topoSort(automation.nodes) ?? automation.nodes).map(
      (node) => node.id,
    );
    // Seeded with what earlier turns already did, so the finished run's effect
    // log is whole no matter how many turns produced it.
    const effects: Effect[] = effectsFrom(checkpoints, order);
    const result = await walkAutomation({
      run,
      automation,
      input: loaded.run.input,
      checkpoints,
      sink,
      effects,
      depth: 0,
    });

    if (
      result.kind === 'suspended' ||
      result.kind === 'handed-off' ||
      result.kind === 'cancelled'
    ) {
      return { status: result.kind === 'cancelled' ? 'cancelled' : 'running' };
    }

    // The trace reads in execution order: what ran, then the failing node, then
    // everything the failure kept from running.
    const failedTrace = result.kind === 'failed' ? result.trace : undefined;
    const trace: NodeTrace[] = traceFrom(checkpoints, order);
    if (failedTrace) trace.push(failedTrace);
    for (const id of order) {
      if (checkpoints.nodes[id] || failedTrace?.node === id) continue;
      const node = automation.nodes.find((candidate) => candidate.id === id);
      if (node) trace.push({ node: id, type: node.type, status: 'not_run' });
    }
    const finished = await ctx.runMutation(
      internal.automations.mutations.finishRun,
      {
        organizationId: args.organizationId,
        runId: args.runId,
        status: result.kind === 'done' ? 'success' : 'failed',
        ...(result.kind === 'done' && { output: result.output }),
        trace,
        effects,
        ...(result.kind === 'failed' && {
          detail: result.nodeId
            ? `${result.nodeId}: ${result.message}`
            : result.message,
        }),
        executions: checkpoints.executions,
      },
    );
    return { status: finished.status };
  },
});

/** The sink that makes a run durable: every commit is a row write, every wait
 * schedules the turn that resumes it. */
function durableSink(
  ctx: ActionCtx,
  organizationId: string,
  runId: Id<'automationRuns'>,
  deadline: number,
): RunSink {
  return {
    async commit(args) {
      const result = await ctx.runMutation(
        internal.automations.mutations.recordProgress,
        {
          organizationId,
          runId,
          ...(args.nodeId !== undefined && { nodeId: args.nodeId }),
          ...(args.checkpoint !== undefined && {
            checkpoint: args.checkpoint,
          }),
          ...(args.cursor !== undefined && { cursor: args.cursor }),
          executions: args.executions,
        },
      );
      return result.status === 'cancelled' ? 'cancelled' : 'running';
    },
    async wait(args) {
      const result = await ctx.runMutation(
        internal.automations.mutations.suspendRun,
        {
          organizationId,
          runId,
          detail: args.detail,
          ...(args.cursor !== undefined && { cursor: args.cursor }),
          executions: args.executions,
          resumeInMs: args.resumeInMs,
        },
      );
      return result.suspended ? 'suspended' : 'cancelled';
    },
    shouldHandOff() {
      return Date.now() >= deadline;
    },
    async handOff() {
      await ctx.runMutation(internal.automations.mutations.continueRun, {
        organizationId,
        runId,
        resumeInMs: 0,
      });
    },
  };
}
