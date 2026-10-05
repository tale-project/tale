/** Real Postgres proof of the op row's live transcript: every flush folds into
 * the stored `live_timeline` under the row lock, so a disjoint, overlapping,
 * stale or concurrent drain-window flush never costs an entry the row holds. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import type { TimelinePart } from '../../../lib/harnesses/timeline';
import { agentTurnShimHandlers } from './agent-turn-shim.ts';

function tool(id: string, state = 'output-available'): TimelinePart {
  return {
    type: 'tool-Bash',
    state,
    toolCallId: id,
    input: { command: `run ${id}` },
  };
}

function text(words: string): TimelinePart {
  return { type: 'text', text: words };
}

/** A transcript as its entries read in order — jsonb re-orders object keys,
 * so the checks compare this rather than the serialized parts. */
function shape(parts: readonly TimelinePart[] | null): string {
  return (parts ?? [])
    .map((part) =>
      part.toolCallId !== undefined
        ? `${part.toolCallId}:${part.state ?? ''}`
        : JSON.stringify(part.text ?? ''),
    )
    .join(' ');
}

export async function checkSessionOpTranscriptMerge(
  sql: Sql,
  ctx: { orgId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const upsert =
    agentTurnShimHandlers(sql)['sandbox/session_mutations:upsertSessionOp'];
  if (upsert === undefined) {
    throw new Error('the task-agent shim answers no upsertSessionOp');
  }
  const sessionId = `itest-transcript-${randomUUID()}`;
  const flush = (execId: string, liveTimeline?: TimelinePart[]) =>
    upsert({
      organizationId: ctx.orgId,
      sessionId,
      execId,
      kind: 'task-agent',
      status: 'running',
      lastEventAt: Date.now(),
      ...(liveTimeline !== undefined ? { liveTimeline } : {}),
    });
  const stored = async (execId: string): Promise<TimelinePart[] | null> => {
    const rows = await sql<{ liveTimeline: TimelinePart[] | null }[]>`
      SELECT live_timeline AS "liveTimeline" FROM app.sandbox_session_ops
      WHERE session_id = ${sessionId} AND exec_id = ${execId}
    `;
    return rows[0]?.liveTimeline ?? null;
  };
  try {
    // A fresh window whose ring buffer lost the turn's head, as long as the
    // stored transcript and sharing none of it: a length pick swapped them.
    await flush('exec-disjoint', [
      text('Reading the brief'),
      tool('t1'),
      tool('t2'),
    ]);
    await flush('exec-disjoint', [
      tool('t3'),
      text('Drafting the report'),
      tool('t4', 'input-available'),
    ]);
    const disjoint = shape(await stored('exec-disjoint'));
    record(
      'session op transcript: a disjoint flush of equal length keeps the union',
      disjoint ===
        '"Reading the brief" t1:output-available t2:output-available t3:output-available "Drafting the report" t4:input-available',
      `stored=${disjoint}`,
    );

    await flush('exec-overlap', [
      text('Reading the brief'),
      tool('t1'),
      text('Writing'),
      tool('t2', 'input-available'),
    ]);
    await flush('exec-overlap', [
      tool('t1'),
      text('Writing the summary'),
      tool('t2'),
      tool('t3', 'input-available'),
    ]);
    const overlap = shape(await stored('exec-overlap'));
    record(
      'session op transcript: an overlapping flush is deduplicated, shared entries updated in place',
      overlap ===
        '"Reading the brief" t1:output-available "Writing the summary" t2:output-available t3:input-available',
      `stored=${overlap}`,
    );

    const full = [
      text('Reading the brief'),
      tool('t1'),
      text('Writing'),
      tool('t2'),
      tool('t3'),
    ];
    await flush('exec-stale', full);
    await flush('exec-stale', [text('Reading the brief'), tool('t1')]);
    const afterStale = shape(await stored('exec-stale'));
    // A write that carries no transcript (a heartbeat, a status stamp)
    // leaves the stored one as it is.
    await flush('exec-stale');
    const afterBare = shape(await stored('exec-stale'));
    record(
      'session op transcript: a stale, shorter flush does not regress the stored transcript',
      afterStale === shape(full) && afterBare === shape(full),
      `afterStale=${afterStale} afterBare=${afterBare}`,
    );

    // A progress callback can wait behind a slow database write while the
    // gateway or recovery claim records a newer heartbeat. Its event time
    // must not replace that newer independent sign of agent life.
    await flush('exec-heartbeat', [text('Working')]);
    const freshHeartbeat = Date.now();
    await sql`UPDATE app.sandbox_session_ops SET heartbeat_at_ms = ${freshHeartbeat}
      WHERE session_id = ${sessionId} AND exec_id = 'exec-heartbeat'`;
    await upsert({
      organizationId: ctx.orgId,
      sessionId,
      execId: 'exec-heartbeat',
      kind: 'task-agent',
      status: 'running',
      heartbeatAt: freshHeartbeat - 300_000,
      lastEventAt: freshHeartbeat - 300_000,
      liveTimeline: [tool('delayed')],
    });
    const heartbeatRows = await sql<{ heartbeatAt: number }[]>`
      SELECT heartbeat_at_ms::float8 AS "heartbeatAt"
      FROM app.sandbox_session_ops
      WHERE session_id = ${sessionId} AND exec_id = 'exec-heartbeat'
    `;
    record(
      'session op heartbeat: delayed progress preserves a newer gateway or recovery heartbeat',
      heartbeatRows[0]?.heartbeatAt === freshHeartbeat &&
        shape(await stored('exec-heartbeat')) ===
          '"Working" delayed:output-available',
      `heartbeat=${heartbeatRows[0]?.heartbeatAt} expected=${freshHeartbeat}`,
    );

    // Concurrent flushes, each carrying one new tool call: the row lock
    // orders them, so every one folds into what the previous one wrote. The
    // second exec has no row yet, so its first writes race the insert too.
    const racers = Array.from({ length: 8 }, (_, i) => `r${String(i)}`);
    await flush('exec-race', [text('Working')]);
    await Promise.all(racers.map((id) => flush('exec-race', [tool(id)])));
    await Promise.all(racers.map((id) => flush('exec-first', [tool(id)])));
    const toolIds = (parts: TimelinePart[] | null): string[] =>
      (parts ?? [])
        .flatMap((part) =>
          part.toolCallId !== undefined ? [part.toolCallId] : [],
        )
        .toSorted();
    const race = await stored('exec-race');
    const first = await stored('exec-first');
    record(
      'session op transcript: concurrent flushes all fold in, with or without a row to lock',
      race?.[0]?.text === 'Working' &&
        race.length === racers.length + 1 &&
        toolIds(race).join(',') === racers.join(',') &&
        first?.length === racers.length &&
        toolIds(first).join(',') === racers.join(','),
      `race=${shape(race)} first=${shape(first)}`,
    );
  } finally {
    // Only this probe's own session is removed; no shared state is reset.
    await sql`DELETE FROM app.sandbox_session_ops WHERE session_id = ${sessionId}`;
  }
}
