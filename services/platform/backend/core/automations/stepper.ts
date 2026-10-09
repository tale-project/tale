'use node';

import { findConnector } from '../../../lib/connectors/catalog';
import { topoSort } from '../../../lib/engine/core/execute/controlflow';
import {
  decideNode,
  repeatSettled,
  resolveForEach,
} from '../../../lib/engine/core/execute/decide';
import {
  cloneData,
  makeScope,
  mockAgentText,
  mockLlmText,
  stubFromSchema,
} from '../../../lib/engine/core/execute/scope';
import {
  connectorIdempotencyKey,
  subautomationPathPrefix,
} from '../../../lib/engine/core/protocol';
import {
  createRecorder,
  type RunRecorder,
  type NodeRunWrite,
} from '../../../lib/engine/core/record/recorder';
import { END_PATH, type UnitKey } from '../../../lib/engine/core/record/types';
import { recordBudget } from '../../../lib/engine/core/record/value';
import { hasCodeRunner, setCodeRunner } from '../../../lib/engine/core/runner';
import {
  evalTemplates,
  ExprError,
  runCode,
} from '../../../lib/engine/core/template';
import type {
  Effect,
  NodeDef,
  NodeTrace,
  Automation,
} from '../../../lib/engine/core/types';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm';
import { DEFAULT_HARNESS } from '../../../lib/shared/harness-offer';
import { processShutdown, type ShutdownState } from '../../lib/shutdown';
import { harnessResumesConversations } from '../chat/external_turn_shared';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import type { Id } from '../lib/rows';
import {
  automationAgentHost,
  type AutomationAgentHost,
  type WorkflowAgentRequest,
} from './agent_host';
import {
  SANDBOX_ROOM_MAX_WAIT_MS,
  isWorkflowAgentRetryable,
  planWorkflowAgentRetry,
  roomWaitSince,
  sandboxRoomRetryAtMs,
  workflowAgentRetryResume,
} from './agent_retry';
import { boundCheckpointTrace, boundNodeTrace } from './bound_run_payload';
import type {
  AgentCursor,
  NodeCheckpoint,
  NodeCursor,
  RunCheckpoints,
} from './checkpoints';
import {
  effectsFrom,
  outputsFrom,
  parseRunCheckpoints,
  skippedFrom,
  traceFrom,
  whenSkippedFrom,
} from './checkpoints';
import {
  agentFailureCodeOf,
  NodeFailure,
  runFailureCodeOf,
  RunStopFailure,
  stepFailureOf,
  type RunFailureCode,
} from './failure';
import {
  callThroughLedger,
  durableLedger,
  InDoubtPark,
  passThroughLedger,
  StaleClaim,
  type RunLedger,
} from './ledger';
import {
  CUT_TURN_BEAT_MS,
  FOREACH_CURSOR_COMMIT_ITEMS,
  FOREACH_CURSOR_COMMIT_MS,
  IN_DOUBT_POLL_MS,
  RUN_HEARTBEAT_INTERVAL_MS,
} from './liveness';
import { automationLlmCall, type AutomationLlmCall } from './llm_call';

/**
 * How long one invocation works before handing the run back to the scheduler.
 * The `automation.step` job's expiry (jobs/tasks.ts) sits hours above this;
 * stepping out early means a long node started near the end of a turn still
 * has room to finish inside that ceiling instead of being killed mid-effect.
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

/** How often a run parked on a human decision re-checks it. Only a
 * backstop: the decision wakes the run in its own transaction, and a park
 * that comes after the decision wakes the run itself (`suspendRun`). */
const APPROVAL_POLL_MS = 600_000;

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
 * Every run carries its own gate on its run context, built for the run's own
 * organization when its turn starts (see {@link automationApprovalGate}).
 */
export interface AutomationApprovalGate {
  check(request: {
    organizationId: string;
    automation: string;
    runId: string;
    nodeId: string;
    nodeType: string;
    /** Whether the caller can park on a card. False inside a subautomation:
     * the gate then answers from the policy alone and mints nothing — and
     * reads nothing, so a card a parent-level node of the same id once had
     * approved never releases a sub-node. */
    canPark: boolean;
    /** The node's input resolved against the run's scope — what the step
     * would call the connector with, for the approver to read before
     * deciding. Absent when it cannot be resolved ahead of the step (a loop
     * body reads `item`/`index`, which exist only once the loop turns). */
    input?: unknown;
  }): Promise<
    { status: 'allowed' } | { status: 'required'; approvalId?: string }
  >;
}

let approvalGateOverride: AutomationApprovalGate | null = null;

/** Install a gate that every run in this process uses instead of its own,
 * until `null` gives each run its real gate back (what a test does when it is
 * finished with it). The gate is held per run, never in a slot one run's turn
 * overwrites for another's: two organizations' runs stepped at once by one
 * worker each ask their own organization's policy. Client repositories'
 * native workflow gates import this module by path and call it. @public */
export function setAutomationApprovalGate(
  gate: AutomationApprovalGate | null,
): void {
  approvalGateOverride = gate;
}

/** How a run gets its agent door. A seam like the approval gate's, but held
 * as a factory: the real host reaches the sandbox, so a harness installs a
 * recording factory. `stepRun` builds each turn's instance from whichever
 * factory is installed and carries it on the run context, so the closure is
 * always over that turn's ctx and organization. */
export type AutomationAgentHostFactory = (
  ctx: ActionCtx,
  organizationId: string,
) => AutomationAgentHost;

let agentHostFactory: AutomationAgentHostFactory | null = null;

/** Install a substitute agent host factory; `null` restores the real one.
 * Client repositories' native workflow gates import this module by path and
 * call it. @public */
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
  const connector = findConnector(nodeType.slice(0, separator));
  const action = connector?.actions.find(
    (candidate) => candidate.name === nodeType.slice(separator + 1),
  );
  return action ? action.effects : 'unknown';
}

/** The connector door's answer as the ledger kept it for a call inside a
 * subautomation: its output and whether it wrote. A call a person skipped
 * keeps nothing, and reads as one that returned nothing and wrote nothing. */
function readDispatchResult(value: unknown): {
  output: unknown;
  effects: string;
} {
  if (value === null || typeof value !== 'object' || !('output' in value)) {
    return { output: null, effects: 'read' };
  }
  const effects = 'effects' in value ? value.effects : undefined;
  return {
    output: value.output,
    effects: typeof effects === 'string' ? effects : 'read',
  };
}

/** Whether a connector node's action declares that calling it twice with
 * the same idempotency key has the effect of calling it once — the one kind
 * of write a resumed run may repeat when it cannot tell whether the first
 * call reached its service. Read from the shipped catalog like
 * {@link nodeEffect}; anything that does not declare it is not. */
function nodeIdempotent(nodeType: string): boolean {
  const separator = nodeType.indexOf('.');
  if (separator <= 0 || separator === nodeType.length - 1) return false;
  const connector = findConnector(nodeType.slice(0, separator));
  const action = connector?.actions.find(
    (candidate) => candidate.name === nodeType.slice(separator + 1),
  );
  return action?.idempotent === true;
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
  const connector = findConnector(nodeType.slice(0, separator));
  return (
    connector?.auth.some((method) => method.method === 'platform') === true
  );
}

/**
 * The real gate for one run: a live effectful node is decided by the approvals
 * domain, which records a pending approval keyed to this run and node and
 * reports its state on every re-entry. Built per turn and carried on that
 * run's context, so it acts only for the organization whose run is being
 * stepped; the request's organization is checked against that as
 * belt-and-braces, and a rejected approval fails the node rather than looping.
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
          policyOnly: !request.canPark,
          ...(request.input !== undefined && { input: request.input }),
        },
      );
      if (decision.decision === 'allow') return { status: 'allowed' };
      if (decision.decision === 'needs-approval') {
        return {
          status: 'required',
          ...(decision.approvalId !== undefined && {
            approvalId: decision.approvalId,
          }),
        };
      }
      throw new NodeFailure(
        'approval_rejected',
        `approval for "${request.nodeType}" was rejected — the run cannot perform it`,
        undefined,
        { reason: 'APPROVAL_REJECTED', params: {} },
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
   * what an inline sub-run does, matching the in-memory executor. `event`
   * records why the run parked when its park string says too little. */
  wait(args: {
    detail: string;
    cursor?: NodeCursor;
    executions: number;
    resumeInMs: number;
    event?: { kind: 'in_doubt'; detail: Record<string, unknown> };
  }): Promise<'suspended' | 'continue' | 'cancelled'>;
  /** Whether this turn should stop and let a fresh invocation continue: its
   * budget is spent, or its server is stopping. */
  shouldHandOff(): boolean;
  /** Hand the run to the scheduler — with a note when its server is
   * stopping, so the run is counted and shown as resumed after a restart. */
  handOff(note?: HandOffNote): Promise<void>;
  /** Whether `wait` can actually park the run. False for the inline sink: a
   * step that would have to park (an agent turn, an approval) refuses BEFORE
   * it spends anything, instead of discovering `continue` after the kick. */
  canPark: boolean;
}

/** Why a walker handed its run on before it was done, when the reason is its
 * server stopping (the store's `RunHandoff`). A hand-off because the turn's
 * budget ran out carries none. */
interface HandOffNote {
  reason: 'shutdown';
  /** The node the walker was in, and its forEach item. */
  nodeId?: string;
  itemIndex?: number;
  /** The node's body was cut off mid-call rather than finished. */
  interrupted?: boolean;
}

const inlineSink: RunSink = {
  async commit() {
    return 'running';
  },
  async wait() {
    return 'continue';
  },
  canPark: false,
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
      /** The stable cause (`Run.failureCode`): named by the site that can
       * tell, or classified from the error by the stepper's catch. */
      code: RunFailureCode;
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
  /** The llm door for this run's organization; live llm nodes go through
   * it, each call measured against and booked to the run's budgets. */
  llm: AutomationLlmCall;
  /** The agent door for this run's organization; live agent nodes kick, poll
   * and cancel their sandbox turns through it. */
  agent: AutomationAgentHost;
  /** The approval gate for this run's organization; live connector nodes ask
   * it before they act. Held per run, so runs of two organizations stepped
   * at once never ask each other's. */
  gate: AutomationApprovalGate;
  /** Where a live run begins and records every call that reaches outside it
   * (`ledger.ts`); a mock run's records nothing. */
  ledger: RunLedger;
  /** Aborted when a step body still running must stop: its server is
   * shutting down and the grace for finishing a step ran out, or the job
   * running this turn was given up on. Every call outside the run listens
   * to it, and an error raised once it aborted is an interruption, never a
   * failure of the step. */
  signal: AbortSignal;
  /** Whether this turn should hand the run on at its next step boundary
   * instead of walking on: its server is stopping, or its replica is being
   * drained for a deploy. */
  yielding: () => boolean;
  /** Whether its server is stopping. Only that hands a run on before the
   * turn's first step: a drained worker hands a step job over before it
   * reaches a walker, and a drain read a few seconds stale must not bounce a
   * run back and forth without a step. */
  shuttingDown: () => boolean;
  /** Where the run's record goes: every unit of work this turn touched,
   * flushed with the progress it describes. */
  recorder: RunRecorder;
  /** Write the given units' rows on their own: a long step that started, so
   * a live view shows it working before its first commit. */
  recordStarted: (keys: readonly UnitKey[]) => Promise<void>;
}

/** The note a hand-off carries when the walker is yielding to a stopping
 * server, and none when its budget simply ran out. */
function yieldNote(
  run: RunContext,
  where: Omit<HandOffNote, 'reason'> = {},
): HandOffNote | undefined {
  return run.yielding() ? { reason: 'shutdown', ...where } : undefined;
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
  /** Where in the run this invocation happens: the node's path (its id at
   * the top level, `<parent>[<item>:<pass>]/<id>` inside a subautomation),
   * its forEach item and its repeat pass — the address of every call it
   * makes outside the run. */
  path: string;
  itemIndex: number;
  pass: number;
  /** The versions this run's subautomations walk (`NodeCursor.pins`) and
   * this node's key prefix among them. */
  pins: Record<string, number> | undefined;
  pinPrefix: string;
  /** The unit of the run record this invocation is (the node, its item or
   * its pass), and the node's pointer in its document. */
  unit: UnitKey;
  pointer: string;
  /** For a pass: the item or node row that shows its last pass's input. */
  mirror?: UnitKey;
  /** Called once the resolved input is recorded: a long step writes its
   * start then. */
  started?: () => Promise<void>;
}

/** Record what an invocation works on, and say it started. */
async function noteInput(
  args: Pick<BodyArgs, 'run' | 'unit' | 'started' | 'mirror'>,
  value: unknown,
  meta: Parameters<RunRecorder['meta']>[1] = {},
): Promise<void> {
  const recorder = args.run.recorder;
  for (const unit of args.mirror === undefined
    ? [args.unit]
    : [args.unit, args.mirror]) {
    recorder.unitInput(unit, value);
    if (Object.keys(meta).length > 0) recorder.meta(unit, meta);
  }
  await args.started?.();
}

/**
 * Run one node once, for one scope. Every branch delegates: transform code and
 * templates to the engine's evaluator, connector actions to the platform's
 * connector door, a subautomation to a nested walk.
 */
async function runNodeBody(args: BodyArgs): Promise<unknown> {
  const { run, node, extra, outputs, input, record, trace, effects } = args;
  const scope = () => makeScope(input, outputs, extra);
  const at = args.pointer;

  if (node.type === 'transform') {
    const resolved = await evalTemplates(
      node.input ?? {},
      scope(),
      `${at}/input`,
    );
    if (record) trace.input = resolved;
    await noteInput(args, resolved);
    const out = await runCode(
      node.code ?? '',
      {
        input: resolved,
        nodes: scope().nodes,
        item: extra.item,
        index: extra.index,
      },
      undefined,
      `${at}/code`,
    );
    if (out === undefined || out === null) {
      throw new ExprError(
        '[code]',
        'transform code returned nothing — it must return a value',
        { reason: 'CODE_NO_RESULT', params: {}, at: { pointer: `${at}/code` } },
      );
    }
    return out;
  }

  if (node.type === 'llm') {
    const model = node.model ?? '';
    const prompt = asPromptText(
      await evalTemplates(node.prompt ?? '', scope(), `${at}/prompt`),
    );
    const system = node.system
      ? asPromptText(await evalTemplates(node.system, scope(), `${at}/system`))
      : undefined;
    const llmInput = {
      model,
      prompt,
      ...(system !== undefined && { system }),
    };
    if (record) trace.input = llmInput;
    await noteInput(args, llmInput, { model });
    effects.push({ node: node.id, connector: 'llm', input: llmInput });
    if (run.mode === 'live') {
      // A model call reaches nothing outside the run but the provider's
      // meter: one a resumed run cannot account for is simply made again,
      // and one that finished is never paid for twice.
      return await callThroughLedger(
        run.ledger,
        {
          nodeId: args.path,
          itemIndex: args.itemIndex,
          pass: args.pass,
          kind: 'llm',
          nodeType: node.type,
          input: llmInput,
          recallable: true,
        },
        async (attempt) => {
          const reply = await run.llm({
            attempt: {
              nodeId: args.path,
              itemIndex: args.itemIndex,
              pass: args.pass,
              attempt,
            },
            model,
            prompt,
            ...(system !== undefined && { system }),
            ...(node.outputSchema !== undefined && {
              outputSchema: node.outputSchema,
            }),
          });
          if (node.outputSchema !== undefined) {
            if (!('data' in reply)) {
              throw new NodeFailure(
                'llm_output_invalid',
                'the llm call returned plain text for a node with outputSchema — structured output was required',
                undefined,
                {
                  reason: 'LLM_OUTPUT_INVALID',
                  params: { model },
                  at: { pointer: `${at}/outputSchema` },
                },
              );
            }
            return reply.data;
          }
          return 'text' in reply ? { text: reply.text } : reply.data;
        },
        run.signal,
      );
    }
    return node.outputSchema !== undefined
      ? stubFromSchema(node.outputSchema)
      : { text: mockLlmText(model, prompt) };
  }

  if (node.type === 'agent') {
    const model = node.model ?? '';
    const prompt = asPromptText(
      await evalTemplates(node.prompt ?? '', scope(), `${at}/prompt`),
    );
    const system = node.system
      ? asPromptText(await evalTemplates(node.system, scope(), `${at}/system`))
      : undefined;
    const files =
      node.files === undefined
        ? undefined
        : await evalTemplates(node.files, scope(), `${at}/files`);
    const agentInput = {
      model,
      ...(node.modelProvider !== undefined && {
        modelProvider: node.modelProvider,
      }),
      prompt,
      ...(system !== undefined && { system }),
      ...(node.harness !== undefined && { harness: node.harness }),
      ...(node.skills !== undefined && { skills: node.skills }),
      ...(node.connectors !== undefined && { connectors: node.connectors }),
      ...(node.tools !== undefined && { tools: node.tools }),
      ...(node.secrets !== undefined && { secrets: node.secrets }),
      ...(files !== undefined && { files }),
    };
    if (record) trace.input = agentInput;
    await noteInput(args, agentInput, { model });
    effects.push({ node: node.id, connector: 'agent', input: agentInput });
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
      throw new NodeFailure(
        'node_error',
        `subautomations nest at most ${MAX_SUBAUTOMATION_DEPTH} levels deep`,
        undefined,
        {
          reason: 'SUBAUTOMATION_TOO_DEEP',
          params: { max: MAX_SUBAUTOMATION_DEPTH },
          at: { pointer: at },
        },
      );
    }
    const [subName, subVersion] = ref.split('@');
    // The version this run fixed for the node the first time it ran, so a
    // deploy between two turns never changes what a resumed run walks; the
    // reference itself only when nothing was fixed (an inline walk of a
    // mock, a run stepped before pins existed).
    const pinned = args.pins?.[`${args.pinPrefix}${node.id}`];
    const version =
      pinned ??
      (subVersion !== undefined && subVersion !== ''
        ? Number(subVersion)
        : undefined);
    const found = await run.ctx.runQuery(
      internal.automations.queries.loadAutomationDocument,
      {
        organizationId: run.organizationId,
        name: subName,
        ...(version !== undefined && { version }),
      },
    );
    if (!found) {
      throw new NodeFailure(
        'node_error',
        `no saved automation "${ref}" — save and deploy it first`,
        undefined,
        {
          reason: 'SUBAUTOMATION_NOT_FOUND',
          params: { automation: ref },
          at: { pointer: `${at}/automation` },
        },
      );
    }
    const resolved = await evalTemplates(
      node.input ?? {},
      scope(),
      `${at}/input`,
    );
    if (record) trace.input = { automation: ref, input: resolved };
    await noteInput(args, { automation: ref, input: resolved });
    // A sub-run is ONE durable step of its parent: its nodes run inline and are
    // not individually checkpointed, so an interrupted sub-run walks again from
    // its first node — and every call its earlier walk made outside the run is
    // answered by the ledger under its nested path, never made twice blindly.
    // Its effects are folded into the parent's log under `<node>/<subnode>`,
    // the same addressing the in-memory executor uses. A park, a stale claim
    // or a person's "fail the run" inside it is thrown through, not folded
    // into "subautomation … failed": the calling node acts on it.
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
      pathPrefix: subautomationPathPrefix(args.path, args.itemIndex, args.pass),
      pins: args.pins,
      pinPrefix: `${args.pinPrefix}${node.id}/`,
      docRef: `${subName}@${found.version}`,
    });
    for (const effect of subEffects) {
      effects.push({
        node: `${node.id}/${effect.node}`,
        connector: effect.connector,
        input: effect.input,
      });
    }
    if (result.kind === 'failed') {
      // The inner step's cause is the sub-run's, as it would be at the top
      // level: re-read from the sentence instead, a reached budget
      // (`budget_exceeded`) read as `node_error`, which counts toward a
      // schedule's pause.
      throw new NodeFailure(
        result.code,
        `subautomation "${ref}" failed: ${result.message}`,
        undefined,
        {
          reason: 'SUBAUTOMATION_FAILED',
          params: {
            automation: subName,
            version: found.version,
            childPath: result.nodeId ?? '',
          },
          at: { pointer: `${at}/automation` },
        },
      );
    }
    if (result.kind !== 'done') {
      throw new Error(
        `subautomation "${ref}" ${result.kind}: did not complete`,
      );
    }
    return result.output;
  }

  // Everything else is a connector action. It is dispatched through the
  // platform's one connector door, which owns the catalog, the input schema,
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
  const resolved = await evalTemplates(
    node.input ?? {},
    scope(),
    `${at}/input`,
  );
  if (record) trace.input = resolved;
  const reach = nodeEffect(node.type);
  await noteInput(args, resolved, {
    connector,
    action: node.type,
    ...(reach !== 'unknown' && { effect: reach }),
    ...(reach === 'write' && {
      idempotencyKey: connectorIdempotencyKey(
        run.runId,
        args.path,
        args.itemIndex,
        args.pass,
      ),
    }),
  });
  const dispatch = async (): Promise<{ output: unknown; effects: string }> => {
    const result = await run.ctx.runAction(
      internal.connectors.execute_action.runConnectorAction,
      {
        organizationId: run.organizationId,
        connector,
        action,
        input: resolved,
        mode: run.mode,
        caller: { kind: 'workflow', runId: run.runId, nodeId: node.id },
        idempotencyKey: connectorIdempotencyKey(
          run.runId,
          args.path,
          args.itemIndex,
          args.pass,
        ),
        // In-process only: the door hands it to the live host, so a call
        // still running when the server stops is cut instead of holding the
        // walker past its grace.
        signal: run.signal,
      },
    );
    if (result.status !== 'ok') {
      // A coded `ConnectorError` used to lose its code in the stepper's
      // catch; the run now says a connector, not the author's code, failed.
      throw new NodeFailure('connector_error', result.message, undefined, {
        reason: 'CONNECTOR_FAILED',
        params: { connector, action: node.type },
        at: { pointer: at },
      });
    }
    return { output: result.output, effects: result.effects };
  };

  // A live write goes through the ledger: a resumed run reuses a write that
  // finished, and one that may or may not have reached its service waits for
  // a person unless its action may safely be repeated. Reads, and every mock
  // call, change nothing outside the run and simply run again — at the top
  // level, where the outputs a node reads are checkpointed.
  if (run.mode === 'live' && nodeEffect(node.type) === 'write') {
    const effect = { node: node.id, connector: node.type, input: resolved };
    let output: unknown;
    try {
      output = await callThroughLedger(
        run.ledger,
        {
          nodeId: args.path,
          itemIndex: args.itemIndex,
          pass: args.pass,
          kind: 'connector',
          nodeType: node.type,
          input: resolved,
          recallable: nodeIdempotent(node.type),
        },
        async () => (await dispatch()).output,
        run.signal,
      );
    } catch (error) {
      // A person failed the run here because nobody could tell whether the
      // write had reached its service: the log keeps it as one that may
      // have happened.
      if (error instanceof RunStopFailure) effects.push(effect);
      throw error;
    }
    // Logged whether it ran now, ran on an earlier walk, or was skipped by a
    // person who could not tell whether it had reached its service.
    effects.push(effect);
    return output;
  }
  // Inside a subautomation every other live call goes through the ledger
  // too, as one that may simply be made again. The sub-run walks again from
  // its first node after an interruption, and its writes are addressed by
  // position: a read answered differently the second time (a record that
  // arrived in between) would line the list's items up with other items'
  // writes — reusing one item's result for another that was never sent, and
  // sending one that was. A finished read answers what the first walk acted
  // on; one nobody finished is made again.
  const result =
    run.mode === 'live' && args.depth > 0
      ? readDispatchResult(
          await callThroughLedger(
            run.ledger,
            {
              nodeId: args.path,
              itemIndex: args.itemIndex,
              pass: args.pass,
              kind: 'connector',
              nodeType: node.type,
              input: resolved,
              recallable: true,
            },
            dispatch,
            run.signal,
          ),
        )
      : await dispatch();
  if (result.effects === 'write') {
    effects.push({ node: node.id, connector: node.type, input: resolved });
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
  /** Prepended to every node id to make its path: empty at the top level,
   * `<parent>[<item>:<pass>]/` inside a subautomation. */
  pathPrefix: string;
  /** The subautomation versions a calling node fixed (`NodeCursor.pins`) and
   * the key prefix of this walk's nodes among them; none at the top level,
   * where each subautomation node fixes its own. */
  pins?: Record<string, number>;
  pinPrefix: string;
  /** The document a subautomation's nodes come from (`name@version`); none
   * at the top level. */
  docRef?: string;
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
      code: 'node_error',
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
    // livelocking it — unless its server is stopping: a turn claimed then
    // hands on before its first node, even one it would resume mid-loop (its
    // place there is saved already), and the next server walks it.
    const resuming = checkpoints.cursor?.node === node.id;
    if (
      (run.shuttingDown() || (stepped > 0 && !resuming)) &&
      sink.shouldHandOff()
    ) {
      await sink.handOff(yieldNote(run));
      return { kind: 'handed-off' };
    }
    stepped++;

    const outcome = await stepNode({
      run,
      node,
      pointer: `/nodes/${automation.nodes.indexOf(node)}`,
      rank: (id) => {
        const at = ordered.findIndex((candidate) => candidate.id === id);
        return at === -1 ? Number.MAX_SAFE_INTEGER : at;
      },
      input,
      checkpoints,
      sink,
      effects: args.effects,
      depth,
      pathPrefix: args.pathPrefix,
      pins: args.pins,
      pinPrefix: args.pinPrefix,
      ...(args.docRef !== undefined && { docRef: args.docRef }),
    });

    if (outcome.kind === 'suspended' || outcome.kind === 'cancelled') {
      return outcome;
    }
    if (outcome.kind === 'handed-off') return outcome;
    if (outcome.kind === 'failed') return outcome;
  }

  // Every node is recorded: evaluate the document's output expression. The
  // run's own output is its `__end` unit; a subautomation's is its calling
  // node's.
  const endKey: UnitKey = { path: END_PATH, item: -1, pass: -1 };
  const outermost = args.pathPrefix === '';
  if (outermost) {
    run.recorder.unitStarted(endKey, { nodeId: END_PATH, nodeType: 'output' });
  }
  try {
    const output =
      automation.output !== undefined
        ? await evalTemplates(
            cloneData(automation.output),
            makeScope(input, outputsFrom(checkpoints)),
            '/output',
          )
        : null;
    if (outermost) run.recorder.unitFinished(endKey, { status: 'ok', output });
    return { kind: 'done', output };
  } catch (error) {
    const message = `failed to evaluate automation "output": ${error instanceof Error ? error.message : String(error)}`;
    if (outermost) {
      run.recorder.unitFinished(endKey, {
        status: 'failed',
        failure: stepFailureOf(error, {
          code: 'node_error',
          message,
          pointer: '/output',
          nodeType: 'output',
        }),
      });
    }
    return { kind: 'failed', code: 'node_error', message };
  }
}

interface StepArgs {
  run: RunContext;
  node: NodeDef;
  /** The node's pointer in the document it comes from (`/nodes/3`). */
  pointer: string;
  /** Where a node sits in the walk, so a skip names the first skipped node
   * it reads from. */
  rank: (nodeId: string) => number;
  input: unknown;
  checkpoints: RunCheckpoints;
  sink: RunSink;
  effects: Effect[];
  depth: number;
  pathPrefix: string;
  pins: Record<string, number> | undefined;
  pinPrefix: string;
  /** The document a subautomation's nodes come from (`name@version`). */
  docRef?: string;
}

type StepOutcome =
  | { kind: 'recorded' }
  | { kind: 'suspended' }
  | { kind: 'handed-off' }
  | { kind: 'cancelled' }
  | {
      kind: 'failed';
      nodeId: string;
      /** The stable cause (`Run.failureCode`), read off the caught error. */
      code: RunFailureCode;
      message: string;
      hint?: string;
      trace: NodeTrace;
    };

/**
 * Advance one node as far as this turn allows: to its checkpoint, to a wait, or
 * to a hand-off. Mutates `checkpoints` so the walk's in-memory view matches
 * what the sink persisted.
 */
/**
 * The connector input a pending approval card shows: the node's input
 * resolved against the run's scope, exactly as the step will resolve it.
 * A loop body reads `item` / `index`, which exist only once the loop turns —
 * the preview then has nothing honest to show and the card carries none.
 */
/**
 * Whether a live call of a `<connector>.<action>` node could resolve its
 * credential — asked before the approval gate, so a run is never parked
 * waiting for a person to release an action that cannot run. A malformed
 * node type is left to the connector body, which names it.
 */
async function assertConnectorCredentialUsable(
  run: RunContext,
  nodeType: string,
): Promise<void> {
  const separator = nodeType.indexOf('.');
  if (separator <= 0 || separator === nodeType.length - 1) return;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the probe handler answers exactly this shape
  const probe = (await run.ctx.runQuery(
    internal.connector_credentials.queries.probeCredentialUsableInternal,
    {
      organizationId: run.organizationId,
      connectorSlug: nodeType.slice(0, separator),
    },
  )) as { usable?: boolean; message?: string; hint?: string } | null;
  // Only an explicit refusal fails the node — a seam that answers nothing
  // usable-shaped leaves the verdict to the connector body.
  if (probe !== null && typeof probe === 'object' && probe.usable === false) {
    throw new NodeFailure(
      'connector_error',
      probe.message ?? `no usable credential for ${nodeType}`,
      probe.hint,
      {
        reason: 'CONNECTOR_CREDENTIAL_MISSING',
        params: { connector: nodeType.slice(0, nodeType.indexOf('.')) },
      },
    );
  }
}

async function previewNodeInput(
  node: { input?: unknown },
  scope: Parameters<typeof evalTemplates>[1],
): Promise<unknown> {
  if (node.input === undefined) return undefined;
  try {
    return await evalTemplates(node.input, scope);
  } catch (error) {
    if (error instanceof ExprError) return undefined;
    throw error;
  }
}

/**
 * The versions a top-level `subautomation` node walks, fixed the first time
 * it runs: its own reference, and every subautomation reference inside the
 * documents it reaches, as deep as subautomations may nest. `name@v` keeps
 * `v`; a bare name takes the version deployed now. Keyed by the chain of
 * node ids without items (`batch`, `batch/inner`). A reference that names no
 * saved automation is left out — the node's body says so when it runs.
 */
async function resolveSubautomationPins(
  run: RunContext,
  node: NodeDef,
  depth: number,
): Promise<Record<string, number>> {
  const pins: Record<string, number> = {};
  const visit = async (ref: string, key: string, level: number) => {
    if (level >= MAX_SUBAUTOMATION_DEPTH) return;
    const [name, explicit] = ref.split('@');
    const found = await run.ctx.runQuery(
      internal.automations.queries.loadAutomationDocument,
      {
        organizationId: run.organizationId,
        name,
        ...(explicit !== undefined &&
          explicit !== '' && { version: Number(explicit) }),
      },
    );
    if (!found || typeof found.version !== 'number') return;
    pins[key] = found.version;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- documents are validated before they are saved
    const document = found.document as Automation;
    for (const child of document.nodes ?? []) {
      if (child.type === 'subautomation' && child.automation !== undefined) {
        await visit(child.automation, `${key}/${child.id}`, level + 1);
      }
    }
  };
  await visit(node.automation ?? '', node.id, depth);
  return pins;
}

async function stepNode(args: StepArgs): Promise<StepOutcome> {
  const { run, node, input, checkpoints, sink, depth, pointer } = args;
  const path = `${args.pathPrefix}${node.id}`;
  const nodeKey = { path, item: -1, pass: -1 };
  // Where in the node this turn is — hoisted so a park in the catch below
  // can say where to come back to.
  let index = 0;
  let passes = 0;
  let outs: unknown[] = [];
  let pins: Record<string, number> | undefined;
  // Whether `index`/`passes`/`outs` hold this node's real place yet: an
  // interruption before they do must not save a cursor that would send a
  // half-done loop back to its first item.
  let placed = false;
  const cursorHere = (): NodeCursor => ({
    node: node.id,
    index,
    passes,
    outs,
    ...(pins !== undefined && { pins }),
  });
  const outputs = outputsFrom(checkpoints);
  const skipped = skippedFrom(checkpoints);
  const whenSkipped = whenSkippedFrom(checkpoints);
  const started = performance.now();
  const trace: NodeTrace = { node: node.id, type: node.type, status: 'ok' };
  const effects: Effect[] = [];
  const rec = run.recorder;
  // Back at the node a loop or an agent turn left off: the same attempt.
  const resumingHere = checkpoints.cursor?.node === node.id;
  rec.unitStarted(nodeKey, {
    nodeId: node.id,
    nodeType: node.type,
    resuming: resumingHere,
  });
  if (args.docRef !== undefined) rec.meta(nodeKey, { docRef: args.docRef });
  // The item and pass this turn is on, while they are open: a failure ends
  // them with the node.
  let openItem: UnitKey | undefined;
  let openPass: UnitKey | undefined;
  // A long step (anything but a transform, or one that iterates) writes its
  // start on its own the first time it is entered, so a live view shows it
  // working before its first commit.
  const long =
    sink.canPark &&
    !resumingHere &&
    (node.type !== 'transform' ||
      typeof node.forEach === 'string' ||
      typeof node.repeatUntil === 'string');

  /** Record the node as finished and mirror it into the walk's own view. */
  const record = async (checkpoint: NodeCheckpoint): Promise<StepOutcome> => {
    checkpoint.trace.ms = Math.round((performance.now() - started) * 10) / 10;
    const status = await sink.commit({
      nodeId: node.id,
      checkpoint,
      executions: checkpoints.executions,
    });
    // The store bounds its persisted copy; this invocation also assembles the
    // final trace from its own checkpoints without re-reading those rows.
    checkpoints.nodes[node.id] = boundCheckpointTrace(checkpoint);
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
    const verdict = await decideNode(
      node,
      input,
      { outputs, skipped, whenSkipped, rank: args.rank },
      { key: nodeKey, pointer },
      rec,
    );
    if (verdict.kind === 'skip') {
      rec.unitFinished(nodeKey, {
        status: 'skipped',
        skip: {
          reason: verdict.reason,
          ...(verdict.via !== undefined && { via: verdict.via }),
        },
      });
      return await skip(verdict.reason, verdict.note);
    }

    // A live effectful step asks the human gate before it acts. The answer is
    // re-checked on every re-entry, so an approval granted later simply lets
    // the next turn through.
    if (run.mode === 'live' && !CORE_TYPES.has(node.type)) {
      // Fail fast on a call that cannot run at all: a connector with no
      // usable credential used to park the run on an approval card, and
      // only the approver's "yes" surfaced the missing credential
      // (2026-09-26 evaluation, D-09). The probe is the dispatcher's own
      // lookup, done ahead of it, so the failure reads the same.
      await assertConnectorCredentialUsable(run, node.type);
      // The card shows the call the step would make, not the run's input:
      // the same resolution the connector body performs, done ahead of it.
      const preview = await previewNodeInput(node, makeScope(input, outputs));
      const decision = await run.gate.check({
        organizationId: run.organizationId,
        automation: run.automation,
        runId: run.runId,
        nodeId: node.id,
        nodeType: node.type,
        canPark: sink.canPark,
        ...(preview !== undefined && { input: preview }),
      });
      if (decision.status === 'required') {
        if (!sink.canPark) {
          // No card was minted (policy-only answer): the honest failure,
          // before the write, instead of "subautomation suspended".
          throw new Error(
            `a subautomation cannot wait for approval — "${node.id}" (${node.type}) needs a person to release it; hoist the node into the calling automation or allow ${node.type} without approval in the approval policy`,
          );
        }
        rec.waitOpened(nodeKey, {
          kind: 'approval',
          since: Date.now(),
          ...(decision.approvalId !== undefined && {
            ref: decision.approvalId,
          }),
        });
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
        unit: nodeKey,
        pointer,
      });
    }

    // Where in the node this turn starts: mid-array and mid-repeat when a
    // previous turn parked here, at the beginning otherwise.
    const cursor: NodeCursor =
      checkpoints.cursor?.node === node.id
        ? { ...checkpoints.cursor, outs: [...checkpoints.cursor.outs] }
        : { node: node.id, index: 0, passes: 0, outs: [] };
    ({ index, passes, outs, pins } = cursor);
    placed = true;

    // A subautomation node fixes the versions it walks the first time it
    // runs, and records them before any of its own steps acts: a deploy
    // between two turns of this run then changes nothing it walks. Only a
    // top-level node can record them; the nodes of its inline walk read them.
    if (node.type === 'subautomation' && sink.canPark && pins === undefined) {
      pins = await resolveSubautomationPins(run, node, depth);
      const status = await sink.commit({
        cursor: cursorHere(),
        executions: checkpoints.executions,
      });
      if (status === 'cancelled') return { kind: 'cancelled' };
      checkpoints.cursor = cursorHere();
    }

    let items: unknown[] | null = null;
    if (typeof node.forEach === 'string') {
      const resolved = await resolveForEach(
        node.forEach,
        input,
        { outputs },
        { key: nodeKey, pointer },
        rec,
      );
      items = resolved;
      trace.input = { forEach: `${resolved.length} item(s)` };
    }
    const iterates = items !== null || typeof node.repeatUntil === 'string';
    if (long && iterates) await run.recordStarted([nodeKey]);

    const maxRepeats = Math.min(
      node.maxRepeats ?? DEFAULT_MAX_REPEATS,
      REPEATS_HARD_CAP,
    );
    let single: unknown;
    // Where the loop's cursor was last saved: a long loop saves it every few
    // items, so a walker that dies mid-loop leaves the items it finished
    // behind it rather than all of them.
    let savedIndex = index;
    let savedAt = Date.now();

    for (;;) {
      if (items !== null && index >= items.length) break;

      checkpoints.executions++;
      if (checkpoints.executions > DEFAULT_MAX_NODE_EXECUTIONS) {
        throw new NodeFailure(
          'execution_limit',
          `run exceeded the ${DEFAULT_MAX_NODE_EXECUTIONS}-execution guard — a forEach over a huge array or a runaway repeat; split the automation`,
          undefined,
          {
            reason: 'EXECUTION_LIMIT',
            params: { limit: DEFAULT_MAX_NODE_EXECUTIONS },
          },
        );
      }

      const extra: Record<string, unknown> =
        items === null ? {} : { item: items[index], index };
      if (items !== null && openItem === undefined) {
        openItem = { path, item: index, pass: -1 };
        // A pass after the first comes back to an item already begun.
        rec.unitStarted(openItem, {
          nodeId: node.id,
          nodeType: node.type,
          resuming: passes > 0,
        });
      }
      if (typeof node.repeatUntil === 'string') {
        openPass = { path, item: items === null ? -1 : index, pass: passes };
        rec.unitStarted(openPass, { nodeId: node.id, nodeType: node.type });
      }
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
        path,
        itemIndex: index,
        pass: passes,
        pins: pins ?? args.pins,
        pinPrefix: args.pinPrefix,
        unit: openPass ?? openItem ?? nodeKey,
        pointer,
        ...(openPass !== undefined && { mirror: openItem ?? nodeKey }),
        ...(long &&
          !iterates && { started: () => run.recordStarted([nodeKey]) }),
      });

      if (typeof node.repeatUntil === 'string') {
        passes++;
        const passKey = openPass ?? {
          path,
          item: items === null ? -1 : index,
          pass: passes - 1,
        };
        const condition = await repeatSettled(
          node,
          node.repeatUntil,
          input,
          { outputs },
          {
            key: passKey,
            pointer,
            index: passes - 1,
            max: maxRepeats,
            extra,
            output,
          },
          rec,
        );
        rec.unitFinished(passKey, { status: 'ok', output });
        openPass = undefined;
        trace.note = `repeatUntil ran ${passes}x${condition ? '' : ' (maxRepeats hit before the condition became true)'}`;
        if (!condition && passes < maxRepeats) {
          // The pass did not settle it. Park rather than spin: a poll that has
          // not finished must not hold an action open.
          if (sink.canPark) {
            rec.waitOpened(openItem ?? nodeKey, {
              kind: 'repeat',
              since: Date.now(),
            });
          }
          const waited = await sink.wait({
            detail: `repeat:${node.id}`,
            cursor: cursorHere(),
            executions: checkpoints.executions,
            resumeInMs: REPEAT_DELAY_MS,
          });
          if (waited === 'cancelled') return { kind: 'cancelled' };
          if (waited === 'suspended') {
            checkpoints.cursor = cursorHere();
            return { kind: 'suspended' };
          }
          continue;
        }
      }

      if (items === null) {
        single = output;
        break;
      }
      if (openItem !== undefined) {
        rec.unitFinished(openItem, { status: 'ok', output });
        openItem = undefined;
      }
      outs.push(output);
      index++;
      passes = 0;
      if (index >= items.length) break;
      // Between items is a safe place to stop: everything sent so far is in the
      // cursor, so the next turn continues at the item after it.
      if (sink.shouldHandOff()) {
        const status = await sink.commit({
          cursor: cursorHere(),
          executions: checkpoints.executions,
        });
        if (status === 'cancelled') return { kind: 'cancelled' };
        checkpoints.cursor = cursorHere();
        await sink.handOff(
          yieldNote(run, { nodeId: node.id, itemIndex: index }),
        );
        return { kind: 'handed-off' };
      }
      if (
        sink.canPark &&
        (index - savedIndex >= FOREACH_CURSOR_COMMIT_ITEMS ||
          Date.now() - savedAt >= FOREACH_CURSOR_COMMIT_MS)
      ) {
        const status = await sink.commit({
          cursor: cursorHere(),
          executions: checkpoints.executions,
        });
        if (status === 'cancelled') return { kind: 'cancelled' };
        checkpoints.cursor = { ...cursorHere(), outs: [...outs] };
        savedIndex = index;
        savedAt = Date.now();
      }
    }

    trace.status = 'ok';
    const output = items === null ? single : outs;
    trace.output = output;
    rec.unitFinished(nodeKey, { status: 'ok', output });
    return await record({ status: 'ok', output, trace, effects });
  } catch (error) {
    // This walker lost its run (a newer claim, or the run ended): nothing more
    // may happen, and the walk unwinds as if the run had been stopped. Inside
    // a subautomation it unwinds the calling node too.
    if (error instanceof StaleClaim) {
      if (!sink.canPark) throw error;
      return { kind: 'cancelled' };
    }
    // A write that may already have reached its service: the run waits at
    // this node, on the item and pass it was on, until a person decides. A
    // subautomation cannot park, so it hands the park to its calling node.
    if (error instanceof InDoubtPark) {
      if (!sink.canPark) throw error;
      rec.waitOpened(openPass ?? openItem ?? nodeKey, {
        kind: 'in_doubt',
        since: Date.now(),
        ref: error.attemptId,
      });
      const cursor = cursorHere();
      const waited = await sink.wait({
        detail: `in_doubt:${node.id}`,
        cursor,
        executions: checkpoints.executions,
        resumeInMs: IN_DOUBT_POLL_MS,
        event: {
          kind: 'in_doubt',
          detail: {
            path: error.address.nodeId,
            itemIndex: error.address.itemIndex,
            pass: error.address.pass,
            attemptId: error.attemptId,
          },
        },
      });
      if (waited === 'cancelled') return { kind: 'cancelled' };
      checkpoints.cursor = cursor;
      return { kind: 'suspended' };
    }
    // The step was cut because its server is stopping: it did not fail, and
    // it is not recorded as done. The run is handed on where it stands — a
    // loop at the item it was on — and the next server runs the step again;
    // the effect ledger keeps a write that may already have reached its
    // service from being repeated blindly. Inside a subautomation the
    // calling node hands the run on. A person's decision to fail the run is
    // carried out whatever the server is doing.
    if (run.signal.aborted && !(error instanceof RunStopFailure)) {
      if (!sink.canPark) throw error;
      if (
        placed &&
        (typeof node.forEach === 'string' ||
          typeof node.repeatUntil === 'string')
      ) {
        const status = await sink.commit({
          cursor: cursorHere(),
          executions: checkpoints.executions,
        });
        if (status === 'cancelled') return { kind: 'cancelled' };
        checkpoints.cursor = cursorHere();
      }
      console.warn(
        `[automations] run ${run.runId}: ${path} was interrupted (${error instanceof Error ? error.message : String(error)}) — handing the run on`,
      );
      await sink.handOff({
        reason: 'shutdown',
        nodeId: node.id,
        itemIndex: index,
        interrupted: true,
      });
      return { kind: 'handed-off' };
    }
    // A failure that knows what to do next says so in the one sentence the
    // run detail and the trace show — `message — hint`, never a JSON blob.
    const message =
      error instanceof NodeFailure && error.hint !== undefined
        ? `${error.message} — ${error.hint}`
        : error instanceof Error
          ? error.message
          : String(error);
    trace.status = 'error';
    trace.error = message;
    // A person decided the run stops here: `onError: continue` does not
    // apply, and inside a subautomation the calling node stops with it.
    if (error instanceof RunStopFailure && !sink.canPark) throw error;
    const hint = /is not defined/.test(message)
      ? 'in templates and code, only `input` and `nodes.<id>.output` are available'
      : /Cannot read propert/.test(message)
        ? 'a referenced value is null/undefined — check the exact output shape in the trace of the upstream node'
        : undefined;
    const code = runFailureCodeOf(error);
    const failure = stepFailureOf(error, {
      code,
      message,
      ...(hint !== undefined && { hint }),
      pointer,
      nodeType: node.type,
      ...(node.model !== undefined && { model: node.model }),
    });
    // The pass and the item it was on failed with it.
    for (const unit of [openPass, openItem]) {
      if (unit !== undefined) {
        rec.unitFinished(unit, { status: 'failed', failure });
      }
    }
    if (node.onError === 'continue' && !(error instanceof RunStopFailure)) {
      rec.decision(nodeKey, { kind: 'onError', policy: 'continue' });
      rec.unitFinished(nodeKey, {
        status: 'skipped',
        skip: { reason: 'error' },
        failure,
      });
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
    rec.unitFinished(nodeKey, { status: 'failed', failure });
    return {
      kind: 'failed',
      nodeId: node.id,
      message,
      // The one catch every node failure funnels through: a site that could
      // tell its cause threw a `NodeFailure`; anything else is classified the
      // way the chat surface classifies a provider failure, else the
      // author's own `node_error`.
      code,
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
  /** The node's unit of the run record, and its pointer in the document. */
  unit: UnitKey;
  pointer: string;
}

/**
 * The park detail of an agent node's turn: `room:<node>` while its start
 * waits for sandbox room and has not launched since — the run's read model
 * says so (`waitingFor: room`) instead of an agent at work — and
 * `agent:<node>` otherwise. The launch stamp turns a `room:` park into an
 * `agent:` one the moment the start launches (`stampAgentTurnLaunch`).
 */
function agentParkDetail(nodeId: string, agent: AgentCursor): string {
  return roomWaitSince(agent) !== undefined
    ? `room:${nodeId}`
    : `agent:${nodeId}`;
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
  const at = args.pointer;
  // An agent turn spans suspensions, so a sink that cannot park cannot host
  // one. Refused HERE, before the op row, the scheduled start and the real
  // sandbox turn a kick spends — the inline sink's `continue` used to reveal
  // it only after all of that.
  if (!sink.canPark) {
    throw new Error(
      'an agent node cannot run inside a subautomation — hoist it to the top level of the calling automation',
    );
  }
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
    const prompt = asPromptText(
      await evalTemplates(node.prompt ?? '', scope, `${at}/prompt`),
    );
    const system = node.system
      ? asPromptText(await evalTemplates(node.system, scope, `${at}/system`))
      : undefined;
    const files =
      node.files === undefined
        ? undefined
        : await evalTemplates(node.files, scope, `${at}/files`);
    const request: WorkflowAgentRequest = {
      model,
      ...(node.modelProvider !== undefined && {
        modelProvider: node.modelProvider,
      }),
      prompt,
      ...(system !== undefined && { system }),
      ...(node.harness !== undefined && { harness: node.harness }),
      ...(node.skills !== undefined && { skills: node.skills }),
      ...(node.connectors !== undefined && { connectors: node.connectors }),
      ...(node.tools !== undefined && { tools: node.tools }),
      ...(node.secrets !== undefined && { secrets: node.secrets }),
      ...(files !== undefined && {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- evalTemplates preserves the record shape of `files`
        files: files as Record<string, unknown>,
      }),
    };
    await noteInput({ run, unit: args.unit }, request, { model });
    await run.recordStarted([args.unit]);
    // Crash-safety guard (the mirror of the already-fixed under-run): a prior
    // kick may have created this turn's op row and scheduled its start, then
    // crashed in the kick→suspend window BEFORE the cursor was persisted —
    // leaving the run 'running' with no cursor. A liveness re-poke re-enters
    // here; kicking again would run a SECOND agent turn (double LLM spend,
    // duplicate effects) while the first is still in flight, and the first
    // turn's settle would be dropped for want of a matching cursor. So if a
    // still-running op exists for this run, ADOPT it — rebuild the cursor on
    // its exec and park — instead of kicking. The in-flight turn then settles
    // into the adopted cursor. Composes with the atomic claim (which already
    // ensures a single walker re-enters at a time).
    const liveOp = await run.ctx.runQuery(
      internal.automations.queries.loadLiveAgentOpForRun,
      { organizationId: run.organizationId, runId: run.runId },
    );
    if (liveOp !== null && liveOp !== undefined) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the query returns exactly this shape (or null)
      const op = liveOp as {
        execId: string;
        sessionId: string;
        deadlineAt: number;
        providerSlug: string;
        gatewayModel: string;
      };
      const agent: AgentCursor = {
        execId: op.execId,
        sessionId: op.sessionId,
        deadlineAt: op.deadlineAt,
        providerSlug: op.providerSlug,
        gatewayModel: op.gatewayModel,
        harness: request.harness ?? DEFAULT_HARNESS,
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
      throw new Error(
        'an agent node cannot run inside a subautomation — hoist it to the top level of the calling automation',
      );
    }
    checkpoints.executions++;
    if (checkpoints.executions > DEFAULT_MAX_NODE_EXECUTIONS) {
      throw new NodeFailure(
        'execution_limit',
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
  trace.execId = parked.execId;
  effects.push({ node: node.id, connector: 'agent', input: parked.input });

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
      detail: agentParkDetail(node.id, parked),
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
    const reason =
      settled.reason ??
      (settled.text !== ''
        ? `the agent turn failed: ${settled.text.slice(0, 300)}`
        : 'the agent turn ended without producing a reply');
    const attempt = parked.attempt ?? 0;
    // In-node auto-retry (task-lane parity): a retryable failure re-kicks the
    // SAME resolved request in place — upstream checkpoints, the run row, and
    // the session workspace all survive — under a fixed budget. An attempt
    // that executed past the progress threshold refreshes the budget instead
    // of counting toward it, and a credential rotation (the broker refreshed
    // the account under the turn) resumes for free on the same account pool,
    // so `planWorkflowAgentRetry` both gates and numbers the re-kick.
    // Exhaustion and denylisted codes fall through to the throw, which is the
    // run's durable record of how many attempts burned.
    const plan = planWorkflowAgentRetry(
      parked,
      settled.failureCode,
      Date.now(),
    );
    // A start refused for want of sandbox room ran nothing: its re-kicks
    // wait under their own wall-clock bound instead of charging the run's
    // execution guard, which a long wait would exhaust for later nodes.
    const waitingForRoom = settled.failureCode === 'sandbox_capacity';
    if (
      isWorkflowAgentRetryable(settled.failureCode) &&
      plan.retry &&
      // The runaway guard charges only executions that happen: a trip here
      // falls through to the exhaust throw carrying the settle's reason.
      (waitingForRoom || checkpoints.executions < DEFAULT_MAX_NODE_EXECUTIONS)
    ) {
      if (!waitingForRoom) checkpoints.executions++;
      // A start refused for room ran nothing: the node waits for room. Any
      // other retry is a try that ended without settling the node.
      if (waitingForRoom) {
        run.recorder.waitOpened(args.unit, {
          kind: 'room',
          since: plan.waitingForRoomSince ?? Date.now(),
        });
      } else {
        run.recorder.attempt(args.unit, {
          n: attempt + 1,
          startedAt: Date.now(),
          endedAt: Date.now(),
          outcome: 'retried',
          ...(settled.failureCode !== undefined &&
            settled.failureCode !== null && {
              failureCode: settled.failureCode,
            }),
        });
      }
      const burned = plan.burnedBrokerTokenHashes;
      // The retry CONTINUES the failed conversation when the harness left a
      // handle — the agent's reasoning and the operator's answers stand,
      // only the cut is repaired. No handle (or a session that is gone)
      // means a fresh conversation over the preserved workspace, as before.
      // A start refused while the pool cooled down resumes what it was to.
      // A harness the platform never resumes (Gemini CLI) starts fresh
      // whatever the settle left.
      const resume = workflowAgentRetryResume(settled, reason, parked, {
        resumable: harnessResumesConversations(parked.harness),
      });
      // A node waiting for sandbox room comes back when its place in the
      // spawner's line comes up, or else backs off past the refusal's hint,
      // more with each refusal in a row; any other refusal with a hint (a
      // broker pool cooling down) waits for exactly that.
      const now = Date.now();
      const notBefore = waitingForRoom
        ? sandboxRoomRetryAtMs({
            now,
            retryAfterMs:
              settled.retryAfterMs ??
              Math.max((settled.retryAtMs ?? now) - now, 0),
            refusals: plan.roomRefusals ?? 1,
            queued: settled.roomQueued === true,
          })
        : settled.retryAtMs;
      const kicked = await run.agent.kick({
        runId: run.runId,
        nodeId: node.id,
        // The reverse of the kick-time cast: the request was stored as
        // plain JSON, and the start action re-validates it anyway.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- recorded verbatim from a WorkflowAgentRequest at kick time
        request: parked.input as unknown as WorkflowAgentRequest,
        ...(burned.length > 0 ? { excludeBrokerTokenHashes: burned } : {}),
        ...(resume !== undefined ? { resume } : {}),
        // A start refused while every broker account cooled down: the
        // re-kick's start waits for the first one back instead of meeting
        // the same refusal at once and spending the budget in seconds.
        ...(notBefore !== undefined ? { notBefore } : {}),
      });
      const agent: AgentCursor = {
        execId: kicked.execId,
        sessionId: kicked.sessionId,
        deadlineAt: kicked.deadlineAt,
        providerSlug: kicked.providerSlug,
        gatewayModel: kicked.gatewayModel,
        harness: kicked.harness,
        input: parked.input,
        attempt: plan.attempt,
        ...(burned.length > 0 ? { burnedBrokerTokenHashes: burned } : {}),
        ...(plan.credentialRotations > 0
          ? { credentialRotations: plan.credentialRotations }
          : {}),
        ...(resume !== undefined
          ? {
              resumedFrom: resume.agentSessionId,
              resumeReason: resume.reason,
              ...(resume.askId !== undefined
                ? { resumeAskId: resume.askId }
                : {}),
            }
          : {}),
        ...(settled.apiErrorStatus === 429 ? { retriedRateLimit: true } : {}),
        ...(plan.waitingForRoomSince !== undefined
          ? { waitingForRoomSince: plan.waitingForRoomSince }
          : {}),
        ...(plan.roomRefusals !== undefined
          ? { roomRefusals: plan.roomRefusals }
          : {}),
      };
      const cursor: NodeCursor = {
        node: node.id,
        index: 0,
        passes: 0,
        outs: [],
        agent,
      };
      const waited = await sink.wait({
        detail: agentParkDetail(node.id, agent),
        cursor,
        executions: checkpoints.executions,
        resumeInMs: AGENT_POLL_MS,
      });
      if (waited === 'cancelled') return { kind: 'cancelled' };
      if (waited === 'suspended') {
        checkpoints.cursor = cursor;
        return { kind: 'suspended' };
      }
      throw new Error(
        'an agent node cannot run inside a subautomation — hoist it to the top level of the calling automation',
      );
    }
    // The settle's own code (`turn_crashed`, `deadline`, `budget_exceeded`,
    // …) used to be dropped here, so the run said only "the agent turn
    // failed" — it is the run's `failureCode` now.
    const agentCode = agentFailureCodeOf(settled.failureCode);
    const cause = {
      reason: 'AGENT_FAILED' as const,
      params: {
        harness: parked.harness,
        agentCode: settled.failureCode ?? agentCode,
        attempts: attempt + 1,
      },
      at: { pointer: at },
    };
    if (settled.failureCode === 'sandbox_capacity') {
      throw new NodeFailure(
        agentCode,
        `the agent turn waited ${Math.round(SANDBOX_ROOM_MAX_WAIT_MS / 60_000)} minutes for sandbox room without getting any (${reason.replace(/^the agent turn is waiting for sandbox room: /, '')})`,
        undefined,
        cause,
      );
    }
    throw new NodeFailure(
      agentCode,
      attempt > 0 ? `${reason} (after ${attempt + 1} attempts)` : reason,
      undefined,
      cause,
    );
  }
  const output = {
    text: settled.text,
    files: settled.files,
    // Deliverables the harvest dropped (caps, read/storage failures) stay
    // visible in the node output — downstream nodes and the run surface must
    // see WHAT is missing, not a shorter list that reads as complete.
    ...(settled.harvestSkipped !== undefined &&
    settled.harvestSkipped.length > 0
      ? { harvestSkipped: settled.harvestSkipped }
      : {}),
    status: settled.status ?? 'ok',
  };
  trace.status = 'ok';
  trace.output = output;
  return await record({ status: 'ok', output, trace, effects });
}

// ------------------------------------------------------------------- action

/** What a stepper turn listens to besides its run. */
export interface StepRunOptions {
  /** The job's own signal: aborted when the job is given up on. */
  signal?: AbortSignal;
  /** The process's shutdown state; {@link processShutdown} unless a test
   * brings its own. */
  shutdown?: ShutdownState;
  /** Whether this replica is being drained for a deploy (a cached read —
   * `lib/drain-probe.ts`); never, unless the worker passes its probe. */
  draining?: () => boolean;
}

/** The turns this process is stepping right now, so a stopping process can
 * wait for them to hand their runs on before it releases what is left. */
const liveTurns = new Set<Promise<unknown>>();

/**
 * Wait, at most `timeoutMs`, for every turn this process is stepping to end
 * — once shutdown has begun, each hands its run on at its next step boundary
 * or when its step is cut. Answers how many are still going.
 */
export async function settleLiveTurns(timeoutMs: number): Promise<number> {
  if (liveTurns.size === 0) return 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(liveTurns),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return liveTurns.size;
}

/**
 * Execute one turn of a run: claim it, step it until it finishes, waits, or
 * runs out of budget, and leave the row in a state the next turn can read.
 *
 * Every exit path is a status a human can act on — nothing is left `running`
 * with no continuation except an actual crash, which the recovery sweep in
 * `triggers.ts` picks back up.
 */
/** One stepper turn as a PLAIN exported function — the internalAction below
 * wraps it, and the 0.5 backend's `automation.step` job runs it on the ctx
 * shim (same pattern as `chat/turn_action.executeTurn`). */
export async function stepRunImpl(
  ctx: ActionCtx,
  args: { organizationId: string; runId: Id<'automationRuns'> },
  options: StepRunOptions = {},
): Promise<{ status: string }> {
  const turn = stepRunTurn(ctx, args, options);
  liveTurns.add(turn);
  const forget = () => {
    liveTurns.delete(turn);
  };
  void turn.then(forget, forget);
  return await turn;
}

async function stepRunTurn(
  ctx: ActionCtx,
  args: { organizationId: string; runId: Id<'automationRuns'> },
  options: StepRunOptions,
): Promise<{ status: string }> {
  // The engine's sandbox seam for untrusted JavaScript (templates, transform
  // bodies). The bundled backend is deterministic and data-only; a deployment
  // that installs a real sandbox backend keeps it.
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());

  const claim = await ctx.runMutation(internal.automations.mutations.claimRun, {
    organizationId: args.organizationId,
    runId: args.runId,
  });
  if (!claim.claimed) return { status: claim.status };
  const epoch = claim.epoch;
  // The turn's signal: its job's, joined with the cut of a stopping server.
  const shutdown = options.shutdown ?? processShutdown;
  const signal =
    options.signal === undefined
      ? shutdown.interrupt
      : AbortSignal.any([options.signal, shutdown.interrupt]);
  let cutAt: number | undefined = signal.aborted ? Date.now() : undefined;
  signal.addEventListener(
    'abort',
    () => {
      cutAt ??= Date.now();
    },
    { once: true },
  );

  // Renew the liveness promise for as long as this walker is genuinely
  // working — a node awaiting a slow local model for half an hour stays
  // alive by heartbeat, and only a walker that actually died goes silent
  // and gets its run re-poked by the sweep. A superseded walker stops
  // beating; its state writes are refused by the same epoch fence. So does
  // a walker whose turn was cut (its job given up on, or its server's step
  // grace spent) and whose body still has not settled long after: a body
  // that ignores the cut would otherwise hold the run for good, where a
  // lapsed lease lets another worker take it over.
  let beating = true;
  const heartbeat = setInterval(() => {
    if (cutAt !== undefined && Date.now() - cutAt > CUT_TURN_BEAT_MS) {
      beating = false;
      clearInterval(heartbeat);
      console.warn(
        `[automations] run ${args.runId}: its turn was cut ${CUT_TURN_BEAT_MS} ms ago and has not ended — no longer renewing its lease, so another worker can take it over`,
      );
      return;
    }
    void ctx
      .runMutation(internal.automations.mutations.heartbeatRun, {
        organizationId: args.organizationId,
        runId: args.runId,
        epoch,
      })
      .then((result) => {
        if (!result.alive && beating) {
          beating = false;
          clearInterval(heartbeat);
        }
      })
      .catch((err) => console.warn('[automations] run heartbeat failed:', err));
  }, RUN_HEARTBEAT_INTERVAL_MS);

  try {
    return await stepClaimedRun(ctx, args, epoch, options, signal);
  } finally {
    beating = false;
    clearInterval(heartbeat);
  }
}
/** The claimed turn's body — everything between a won claim and the row's
 * next durable state, extracted so the heartbeat wraps it exactly. */
async function stepClaimedRun(
  ctx: ActionCtx,
  args: { organizationId: string; runId: Id<'automationRuns'> },
  epoch: number,
  options: StepRunOptions,
  signal: AbortSignal,
): Promise<{ status: string }> {
  {
    const loaded = await ctx.runQuery(
      internal.automations.queries.loadRunForStep,
      { organizationId: args.organizationId, runId: args.runId },
    );
    if (!loaded) {
      // The automation's versions are gone (a force-delete, or a delete that
      // raced a just-started run). Without a document the run can never step,
      // so mark it terminal instead of returning 'missing' and leaving it
      // 'running' — otherwise the liveness sweep re-claims it every ~3min
      // forever and its sandbox session is never freed. Epoch-fenced like
      // every other terminal write; the delete guard makes this the rare
      // race, not the norm.
      console.error(
        `[automations] run ${args.runId} has no document to execute — failing it terminally`,
      );
      const failed = await ctx.runMutation(
        internal.automations.mutations.finishRun,
        {
          organizationId: args.organizationId,
          runId: args.runId,
          epoch,
          status: 'failed',
          failureCode: 'automation_deleted',
          trace: [],
          effects: [],
          detail: 'the automation was deleted while this run was in flight',
          executions: 0,
        },
      );
      return { status: failed.status };
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- documents are validated before they are saved
    const automation = loaded.document as Automation;
    // Progress this engine cannot read fails the run: reading it as "nothing
    // done yet" would start the run over and repeat every step it finished,
    // writes included.
    const parsed = parseRunCheckpoints(loaded.run.checkpoints);
    if (!parsed.ok) {
      console.error(
        `[automations] run ${args.runId} has saved progress this engine cannot read (${parsed.reason}) — failing it instead of starting over`,
      );
      const failed = await ctx.runMutation(
        internal.automations.mutations.finishRun,
        {
          organizationId: args.organizationId,
          runId: args.runId,
          epoch,
          status: 'failed',
          failureCode: 'engine_incompatible',
          trace: [],
          effects: [],
          detail: `this run's saved progress could not be read by this version of Tale (${parsed.reason}); it was stopped instead of starting over, so no step ran twice`,
          executions: 0,
        },
      );
      return { status: failed.status };
    }
    const checkpoints = parsed.checkpoints;
    const shutdown = options.shutdown ?? processShutdown;
    const draining = options.draining ?? (() => false);
    // The run's record: what earlier turns left open, and what the run may
    // still store.
    const recorder = createRecorder({
      now: () => Date.now(),
      budget: recordBudget(loaded.recordBytes ?? 0),
      open: loaded.openNodeRuns ?? [],
    });
    const run: RunContext = {
      ctx,
      organizationId: args.organizationId,
      runId: args.runId,
      automation: loaded.run.name,
      mode: loaded.run.mode,
      deadline: Date.now() + stepBudgetMs(),
      // Built fresh every turn: each door closes over this invocation's ctx
      // and the run's own organization, and travels with this run alone —
      // a worker stepping two organizations' runs at once never lets one
      // run's turn replace the other's gate. Each llm call is the run's
      // spend.
      llm: automationLlmCall(ctx, args.organizationId, args.runId, { signal }),
      agent: (agentHostFactory ?? automationAgentHost)(
        ctx,
        args.organizationId,
      ),
      gate:
        approvalGateOverride ??
        automationApprovalGate(ctx, args.organizationId),
      ledger:
        loaded.run.mode === 'live'
          ? durableLedger(ctx, {
              organizationId: args.organizationId,
              runId: args.runId,
              epoch,
            })
          : passThroughLedger,
      signal,
      yielding: () => shutdown.shuttingDown || draining(),
      shuttingDown: () => shutdown.shuttingDown,
      recorder,
      recordStarted: async (keys) => {
        const rows = recorder.drain(keys);
        if (rows.length === 0) return;
        // The record is display state: a start that could not be written
        // shows with the step's next commit, and never fails the step.
        try {
          await ctx.runMutation(
            internal.automations.mutations.recordNodeRunsStarted,
            {
              organizationId: args.organizationId,
              runId: args.runId,
              epoch,
              rows,
            },
          );
        } catch (error) {
          console.warn(
            `[automations] run ${args.runId}: the start of ${keys.map((key) => key.path).join(', ')} was not recorded (${error instanceof Error ? error.message : String(error)})`,
          );
          recorder.restore(rows);
        }
      },
    };

    const sink = durableSink(
      ctx,
      args.organizationId,
      args.runId,
      run.deadline,
      epoch,
      run.yielding,
      recorder,
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
      pathPrefix: '',
      pinPrefix: '',
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
    // The failing node never passed through a checkpoint commit (a hard
    // failure is not a checkpoint), so its entry is bounded here — the one
    // place it first enters storage; the checkpoint traces were bounded by
    // `recordProgress` and are NOT re-bounded (the bound is not idempotent).
    const failedTrace =
      result.kind === 'failed' && result.trace
        ? boundNodeTrace(result.trace)
        : undefined;
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
        epoch,
        status: result.kind === 'done' ? 'success' : 'failed',
        ...(result.kind === 'done' && { output: result.output }),
        trace,
        effects,
        ...(result.kind === 'failed' && {
          detail: result.nodeId
            ? `${result.nodeId}: ${result.message}`
            : result.message,
          failureCode: result.code,
        }),
        executions: checkpoints.executions,
        nodeRuns: recorder.drain(),
      },
    );
    return { status: finished.status };
  }
}

/** The statuses a fenced progress write answers while the walker still holds
 * a live run. */
const LIVE_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'waiting',
]);

/** The sink that makes a run durable: every commit is a row write, every wait
 * schedules the turn that resumes it. Every write carries the walker's claim
 * epoch — a superseded walker's commit reads back 'stale' and unwinds as if
 * cancelled, so duplicate wakes can never double-drive one run. */
function durableSink(
  ctx: ActionCtx,
  organizationId: string,
  runId: Id<'automationRuns'>,
  deadline: number,
  epoch: number,
  yielding: () => boolean,
  recorder: RunRecorder,
): RunSink {
  // The record's rows ride every write that commits progress: what a write
  // does not commit is not recorded either.
  const nodeRuns = (): { nodeRuns?: NodeRunWrite[] } => {
    const rows = recorder.drain();
    return rows.length > 0 ? { nodeRuns: rows } : {};
  };
  return {
    async commit(args) {
      const result = await ctx.runMutation(
        internal.automations.mutations.recordProgress,
        {
          organizationId,
          runId,
          epoch,
          ...(args.nodeId !== undefined && { nodeId: args.nodeId }),
          ...(args.checkpoint !== undefined && {
            checkpoint: args.checkpoint,
          }),
          ...(args.cursor !== undefined && { cursor: args.cursor }),
          executions: args.executions,
          ...nodeRuns(),
        },
      );
      // Only a live run keeps walking: a stop, a finish another walker
      // recorded, a newer claim or a run that is gone all end this walk.
      return LIVE_STATUSES.has(result.status) ? 'running' : 'cancelled';
    },
    async wait(args) {
      const result = await ctx.runMutation(
        internal.automations.mutations.suspendRun,
        {
          organizationId,
          runId,
          epoch,
          detail: args.detail,
          ...(args.cursor !== undefined && { cursor: args.cursor }),
          executions: args.executions,
          resumeInMs: args.resumeInMs,
          ...(args.event !== undefined && { event: args.event }),
          ...nodeRuns(),
        },
      );
      return result.suspended ? 'suspended' : 'cancelled';
    },
    shouldHandOff() {
      return Date.now() >= deadline || yielding();
    },
    canPark: true,
    async handOff(note) {
      await ctx.runMutation(internal.automations.mutations.continueRun, {
        organizationId,
        runId,
        epoch,
        resumeInMs: 0,
        ...(note !== undefined && { handoff: note }),
        ...nodeRuns(),
      });
    },
  };
}
