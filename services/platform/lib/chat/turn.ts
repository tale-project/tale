/**
 * The turn pipeline — one conversation turn, in a fixed order of named steps:
 *
 *   input guardrails → resolve agent + execution → assemble context → stream
 *   → output guardrails → usage ledger → done
 *
 * Each step is its own function and each records itself in the result, so the
 * sequence is readable here and observable from a test rather than inferred
 * from a call graph. A refusal at any step short-circuits: the steps after it
 * do not run, and the result says which step refused and why.
 *
 * Everything the turn touches from the outside is injected — the model call,
 * the store, the usage ledger, the clock — so the pipeline runs end to end in
 * a unit test with no Convex, no network, and no provider. What is left is the
 * ORDER, which is the part worth protecting: guardrails before the model sees
 * anything, context assembled from one contract, output filtered before it
 * reaches a client, usage recorded whether or not the answer was good.
 *
 * The model is ALWAYS explicit. There is no auto-selection, no routing, and no
 * tiering: the caller names a model and a credential, and
 * {@link resolveExecution} decides only HOW that pair may run — a credential
 * whose auth method binds it to a vendor's own tooling forces sandbox mode
 * with that harness, and refuses anything else.
 */

import {
  resolveExecution,
  type CredentialAuth,
  type ExecutionMode,
  type ExecutionResolution,
  type HarnessTable,
} from '../shared/providers/resolve_execution';
import type { ModelCatalogEntry } from '../shared/schemas/providers';
import { assembleContext, type AssembledContext } from './context';
import type { AgentInstructions, ContextBudget, ToolDoc } from './context';
import {
  createOutputTransform,
  runGuardrailChain,
  type GuardrailChainOptions,
  type GuardrailFilter,
  type GuardrailRefusal,
} from './guardrails';
import { estimateTokens, type ChatMessage, type TurnUsage } from './types';

/** The pipeline, in order. A step is recorded when it runs, so the result
 * carries the actual sequence. */
export const TURN_STEPS = [
  'input-guardrails',
  'resolve-execution',
  'assemble-context',
  'stream',
  'output-guardrails',
  'usage-ledger',
  'done',
] as const;

export type TurnStep = (typeof TURN_STEPS)[number];

// ------------------------------------------------------------------- ports

/** One chunk of model output. A provider that reports real token counts
 * attaches them (usually on its last chunk); the pipeline prefers those over
 * its own estimate, so the ledger records what was actually billed. */
export interface ModelStreamChunk {
  readonly text: string;
  readonly usage?: TurnUsage;
}

export interface ModelCallRequest {
  readonly organizationId: string;
  readonly model: string;
  readonly providerSlug: string;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  /** How the turn runs — direct API call, or the harness in a sandbox. */
  readonly execution: ExecutionResolution;
  readonly signal?: AbortSignal;
}

/** The model seam. Injected so the pipeline is testable without a provider,
 * and so the sandbox path is the same call with a different execution. */
export type ModelCall = (
  request: ModelCallRequest,
) => AsyncIterable<ModelStreamChunk>;

/**
 * The thread store, as the pipeline needs it. Mirrors the chat tables: a
 * generation row exists exactly while a turn is in flight, and its heartbeat
 * is what distinguishes a live stream from a crashed one.
 */
export interface TurnStore {
  appendMessage(message: {
    organizationId: string;
    threadId: string;
    role: ChatMessage['role'];
    parts: ChatMessage['parts'];
    model?: string;
    providerSlug?: string;
    usage?: TurnUsage;
    blockedReason?: string;
  }): Promise<{ id: string; sequence: number }>;
  beginGeneration(generation: {
    organizationId: string;
    threadId: string;
    streamId: string;
  }): Promise<void>;
  heartbeat(generation: {
    organizationId: string;
    threadId: string;
  }): Promise<void>;
  /** Deletes the row: its absence is what tells every reader the turn
   * settled. Runs whether the turn succeeded, refused, or threw. */
  endGeneration(generation: {
    organizationId: string;
    threadId: string;
  }): Promise<void>;
}

export interface UsageLedgerEntry {
  readonly organizationId: string;
  readonly userId: string;
  readonly agentSlug?: string;
  readonly model: string;
  readonly provider: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface UsageLedger {
  record(entry: UsageLedgerEntry): Promise<void>;
}

/** The agent the turn talks to, already loaded and validated by the host. */
export interface ResolvedAgent extends AgentInstructions {
  readonly slug: string;
}

// ---------------------------------------------------------------- requests

export interface TurnRequest {
  readonly organizationId: string;
  readonly userId: string;
  readonly threadId: string;
  readonly streamId: string;
  /** What the user just sent. */
  readonly userText: string;
  /** The conversation so far, oldest first, excluding `userText`. */
  readonly history: readonly ChatMessage[];
  readonly locale: string;
  readonly agent?: ResolvedAgent;
  /** A sub-agent turn skips the org's mandatory instructions — the turn that
   * spawned it already applied them. */
  readonly isSubAgentTurn?: boolean;
  readonly mandatoryInstructions?: string;
  readonly toolDocs?: readonly ToolDoc[];
  /** The explicitly chosen model. Never inferred. */
  readonly model: ModelCatalogEntry;
  readonly credential: CredentialAuth;
  readonly executionMode: ExecutionMode;
  /** Requested harness for sandbox mode; a subscription credential brings its
   * own and refuses any other. */
  readonly harness?: string;
  readonly budget?: ContextBudget;
  readonly signal?: AbortSignal;
}

export interface TurnDeps {
  readonly harnesses: HarnessTable;
  readonly inputFilters?: readonly GuardrailFilter[];
  readonly outputFilters?: readonly GuardrailFilter[];
  readonly guardrailOptions?: GuardrailChainOptions;
  readonly model: ModelCall;
  readonly store: TurnStore;
  readonly usage: UsageLedger;
  readonly now?: () => Date;
  /** Called with every cleared chunk — how a host forwards the stream. */
  readonly onChunk?: (text: string) => void;
}

export type TurnOutcome =
  | {
      readonly status: 'completed';
      readonly steps: readonly TurnStep[];
      readonly text: string;
      readonly usage: TurnUsage;
      readonly context: AssembledContext;
      readonly execution: ExecutionResolution;
    }
  | {
      readonly status: 'refused';
      readonly steps: readonly TurnStep[];
      /** Where it stopped. */
      readonly step: TurnStep;
      readonly reason: string;
      readonly refusal?: GuardrailRefusal;
    };

// -------------------------------------------------------------------- steps

/**
 * Step 1. Everything the user sent passes the fixed chain before the model or
 * any tool sees it; the chain may rewrite the text (a PII mask), and a refusal
 * ends the turn here.
 */
export async function runInputGuardrails(
  text: string,
  deps: TurnDeps,
): Promise<{ text: string; refusal?: GuardrailRefusal }> {
  const result = await runGuardrailChain(
    text,
    'input',
    deps.inputFilters ?? [],
    deps.guardrailOptions,
  );
  return { text: result.text, refusal: result.refusal };
}

/**
 * Step 2. The agent is already resolved by the host (it owns config loading);
 * what this step decides is EXECUTION — whether the chosen (model, credential)
 * pair runs directly or in a sandbox harness, per the one case split every
 * caller shares.
 */
export function resolveAgentAndExecution(
  request: TurnRequest,
  deps: TurnDeps,
): { agent?: ResolvedAgent; execution: ExecutionResolution } {
  const execution = resolveExecution(
    {
      model: request.model,
      credential: request.credential,
      mode: request.executionMode,
      harness: request.harness,
    },
    deps.harnesses,
  );
  return { agent: request.agent, execution };
}

/**
 * Step 3. One contract, one order — see `context.ts`. The user's (already
 * filtered) message is appended to the history as the newest turn.
 */
export function assembleTurnContext(
  request: TurnRequest,
  filteredUserText: string,
  now: Date,
): AssembledContext {
  const history: ChatMessage[] = [
    ...request.history,
    { role: 'user', parts: [{ type: 'text', text: filteredUserText }] },
  ];
  return assembleContext({
    organizationId: request.organizationId,
    mandatoryInstructions: request.mandatoryInstructions,
    isSubAgentTurn: request.isSubAgentTurn,
    agent: request.agent,
    locale: request.locale,
    toolDocs: request.toolDocs,
    now,
    history,
    budget: request.budget ?? {
      maxTokens: request.model.contextWindow,
      reserveOutputTokens: request.model.maxOutputTokens,
    },
  });
}

/**
 * Steps 4 and 5. The stream and the output guardrails interleave by design:
 * each buffered segment is filtered BEFORE it is handed to the client, because
 * text already on the wire cannot be taken back. The stream step pulls chunks;
 * the output-guardrails step settles the final segment and the verdict.
 */
export async function streamWithOutputGuardrails(
  request: TurnRequest,
  context: AssembledContext,
  execution: ExecutionResolution,
  deps: TurnDeps,
): Promise<{
  text: string;
  refusal?: GuardrailRefusal;
  reportedUsage?: TurnUsage;
}> {
  const transform = createOutputTransform(deps.outputFilters ?? [], {
    ...deps.guardrailOptions,
  });
  let cleared = '';
  let reportedUsage: TurnUsage | undefined;

  const emit = (chunk: {
    text: string;
    refusal?: GuardrailRefusal;
  }): boolean => {
    if (chunk.text.length > 0) {
      cleared += chunk.text;
      deps.onChunk?.(chunk.text);
    }
    return chunk.refusal === undefined;
  };

  for await (const chunk of deps.model({
    organizationId: request.organizationId,
    model: request.model.id,
    providerSlug: request.model.provider,
    system: context.system,
    messages: context.messages,
    execution,
    signal: request.signal,
  })) {
    if (chunk.usage) reportedUsage = chunk.usage;
    const checked = await transform.push(chunk.text);
    if (!emit(checked)) {
      return { text: cleared, refusal: checked.refusal, reportedUsage };
    }
    await deps.store.heartbeat({
      organizationId: request.organizationId,
      threadId: request.threadId,
    });
  }

  const tail = await transform.flush();
  if (!emit(tail)) {
    return { text: cleared, refusal: tail.refusal, reportedUsage };
  }
  return { text: cleared, reportedUsage };
}

/**
 * Step 6. Usage is recorded for every turn that reached the model, refused
 * output included: the tokens were spent either way, and a ledger that only
 * counts good answers under-reports what the org is paying for.
 */
export async function recordUsage(
  request: TurnRequest,
  usage: TurnUsage,
  deps: TurnDeps,
): Promise<void> {
  await deps.usage.record({
    organizationId: request.organizationId,
    userId: request.userId,
    agentSlug: request.agent?.slug,
    model: request.model.id,
    provider: request.model.provider,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  });
}

// ----------------------------------------------------------------- the turn

function refusalReason(refusal: GuardrailRefusal): string {
  if (refusal.stepError) {
    return `The ${refusal.filterName} guardrail failed (${refusal.stepError}) and the policy is to refuse rather than let the message through.`;
  }
  const categories =
    refusal.categoryIds.length > 0
      ? ` (${refusal.categoryIds.join(', ')})`
      : '';
  return `Blocked by the ${refusal.filterName} guardrail${categories}.`;
}

/**
 * Run one turn. The generation row is created before the model call and
 * removed in a `finally`, so a thread can never be left looking like it is
 * still generating because a turn threw.
 */
export async function runTurn(
  request: TurnRequest,
  deps: TurnDeps,
): Promise<TurnOutcome> {
  const now = deps.now ?? (() => new Date());
  const steps: TurnStep[] = [];

  const refuse = async (
    step: TurnStep,
    reason: string,
    refusal?: GuardrailRefusal,
  ): Promise<TurnOutcome> => {
    await deps.store.appendMessage({
      organizationId: request.organizationId,
      threadId: request.threadId,
      role: 'assistant',
      parts: [],
      blockedReason: reason,
    });
    return { status: 'refused', steps, step, reason, refusal };
  };

  steps.push('input-guardrails');
  const input = await runInputGuardrails(request.userText, deps);
  if (input.refusal) {
    return refuse(
      'input-guardrails',
      refusalReason(input.refusal),
      input.refusal,
    );
  }

  steps.push('resolve-execution');
  const { execution } = resolveAgentAndExecution(request, deps);
  if (execution.mode === 'refused') {
    return refuse('resolve-execution', execution.reason);
  }

  steps.push('assemble-context');
  const context = assembleTurnContext(request, input.text, now());

  await deps.store.appendMessage({
    organizationId: request.organizationId,
    threadId: request.threadId,
    role: 'user',
    parts: [{ type: 'text', text: input.text }],
  });
  await deps.store.beginGeneration({
    organizationId: request.organizationId,
    threadId: request.threadId,
    streamId: request.streamId,
  });

  try {
    steps.push('stream');
    const streamed = await streamWithOutputGuardrails(
      request,
      context,
      execution,
      deps,
    );

    steps.push('output-guardrails');
    // What the provider reported beats what we estimated: the ledger should
    // carry what was actually billed, and the estimate exists only for
    // providers that report nothing.
    const outputTokens = estimateTokens(streamed.text);
    const usage: TurnUsage = streamed.reportedUsage ?? {
      inputTokens: context.estimatedTokens,
      outputTokens,
      totalTokens: context.estimatedTokens + outputTokens,
    };

    if (streamed.refusal) {
      const reason = refusalReason(streamed.refusal);
      steps.push('usage-ledger');
      await recordUsage(request, usage, deps);
      await deps.store.appendMessage({
        organizationId: request.organizationId,
        threadId: request.threadId,
        role: 'assistant',
        parts: streamed.text ? [{ type: 'text', text: streamed.text }] : [],
        model: request.model.id,
        providerSlug: request.model.provider,
        usage,
        blockedReason: reason,
      });
      return {
        status: 'refused',
        steps,
        step: 'output-guardrails',
        reason,
        refusal: streamed.refusal,
      };
    }

    steps.push('usage-ledger');
    await recordUsage(request, usage, deps);
    await deps.store.appendMessage({
      organizationId: request.organizationId,
      threadId: request.threadId,
      role: 'assistant',
      parts: [{ type: 'text', text: streamed.text }],
      model: request.model.id,
      providerSlug: request.model.provider,
      usage,
    });

    steps.push('done');
    return {
      status: 'completed',
      steps,
      text: streamed.text,
      usage,
      context,
      execution,
    };
  } finally {
    await deps.store.endGeneration({
      organizationId: request.organizationId,
      threadId: request.threadId,
    });
  }
}
