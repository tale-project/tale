import type { Sql } from 'postgres';

import { estimateCostCents } from '../../../lib/chat/turn.ts';
import { DIRECT_API_AGENT_SLUG } from '../../../lib/shared/constants/usage.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import { ridesAnthropicHarnessEndpoint } from '../../core/lib/providers/agent_serving.ts';
import { settleGatewayKey } from '../../core/node_only/sandbox/gateway_key_settlement.ts';
import { provisionSessionGatewayKey } from '../../core/node_only/sandbox/gateway_provisioning.ts';
import { resolveGatewayRouting } from '../../core/node_only/sandbox/llm_gateway_admin.ts';
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
import { orgAdapterShimHandlers } from '../knowledge/service.ts';
import { credentialShimHandlers } from '../provider_credentials/service.ts';
import {
  pgGatewayKeySettlementPort,
  settleSessionOpSpend,
} from '../sandbox/spend-settlement.ts';
import { reserveTurnBudget } from '../sandbox/turn-budget.ts';
import type { ModelApiModel } from './models.ts';
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
 *     stamped with the person, `__direct_api__` and the key). A reached cap
 *     answers the chat lane's 429 `BUDGET_EXCEEDED`.
 *  2. MINT — `provisionSessionGatewayKey` pushes the connector's credential
 *     into the sandbox LLM gateway (fail-closed, as for a session) and mints
 *     a virtual key for this request alone: bound to this organization's
 *     upstream key, allowed this one model, capped by the hold.
 *  3. SETTLE — once the answer is over, the key's cumulative spend is read
 *     from the gateway, booked on the op row and into `app.usage_ledger`
 *     under the person, `__direct_api__` and the key (with the token counts
 *     the relayed answer reported), and the key is deleted — the shared
 *     `settleGatewayKey` choreography. What this attempt cannot finish the
 *     reconcile job (`sandbox.gateway_key_reconcile`) and the sandbox
 *     watchdog's sweep finish, booking the figure the gateway kept.
 *
 * The hold is the request's worst case at the model's catalog price — the
 * prompt as sent plus the output it may produce — the way a chat turn sizes
 * its own, never less than a cent.
 */

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
/** Where a request with no catalog price, or no output cap, sizes its hold. */
const DEFAULT_OUTPUT_RESERVE_TOKENS = 4_096;

/** The hold a request reserves: its prompt plus the output it may produce —
 * the output cap once per answer it asks for — at the model's catalog price;
 * one cent when the catalog names no price (the figure the gateway books is
 * the spend either way). */
export function modelApiHoldCents(
  model: ModelApiModel,
  promptTokens: number,
  maxOutputTokens: number | undefined,
  choiceCount = 1,
): number {
  const output = Math.min(
    maxOutputTokens ?? model.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS,
    model.maxOutputTokens ?? Number.MAX_SAFE_INTEGER,
  );
  const cents = estimateCostCents(
    promptTokens,
    output * choiceCount,
    model.pricing,
  );
  return Math.max(1, Math.ceil(cents));
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
}

/** The ctx the provisioning reads through: credentials and the org slug. */
function provisioningCtx(sql: Sql): ActionCtx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the provisioning's only ctx facilities are the credential reads and the org-slug read these handlers answer
  return createCtxShim({
    ...credentialShimHandlers(sql),
    ...orgAdapterShimHandlers(sql),
  }) as unknown as ActionCtx;
}

/** Close the op: it ended, and no hold stays open once its spend is booked. */
async function finalizeModelApiOp(
  sql: Sql,
  op: { sessionId: string; execId: string },
  status: 'completed' | 'failed' | 'cancelled',
): Promise<void> {
  const now = Date.now();
  await sql`
    UPDATE app.sandbox_session_ops SET
      status = ${status}, finished_at_ms = ${now},
      finalized_at_ms = coalesce(finalized_at_ms, ${now})
    WHERE session_id = ${op.sessionId} AND exec_id = ${op.execId}
      AND status = 'running'
  `;
}

/**
 * Reserve, provision and mint for one request. Throws the coded refusal the
 * caller answers: 429 `BUDGET_EXCEEDED` for a reached cap (nothing held),
 * 503 `MODEL_API_UNAVAILABLE` when the gateway cannot serve the model (the
 * hold is released at once).
 */
export async function openModelApiLease(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    apiKeyId: string;
    requestId: string;
    wire: ModelApiWire;
    model: ModelApiModel;
    holdCents: number;
  },
): Promise<ModelApiLease> {
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
    defaultBudgetCents: args.holdCents,
    modelRef: `${args.model.providerSlug}/${routing.gatewayModel}`,
    subject: {
      userId: args.userId,
      agentSlug: DIRECT_API_AGENT_SLUG,
      apiKeyId: args.apiKeyId,
    },
  });
  if (!allowance.allowed) {
    if (allowance.violation === undefined) {
      throw new ModelApiRefusal(429, 'BUDGET_EXCEEDED', allowance.reason);
    }
    const refusal = toChatBudgetRefusal(allowance.violation);
    throw new ModelApiRefusal(429, 'BUDGET_EXCEEDED', refusal.message, {
      headers: {
        'retry-after': String(budgetRetryAfterSeconds(refusal.resetsAt)),
      },
    });
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
    });
  } catch (error) {
    console.error(
      `[model-api] ${args.organizationId}: the gateway could not serve ${args.model.id} for request ${args.requestId}:`,
      error,
    );
    // Nothing was minted, so nothing can have been spent: close the op and
    // its hold at once.
    await finalizeModelApiOp(sql, op, 'failed');
    await settleSessionOpSpend(sql, { ...op, spentCents: null });
    throw new ModelApiRefusal(
      503,
      'MODEL_API_UNAVAILABLE',
      `The model gateway cannot serve ${args.model.id} right now; try again shortly. If it persists, ask an admin to check the provider's credential.`,
    );
  }
  await sql`
    UPDATE app.sandbox_session_ops SET minted_key_id = ${key.keyId}
    WHERE session_id = ${sessionId} AND exec_id = ${args.requestId}
  `;
  return {
    organizationId: args.organizationId,
    sessionId,
    execId: args.requestId,
    token: key.token,
    keyId: key.keyId,
    gatewayModel: routing.gatewayModel,
  };
}

/** Keep a request in flight visibly alive; the returned function stops it. */
export function heartbeatModelApiOp(
  sql: Sql,
  lease: ModelApiLease,
): () => void {
  const timer = setInterval(() => {
    sql`
      UPDATE app.sandbox_session_ops SET heartbeat_at_ms = ${Date.now()}
      WHERE session_id = ${lease.sessionId} AND exec_id = ${lease.execId}
        AND status = 'running'
    `.catch((error: unknown) => {
      console.warn(
        `[model-api] heartbeat for request ${lease.execId} failed:`,
        error,
      );
    });
  }, HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/** The token counts the relayed answer reported, booked beside the
 * gateway's figure. */
export interface ModelApiUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Book the request's spend and delete its key — {@link SETTLE_DELAY_MS}
 * after the answer ended. An attempt that cannot finish (the gateway did not
 * answer the spend read, the delete failed) hands the rest to the reconcile
 * job; the sandbox watchdog's sweep is the last backstop.
 */
export async function settleModelApiLease(
  sql: Sql,
  lease: ModelApiLease,
  usage: ModelApiUsage | undefined,
): Promise<void> {
  const op = { sessionId: lease.sessionId, execId: lease.execId };
  const outcome = await settleGatewayKey(
    { spendSettled: false, keyRevoked: false },
    {
      ...pgGatewayKeySettlementPort(sql, { ...op, keyId: lease.keyId }),
      recordSpend: async (cents) => {
        await settleSessionOpSpend(sql, {
          ...op,
          spentCents: cents,
          ...(usage !== undefined ? { usage } : {}),
        });
      },
    },
    (message, error) =>
      console.warn(
        `[model-api] request ${lease.execId} key ${lease.keyId}: ${message}`,
        ...(error !== undefined ? [error] : []),
      ),
  );
  if (outcome.spendSettled && outcome.keyRevoked) return;
  await addJobInTx(
    sql,
    'sandbox.gateway_key_reconcile',
    { organizationId: lease.organizationId, ...op },
    { startAfter: new Date(Date.now() + 30_000) },
  );
}

/** End a request: close its op now, settle it once the gateway has booked
 * the cost. Never throws — the settlement's own backstops own a failure. */
export function closeModelApiLease(
  sql: Sql,
  lease: ModelApiLease,
  status: 'completed' | 'failed' | 'cancelled',
  usage: ModelApiUsage | undefined,
): void {
  void finalizeModelApiOp(sql, lease, status)
    .catch((error: unknown) => {
      console.error(
        `[model-api] could not close the op of request ${lease.execId}; the watchdog closes it once it is stale:`,
        error,
      );
    })
    .then(() => {
      const timer = setTimeout(() => {
        settleModelApiLease(sql, lease, usage).catch((error: unknown) => {
          console.error(
            `[model-api] settlement of request ${lease.execId} failed; the sandbox watchdog's sweep settles it:`,
            error,
          );
        });
      }, SETTLE_DELAY_MS);
      timer.unref();
    });
}

/**
 * The sandbox watchdog's pass over model-endpoint requests whose process died
 * mid-answer: an op still `running` with no heartbeat for
 * {@link MODEL_API_OP_STALE_MS} is closed as failed, which hands it to the
 * settlement sweep — the gateway's figure is booked and the key deleted.
 */
export async function closeStaleModelApiOps(
  sql: Sql,
  now: number = Date.now(),
): Promise<number> {
  const closed = await sql<{ execId: string }[]>`
    UPDATE app.sandbox_session_ops SET
      status = 'failed', finished_at_ms = ${now},
      finalized_at_ms = coalesce(finalized_at_ms, ${now})
    WHERE kind = ${MODEL_API_OP_KIND} AND status = 'running'
      AND greatest(started_at_ms, coalesce(heartbeat_at_ms, 0))
        < ${now - MODEL_API_OP_STALE_MS}
    RETURNING exec_id AS "execId"
  `;
  return closed.length;
}
