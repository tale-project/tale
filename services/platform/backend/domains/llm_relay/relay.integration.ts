/**
 * The model relay over real Postgres (tale-project/tale#4942): a turn's
 * token admits its calls, the turn's allowance — its images included —
 * refuses one past it, and each call is booked on the turn's op in the
 * columns migration 0239 added, two calls at once included. The upstream is
 * the relay's fetch seam, answering as Anthropic does: no vendor is called.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { resolveGatewayRouting } from '../../../lib/shared/providers/gateway_routing.ts';
import { relayDeps } from './deps.ts';
import type { RelayConnector } from './endpoint.ts';
import type { UpstreamFetch } from './passthrough.ts';
import { createRelayHandler, tokenHashOf } from './server.ts';
import { bookCall, grantOf, remainingCents } from './store.ts';

const sse = (event: Record<string, unknown>) =>
  `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;

/** Claude answering a call: 1,000 input, 4,000 cache reads, 200 output. */
const ANSWER = [
  sse({
    type: 'message_start',
    message: {
      usage: {
        input_tokens: 1000,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 0,
        output_tokens: 1,
      },
    },
  }),
  sse({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Done.' },
  }),
  sse({ type: 'message_delta', usage: { output_tokens: 200 } }),
  sse({ type: 'message_stop' }),
].join('');

/** What the answer costs at the prices below, in cents. */
const ANSWER_CENTS = 0.72;

const ANTHROPIC: RelayConnector = {
  name: 'anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-ant-itest',
};

export async function checkModelRelay(
  sql: Sql,
  ctx: { orgId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId } = ctx;
  const now = Date.now();
  const sessionId = `relay-itest-${randomUUID()}`;
  const keyId = `tr_itest_${randomUUID()}`;
  const token = `tale-rt-itest-${randomUUID()}`;
  const bridgeOnly = `tale-sub-itest-${randomUUID()}`;
  const upstreamCalls: string[] = [];
  const fetcher: UpstreamFetch = async (url) => {
    upstreamCalls.push(url);
    return new Response(ANSWER, {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  const handler = () =>
    createRelayHandler({
      grantOf: (hash) => grantOf(sql, hash),
      remainingCents: (key) => remainingCents(sql, key),
      bookCall: (key, usage, cents) => bookCall(sql, key, usage, cents),
      connectorFor: async () => ({
        connector: ANTHROPIC,
        entry: {
          id: 'claude-sonnet-5-5',
          provider: 'anthropic',
          tags: ['chat'],
          supportsTools: true,
          supportsVision: true,
          contextWindow: 200_000,
          pricing: {
            inputCentsPerMillion: 300,
            outputCentsPerMillion: 1500,
            cacheReadCentsPerMillion: 30,
          },
        },
      }),
      fetcher,
    });
  const call = (relay: (r: Request) => Promise<Response>, bearer = token) =>
    relay(
      new Request('http://relay/anthropic/v1/messages', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-sonnet-5-5',
          stream: true,
          max_tokens: 1000,
          messages: [{ role: 'user', content: 'go' }],
        }),
      }),
    );
  const op = async () =>
    (
      await sql<
        {
          spent: number;
          input: number;
          cacheRead: number;
          output: number;
          calls: number;
        }[]
      >`
        SELECT relay_spent_cents::float8 AS spent,
               relay_input_tokens::float8 AS input,
               relay_cache_read_tokens::float8 AS "cacheRead",
               relay_output_tokens::float8 AS output,
               relay_calls AS calls
        FROM app.sandbox_session_ops WHERE minted_key_id = ${keyId}
      `
    )[0];
  /** Booking runs once the answer has ended: wait for the count to move. */
  const bookedCalls = async (want: number): Promise<number> => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const calls = (await op())?.calls ?? 0;
      if (calls >= want) return calls;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return (await op())?.calls ?? 0;
  };

  await sql`
    INSERT INTO app.sandbox_sessions (
      org_id, session_id, status, owner_type, owner_id, created_by,
      llm_gateway_key_id, created_at_ms, expires_at_ms
    ) VALUES (
      ${orgId}, ${sessionId}, 'active', 'render', ${sessionId},
      'itest:relay', ${keyId}, ${now}, ${now + 3_600_000}
    )
  `;
  await sql`
    INSERT INTO app.sandbox_session_tokens (
      org_id, session_id, token_hash, llm_gateway_key_id, scope,
      created_at_ms, expires_at_ms
    ) VALUES
      (${orgId}, ${sessionId}, ${tokenHashOf(token)}, ${keyId},
       ${sql.json({
         agentKind: 'claude-code',
         allowedModels: ['anthropic/claude-sonnet-5-5'],
         relayModels: [
           { providerSlug: 'anthropic', modelId: 'claude-sonnet-5-5' },
         ],
         connectorGrants: [],
         budgetCents: 2,
       })},
       ${now}, ${now + 3_600_000}),
      (${orgId}, ${sessionId}, ${tokenHashOf(bridgeOnly)}, ${keyId},
       ${sql.json({
         agentKind: 'claude-code',
         allowedModels: [],
         connectorGrants: [],
         budgetCents: 0,
       })},
       ${now}, ${now + 3_600_000})
  `;
  await sql`
    INSERT INTO app.sandbox_session_ops (
      org_id, session_id, exec_id, kind, status, started_at_ms,
      minted_key_id, budget_cents
    ) VALUES (
      ${orgId}, ${sessionId}, 'exec-relay-itest', 'task-agent', 'running',
      ${now}, ${keyId}, 2
    )
  `;

  try {
    // One call, booked on the turn's op at the catalog price.
    const relay = handler();
    const first = await call(relay);
    await first.text();
    await bookedCalls(1);
    const booked = await op();
    record(
      'model relay: a call is booked on its turn (migration 0239) [RELAY-R5]',
      first.status === 200 &&
        booked !== undefined &&
        Math.abs(booked.spent - ANSWER_CENTS) < 1e-9 &&
        booked.input === 1000 &&
        booked.cacheRead === 4000 &&
        booked.output === 200 &&
        booked.calls === 1,
      `status ${first.status}, op ${JSON.stringify(booked)}`,
    );

    // Two calls at once, both booked: the UPDATE adds, it never overwrites.
    const both = await Promise.all([call(relay), call(relay)]);
    await Promise.all(both.map((answer) => answer.text()));
    const calls = await bookedCalls(3);
    const after = await op();
    record(
      'model relay: two calls of a turn at once are both booked [RELAY-R5]',
      calls === 3 &&
        after !== undefined &&
        Math.abs(after.spent - 3 * ANSWER_CENTS) < 1e-9,
      `op ${JSON.stringify(after)}`,
    );

    // The allowance: 2 cents, less 2.16 booked, is spent.
    const before = upstreamCalls.length;
    const spent = await call(relay);
    record(
      'model relay: a turn past its allowance is refused, its images counted [RELAY-R4]',
      spent.status === 402 && upstreamCalls.length === before,
      `status ${spent.status}, upstream calls ${upstreamCalls.length - before}`,
    );
    await sql`
      UPDATE app.sandbox_session_ops
      SET budget_cents = 10, image_hold_cents = 7.9, image_hold_requests = 1,
          image_call_started_at_ms = ${Date.now()}
      WHERE minted_key_id = ${keyId}
    `;
    const held = await call(relay);
    record(
      'model relay: an image the turn holds leaves its allowance [RELAY-R4]',
      held.status === 402,
      `status ${held.status} (10 cents, 2.16 booked, 7.9 held for images)`,
    );

    // A token that calls no model through the relay, and a revoked one.
    const bridge = await call(handler(), bridgeOnly);
    await sql`
      UPDATE app.sandbox_session_tokens SET revoked_at_ms = ${Date.now()}
      WHERE token_hash = ${tokenHashOf(token)}
    `;
    const revoked = await call(handler());
    record(
      'model relay: a bridge-only token and a revoked one call no model [RELAY-R1]',
      bridge.status === 401 && revoked.status === 401,
      `bridge-only ${bridge.status}, revoked ${revoked.status}`,
    );
  } finally {
    await sql`DELETE FROM app.sandbox_session_ops WHERE minted_key_id = ${keyId}`;
    await sql`DELETE FROM app.sandbox_session_tokens WHERE session_id = ${sessionId}`;
    await sql`DELETE FROM app.sandbox_sessions WHERE session_id = ${sessionId}`;
  }
}

/** The prompt a lane's harness sends, in tokens. */
const TURN_PROMPT_TOKENS = 1000;

/**
 * The model relay a lane's fake harness calls: in process, on the backend's
 * own deps (`relayDeps`). It admits the token the host put in an exec's env
 * for the turn's model, serves the call with the credential the turn was
 * minted with, and books it on the turn's op, where the settle reads it.
 * The vendor is the fetch seam, and the model's catalog entry is priced so
 * one call costs `cents`.
 */
export function laneRelay(
  sql: Sql,
  cents: number,
): {
  /** One call with the relay token an exec's body carries; returns once
   * the relay has booked it. */
  call: (execBody: string) => Promise<void>;
  /** Each call's status: 0 when the body carried no live relay token. */
  statuses: number[];
  /** The authorization each call reached the vendor with. */
  vendorKeys: string[];
} {
  const live = relayDeps(sql);
  const statuses: number[] = [];
  const vendorKeys: string[] = [];
  const relay = createRelayHandler({
    ...live,
    connectorFor: async (grant, providerSlug, modelId) => {
      const served = await live.connectorFor(grant, providerSlug, modelId);
      return {
        connector: served.connector,
        entry:
          served.entry === undefined
            ? undefined
            : {
                ...served.entry,
                pricing: {
                  inputCentsPerMillion:
                    (cents * 1_000_000) / TURN_PROMPT_TOKENS,
                  outputCentsPerMillion: 0,
                },
              },
      };
    },
    fetcher: async (_url, init) => {
      vendorKeys.push(new Headers(init.headers).get('authorization') ?? '');
      return Response.json({
        id: 'chatcmpl-itest-turn',
        object: 'chat.completion',
        created: 0,
        model: 'itest-agent-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'On it.' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: TURN_PROMPT_TOKENS,
          completion_tokens: 20,
          total_tokens: TURN_PROMPT_TOKENS + 20,
        },
      });
    },
  });
  const call = async (execBody: string): Promise<void> => {
    const token = /tale-rt-[\w-]+/.exec(execBody)?.[0];
    const grant =
      token === undefined ? null : await grantOf(sql, tokenHashOf(token));
    const model = grant?.allowedModels[0];
    if (token === undefined || grant === null || model === undefined) {
      statuses.push(0);
      return;
    }
    const answer = await relay(
      new Request('http://relay/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: resolveGatewayRouting(
            grant.organizationId,
            model.providerSlug,
            model.modelId,
            { anthropicHarnessLane: model.anthropicHarnessLane === true },
          ).gatewayModel,
          messages: [{ role: 'user', content: 'Do the work.' }],
        }),
      }),
    );
    await answer.text();
    statuses.push(answer.status);
    if (answer.status !== 200) return;
    // Booking runs once the answer has ended: wait for the count to move.
    for (let attempt = 0; attempt < 50; attempt++) {
      const rows = await sql<{ calls: number }[]>`
        SELECT relay_calls AS calls FROM app.sandbox_session_ops
        WHERE minted_key_id = ${grant.keyId}
      `;
      if ((rows[0]?.calls ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };
  return { call, statuses, vendorKeys };
}
