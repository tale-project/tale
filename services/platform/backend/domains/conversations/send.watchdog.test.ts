import { describe, expect, it } from 'vitest';

import { recoverStuckConversationSends } from './send.ts';

/**
 * Unit lock for the outbound-send crash-recovery waker (job-liveness class): a
 * send stranded 'queued' by a lost/expired job is flipped to an HONEST
 * 'failed' state (with a reason) and a realtime hint is emitted so the
 * sender's retry/discard controls appear. The stale-window scan and the
 * retry-surface round-trip ride the real-Postgres probe in
 * `integration-check.ts`.
 */

function capturingSql(
  script: unknown[][],
  queries: string[],
  // oxlint-disable-next-line typescript/no-explicit-any -- test double for the postgres.js tag
): any {
  let i = 0;
  const fn = (strings: TemplateStringsArray): Promise<unknown[]> => {
    if (Array.isArray(strings)) queries.push(strings.join('?'));
    return Promise.resolve(i < script.length ? (script[i++] ?? []) : []);
  };
  fn.json = (value: unknown): unknown => value;
  return fn;
}

describe('recoverStuckConversationSends', () => {
  it('fails stranded queued sends with a reason and emits a hint', async () => {
    const queries: string[] = [];
    const sql = capturingSql(
      [
        // the UPDATE ... RETURNING flips the queued row to failed
        [{ id: 'msg_1', conversationId: 'conv_1', orgId: 'org_1' }],
        // emitHintInTx's outbox insert
        [],
      ],
      queries,
    );

    const result = await recoverStuckConversationSends(sql, { staleMs: 1_000 });

    expect(result).toEqual({ failed: 1 });
    // Honest terminal state, keyed off outbound queued rows.
    expect(queries[0]).toContain("delivery_state = 'failed'");
    expect(queries[0]).toContain("delivery_state = 'queued'");
    expect(queries[0]).toContain("direction = 'outbound'");
    // A realtime hint lights up the retry surface in the open inbox.
    expect(queries[1]).toContain('app_realtime.outbox');
  });

  it('reports zero and emits nothing when no send is stranded', async () => {
    const queries: string[] = [];
    const sql = capturingSql([[]], queries);

    const result = await recoverStuckConversationSends(sql);

    expect(result).toEqual({ failed: 0 });
    // Only the sweep query ran — no per-row hint.
    expect(queries).toHaveLength(1);
  });
});
