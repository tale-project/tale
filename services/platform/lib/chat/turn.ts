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
 * The model is ALWAYS concrete inside this pipeline. There is no routing, no
 * tiering, and no failover here: the caller hands a resolved catalog entry
 * and a credential, and {@link resolveExecution} decides only HOW that pair
 * may run — a credential whose auth method binds it to a vendor's own
 * tooling forces sandbox mode with that harness, and refuses anything else.
 * The chat lane's opt-in Auto is a step BEFORE this pipeline
 * (`convex/lib/providers/resolve_chat_model.ts`): it resolves to a concrete
 * pair or refuses; it never reaches in.
 */

import { classifyChatErrorCode, encodeChatError } from '../shared/chat-errors';
import {
  resolveExecution,
  type CredentialAuth,
  type ExecutionMode,
  type ExecutionResolution,
  type HarnessTable,
} from '../shared/providers/resolve_execution';
import type { ModelCatalogEntry } from '../shared/schemas/providers';
import {
  assembleContext,
  type AssembledContext,
  type ProjectContext,
} from './context';
import type { AgentInstructions, ContextBudget, ToolDoc } from './context';
import {
  fitSamplingToWindow,
  resolveTurnSampling,
  type ReasoningEffort,
  type TurnSampling,
} from './effort';
import {
  createOutputTransform,
  runGuardrailChain,
  type GuardrailChainOptions,
  type GuardrailFilter,
  type GuardrailRefusal,
} from './guardrails';
import {
  isAwaitingAnswerResult,
  isPausingChatTool,
  type ChatToolExecutor,
  type ToolCallRequest,
  type WireTool,
} from './tools';
import {
  estimateMessageTokens,
  estimateTokens,
  type ChatMessage,
  type MessagePart,
  type TurnUsage,
} from './types';

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

/**
 * How many rounds of a turn may end in tool calls before the loop stops
 * offering tools and the model must answer. An execution ceiling is a
 * property of THIS host, never a persona setting (the agent schema rejects
 * `max-steps` for exactly that reason). Three retrieval tools need a
 * search, a fetch or two — a round executes its calls in parallel, so
 * breadth is free — and an answer; four rounds is headroom for one
 * follow-up, not a target. A turn that hits the cap is stamped
 * `stepLimitHit` for the UI's notice.
 */
export const MAX_TOOL_ROUNDS = 4;

/**
 * Wire-only budget notices, appended as a trailing user turn on the round
 * they describe (user role for the same reason as the context truncation
 * notice: the Anthropic wire hoists system-role messages out of position).
 * Neither is ever persisted — they steer the model, they are not transcript.
 *
 * Without the SPENT notice the withheld tools are invisible: a model
 * mid-plan announces its next lookup and stops instead of answering. The
 * LAST notice spends the final round wide — a round's calls execute in
 * parallel, but an unprompted model issues one call per round. Both open
 * the exit that `rag_fetch`'s keep-fetching steer otherwise holds shut:
 * say what was actually read, offer to continue.
 */
export const LAST_TOOL_ROUND_NOTICE =
  '[Last lookup round for this reply: issue every remaining search or ' +
  'fetch now, as parallel tool calls in this one response — after their ' +
  'results you must answer.]';

export const TOOL_BUDGET_SPENT_NOTICE =
  '[The lookup budget for this reply is spent; no further tool calls will ' +
  'run. Answer now from what you have gathered. If you could not read ' +
  'everything, say exactly which parts you did read and offer to continue ' +
  'in a follow-up reply — do not announce further lookups.]';

// ------------------------------------------------------------------- ports

/** One chunk of model output. A provider that reports real token counts
 * attaches them (usually on its last chunk); the pipeline prefers those over
 * its own estimate, so the ledger records what was actually billed. */
export interface ModelStreamChunk {
  readonly text: string;
  /** A reasoning ("thinking") delta, when the turn requested reasoning. */
  readonly reasoning?: string;
  readonly usage?: TurnUsage;
  /** The tool calls the model ended this response with, decoded and parsed
   * by the host. Yielded at most once, at the end of the stream — a chunk
   * carrying these carries no new text. */
  readonly toolCalls?: readonly ToolCallRequest[];
}

export interface ModelCallRequest {
  readonly organizationId: string;
  readonly model: string;
  readonly providerSlug: string;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  /** The tool definitions to put on the wire. Absent means the model is not
   * offered tools for this call — the loop's final round withholds them so
   * the model must answer. */
  readonly tools?: readonly WireTool[];
  /** How the turn runs — direct API call, or the harness in a sandbox. */
  readonly execution: ExecutionResolution;
  /** The turn's resolved sampling — maxTokens, temperature (absent while
   * thinking is enabled), and the reasoning control, per
   * {@link resolveTurnSampling}. */
  readonly sampling: TurnSampling;
  /** The model can SEE images (catalog `vision` tag): the host inlines image
   * attachments as content blocks. Without it they read as text surfaces. */
  readonly vision?: boolean;
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
    /** A hard failure (provider error, stream timeout) — distinct from a
     * guardrail block; rendered as an error and counted as one. */
    error?: string;
    /** Older history was dropped assembling this turn's context — recorded
     * silently on the reply row for telemetry; never rendered. */
    truncation?: { droppedMessages: number };
  }): Promise<{ id: string; sequence: number }>;
  /** Persist streaming progress: the full cleared text (and reasoning) so
   * far, which doubles as the turn's proof of life. Called once per cleared
   * chunk; the store throttles its writes and the finalize call carries the
   * authoritative text, so a skipped or failed write can never lose the
   * tail. */
  streamProgress(update: {
    organizationId: string;
    threadId: string;
    messageId?: string;
    text: string;
    reasoning?: string;
    /** Bypass the store's write throttle — the first non-empty persist, the
     * flush after transform.flush(), and the tail RESET at a tool-round
     * boundary, which must land before the round's text lands on the parts. */
    flush?: boolean;
  }): Promise<void | { cancelRequested?: boolean }>;
  /**
   * Persist the turn's settled parts so far — the text segments, tool calls,
   * and tool results earlier rounds produced. Called once per settled part
   * batch (a few times a turn, never per chunk), with the AUTHORITATIVE
   * parts-so-far, so a repeated write is idempotent and a crash keeps
   * everything already settled.
   */
  updateAssistantParts(update: {
    organizationId: string;
    threadId: string;
    messageId: string;
    parts: readonly MessagePart[];
  }): Promise<void>;
  /** Settle the placeholder assistant message the turn streamed into. An
   * absent `text` keeps whatever the throttled streaming writes persisted —
   * the shape a mid-stream failure wants. */
  finalizeAssistantMessage(message: {
    organizationId: string;
    threadId: string;
    messageId: string;
    text?: string;
    /** The model's reasoning, settled as a display-only part. */
    reasoning?: string;
    /** The COMPLETE ordered parts of the settled message — text segments,
     * tool calls, and tool results included. When present it is authoritative
     * and `text`/`reasoning` are display metadata only. */
    parts?: readonly MessagePart[];
    model?: string;
    providerSlug?: string;
    usage?: TurnUsage;
    blockedReason?: string;
    error?: string;
  }): Promise<void>;
  /**
   * Open the turn in ONE transaction: append the user's message, create the
   * assistant placeholder the turn streams into, and begin the generation
   * row. A single store round-trip where three ran before — every round-trip
   * from the action host is an authenticated syscall, and the setup wait the
   * message-info panel reports is their sum. Atomic, so a failure can never
   * strand a user message whose reply will not arrive, or a placeholder with
   * no generation row.
   */
  beginTurn(setup: {
    organizationId: string;
    threadId: string;
    /** The user turn's parts. Absent on a regenerate — the trailing user
     * row already exists and the turn only re-answers it. */
    userParts?: ChatMessage['parts'];
    /** Older history was dropped assembling this turn's context — recorded
     * silently on the reply row for telemetry; never rendered. */
    truncation?: { droppedMessages: number };
  }): Promise<{
    userMessage?: { id: string; sequence: number };
    /** The placeholder the turn streams into. */
    assistantMessage: { id: string; sequence: number };
  }>;
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

/** One file riding the user's message — already uploaded and org-verified by
 * the host; the pipeline persists it as an attachment part and the wire
 * inlines it for a vision model. */
export interface TurnAttachment {
  /** Blob reference: a Convex `_storage` id or an `s3:` ref. */
  readonly fileId: string;
  readonly fileName: string;
  readonly fileType: string;
  readonly fileSize: number;
}

export interface TurnRequest {
  readonly organizationId: string;
  readonly userId: string;
  readonly threadId: string;
  /** What the user just sent. */
  readonly userText: string;
  /** Files riding the user's message, oldest gesture first. The HOST owns
   * validating them (org ownership, count, type) before the turn starts. */
  readonly attachments?: readonly TurnAttachment[];
  /** The conversation so far, oldest first, excluding `userText`. */
  readonly history: readonly ChatMessage[];
  readonly locale: string;
  readonly agent?: ResolvedAgent;
  /** A sub-agent turn skips the org's mandatory instructions — the turn that
   * spawned it already applied them. */
  readonly isSubAgentTurn?: boolean;
  readonly mandatoryInstructions?: string;
  readonly toolDocs?: readonly ToolDoc[];
  /** The project a project-bound thread belongs to — named in the prompt, not
   * used to narrow retrieval. Absent for an unbound thread. */
  readonly project?: ProjectContext;
  /** The explicitly chosen model. Never inferred. */
  readonly model: ModelCatalogEntry;
  /** The user's reasoning-effort pick for this turn. Absent — and any pick on
   * a model with no reasoning capability — samples the default. */
  readonly reasoningEffort?: ReasoningEffort;
  readonly credential: CredentialAuth;
  readonly executionMode: ExecutionMode;
  /**
   * False when the user message ALREADY sits at the end of the thread — a
   * regenerate re-runs it rather than appending it twice. The guardrails
   * still run on `userText` (policy applies to re-runs too); only the
   * persistence of the user turn is skipped.
   */
  readonly appendUserMessage?: boolean;
  /**
   * Audio/video transcript appendix for the MODEL-facing newest user turn.
   * Appended after the (filtered) typed text in context assembly only — the
   * stored bubble keeps `userText` so the optimistic send can adopt by exact
   * text and the reader sees what they typed.
   */
  readonly audioTranscriptAppendix?: string;
  /**
   * Document retrieval appendix for the MODEL-facing newest user turn:
   * names each attached document and the knowledge-tool ref that reads it.
   * Same contract as `audioTranscriptAppendix` — context assembly only,
   * never stored.
   */
  readonly documentAppendix?: string;
  /** Requested harness for sandbox mode; a subscription credential brings its
   * own and refuses any other. */
  readonly harness?: string;
  readonly budget?: ContextBudget;
  /** Turns the bounded history read already omitted — folded into the
   * truncation notice. */
  readonly historyOmittedCount?: number;
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
  /** The tool executor, when this lane equips tools. Absent runs the turn
   * as a plain single-shot answer. */
  readonly tools?: ChatToolExecutor;
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
      /**
       * The turn ended on a question rather than on an answer. The reply is
       * settled and the generation row is gone either way — what differs is
       * that a pending question is now outstanding, and the next turn will be
       * started by the person answering it rather than by them typing.
       */
      readonly paused?: boolean;
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
/** The newest user turn's parts: the (filtered) text plus one attachment
 * part per file. Images share this derivation between the stored bubble and
 * the model wire; audio/video transcripts ride `audioTranscriptAppendix` on
 * the model-facing turn only. */
export function userTurnParts(
  filteredUserText: string,
  attachments: readonly TurnAttachment[] | undefined,
): MessagePart[] {
  return [
    { type: 'text', text: filteredUserText },
    ...(attachments ?? []).map((attachment): MessagePart => ({
      type: 'attachment',
      name: attachment.fileName,
      mediaType: attachment.fileType,
      fileId: attachment.fileId,
      sizeBytes: attachment.fileSize,
    })),
  ];
}

export function assembleTurnContext(
  request: TurnRequest,
  filteredUserText: string,
  now: Date,
): AssembledContext {
  const appendix =
    (request.audioTranscriptAppendix ?? '') + (request.documentAppendix ?? '');
  const modelFacingText =
    appendix.length > 0 ? filteredUserText + appendix : filteredUserText;
  const history: ChatMessage[] = [
    ...request.history,
    {
      role: 'user',
      parts: userTurnParts(modelFacingText, request.attachments),
    },
  ];
  return assembleContext({
    organizationId: request.organizationId,
    mandatoryInstructions: request.mandatoryInstructions,
    isSubAgentTurn: request.isSubAgentTurn,
    agent: request.agent,
    locale: request.locale,
    toolDocs: request.toolDocs,
    ...(request.project !== undefined ? { project: request.project } : {}),
    now,
    history,
    ...(request.historyOmittedCount !== undefined
      ? { historyOmittedCount: request.historyOmittedCount }
      : {}),
    budget: request.budget ?? {
      maxTokens: request.model.contextWindow,
      // The reserve mirrors what the wire will actually request, so budget
      // and reality can never disagree.
      reserveOutputTokens: fitSamplingToWindow(
        resolveTurnSampling(request.model, request.reasoningEffort),
        request.model.contextWindow,
      ).maxTokens,
    },
  });
}

/** What one model round may carry beyond the shared request: the working
 * transcript (which grows as tool rounds settle), the tools on offer, and the
 * cancel channel. */
interface StreamRoundOptions {
  /** The transcript for THIS round. The first round streams the assembled
   * history; later rounds append the turn's settled parts. */
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly WireTool[];
  readonly signal?: AbortSignal;
  /** Invoked once when the store reports a user cancel; the caller aborts
   * the round's signal in response. */
  readonly onCancelRequested?: () => void;
}

/** How often a stalled stream re-asks the store whether the user hit Stop.
 * Longer than the store's write throttle, so nearly every poll is a real
 * read; short enough that Stop answers within a second even when the
 * provider is between bytes. */
export const CANCEL_POLL_INTERVAL_MS = 750;

const CANCEL_POLL_TICK = Symbol('cancel-poll-tick');

/** Race one pending chunk read against the cancel-poll clock. The pending
 * read is REUSED across ticks (never re-issued — a dropped read would lose
 * its chunk), and the timer clears the moment the chunk wins so a fast
 * stream never accumulates timers. */
function raceCancelPoll<T>(
  pending: Promise<T>,
  intervalMs: number,
): Promise<T | typeof CANCEL_POLL_TICK> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    pending.finally(() => clearTimeout(timer)),
    new Promise<typeof CANCEL_POLL_TICK>((resolve) => {
      timer = setTimeout(() => resolve(CANCEL_POLL_TICK), intervalMs);
    }),
  ]);
}

/**
 * Steps 4 and 5. The stream and the output guardrails interleave by design:
 * each buffered segment is filtered BEFORE it is handed to the client, because
 * text already on the wire cannot be taken back. The stream step pulls chunks;
 * the output-guardrails step settles the final segment and the verdict.
 *
 * One call is ONE model round. The tool loop in `runTurn` calls it again with
 * an extended transcript after executing the round's tool calls.
 */
export async function streamWithOutputGuardrails(
  request: TurnRequest,
  context: AssembledContext,
  execution: ExecutionResolution,
  /** The sampling the turn resolved once, up front — see `runTurn`. */
  sampling: TurnSampling,
  deps: TurnDeps,
  /** The placeholder assistant message the cleared text streams into. */
  assistantMessageId?: string,
  round: StreamRoundOptions = { messages: context.messages },
): Promise<{
  text: string;
  /** The model's accumulated reasoning ("thinking") text, when any. */
  reasoning?: string;
  /** The tool calls the model ended the round with, when any. */
  toolCalls?: readonly ToolCallRequest[];
  refusal?: GuardrailRefusal;
  /** The user asked the turn to stop; `text` holds what streamed. */
  cancelled?: boolean;
  reportedUsage?: TurnUsage;
  /** When the first provider text SSE arrived — the TTFT anchor. */
  firstChunkAtMs?: number;
  /** When the first reasoning delta arrived, when the round produced any. */
  firstReasoningAtMs?: number;
  /** When this round dispatched its model call — the setup boundary. */
  roundStartedAtMs: number;
}> {
  const transform = createOutputTransform(deps.outputFilters ?? [], {
    ...deps.guardrailOptions,
  });
  const now = deps.now ?? (() => new Date());
  const roundStartedAtMs = now().getTime();
  let cleared = '';
  let reasoning = '';
  let toolCalls: readonly ToolCallRequest[] | undefined;
  let reportedUsage: TurnUsage | undefined;
  let firstChunkAtMs: number | undefined;
  let firstReasoningAtMs: number | undefined;
  let cancelled = false;
  let persistedNonEmpty = false;

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

  /** Stream the accumulated text into the generation row. One throttled
   * write doubles as the turn's heartbeat AND the cancel channel — the store
   * answers with the row's cancel flag. The finalize call is the
   * authoritative write, so a failure here must not end the turn. */
  const persistProgress = async (
    options: { flush?: boolean; poll?: boolean } = {},
  ): Promise<void> => {
    const isNonEmpty = cleared.length > 0 || reasoning.length > 0;
    if (!options.poll && !options.flush && !isNonEmpty) {
      return;
    }
    try {
      const flush =
        options.flush === true || (isNonEmpty && !persistedNonEmpty);
      const progress = await deps.store.streamProgress({
        organizationId: request.organizationId,
        threadId: request.threadId,
        messageId: assistantMessageId,
        text: cleared,
        ...(reasoning.length > 0 ? { reasoning } : {}),
        ...(flush ? { flush: true } : {}),
      });
      if (isNonEmpty) persistedNonEmpty = true;
      if (progress?.cancelRequested === true && !cancelled) {
        cancelled = true;
        round.onCancelRequested?.();
      }
    } catch (error) {
      console.warn(
        `[chat] streaming progress write failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  };

  try {
    const stream = deps.model({
      organizationId: request.organizationId,
      model: request.model.id,
      providerSlug: request.model.provider,
      system: context.system,
      messages: round.messages,
      ...(round.tools !== undefined ? { tools: round.tools } : {}),
      execution,
      sampling,
      // The catalog's own capability flag decides whether image attachments
      // are inlined on the wire — the pipeline resolves it here so the host
      // never re-derives capability from a model id.
      vision: request.model.supportsVision,
      signal: round.signal ?? request.signal,
    });
    // A manual iterator instead of `for await`: each next() races the
    // cancel poll below, so Stop stays responsive while the provider is
    // BETWEEN bytes — the first-byte wait and long thinking stalls are
    // exactly when a user reaches for it, and a per-chunk check alone
    // would leave the click unanswered until the stream resumed.
    const iterator = stream[Symbol.asyncIterator]();
    let pending = iterator.next();
    for (;;) {
      const winner = await raceCancelPoll(pending, CANCEL_POLL_INTERVAL_MS);
      if (winner === CANCEL_POLL_TICK) {
        // The progress write doubles as the cancel read; between real
        // writes the store's throttle answers from its last verdict.
        // Empty polls still write — Stop must land while the provider
        // is between bytes, including before any text exists.
        await persistProgress({ poll: true });
        if (!cancelled) continue;
        // The abort is already in flight (persistProgress fired the
        // round's cancel hook). Silence the abandoned read and close the
        // stream WITHOUT awaiting either — a provider that ignores the
        // abort must not be able to hold the stop hostage.
        void pending.then(
          () => undefined,
          () => undefined,
        );
        void iterator.return?.().then(
          () => undefined,
          () => undefined,
        );
        break;
      }
      if (winner.done === true) break;
      const chunk = winner.value;
      if (chunk.usage) reportedUsage = chunk.usage;
      if (chunk.toolCalls !== undefined) toolCalls = chunk.toolCalls;
      // Reasoning bypasses the output guardrails: it is display-only, never
      // wire-replayed, and holding the answer hostage to filtered thinking
      // would block replies whose visible text is clean.
      if (chunk.reasoning !== undefined) {
        firstReasoningAtMs ??= now().getTime();
        reasoning += chunk.reasoning;
      }
      // TTFT is first provider text SSE, before the output transform.
      // A no-op filter must not delay the stamp; a filtering host still
      // records when the model spoke, not when the buffer cleared.
      if (chunk.text.length > 0) {
        firstChunkAtMs ??= now().getTime();
      }
      const checked = await transform.push(chunk.text);
      if (!emit(checked)) {
        await iterator.return?.().then(
          () => undefined,
          () => undefined,
        );
        return {
          text: cleared,
          ...(reasoning.length > 0 ? { reasoning } : {}),
          refusal: checked.refusal,
          reportedUsage,
          firstChunkAtMs,
          firstReasoningAtMs,
          roundStartedAtMs,
        };
      }
      await persistProgress();
      if (cancelled) {
        await iterator.return?.().then(
          () => undefined,
          () => undefined,
        );
        break;
      }
      // Pull the next chunk only AFTER the body finished — the same
      // lockstep `for await` kept, so the producer never runs ahead of
      // the guardrail/persist work on the chunk before it.
      pending = iterator.next();
    }
  } catch (error) {
    // A cancel aborts the in-flight fetch; the resulting AbortError is the
    // stop working, not a failure. Anything else stays fatal to the round.
    if (!cancelled) throw error;
  }

  if (cancelled) {
    return {
      text: cleared,
      ...(reasoning.length > 0 ? { reasoning } : {}),
      cancelled: true,
      reportedUsage,
      firstChunkAtMs,
      firstReasoningAtMs,
      roundStartedAtMs,
    };
  }

  const tail = await transform.flush();
  if (!emit(tail)) {
    return {
      text: cleared,
      ...(reasoning.length > 0 ? { reasoning } : {}),
      refusal: tail.refusal,
      reportedUsage,
      firstChunkAtMs,
      firstReasoningAtMs,
      roundStartedAtMs,
    };
  }
  // Flush may have just cleared a short tail that never hit minFlushChars.
  // Persist the accumulated text so the UI sees it before finalize, and
  // so a throw after this point still has streamText for rescue.
  await persistProgress({ flush: true });
  return {
    text: cleared,
    ...(reasoning.length > 0 ? { reasoning } : {}),
    ...(toolCalls !== undefined && toolCalls.length > 0 ? { toolCalls } : {}),
    reportedUsage,
    firstChunkAtMs,
    firstReasoningAtMs,
    roundStartedAtMs,
  };
}

/** Cost of a turn in cents from the model's catalog pricing — fractional
 * cents, so a sub-cent turn keeps its precision. Absent pricing yields zero
 * rather than guessing a rate — an under-count is honest where a fabricated
 * one is not. The ONE cost formula: the usage ledger and the per-message
 * stamp both call it, so the two figures can never drift. */
export function estimateCostCents(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelCatalogEntry['pricing'] | undefined,
): number {
  if (!pricing) return 0;
  return (
    (inputTokens / 1_000_000) * pricing.inputCentsPerMillion +
    (outputTokens / 1_000_000) * pricing.outputCentsPerMillion
  );
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

/** Order-insensitive spelling of one call's arguments, for the same-round
 * dedup key: object keys sorted at every depth, so two spellings of the same
 * arguments compare equal. An undefined input keys like null — both read as
 * "no arguments". */
function canonicalArgs(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value) ?? null);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}

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
  const turnStartedAtMs = now().getTime();
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

  // The assistant message exists BEFORE the stream starts: the turn streams
  // its cleared text into this row, so a reader watching the thread sees the
  // reply grow, and a mid-stream failure keeps the partial text it managed.
  // User message, placeholder, and generation row commit as ONE transaction —
  // the setup wait is a single authenticated round-trip, and no partial
  // combination of the three can survive a failure.
  const opened = await deps.store.beginTurn({
    organizationId: request.organizationId,
    threadId: request.threadId,
    ...(request.appendUserMessage !== false
      ? { userParts: userTurnParts(input.text, request.attachments) }
      : {}),
    // Silent observability: the reply records that its context was fitted
    // by dropping history. Never rendered — telemetry and debugging only.
    ...(context.truncation !== undefined
      ? { truncation: { droppedMessages: context.truncation.droppedMessages } }
      : {}),
  });
  const placeholder = opened.assistantMessage;

  /** Timings for the message-info panel, all anchored at runTurn start —
   * the action host beginning the reply, not the user's click. Setup is
   * the wait before the first model round; TTFT is first provider text
   * SSE; duration is settle. Perceived wait is a separate client stamp. */
  const timings = (anchors: {
    firstChunkAtMs?: number;
    firstReasoningAtMs?: number;
    firstRoundStartedAtMs?: number;
  }) => ({
    durationMs: now().getTime() - turnStartedAtMs,
    ...(anchors.firstChunkAtMs !== undefined
      ? { timeToFirstTokenMs: anchors.firstChunkAtMs - turnStartedAtMs }
      : {}),
    ...(anchors.firstReasoningAtMs !== undefined
      ? {
          timeToFirstReasoningMs: anchors.firstReasoningAtMs - turnStartedAtMs,
        }
      : {}),
    ...(anchors.firstRoundStartedAtMs !== undefined
      ? { setupMs: anchors.firstRoundStartedAtMs - turnStartedAtMs }
      : {}),
  });

  try {
    steps.push('stream');
    // Resolved ONCE per turn, before any chunk flows: the model call, and
    // nothing else, decides how to spell it on the wire. Fitted to the same
    // effective window the context budget used, so the reserve the history
    // made room for and the ceiling the wire requests never disagree.
    const sampling = fitSamplingToWindow(
      resolveTurnSampling(request.model, request.reasoningEffort),
      request.budget?.maxTokens ?? request.model.contextWindow,
    );

    // The turn's cancel channel: every throttled progress write reports the
    // row's cancel flag back; aborting the controller cuts the in-flight
    // provider fetch, and the turn settles with whatever streamed.
    const cancel = new AbortController();
    const roundSignal = request.signal
      ? AbortSignal.any([request.signal, cancel.signal])
      : cancel.signal;

    const executor = deps.tools;
    /** Parts settled by finished tool rounds, in authored order. */
    const settledParts: MessagePart[] = [];
    /** Usage summed across rounds — every round bills its own full prompt.
     * A round that reports nothing is estimated at the same rates the
     * context assembly uses. Cache and reasoning counts stay undefined until
     * a round actually reports one, so the stamp never invents a zero. */
    const summed: {
      input: number;
      output: number;
      cached?: number;
      reasoning?: number;
    } = { input: 0, output: 0 };
    /** The TTFT anchor is the FIRST round's first provider text SSE;
     * reasoning and setup anchor the same way (first round wins). */
    let firstChunkAtMs: number | undefined;
    let firstReasoningAtMs: number | undefined;
    let firstRoundStartedAtMs: number | undefined;

    const persistSettledParts = async (): Promise<void> => {
      await deps.store.updateAssistantParts({
        organizationId: request.organizationId,
        threadId: request.threadId,
        messageId: placeholder.id,
        parts: [...settledParts],
      });
    };

    // The tool loop. Each pass is one model round: a round that ends in tool
    // calls settles its parts on the placeholder, executes the calls, and
    // streams again with the turn's parts appended to the transcript. Once
    // the round budget is spent the tools are withheld, so the model's only
    // move is to answer.
    let streamed: Awaited<ReturnType<typeof streamWithOutputGuardrails>>;
    let toolRounds = 0;
    /** A pausing tool registered a question: the turn settles where it is and
     *  the person's answer starts the next one. */
    let paused = false;
    /**
     * The CURRENT round's text and reasoning are already in `settledParts`.
     *
     * The loop settles a round before running its tools, then usually streams
     * again — so at finalize `streamed` holds the NEXT round's output and the
     * two never overlap. A round that breaks out AFTER settling (a pause, a
     * cancel mid-execution) leaves `streamed` pointing at what was just
     * settled, and appending it again printed the model's whole pre-tool
     * paragraph twice.
     */
    let roundSettled = false;
    for (;;) {
      // Each round starts un-settled; only the settle block below flips it,
      // and only for the round that is about to run its tools.
      roundSettled = false;
      const offeredTools =
        executor !== undefined && toolRounds < MAX_TOOL_ROUNDS
          ? executor.wireTools
          : undefined;
      // The notice rides the wire only, never the store: the transcript
      // shows the answer, not the host steering the model toward it.
      const budgetNotice =
        executor === undefined
          ? undefined
          : toolRounds >= MAX_TOOL_ROUNDS
            ? TOOL_BUDGET_SPENT_NOTICE
            : toolRounds === MAX_TOOL_ROUNDS - 1
              ? LAST_TOOL_ROUND_NOTICE
              : undefined;
      const roundMessages: ChatMessage[] = [...context.messages];
      if (settledParts.length > 0) {
        roundMessages.push({ role: 'assistant', parts: [...settledParts] });
      }
      if (budgetNotice !== undefined) {
        roundMessages.push({
          role: 'user',
          parts: [{ type: 'text', text: budgetNotice }],
        });
      }
      streamed = await streamWithOutputGuardrails(
        request,
        context,
        execution,
        sampling,
        deps,
        placeholder.id,
        {
          messages: roundMessages,
          ...(offeredTools !== undefined ? { tools: offeredTools } : {}),
          signal: roundSignal,
          onCancelRequested: () => cancel.abort(),
        },
      );
      firstChunkAtMs ??= streamed.firstChunkAtMs;
      firstReasoningAtMs ??= streamed.firstReasoningAtMs;
      firstRoundStartedAtMs ??= streamed.roundStartedAtMs;
      if (streamed.reportedUsage) {
        summed.input += streamed.reportedUsage.inputTokens;
        summed.output += streamed.reportedUsage.outputTokens;
        if (streamed.reportedUsage.cachedInputTokens !== undefined) {
          summed.cached =
            (summed.cached ?? 0) + streamed.reportedUsage.cachedInputTokens;
        }
        if (streamed.reportedUsage.reasoningTokens !== undefined) {
          summed.reasoning =
            (summed.reasoning ?? 0) + streamed.reportedUsage.reasoningTokens;
        }
      } else {
        summed.input +=
          estimateTokens(context.system) +
          roundMessages.reduce(
            (sum, message) => sum + estimateMessageTokens(message),
            0,
          );
        summed.output +=
          estimateTokens(streamed.text) +
          estimateTokens(streamed.reasoning ?? '');
      }

      const calls = streamed.toolCalls ?? [];
      if (
        streamed.refusal !== undefined ||
        streamed.cancelled === true ||
        calls.length === 0 ||
        executor === undefined
      ) {
        break;
      }

      // Settle this round BEFORE the tools run: the client sees the call
      // while the tool executes, and a crash keeps the record of what was
      // asked.
      if (streamed.reasoning !== undefined && streamed.reasoning.length > 0) {
        settledParts.push({ type: 'reasoning', text: streamed.reasoning });
      }
      if (streamed.text.length > 0) {
        settledParts.push({ type: 'text', text: streamed.text });
      }
      for (const call of calls) {
        settledParts.push({
          type: 'tool-call',
          callId: call.id,
          capabilityId: call.name,
          input: call.input,
        });
      }
      roundSettled = true;
      // Order matters for the reader: the live tail resets BEFORE the same
      // text lands on the row's parts. A reader between the two writes holds
      // its last text (its view never shrinks mid-stream); the other order
      // would briefly show the round's text twice — once from the parts,
      // once from the not-yet-reset tail.
      const boundary = await deps.store.streamProgress({
        organizationId: request.organizationId,
        threadId: request.threadId,
        messageId: placeholder.id,
        text: '',
        reasoning: '',
        flush: true,
      });
      await persistSettledParts();
      // The boundary flush is also a cancel read: a Stop that landed while
      // the round streamed its tool calls must not start the tools.
      if (boundary?.cancelRequested === true) {
        streamed = { ...streamed, cancelled: true };
        break;
      }

      // Execute the round's calls CONCURRENTLY, deduplicated: the model
      // sometimes asks the same question twice in one round, and an
      // identical (name, arguments) pair cannot answer differently — one
      // execution serves every duplicate. Every callId still settles its
      // own tool-result (both wire dialects pair each call with a result;
      // a missing one fails the next round), duplicates sharing the one
      // output. The executor's contract is to never throw — a failed call
      // comes back as a structured result the model reads and can recover
      // from — and the pipeline enforces it once more here, so no executor
      // bug (or test fake) can end the whole turn over one call.
      const runCall = async (call: ToolCallRequest): Promise<unknown> => {
        try {
          return await executor.execute(call);
        } catch (error) {
          console.warn(
            `[chat] tool executor broke its never-throws contract on ${call.name}: ${error instanceof Error ? error.message : 'unknown'}`,
          );
          return {
            status: 'error',
            message: 'The tool failed unexpectedly. Tell the user.',
          };
        }
      };
      const outputByKey = new Map<string, Promise<unknown>>();
      const outputs = await Promise.all(
        calls.map((call) => {
          // A call that failed to parse keys on its raw text — two broken
          // calls are only "the same" when they broke identically.
          const key = `${call.name} ${call.rawInput ?? canonicalArgs(call.input)}`;
          const pending = outputByKey.get(key) ?? runCall(call);
          outputByKey.set(key, pending);
          return pending;
        }),
      );
      for (const [index, call] of calls.entries()) {
        const output = outputs[index];
        settledParts.push({
          type: 'tool-result',
          callId: call.id,
          capabilityId: call.name,
          output,
          structured: true,
        });
        // A pausing tool ends the turn. There is no answer to feed back yet,
        // and looping would have the model carry on against its own guess at
        // what the person was about to say — the exact regression v0.2.91
        // records. The round's other calls still run (they are read-only and
        // already have their record); the LOOP is what stops.
        if (isPausingChatTool(call.name) && isAwaitingAnswerResult(output)) {
          settledParts.push({
            type: 'human-input',
            requestId: output.requestId,
            question: output.question,
            ...(output.questionCount !== undefined
              ? { questionCount: output.questionCount }
              : {}),
          });
          paused = true;
        }
      }
      await persistSettledParts();
      // One cancel read for the whole batch: a Stop that landed while the
      // tools ran must not start another round. The finished batch keeps
      // its settled record either way.
      const verdict = await deps.store.streamProgress({
        organizationId: request.organizationId,
        threadId: request.threadId,
        messageId: placeholder.id,
        text: '',
        reasoning: '',
      });
      if (verdict?.cancelRequested === true) {
        streamed = { ...streamed, cancelled: true };
      }
      if (streamed.cancelled === true || paused) break;
      toolRounds += 1;
    }

    steps.push('output-guardrails');
    // What the providers reported beats what we estimated; either way the
    // rounds are summed, because every round was billed. The cost stamp is
    // the ledger's own formula on the same counts, so the message and the
    // ledger always tell the same story; `stepLimitHit` marks a turn whose
    // final round had tools withheld because the round budget was spent.
    const usage: TurnUsage = {
      inputTokens: summed.input,
      outputTokens: summed.output,
      totalTokens: summed.input + summed.output,
      ...(summed.cached !== undefined
        ? { cachedInputTokens: summed.cached }
        : {}),
      ...(summed.reasoning !== undefined
        ? { reasoningTokens: summed.reasoning }
        : {}),
      ...(request.model.pricing !== undefined
        ? {
            costEstimateCents: estimateCostCents(
              summed.input,
              summed.output,
              request.model.pricing,
            ),
          }
        : {}),
      ...(toolRounds >= MAX_TOOL_ROUNDS ? { stepLimitHit: true } : {}),
      ...timings({ firstChunkAtMs, firstReasoningAtMs, firstRoundStartedAtMs }),
    };

    // The settled record of the whole turn: earlier rounds' parts, then the
    // final round's reasoning and text. An entirely empty turn still writes
    // one empty text part, so the row never reads as "missing".
    const finalParts: MessagePart[] = [
      ...settledParts,
      ...(!roundSettled &&
      streamed.reasoning !== undefined &&
      streamed.reasoning.length > 0
        ? [{ type: 'reasoning', text: streamed.reasoning } as const]
        : []),
      ...(!roundSettled &&
      (streamed.text.length > 0 || settledParts.length === 0)
        ? [{ type: 'text', text: streamed.text } as const]
        : []),
    ];

    if (streamed.refusal) {
      const reason = refusalReason(streamed.refusal);
      steps.push('usage-ledger');
      await recordUsage(request, usage, deps);
      await deps.store.finalizeAssistantMessage({
        organizationId: request.organizationId,
        threadId: request.threadId,
        messageId: placeholder.id,
        text: streamed.text,
        ...(streamed.reasoning !== undefined
          ? { reasoning: streamed.reasoning }
          : {}),
        parts: finalParts,
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
    await deps.store.finalizeAssistantMessage({
      organizationId: request.organizationId,
      threadId: request.threadId,
      messageId: placeholder.id,
      text: streamed.text,
      ...(streamed.reasoning !== undefined
        ? { reasoning: streamed.reasoning }
        : {}),
      parts: finalParts,
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
      ...(paused ? { paused: true } : {}),
    };
  } catch (err) {
    // The stream threw — a provider error mid-reply, or the stream timeout.
    // Settle the placeholder carrying the failure so the thread is never left
    // with a question and no answer, and the failure is a countable error
    // (not a silent lost turn or a guardrail block). No `text` is passed, so
    // whatever partial text the streaming writes persisted survives. The
    // `finally` still settles the generation; returning `refused` surfaces
    // the reason on the seam.
    const reason =
      err instanceof Error ? err.message : 'The model response failed.';
    // The message row is the only durable record of this failure — the log
    // line is the operator's copy of it (the reason text was already
    // secret-redacted and truncated where it was thrown).
    console.error('[chat] turn failed:', reason);
    // Stored as the structured envelope: the code the classifier derives
    // here is what lets the client render a localized, actionable hint
    // instead of the raw provider sentence. `decodeChatError` degrades
    // gracefully, so every reader of the raw string keeps working.
    await deps.store.finalizeAssistantMessage({
      organizationId: request.organizationId,
      threadId: request.threadId,
      messageId: placeholder.id,
      model: request.model.id,
      providerSlug: request.model.provider,
      error: encodeChatError({
        code: classifyChatErrorCode(err),
        provider: request.model.provider,
        model: request.model.id,
        raw: reason,
      }),
    });
    return { status: 'refused', steps, step: 'stream', reason };
  } finally {
    await deps.store.endGeneration({
      organizationId: request.organizationId,
      threadId: request.threadId,
    });
  }
}
