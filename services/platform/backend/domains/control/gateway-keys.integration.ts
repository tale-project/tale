/**
 * The keys the retired sandbox LLM gateway still has open, over real
 * Postgres and through the control door (tale-project/tale#4942): what
 * `tale deploy` asks before it removes the gateway's container. Seeds keys
 * the gateway minted in every state that counts and every one that does
 * not, beside keys the model relay minted, and reads the answer as the CLI
 * does. Other lanes leave keys of their own in the suite's database, so
 * the lane reads the count before it seeds, and checks what its rows add.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';

export async function checkControlGatewayKeys(
  sql: Sql,
  base: string,
  ctx: { orgId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId } = ctx;
  const token = process.env.TALE_CONTROL_TOKEN ?? '';
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const key = (name: string) => `vk-ctrl-${suffix}-${name}`;
  const relayKey = (name: string) => `tr_ctrl-${suffix}-${name}`;
  const session = (name: string) => `ctrl-gk-${suffix}-${name}`;
  const sessions = [
    'ops',
    'live',
    'ended',
    'parked',
    'parked-gone',
    'parked-old',
  ].map(session);
  const jobIds: string[] = [];

  const ask = async (bearer: string | undefined): Promise<Response> =>
    fetch(`${base}/api/control/gateway-keys`, {
      headers:
        bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
    });
  const openNow = async (): Promise<number> => {
    const res = await ask(token);
    const body: unknown = await res.json();
    if (
      res.status !== 200 ||
      typeof body !== 'object' ||
      body === null ||
      !('open' in body) ||
      typeof body.open !== 'number'
    ) {
      throw new Error(
        `GET /api/control/gateway-keys answered ${res.status}: ${JSON.stringify(body)}`,
      );
    }
    return body.open;
  };

  const seedSession = async (
    sessionId: string,
    status: string,
    keyId: string | null = null,
  ): Promise<void> => {
    await sql`
      INSERT INTO app.sandbox_sessions (
        org_id, session_id, status, owner_type, owner_id, created_by,
        llm_gateway_key_id, created_at_ms, expires_at_ms, destroyed_at_ms
      ) VALUES (
        ${orgId}, ${sessionId}, ${status}, 'render', ${sessionId},
        'itest:ctrl-gk', ${keyId}, ${now}, ${now + 3_600_000},
        ${status === 'destroyed' ? now : null}
      )
    `;
  };
  const seedToken = async (
    sessionId: string,
    keyId: string,
    revoked = false,
  ): Promise<void> => {
    await sql`
      INSERT INTO app.sandbox_session_tokens (
        org_id, session_id, token_hash, llm_gateway_key_id, scope,
        created_at_ms, expires_at_ms, revoked_at_ms
      ) VALUES (
        ${orgId}, ${sessionId}, ${`ctrl-gk-${randomUUID()}`}, ${keyId},
        ${sql.json({ agentKind: 'claude-code', allowedModels: [], connectorGrants: [], budgetCents: 100 })},
        ${now}, ${now + 3_600_000}, ${revoked ? now : null}
      )
    `;
  };
  const seedOp = async (
    execId: string,
    keyId: string | null,
    facts: { spendSettled: boolean; keyRevoked: boolean },
  ): Promise<void> => {
    await sql`
      INSERT INTO app.sandbox_session_ops (
        org_id, session_id, exec_id, kind, status, minted_key_id,
        started_at_ms, finalized_at_ms, spend_settled_at_ms,
        key_revoked_at_ms
      ) VALUES (
        ${orgId}, ${session('ops')}, ${execId}, 'workflow-agent', 'completed',
        ${keyId}, ${now}, ${now},
        ${facts.spendSettled ? now : null}, ${facts.keyRevoked ? now : null}
      )
    `;
  };

  try {
    // Door auth first: the count is the deployment's, the token its key.
    const refused = await ask(undefined);
    const wrong = await ask('not-the-token');
    const before = await openNow();

    // Ops: open until the spend is booked AND the key is revoked.
    await seedOp('unsettled', key('unsettled'), {
      spendSettled: false,
      keyRevoked: false,
    });
    await seedOp('unrevoked', key('unrevoked'), {
      spendSettled: true,
      keyRevoked: false,
    });
    await seedOp('closed', key('closed'), {
      spendSettled: true,
      keyRevoked: true,
    });
    await seedOp('relay', relayKey('op'), {
      spendSettled: false,
      keyRevoked: false,
    });
    await seedOp('keyless', null, { spendSettled: false, keyRevoked: false });
    // Tokens: open while unrevoked under a session with a live incarnation.
    await seedSession(session('live'), 'active');
    await seedToken(session('live'), key('live-token'));
    await seedToken(session('live'), key('revoked-token'), true);
    // The same key as an open op: counted once.
    await seedToken(session('live'), key('unsettled'));
    await seedToken(session('live'), relayKey('token'));
    await seedSession(session('ended'), 'expired');
    await seedToken(session('ended'), key('ended-token'));
    // Parked keys: open while their session has a live incarnation.
    await seedSession(session('parked'), 'stopped', key('parked'));
    await seedSession(session('parked-gone'), 'destroyed', key('parked-gone'));
    await seedSession(session('parked-old'), 'destroyed', key('parked-old'));
    await seedSession(session('parked-old'), 'active');
    // A deleted organization's retirement: open while its job waits. Held
    // a day out, so no worker takes these jobs while the lane runs.
    const later = new Date(now + 24 * 3_600_000);
    const waiting = await addJobInTx(
      sql,
      'sandbox.retire_organization',
      {
        organizationId: `ctrl-gk-${suffix}-gone`,
        sessionIds: [],
        // One key of its own, one an op holds too, and a relay key.
        gatewayKeyIds: [key('job'), key('unrevoked'), relayKey('job')],
        deviceIds: [],
        teardown: false,
      },
      { startAfter: later },
    );
    const finished = await addJobInTx(
      sql,
      'sandbox.retire_organization',
      {
        organizationId: `ctrl-gk-${suffix}-done`,
        sessionIds: [],
        gatewayKeyIds: [key('job-done')],
        deviceIds: [],
        teardown: false,
      },
      { startAfter: later },
    );
    for (const id of [waiting, finished]) {
      if (id !== null) jobIds.push(id);
    }
    if (finished !== null) {
      await sql`
        UPDATE pgboss.job SET state = 'completed', completed_on = now()
        WHERE id = ${finished}
      `;
    }

    const after = await openNow();
    // unsettled, unrevoked, live-token, parked, parked-old, job.
    const want = 6;
    record(
      'control: the deploy reads how many keys the retired gateway still has open [CTRL-R6]',
      refused.status === 401 &&
        wrong.status === 401 &&
        jobIds.length === 2 &&
        after - before === want,
      `no token=${refused.status} wrong token=${wrong.status} (want 401/401), jobs=${jobIds.length} (want 2), open ${before} → ${after}: added ${after - before} (want ${want})`,
    );

    // The keys close: the op books and revokes, the token and the parked key
    // go with their teardown, the job finishes.
    await sql`
      UPDATE app.sandbox_session_ops
      SET spend_settled_at_ms = ${now}, key_revoked_at_ms = ${now}
      WHERE org_id = ${orgId} AND session_id = ${session('ops')}
    `;
    await sql`
      UPDATE app.sandbox_session_tokens SET revoked_at_ms = ${now}
      WHERE org_id = ${orgId} AND session_id = ANY(${sessions})
    `;
    await sql`
      UPDATE app.sandbox_sessions SET llm_gateway_key_id = NULL
      WHERE org_id = ${orgId} AND session_id = ANY(${sessions})
    `;
    if (waiting !== null) {
      await sql`
        UPDATE pgboss.job SET state = 'completed', completed_on = now()
        WHERE id = ${waiting}
      `;
    }
    const closed = await openNow();
    record(
      'control: a key the retired gateway minted stops counting once nothing will settle it [CTRL-R6]',
      closed === before,
      `open ${before} → ${after} → ${closed} (want ${before} again)`,
    );
  } finally {
    await sql`
      DELETE FROM app.sandbox_session_ops
      WHERE org_id = ${orgId} AND session_id = ANY(${sessions})
    `;
    await sql`
      DELETE FROM app.sandbox_session_tokens
      WHERE org_id = ${orgId} AND session_id = ANY(${sessions})
    `;
    await sql`
      DELETE FROM app.sandbox_sessions
      WHERE org_id = ${orgId} AND session_id = ANY(${sessions})
    `;
    if (jobIds.length > 0) {
      await sql`DELETE FROM pgboss.job WHERE id = ANY(${jobIds}::uuid[])`;
    }
  }
}
