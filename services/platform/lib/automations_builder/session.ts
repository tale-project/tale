/**
 * The automation builder agent: an autonomous session that authors an automation
 * document by talking to the engine's dispatch table.
 *
 * The protocol is text, not native tool calling and not a coding harness. One
 * action per reply, in a fenced yaml block, parsed by the engine's own
 * deterministic repair layer. Text actions measurably beat native tool calls
 * for the small models this must support: tool calling adds failure modes
 * (arguments are still JSON text, several small models have no tool support,
 * some silently ignore the tools parameter) without removing any, and
 * grammar-constrained decoding fixes syntax at the cost of the reasoning that
 * produces correct automations.
 *
 * This module is deliberately pure — no Convex, no filesystem, no network,
 * no clock it did not receive. The dispatch surface, the model call, the
 * clock and the cancellation check are all injected, so the session policy
 * below is provable by unit test rather than by observation in production.
 *
 * The state machine, per turn:
 *
 *   cancelled? ─────────────────────────────────────────► cancelled
 *   past the deadline? ─────────────────────────────────► gave-up
 *   fruitless streak at the limit? → restart (or) ──────► gave-up
 *   ask the model ── call failed? ──────────────────────► gave-up
 *   parse the reply ── no action? → nudge, next turn
 *   perform the action ── save accepted? ───────────────► succeeded
 *   classify progress, feed the result back, next turn
 *   turn budget exhausted ─────────────────────────────► gave-up
 *
 * Every path out of the loop is one of the three terminal states; there is no
 * path that runs forever.
 */

import { stableStringify } from '../engine/api/tests';
import { isParseFailure, parseAgentReply } from '../engine/core/repair';
import {
  BUILDER_POLICY,
  builderSystemPrompt,
  builderTaskPrompt,
  CHECKLIST_NUDGE,
  invitesFinish,
  leniencyNote,
  nudgeFor,
  protocolNudge,
  REFLECTION_NUDGE,
  type BuilderPolicy,
} from './policy';
import {
  asRecord,
  errorSignature,
  isFailureResult,
  renderResult,
  resultFacts,
} from './results';

export interface BuilderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * The engine surface the loop drives: `dispatch()` already bound to a host
 * context (its store, and whether live execution is permitted). The loop
 * never learns which methods exist — the dispatch table answers an unknown
 * method with the list of real ones, so there is exactly one method table in
 * the system.
 */
export type BuilderDispatch = (
  method: string,
  params: unknown,
) => Promise<unknown>;

export interface BuilderModelRequest {
  /** The full conversation, oldest first. Never summarized (see policy). */
  messages: BuilderMessage[];
  temperature: number;
  /** 1-based turn number, for host-side logging and tracing. */
  turn: number;
}

export interface BuilderModelReply {
  content: string;
  usage?: { prompt: number; completion: number };
}

/** The model call, injected: the host owns model choice, credentials and
 * transport. The model is always explicit — nothing here picks one. */
export type BuilderModel = (
  request: BuilderModelRequest,
) => Promise<BuilderModelReply>;

export interface BuilderSessionOptions {
  /** What the automation must do, in the requester's own words. */
  goal: string;
  dispatch: BuilderDispatch;
  model: BuilderModel;
  /** Overrides for individual policy values; anything omitted keeps the
   * measured default. */
  policy?: Partial<BuilderPolicy>;
  /** Injected clock, so deadline behaviour is testable. */
  now?: () => number;
  /** Polled at the turn boundaries; true ends the session as `cancelled`. */
  isCancelled?: () => boolean;
  /** Overrides the generated system prompt. Hosts should not need this; it
   * exists so a test can pin a short prompt. */
  systemPrompt?: string;
}

export type BuilderOutcome =
  | { status: 'succeeded'; saved: { name: string; version: number } }
  | { status: 'gave-up'; reason: string }
  | { status: 'cancelled'; reason: string };

export type TranscriptKind =
  | 'action'
  | 'parse-error'
  | 'restart'
  | 'history-truncated';

/** One recorded step. The host persists these; the UI replays them. */
export interface BuilderTranscriptEntry {
  turn: number;
  kind: TranscriptKind;
  method?: string;
  params?: unknown;
  result?: unknown;
  /** The model's raw reply, excerpted. */
  reply?: string;
  /** Why a restart, truncation or parse failure happened. */
  note?: string;
  /** Whether the turn moved the job forward. */
  progress?: boolean;
  /** Set when the turn was counted fruitless, naming which rule fired. */
  fruitlessReason?: FruitlessReason;
  /** Set when the reply deviated from the protocol but was recovered. */
  lenient?: string;
}

export type FruitlessReason =
  | 'parse-failure'
  | 'repeated-action'
  | 'repeated-error';

export interface BuilderSessionResult {
  outcome: BuilderOutcome;
  transcript: BuilderTranscriptEntry[];
  /** The final attempt's conversation, exactly as the model last saw it. */
  messages: BuilderMessage[];
  turns: number;
  restarts: number;
  usage: { prompt: number; completion: number };
}

/** The visible marker a dropped-history notice carries, so the loop can find
 * and refresh its own notice instead of stacking new ones. */
const HISTORY_NOTICE_PREFIX = 'Context notice:';

/** Never drop the most recent exchanges — the current document and the error
 * being fixed live there. */
const KEEP_RECENT_MESSAGES = 4;

const REPLY_EXCERPT = 1200;
/** Error lines quoted into the NEXT attempt's prompt — kept tight, they cost
 * tokens on every restart. */
const ERROR_EXCERPT = 200;
/** The user-visible give-up reason — sized for a whole provider error body,
 * since it is the only diagnostic the builder surface gets. */
const REASON_EXCERPT = 2000;

/**
 * One attempt at the job. A restart replaces the whole attempt rather than
 * editing the conversation, which is what makes "restart" mean something: the
 * next attempt inherits a short, factual summary of what was learned and none
 * of the wreckage that produced it.
 */
interface Attempt {
  messages: BuilderMessage[];
  /** How many leading messages are the seed and may never be dropped. */
  seedLength: number;
  /** Actions already performed in this attempt. The engine is deterministic
   * in mock mode, so re-issuing one cannot produce new information. */
  seenActions: Set<string>;
  lastErrorSignature: string;
  /** Signature of the document whose own tests last passed in full. */
  testsGreenFor: string | null;
  fruitless: number;
  turnsUsed: number;
  methodsTried: string[];
  errorsSeen: string[];
  droppedMessages: number;
}

function newAttempt(
  systemPrompt: string,
  taskPrompt: string,
  learned?: string,
): Attempt {
  const messages: BuilderMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: taskPrompt },
  ];
  if (learned) messages.push({ role: 'user', content: learned });
  return {
    messages,
    seedLength: messages.length,
    seenActions: new Set<string>(),
    lastErrorSignature: '',
    testsGreenFor: null,
    fruitless: 0,
    turnsUsed: 0,
    methodsTried: [],
    errorsSeen: [],
    droppedMessages: 0,
  };
}

function excerpt(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * What the next attempt is told about the one being abandoned. Assembled from
 * recorded facts — which actions were tried and which errors kept coming
 * back — and never from a model call: a session that cannot make progress is
 * the last one whose summary of itself should be trusted, and an LLM-written
 * recap is exactly the compaction this loop refuses to do.
 */
function attemptSummary(attempt: Attempt): string {
  const counts = new Map<string, number>();
  for (const method of attempt.methodsTried) {
    counts.set(method, (counts.get(method) ?? 0) + 1);
  }
  const tried = [...counts.entries()]
    .map(([method, count]) => (count > 1 ? `${method} ×${count}` : method))
    .join(', ');
  const distinctErrors = [...new Set(attempt.errorsSeen)].slice(-3);
  const lines = [
    `A previous attempt was abandoned after ${attempt.turnsUsed} turns without progress. Facts from it:`,
  ];
  if (tried) lines.push(`- actions already tried: ${tried}`);
  if (distinctErrors.length > 0) {
    lines.push('- errors it kept hitting:');
    for (const error of distinctErrors) {
      lines.push(`  - ${excerpt(error, ERROR_EXCERPT)}`);
    }
  }
  lines.push(
    'Start from a clean draft and take a different approach. Repeating those actions unchanged will fail the same way.',
  );
  return lines.join('\n');
}

/**
 * Keep the conversation inside the model's window WITHOUT summarizing it.
 * The seed (system prompt, job, and anything a restart learned) and the most
 * recent exchanges always survive; the oldest turns in between are dropped
 * whole and replaced by one notice saying how many are gone. The agent is
 * told it lost history so it can ask the engine again for anything it needs,
 * which is cheap — silently handing it a summary that omits the detail it
 * needed is not.
 */
function enforceHistoryBudget(attempt: Attempt, maxChars: number): number {
  const size = (): number =>
    attempt.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
  if (size() <= maxChars) return 0;

  const hasNotice = (): boolean => {
    const first = attempt.messages[attempt.seedLength];
    return (
      first !== undefined && first.content.startsWith(HISTORY_NOTICE_PREFIX)
    );
  };

  let dropped = 0;
  while (size() > maxChars) {
    const noticeOffset = hasNotice() ? 1 : 0;
    const droppableFrom = attempt.seedLength + noticeOffset;
    if (attempt.messages.length - droppableFrom <= KEEP_RECENT_MESSAGES) break;
    attempt.messages.splice(droppableFrom, 1);
    dropped++;
  }
  if (dropped === 0) return 0;

  attempt.droppedMessages += dropped;
  const notice: BuilderMessage = {
    role: 'user',
    content: `${HISTORY_NOTICE_PREFIX} ${attempt.droppedMessages} earlier message(s) were dropped to fit the context window. Nothing was summarized and nothing was rewritten — the turns that remain are verbatim. Re-read the latest result below, and call get_automation or run_automation again if you need something that is gone.`,
  };
  if (hasNotice()) attempt.messages[attempt.seedLength] = notice;
  else attempt.messages.splice(attempt.seedLength, 0, notice);
  return dropped;
}

/** A stable identity for an action, so a repeat is recognizable. */
function actionKey(method: string, params: unknown): string {
  return `${method}:${stableStringify(params)}`;
}

/** The document an action carries, as a comparable signature. */
function automationSignature(params: unknown): string {
  const record = asRecord(params);
  return record?.automation === undefined
    ? ''
    : stableStringify(record.automation);
}

interface PerformedAction {
  result: unknown;
  saved?: { name: string; version: number };
}

/**
 * Run one action against the engine. Everything is forwarded to dispatch —
 * the loop keeps no second copy of the method table — except for the one rule
 * that belongs to the session rather than the engine: a document is saved
 * only after ITS OWN tests have passed. Authors that verify against tests
 * before shipping land working automations roughly twice as often, and pinning
 * the gate to the tested document (not merely to "some test passed earlier")
 * closes the obvious hole of testing one draft and saving another.
 */
async function performAction(
  action: { method: string; params: unknown },
  attempt: Attempt,
  dispatch: BuilderDispatch,
): Promise<PerformedAction> {
  if (action.method === 'test_automation') {
    const result = await dispatch(action.method, action.params);
    if (resultFacts(result).testsPassed) {
      attempt.testsGreenFor = automationSignature(action.params);
    }
    return { result };
  }

  if (action.method === 'save_automation') {
    const signature = automationSignature(action.params);
    if (attempt.testsGreenFor === null) {
      return {
        result: {
          error: 'save rejected — this document has not passed its own tests',
          hint: 'add a tests: block, call test_automation until every test passes, then save that exact document',
        },
      };
    }
    if (attempt.testsGreenFor !== signature) {
      return {
        result: {
          error:
            'save rejected — the document changed since the last passing test run',
          hint: 'call test_automation on the document you are about to save, then save it unchanged',
        },
      };
    }
    const result = await dispatch(action.method, action.params);
    const saved = resultFacts(result).saved;
    return saved ? { result, saved } : { result };
  }

  return { result: await dispatch(action.method, action.params) };
}

/** The message the agent gets back: the result, the next step, and — at the
 * two points that matter — a reflection or checklist nudge. */
function feedbackMessage(
  method: string,
  result: unknown,
  lenient?: string,
): string {
  const lines = [`${method} result:`, '```json', renderResult(result), '```'];
  const nudge = nudgeFor(method, result);
  if (nudge) lines.push(nudge);
  if (isFailureResult(result)) lines.push(REFLECTION_NUDGE);
  else if (invitesFinish(method, result)) lines.push(CHECKLIST_NUDGE);
  if (lenient) lines.push(leniencyNote(lenient));
  return lines.join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run one authoring session to a terminal state.
 *
 * Resolves with `succeeded` (a tested document was saved), `gave-up` (with
 * the reason: turn budget, deadline, no progress, or a failed model call) or
 * `cancelled`. It never rejects for a reason the loop can name, and it never
 * runs unbounded.
 */
export async function runBuilderSession(
  options: BuilderSessionOptions,
): Promise<BuilderSessionResult> {
  const policy: BuilderPolicy = { ...BUILDER_POLICY, ...options.policy };
  const now = options.now ?? ((): number => Date.now());
  const isCancelled = options.isCancelled ?? ((): boolean => false);
  const systemPrompt = options.systemPrompt ?? builderSystemPrompt();
  const taskPrompt = builderTaskPrompt(options.goal);
  const startedAt = now();

  const transcript: BuilderTranscriptEntry[] = [];
  const usage = { prompt: 0, completion: 0 };
  let attempt = newAttempt(systemPrompt, taskPrompt);
  let restarts = 0;

  const done = (
    outcome: BuilderOutcome,
    turns: number,
  ): BuilderSessionResult => ({
    outcome,
    transcript,
    messages: attempt.messages,
    turns,
    restarts,
    usage,
  });

  for (let turn = 1; turn <= policy.maxTurns; turn++) {
    if (isCancelled()) {
      return done(
        { status: 'cancelled', reason: 'the caller cancelled the session' },
        turn - 1,
      );
    }
    if (now() - startedAt > policy.deadlineMs) {
      return done(
        {
          status: 'gave-up',
          reason: `the ${Math.round(policy.deadlineMs / 1000)}s session deadline passed`,
        },
        turn - 1,
      );
    }

    if (attempt.fruitless >= policy.restartAfterFruitless) {
      if (restarts >= policy.maxRestarts) {
        return done(
          {
            status: 'gave-up',
            reason: `no progress in ${attempt.fruitless} consecutive turns, and the restart budget is spent`,
          },
          turn - 1,
        );
      }
      const learned = attemptSummary(attempt);
      attempt = newAttempt(systemPrompt, taskPrompt, learned);
      restarts++;
      transcript.push({
        turn,
        kind: 'restart',
        note: 'restarted with a fresh session seeded with what the abandoned attempt learned',
      });
    }

    attempt.turnsUsed++;
    let reply: BuilderModelReply;
    try {
      reply = await options.model({
        messages: [...attempt.messages],
        temperature:
          restarts > 0 ? policy.restartTemperature : policy.temperature,
        turn,
      });
    } catch (error) {
      return done(
        {
          status: 'gave-up',
          reason: `the model call failed: ${excerpt(errorMessage(error), REASON_EXCERPT)}`,
        },
        turn,
      );
    }
    usage.prompt += reply.usage?.prompt ?? 0;
    usage.completion += reply.usage?.completion ?? 0;

    // An empty assistant turn still has to appear in the history: the model
    // must see that its silence was recorded, and some providers reject a
    // conversation containing an empty message.
    const content =
      reply.content.trim().length > 0 ? reply.content : '(empty reply)';
    attempt.messages.push({ role: 'assistant', content });

    if (isCancelled()) {
      return done(
        { status: 'cancelled', reason: 'the caller cancelled the session' },
        turn,
      );
    }

    const parsed = parseAgentReply(content);
    if (isParseFailure(parsed)) {
      attempt.fruitless++;
      transcript.push({
        turn,
        kind: 'parse-error',
        note: parsed.parseError,
        reply: excerpt(content, REPLY_EXCERPT),
        progress: false,
        fruitlessReason: 'parse-failure',
      });
      attempt.messages.push({
        role: 'user',
        content: protocolNudge(parsed.parseError),
      });
      const dropped = enforceHistoryBudget(attempt, policy.maxHistoryChars);
      if (dropped > 0) recordTruncation(transcript, turn, dropped);
      continue;
    }

    const key = actionKey(parsed.method, parsed.params);
    const repeatedAction = attempt.seenActions.has(key);
    attempt.seenActions.add(key);
    attempt.methodsTried.push(parsed.method);

    const performed = await performAction(parsed, attempt, options.dispatch);
    const signature = errorSignature(performed.result);
    if (signature) attempt.errorsSeen.push(signature);

    // A turn is fruitless when it produced no new information: the reply
    // carried no action, the action was one this attempt already ran (the
    // engine is deterministic, so the answer is the one it already has), or
    // it hit the very same error as the turn before.
    const fruitlessReason: FruitlessReason | null = repeatedAction
      ? 'repeated-action'
      : signature !== '' && signature === attempt.lastErrorSignature
        ? 'repeated-error'
        : null;
    attempt.lastErrorSignature = signature;
    attempt.fruitless = fruitlessReason === null ? 0 : attempt.fruitless + 1;

    transcript.push({
      turn,
      kind: 'action',
      method: parsed.method,
      params: parsed.params,
      result: performed.result,
      reply: excerpt(content, REPLY_EXCERPT),
      progress: fruitlessReason === null,
      ...(fruitlessReason !== null && { fruitlessReason }),
      ...(parsed.lenient !== undefined && { lenient: parsed.lenient }),
    });

    if (performed.saved) {
      return done({ status: 'succeeded', saved: performed.saved }, turn);
    }

    attempt.messages.push({
      role: 'user',
      content: feedbackMessage(parsed.method, performed.result, parsed.lenient),
    });
    const dropped = enforceHistoryBudget(attempt, policy.maxHistoryChars);
    if (dropped > 0) recordTruncation(transcript, turn, dropped);
  }

  return done(
    {
      status: 'gave-up',
      reason: `the ${policy.maxTurns}-turn budget is exhausted`,
    },
    policy.maxTurns,
  );
}

function recordTruncation(
  transcript: BuilderTranscriptEntry[],
  turn: number,
  dropped: number,
): void {
  transcript.push({
    turn,
    kind: 'history-truncated',
    note: `dropped ${dropped} of the oldest message(s) to fit the context window; nothing was summarized`,
  });
}
