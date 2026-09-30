import type { Sql } from 'postgres';

import { estimateCostCents } from '../../../lib/chat/turn.ts';
import { DIRECT_API_AGENT_SLUG } from '../../../lib/shared/constants/usage.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import { ridesAnthropicHarnessEndpoint } from '../../core/lib/providers/agent_serving.ts';
import {
  gatewayProvisioningFailureStage,
  provisionSessionGatewayKey,
} from '../../core/node_only/sandbox/gateway_provisioning.ts';
import {
  resolveGatewayRouting,
  revokeVirtualKey,
} from '../../core/node_only/sandbox/llm_gateway_admin.ts';
import {
  MODEL_API_OP_KIND,
  modelApiOpSessionId,
} from '../../core/sandbox/session_constants.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import {
  budgetRetryAfterSeconds,
  toChatBudgetRefusal,
} from '../chat/budget-admission.ts';
import {
  type BudgetViolation,
  findBudgetViolation,
  loadBudgetSubject,
  type TurnAllowance,
} from '../governance/budget-gate.ts';
import { budgetCapPhrase } from '../governance/budget-refusal.ts';
import { readInFlightReservations } from '../governance/budget-reservations.ts';
import { orgAdapterShimHandlers } from '../knowledge/service.ts';
import { credentialShimHandlers } from '../provider_credentials/service.ts';
import {
  reconcileSessionOpKey,
  settleSessionOpSpend,
} from '../sandbox/spend-settlement.ts';
import { reserveTurnBudget } from '../sandbox/turn-budget.ts';
import type { ModelApiModel } from './models.ts';
import { relayLifetime, type RelayOutcome } from './relay.ts';
import { ModelApiRefusal, type ModelApiWire } from './wire.ts';

/**
 * A model-endpoint request's spend, through the machinery a managed harness
 * turn uses — no second allowance, key or ledger lane:
 *
 *  1. RESERVE — `reserveTurnBudget` (kind `model-api`) measures the key
 *     holder against every cap that binds them — personal, team, role,
 *     organization and the key's own — after the booked spend and every
 *     hold in flight, and records this request's hold on an op row
 *     (`app.sandbox_session_ops`, `session_id` `model-api:<key id>`,
 *     stamped with the person, `__direct_api__` and the key). The hold is
 *     the request's WORST CASE — the prompt plus its output cap, once per
 *     answer, at the model's catalog price, and those tokens — admitted
 *     whole or not at all: a request whose worst case no longer fits is
 *     refused (429 `BUDGET_EXCEEDED`, naming the output cap that would
 *     fit), never minted a smaller allowance it could spend past. A person
 *     or a key with {@link MODEL_API_CONCURRENCY_LIMIT} requests already
 *     running is refused first (429 `MODEL_API_CONCURRENCY_EXCEEDED`).
 *  2. MINT — `provisionSessionGatewayKey` pushes the connector's credential
 *     into the sandbox LLM gateway (fail-closed, as for a session) and mints
 *     a virtual key for this request alone: bound to this organization's
 *     upstream key, allowed this one model, capped by the hold.
 *  3. SETTLE — once the answer is over, the key's cumulative spend is read
 *     from the gateway, booked on the op row and into `app.usage_ledger`
 *     under the person, `__direct_api__` and the key, with the token counts
 *     the relay read, and the key is deleted — the shared `settleGatewayKey`
 *     choreography. The gateway's figure is not the whole story for every
 *     ending, so the request records what the relay saw on its op row when
 *     it ends ({@link spendFactsOf}), and every attempt that settles it —
 *     this one, the reconcile job, the sandbox watchdog's sweep — books it
 *     the same way (`adjustSpendReading`):
 *       - an answer that ended early — the caller hung up, the vendor broke
 *         off, its lifetime ran out, whole answer or stream — is booked at
 *         least at its prompt and the output the relay counted, at the
 *         catalog price: the gateway cancels the vendor call and books only
 *         the usage the vendor had reported by then;
 *       - a request the caller left before it was sent — while its
 *         guardrails judged it or its key was minted — never reached the
 *         gateway: only the gateway's figure for its unused key is booked;
 *       - a finished answer whose usage the vendor reported but whose key
 *         reads 0 has not been booked by the gateway yet: the settlement
 *         waits and retries, and past its grace books the reported usage at
 *         the catalog price.
 */

/** The most model-endpoint requests one person — and, separately, one API
 * key — may have running in an organization at once. */
export const MODEL_API_CONCURRENCY_LIMIT = 8;
/** What a refusal over the concurrency limit tells the caller to wait. */
const CONCURRENCY_RETRY_AFTER_SECONDS = 2;
/** How long the gateway gets to book a finished request's cost before the
 * spend is read: its budget accounting runs after the answer has left, off
 * the request's own path. */
const SETTLE_DELAY_MS = 2_000;
/** How often a request in flight tells the sweep it is alive. */
const HEARTBEAT_MS = 60_000;
/** A request silent this long (no heartbeat) was lost with its process: the
 * sandbox watchdog closes its op, and the settlement sweep books what the
 * gateway metered and deletes its key. */
export const MODEL_API_OP_STALE_MS = 5 * HEARTBEAT_MS;
/** The output cap a request that names none holds, when the catalog names
 * no maximum for the model either — and sends upstream, so the hold stays a
 * bound. */
const DEFAULT_OUTPUT_RESERVE_TOKENS = 4_096;

/** The token counts the relayed answer reported, booked beside the
 * gateway's figure. */
export interface ModelApiUsage {
  inputTokens: number;
  outputTokens: number;
  /** The share of the prompt served from the vendor's cache. */
  cachedInputTokens?: number;
}

/** A request's worst case, which its hold claims. */
export interface ModelApiWorstCase {
  promptTokens: number;
  /** The output one answer may produce: the request's own cap, else the
   * catalog's maximum, else {@link DEFAULT_OUTPUT_RESERVE_TOKENS} — never
   * more than the catalog's maximum. */
  outputCap: number;
  choiceCount: number;
  /** The prompt plus the output cap once per answer, at the catalog price,
   * rounded up; one cent when the catalog names no price (the figure the
   * gateway books is the spend either way). */
  cents: number;
  /** The prompt plus the output cap once per answer. */
  tokens: number;
}

export function modelApiWorstCase(
  model: ModelApiModel,
  promptTokens: number,
  maxOutputTokens: number | undefined,
  choiceCount = 1,
): ModelApiWorstCase {
  const outputCap = Math.min(
    maxOutputTokens ?? model.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS,
    model.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
  );
  const cents = estimateCostCents(
    promptTokens,
    outputCap * choiceCount,
    model.pricing,
  );
  return {
    promptTokens,
    outputCap,
    choiceCount,
    cents: Math.max(1, Math.ceil(cents)),
    tokens: promptTokens + outputCap * choiceCount,
  };
}

/** One request's gateway access: the op it is booked on and the virtual key
 * it may spend through. */
export interface ModelApiLease {
  organizationId: string;
  sessionId: string;
  execId: string;
  /** The plaintext `sk-bf-*` — sent to the gateway, never stored or
   * returned to the caller. */
  token: string;
  keyId: string;
  /** The model as the gateway routes it (`<record>/<modelId>`). */
  gatewayModel: string;
  /** When the request was admitted — where its lifetime starts. */
  startedAtMs: number;
}

/** The ctx the provisioning reads through: credentials and the org slug. */
function provisioningCtx(sql: Sql): ActionCtx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the provisioning's only ctx facilities are the credential reads and the org-slug read these handlers answer
  return createCtxShim({
    ...credentialShimHandlers(sql),
    ...orgAdapterShimHandlers(sql),
  }) as unknown as ActionCtx;
}

/** What the op row records about a request's spend when it ends. */
export interface ModelApiSpendFacts {
  floorCents: number | null;
  expectedCents: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

const NO_FACTS: ModelApiSpendFacts = {
  floorCents: null,
  expectedCents: null,
  inputTokens: null,
  outputTokens: null,
};

/** Close the op: it ended, with the facts its settlement books by. */
async function finalizeModelApiOp(
  sql: Sql,
  op: { sessionId: string; execId: string },
  status: 'completed' | 'failed' | 'cancelled',
  facts: ModelApiSpendFacts,
): Promise<void> {
  const now = Date.now();
  await sql`
    UPDATE app.sandbox_session_ops SET
      status = ${status}, finished_at_ms = ${now},
      finalized_at_ms = coalesce(finalized_at_ms, ${now}),
      floor_cents = ${facts.floorCents},
      expected_cents = ${facts.expectedCents},
      input_tokens = ${facts.inputTokens},
      output_tokens = ${facts.outputTokens}
    WHERE session_id = ${op.sessionId} AND exec_id = ${op.execId}
      AND status = 'running'
  `;
}

/** A request that never minted a key: close its op and free its hold now —
 * nothing can have been spent. */
async function releaseUnmintedOp(
  sql: Sql,
  op: { sessionId: string; execId: string },
): Promise<void> {
  await finalizeModelApiOp(sql, op, 'failed', NO_FACTS);
  await settleSessionOpSpend(sql, { ...op, spentCents: null });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The output cap that would still fit under the room the tightest caps
 * leave — per answer, the prompt paid first. Undefined when no cap limits
 * it. */
function affordableOutputTokens(
  model: ModelApiModel,
  worstCase: ModelApiWorstCase,
  room: { cents?: number; tokens?: number },
): number | undefined {
  const limits: number[] = [];
  const pricing = model.pricing;
  if (
    room.cents !== undefined &&
    pricing !== undefined &&
    pricing.outputCentsPerMillion > 0
  ) {
    // The hold is whole cents, rounded up: what fits is what stays within
    // the whole cents the room holds.
    const promptCents = estimateCostCents(worstCase.promptTokens, 0, pricing);
    limits.push(
      (Math.floor(room.cents) - promptCents) /
        (pricing.outputCentsPerMillion / 1_000_000) /
        worstCase.choiceCount,
    );
  }
  if (room.tokens !== undefined) {
    limits.push((room.tokens - worstCase.promptTokens) / worstCase.choiceCount);
  }
  if (limits.length === 0) return undefined;
  return Math.max(0, Math.floor(Math.min(...limits)));
}

/** A reached cap, or a worst case that does not fit, in the wire's words. */
function budgetRefusal(
  allowance: Extract<TurnAllowance, { allowed: false }>,
  wire: ModelApiWire,
  model: ModelApiModel,
  worstCase: ModelApiWorstCase,
): ModelApiRefusal {
  if (allowance.concurrency !== undefined) {
    const { scope, limit } = allowance.concurrency;
    return new ModelApiRefusal(
      429,
      'MODEL_API_CONCURRENCY_EXCEEDED',
      `${scope === 'apiKey' ? 'This API key already has' : 'You already have'} ${limit} model requests running in this organization, the most at once; wait for one to finish.`,
      {
        headers: { 'retry-after': String(CONCURRENCY_RETRY_AFTER_SECONDS) },
      },
    );
  }
  const violation: BudgetViolation | undefined = allowance.violation;
  if (violation === undefined) {
    return new ModelApiRefusal(429, 'BUDGET_EXCEEDED', allowance.reason);
  }
  const headers = {
    'retry-after': String(budgetRetryAfterSeconds(violation.resetsAt)),
  };
  if (allowance.room === undefined) {
    return new ModelApiRefusal(
      429,
      'BUDGET_EXCEEDED',
      toChatBudgetRefusal(violation).message,
      { headers },
    );
  }
  const reset = new Date(violation.resetsAt).toISOString();
  const affordable = affordableOutputTokens(model, worstCase, allowance.room);
  const capField =
    wire === 'anthropic' ? 'max_tokens' : 'max_completion_tokens';
  const each =
    worstCase.choiceCount > 1
      ? ` for each of its ${worstCase.choiceCount} answers`
      : '';
  const worst =
    violation.code === 'TOKEN_LIMIT'
      ? `${worstCase.tokens.toLocaleString('en')} tokens`
      : formatCents(worstCase.cents);
  const message =
    affordable !== undefined && affordable >= 1
      ? `Usage limit reached for this request: with ${worstCase.outputCap.toLocaleString('en')} output tokens${each} it could use up to ${worst}, more than ${budgetCapPhrase(violation)} leaves until ${reset}. Set ${capField} to ${affordable.toLocaleString('en')} or less, or wait until the limit resets.`
      : `Usage limit reached: ${budgetCapPhrase(violation)} leaves too little for this request — its prompt of about ${worstCase.promptTokens.toLocaleString('en')} tokens and any output — until ${reset}.`;
  return new ModelApiRefusal(429, 'BUDGET_EXCEEDED', message, { headers });
}

/** A provisioning failure in the caller's words: the credential when it is
 * the cause, the gateway otherwise. */
function provisioningRefusal(
  error: unknown,
  model: ModelApiModel,
): ModelApiRefusal {
  if (gatewayProvisioningFailureStage(error) === 'credential') {
    return new ModelApiRefusal(
      503,
      'MODEL_API_UNAVAILABLE',
      `The provider credential that serves ${model.id} cannot be used right now. Ask an admin to check it under Settings → AI providers.`,
      { headers: { 'x-should-retry': 'false' } },
    );
  }
  return new ModelApiRefusal(
    503,
    'MODEL_API_UNAVAILABLE',
    `The model gateway cannot serve ${model.id} right now; try again shortly.`,
    { headers: { 'retry-after': '10' } },
  );
}

/**
 * Reserve, provision and mint for one request. Throws the coded refusal the
 * caller answers: 429 `MODEL_API_CONCURRENCY_EXCEEDED` or `BUDGET_EXCEEDED`
 * (nothing held), 503 `MODEL_API_UNAVAILABLE` when the gateway cannot serve
 * the model (the hold released at once, any key minted revoked).
 */
export async function openModelApiLease(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    apiKeyId: string;
    /** The request's own id — the op row's `exec_id`. */
    requestId: string;
    wire: ModelApiWire;
    model: ModelApiModel;
    worstCase: ModelApiWorstCase;
  },
): Promise<ModelApiLease> {
  const startedAtMs = Date.now();
  const anthropicHarnessLane = ridesAnthropicHarnessEndpoint(
    args.wire === 'anthropic' ? 'anthropic' : 'openai-chat',
    args.model.connector,
  );
  const routing = resolveGatewayRouting(
    args.organizationId,
    args.model.providerSlug,
    args.model.modelId,
    { anthropicHarnessLane },
  );
  const sessionId = modelApiOpSessionId(args.apiKeyId);
  const op = { sessionId, execId: args.requestId };
  const allowance = await reserveTurnBudget(sql, {
    organizationId: args.organizationId,
    sessionId,
    execId: args.requestId,
    kind: MODEL_API_OP_KIND,
    defaultBudgetCents: args.worstCase.cents,
    modelRef: `${args.model.providerSlug}/${routing.gatewayModel}`,
    subject: {
      userId: args.userId,
      agentSlug: DIRECT_API_AGENT_SLUG,
      apiKeyId: args.apiKeyId,
    },
    whole: { prospectiveTokens: args.worstCase.tokens },
    concurrencyLimit: MODEL_API_CONCURRENCY_LIMIT,
  });
  if (!allowance.allowed) {
    throw budgetRefusal(allowance, args.wire, args.model, args.worstCase);
  }
  let key: Awaited<ReturnType<typeof provisionSessionGatewayKey>>;
  try {
    key = await provisionSessionGatewayKey(provisioningCtx(sql), {
      organizationId: args.organizationId,
      sessionId,
      allowedModels: [
        {
          providerSlug: args.model.providerSlug,
          modelId: args.model.modelId,
          anthropicHarnessLane,
        },
      ],
      budgetCents: allowance.budgetCents,
      requestScoped: true,
      requestId: args.requestId,
    });
  } catch (error) {
    console.error(
      `[model-api] ${args.organizationId}: the gateway could not serve ${args.model.id} for request ${args.requestId}:`,
      error,
    );
    await releaseUnmintedOp(sql, op);
    throw provisioningRefusal(error, args.model);
  }
  try {
    await sql`
      UPDATE app.sandbox_session_ops SET minted_key_id = ${key.keyId}
      WHERE session_id = ${sessionId} AND exec_id = ${args.requestId}
    `;
  } catch (error) {
    // A key the op row does not name is one no settlement can find: revoke
    // it now rather than leave a live, unaccounted key in the gateway.
    console.error(
      `[model-api] ${args.organizationId}: request ${args.requestId} could not record its gateway key; revoking it:`,
      error,
    );
    await revokeVirtualKey(key.keyId).catch((revokeError: unknown) => {
      console.error(
        `[model-api] revoking the unrecorded key ${key.keyId} of request ${args.requestId} failed:`,
        revokeError,
      );
    });
    await releaseUnmintedOp(sql, op).catch((releaseError: unknown) => {
      console.error(
        `[model-api] releasing the hold of request ${args.requestId} failed; the watchdog closes it once it is stale:`,
        releaseError,
      );
    });
    throw new ModelApiRefusal(
      503,
      'MODEL_API_UNAVAILABLE',
      `The model endpoints cannot serve ${args.model.id} right now; try again shortly.`,
      { headers: { 'retry-after': '10' } },
    );
  }
  return {
    organizationId: args.organizationId,
    sessionId,
    execId: args.requestId,
    token: key.token,
    keyId: key.keyId,
    gatewayModel: routing.gatewayModel,
    startedAtMs,
  };
}

/** Keep a request in flight visibly alive; the returned function stops it. */
export function heartbeatModelApiOp(
  sql: Sql,
  lease: ModelApiLease,
): () => void {
  const { sessionId, execId } = lease;
  const timer = setInterval(() => {
    sql`
      UPDATE app.sandbox_session_ops SET heartbeat_at_ms = ${Date.now()}
      WHERE session_id = ${sessionId} AND exec_id = ${execId}
        AND status = 'running'
    `.catch((error: unknown) => {
      console.warn(
        `[model-api] heartbeat for request ${execId} failed:`,
        error,
      );
    });
  }, HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/** How a request ended, with what its settlement books by. */
export interface ModelApiEnding {
  outcome: RelayOutcome;
  model: ModelApiModel;
  /** The prompt estimate the hold was sized with. */
  promptTokens: number;
}

/**
 * What the op row records about a request's spend when it ends — the facts
 * every settlement attempt books by, beside the gateway's figure:
 *  - a finished answer: the usage it reported, and that usage at the
 *    catalog price (a zero gateway reading is then not final);
 *  - an answer that ended early: its prompt (the vendor's count, else the
 *    estimate) and the output the relay counted, at the catalog price —
 *    the floor of what is booked;
 *  - a request that never left this process (the caller hung up before it
 *    was sent, or the gateway connection was never made; the relay counted
 *    nothing): no facts, so only the gateway's figure is booked.
 */
export function spendFactsOf(ending: ModelApiEnding): ModelApiSpendFacts {
  const { outcome, model } = ending;
  if (outcome.status === 'completed') {
    const usage = outcome.usage;
    if (usage === undefined || usage.inputTokens + usage.outputTokens === 0) {
      return NO_FACTS;
    }
    const cents = estimateCostCents(
      usage.inputTokens,
      usage.outputTokens,
      model.pricing,
      usage.cachedInputTokens ?? 0,
    );
    return {
      ...NO_FACTS,
      expectedCents: cents > 0 ? cents : null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  }
  if (outcome.countedOutputTokens === undefined) return NO_FACTS;
  const reported = outcome.usage;
  const inputTokens =
    reported !== undefined && reported.inputTokens > 0
      ? reported.inputTokens
      : ending.promptTokens;
  const outputTokens = Math.max(
    reported?.outputTokens ?? 0,
    outcome.countedOutputTokens,
  );
  const cents = estimateCostCents(inputTokens, outputTokens, model.pricing);
  return {
    ...NO_FACTS,
    floorCents: cents > 0 ? cents : null,
    inputTokens,
    outputTokens,
  };
}

/**
 * Settle one request from wherever it stands — the shared reconcile, which
 * books by the facts the op row carries — and leave what this attempt could
 * not finish to the reconcile job; the sandbox watchdog's sweep is the last
 * backstop.
 */
export async function settleModelApiOp(
  sql: Sql,
  lease: Pick<ModelApiLease, 'organizationId' | 'sessionId' | 'execId'>,
): Promise<void> {
  const op = {
    organizationId: lease.organizationId,
    sessionId: lease.sessionId,
    execId: lease.execId,
  };
  const outcome = await reconcileSessionOpKey(sql, op);
  if (outcome === null || (outcome.spendSettled && outcome.keyRevoked)) return;
  await addJobInTx(sql, 'sandbox.gateway_key_reconcile', op, {
    startAfter: new Date(Date.now() + 30_000),
  });
}

/** End a request: close its op with the facts its settlement books by, then
 * settle it shortly, once the gateway has booked the cost. Never throws —
 * the settlement's own backstops own a failure. */
export function closeModelApiLease(
  sql: Sql,
  lease: ModelApiLease,
  ending: ModelApiEnding,
): void {
  const facts = spendFactsOf(ending);
  const op = {
    organizationId: lease.organizationId,
    sessionId: lease.sessionId,
    execId: lease.execId,
  };
  void finalizeModelApiOp(sql, op, ending.outcome.status, facts)
    .then(() => {
      const timer = setTimeout(() => {
        settleModelApiOp(sql, op).catch((error: unknown) => {
          console.error(
            `[model-api] settlement of request ${op.execId} failed; the sandbox watchdog's sweep settles it:`,
            error,
          );
        });
      }, SETTLE_DELAY_MS);
      timer.unref();
    })
    .catch((error: unknown) => {
      console.error(
        `[model-api] could not close request ${op.execId}; the watchdog closes and settles it once it is stale:`,
        error,
      );
    });
}

/**
 * The sandbox watchdog's pass over model-endpoint requests whose process died
 * mid-answer: an op still `running` with no heartbeat for
 * {@link MODEL_API_OP_STALE_MS} is closed as failed, which hands it to the
 * settlement sweep — the gateway's figure is booked and the key deleted,
 * though not before a whole answer it may have been waiting for could have
 * been booked (its lifetime since it started). The gateway cancels a call
 * only once its caller's connection closes, and a process that stopped
 * beating may be hung rather than gone, its connection still open while the
 * vendor answers.
 */
export async function closeStaleModelApiOps(
  sql: Sql,
  now: number = Date.now(),
): Promise<number> {
  const wholeLifetimeMs = relayLifetime().wholeMs;
  const closed = await sql<{ execId: string }[]>`
    UPDATE app.sandbox_session_ops SET
      status = 'failed', finished_at_ms = ${now},
      finalized_at_ms = coalesce(finalized_at_ms, ${now}),
      settle_after_ms = greatest(started_at_ms + ${wholeLifetimeMs}, ${now})
    WHERE kind = ${MODEL_API_OP_KIND} AND status = 'running'
      AND greatest(started_at_ms, coalesce(heartbeat_at_ms, 0))
        < ${now - MODEL_API_OP_STALE_MS}
    RETURNING exec_id AS "execId"
  `;
  return closed.length;
}

/**
 * A read of the caller's budgets before the request costs anything — the
 * paid moderation call that judges its text comes before the hold. Refuses
 * (429 `BUDGET_EXCEEDED`) a caller already at a cap, counting the holds in
 * flight; takes no lock and holds nothing: the reservation that follows is
 * the admission.
 */
export async function assertModelApiBudgetRoom(
  sql: Sql,
  args: { organizationId: string; userId: string; apiKeyId: string },
): Promise<void> {
  const subject = await loadBudgetSubject(sql, args);
  const violation = await findBudgetViolation(sql, subject, {
    reservations: await readInFlightReservations(sql, subject),
  });
  if (violation === null) return;
  const refusal = toChatBudgetRefusal(violation);
  throw new ModelApiRefusal(429, 'BUDGET_EXCEEDED', refusal.message, {
    headers: {
      'retry-after': String(budgetRetryAfterSeconds(refusal.resetsAt)),
    },
  });
}
