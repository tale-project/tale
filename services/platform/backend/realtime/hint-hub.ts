import type { SSEStreamingApi } from 'hono/streaming';
import type { Sql } from 'postgres';

import {
  describeDatabaseError,
  isDatabaseUnavailable,
} from '../db/unavailable.ts';
import { reportError } from '../error-reporting.ts';
import { coalesceHints } from './hints.ts';
import {
  createOutboxReclaimer,
  latestOutboxId,
  outboxRetainsCursor,
  readHintsAfter,
  reclaimOutbox,
} from './outbox.ts';
import {
  createHeartbeat,
  createStreamWriter,
  type FanoutStream,
  frameEvent,
  jitteredRetryMs,
  type StreamWriter,
} from './sse-fanout.ts';

/**
 * The process-shared tail of the hint outbox.
 *
 * Every `/events` stream used to run its own loop: a query every 300 ms for
 * its org's hints, two more every 15 s to re-prove its reader. That is about
 * 3.5 queries a second per open browser tab — a million tabs would ask the
 * database for 3.5 million queries a second, all for rows most of them do
 * not want. The hub turns that around: ONE loop per process reads every new
 * outbox row once and fans it out in memory to the streams it concerns, and
 * ONE batched pass re-proves every reader on the recheck cadence. The cost
 * is per process, not per tab.
 *
 * What a stream sees is unchanged: hints for its org (and its user's own
 * targeted hints) strictly after its cursor, coalesced per poll, ascending
 * by id; `resync` when a resumed cursor can no longer be replayed in full;
 * `forbidden` when its reader lost the membership or the session; heartbeats
 * on an idle lane.
 *
 * Resume is served from memory where it can be: the hub keeps the newest
 * outbox rows in a ring, so a browser reconnecting after a deploy (with its
 * `Last-Event-ID`) replays from the ring without a per-stream read. Only a
 * cursor older than the ring takes the database path the per-stream loop
 * used — read, then check the cursor is still retained. A ring resume still
 * answers whether the database retains its cursor (a client whose cursor
 * fell out of retention is told to `resync`, whichever process it reaches),
 * from one read of the oldest retained id that every resume within
 * `OLDEST_RETAINED_TTL_MS` shares — a reconnect storm costs a few reads.
 */

/** Newest outbox rows the hub keeps for in-memory resume. */
const DEFAULT_RING_CAPACITY = 20_000;
/** Rows one tail read takes; a full page reads again without sleeping. */
const DEFAULT_TAIL_PAGE = 2_000;
/** Rows one catch-up read of a resumed stream takes (the per-stream page). */
const CATCH_UP_PAGE = 500;
/** Pairs one batched authorization query checks. */
const RECHECK_CHUNK = 500;
/** How long resumes share one read of the oldest retained outbox id. */
const OLDEST_RETAINED_TTL_MS = 250;
/** How long the tail keeps looking for an id it read past. */
const DEFAULT_LATE_COMMIT_GRACE_MS = 30_000;
/** Ids read past that the tail tracks at most: of a bigger jump (a mass
 * rollback, a sequence reset) only the newest are chased. */
const LATE_COMMIT_MAX_TRACKED = 10_000;
/** Newest preloaded rows whose gaps a starting tail checks for late commits. */
const LATE_COMMIT_STARTUP_ROWS = 2_000;
/** Ids under the first row a tail started on an empty outbox looks for. */
const LATE_COMMIT_EMPTY_START_IDS = 1_000n;
/**
 * How long the loop keeps reading after its last stream left. Zero by
 * default: a process without streams stops polling (the worker's reclaim
 * cron keeps the outbox bounded), at the price of reloading the ring when
 * the next stream arrives.
 */
const DEFAULT_LINGER_MS = 0;

export interface HintHubOptions {
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  authRecheckIntervalMs: number;
  errorBackoffMs: number;
  unavailableBackoffMaxMs: number;
  outageReportAfterMs: number;
  ringCapacity?: number;
  tailPage?: number;
  lingerMs?: number;
  maxPendingWrites?: number;
  /** How long the tail looks for an id it read past (see `noteSkipped`). */
  lateCommitGraceMs?: number;
}

export interface HintSubscription {
  orgId: string;
  userId: string;
  sessionId: string;
  /** The client's `Last-Event-ID` when it is resuming, else null. */
  resumeCursor: string | null;
}

interface TailRow {
  id: bigint;
  idText: string;
  orgId: string;
  userId: string | null;
  entity: string;
  entityId: string | null;
}

interface Subscriber extends FanoutStream {
  readonly orgId: string;
  readonly userId: string;
  readonly sessionId: string;
  /** Rows at or below this id were delivered (or are not for this stream). */
  cursor: bigint | null;
  /** Delivered by the tail loop; false while a resumed stream catches up. */
  live: boolean;
  writer: StreamWriter;
  finish: () => void;
}

function toBigInt(id: string): bigint {
  return BigInt(id);
}

function hintFrame(row: TailRow): string {
  return frameEvent({
    event: 'hint',
    id: row.idText,
    data: JSON.stringify({ entity: row.entity, entityId: row.entityId }),
  });
}

function tailRowOf(row: {
  id: string;
  org_id: string;
  user_id: string | null;
  entity: string;
  entity_id: string | null;
}): TailRow {
  return {
    id: toBigInt(row.id),
    idText: row.id,
    orgId: row.org_id,
    userId: row.user_id ?? null,
    entity: row.entity,
    entityId: row.entity_id,
  };
}

/** A hint that committed after the tail read past its id: framed without
 * an `id`, so the browser's resume position does not move backwards. */
function lateHintFrame(row: TailRow): string {
  return frameEvent({
    event: 'hint',
    data: JSON.stringify({ entity: row.entity, entityId: row.entityId }),
  });
}

/**
 * A database outage as the hub sees it: the first failure logs it, the
 * first success logs its end, and an outage that outlasts `reportAfterMs`
 * is reported once, at warning level.
 */
function createOutageWatch(reportAfterMs: number): {
  failed: (error: unknown) => void;
  recovered: () => void;
} {
  let since: number | null = null;
  let reported = false;
  return {
    failed(error) {
      const now = Date.now();
      if (since === null) {
        since = now;
        reported = false;
        console.warn(
          `[backend] /events: database unavailable, streams backing off: ${describeDatabaseError(error)}`,
        );
        return;
      }
      const outageMs = now - since;
      if (!reported && outageMs >= reportAfterMs) {
        reported = true;
        console.warn(
          `[backend] /events: database still unavailable after ${Math.round(outageMs / 1000)}s`,
        );
        reportError(error, {
          level: 'warning',
          tags: { 'tale.lane': 'events-poll' },
          extra: { outageMs },
        });
      }
    },
    recovered() {
      if (since === null) return;
      console.log(
        `[backend] /events: database back after ${Math.round((Date.now() - since) / 1000)}s`,
      );
      since = null;
      reported = false;
    },
  };
}

export interface HintHub {
  /**
   * Serve one stream until it ends (client gone, reader refused, process
   * shutting down). Resolves once the stream's last write is flushed.
   */
  attach: (
    stream: SSEStreamingApi,
    subscription: HintSubscription,
  ) => Promise<void>;
  /** Streams currently attached (tests and telemetry). */
  size: () => number;
}

export function createHintHub(sql: Sql, options: HintHubOptions): HintHub {
  const ringCapacity = options.ringCapacity ?? DEFAULT_RING_CAPACITY;
  const tailPage = options.tailPage ?? DEFAULT_TAIL_PAGE;
  const lingerMs = options.lingerMs ?? DEFAULT_LINGER_MS;
  const lateCommitGraceMs =
    options.lateCommitGraceMs ?? DEFAULT_LATE_COMMIT_GRACE_MS;
  const outage = createOutageWatch(options.outageReportAfterMs);
  /** The last read of the oldest retained id, shared by resumes. */
  let oldestRead: { at: number; value: Promise<bigint | null> } | null = null;
  const reclaimer = createOutboxReclaimer({
    reclaim: async () => {
      const reclaimed = await reclaimOutbox(sql);
      // A prefix just went: the next resume reads the oldest id afresh.
      if (reclaimed > 0) oldestRead = null;
      return reclaimed;
    },
  });

  const byOrg = new Map<string, Set<Subscriber>>();
  const all = new Set<Subscriber>();
  /** The process's tail position; null until the loop has read it. */
  let cursor: bigint | null = null;
  /** The newest rows, ascending; contiguous up to `cursor`. */
  let ring: TailRow[] = [];
  /** Ids the tail read past without a row, and when it first did. */
  const skipped = new Map<bigint, number>();
  let loopRunning = false;
  let lastRecheckAt = Date.now();
  let rechecking = false;
  let idleSince: number | null = null;
  let unavailableBackoffMs = options.errorBackoffMs;
  /** Wakes catch-up readers waiting for the tail to know its position. */
  let cursorWaiters: (() => void)[] = [];

  const heartbeat = createHeartbeat({
    intervalMs: options.heartbeatIntervalMs,
    streams: function* () {
      for (const subscriber of all) {
        yield { target: subscriber, writer: subscriber.writer };
      }
    },
  });

  function remove(subscriber: Subscriber): void {
    if (!all.delete(subscriber)) return;
    const peers = byOrg.get(subscriber.orgId);
    if (peers !== undefined) {
      peers.delete(subscriber);
      if (peers.size === 0) byOrg.delete(subscriber.orgId);
    }
    if (all.size === 0) {
      heartbeat.stop();
      idleSince = Date.now();
    }
  }

  function end(subscriber: Subscriber): void {
    if (subscriber.ended) return;
    subscriber.ended = true;
    remove(subscriber);
    subscriber.finish();
  }

  function appendToRing(rows: readonly TailRow[]): void {
    if (rows.length === 0) return;
    ring.push(...rows);
    if (ring.length > ringCapacity) {
      ring = ring.slice(ring.length - ringCapacity);
    }
  }

  /**
   * Put rows that committed late into the ring at their place by id, and
   * only inside its span: the ring's oldest row is what `ringCovers` trusts
   * for a resume, so a row older than it is not put in front of it (a full
   * ring would trim it again at once; a younger ring must not appear to
   * reach further back). Such a row still went to every live stream.
   */
  function insertIntoRing(rows: readonly TailRow[]): void {
    for (const row of rows) {
      const oldest = ring[0];
      if (oldest === undefined || row.id < oldest.id) continue;
      let low = 0;
      let high = ring.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        const at = ring[middle];
        if (at !== undefined && at.id < row.id) low = middle + 1;
        else high = middle;
      }
      if (ring[low]?.id !== row.id) ring.splice(low, 0, row);
    }
    if (ring.length > ringCapacity) {
      ring = ring.slice(ring.length - ringCapacity);
    }
  }

  /**
   * Remember the ids a tail read went past without a row. An outbox id is
   * taken when the row is inserted but becomes visible only when its
   * transaction commits, so a transaction that commits after a later one
   * leaves a hole the `id > cursor` read has already passed — the per-stream
   * loop lost those hints for good. A hole is also what a rolled-back insert
   * leaves; either way it is looked for until `lateCommitGraceMs` is over.
   */
  function noteSkipped(from: bigint, rows: readonly TailRow[]): void {
    // A tail that starts on an empty outbox starts at 0, and the first row
    // can be millions of ids on (everything before it was reclaimed): only
    // the ids just under it can belong to a transaction still in flight.
    const head = rows[0];
    if (head === undefined) return;
    const floor = head.id - LATE_COMMIT_EMPTY_START_IDS - 1n;
    const now = Date.now();
    let expected = (from > 0n || floor < 0n ? from : floor) + 1n;
    for (const row of rows) {
      const budget = BigInt(LATE_COMMIT_MAX_TRACKED - skipped.size);
      if (budget <= 0n) return;
      // Of a jump bigger than the budget, keep the newest ids: a
      // transaction still in flight took its id recently.
      const first = row.id - expected > budget ? row.id - budget : expected;
      for (let id = first; id < row.id; id += 1n) skipped.set(id, now);
      expected = row.id + 1n;
    }
  }

  /**
   * Hand rows that committed late to every stream of their orgs: like
   * `dispatch`, an org's org-wide hints are coalesced and framed once and
   * every stream shares the string; only a user-targeted hint is framed
   * for its user.
   */
  function dispatchLate(rows: readonly TailRow[]): void {
    const perOrg = new Map<string, TailRow[]>();
    for (const row of rows) {
      const list = perOrg.get(row.orgId);
      if (list === undefined) perOrg.set(row.orgId, [row]);
      else list.push(row);
    }
    for (const [orgId, orgRows] of perOrg) {
      const subscribers = byOrg.get(orgId);
      if (subscribers === undefined) continue;
      const orgWide = coalesceHints(orgRows.filter((r) => r.userId === null))
        .map(lateHintFrame)
        .join('');
      const targeted = orgRows.filter((r) => r.userId !== null);
      for (const subscriber of subscribers) {
        if (subscriber.ended) continue;
        const own = coalesceHints(
          targeted.filter((r) => r.userId === subscriber.userId),
        )
          .map(lateHintFrame)
          .join('');
        const frames = orgWide + own;
        if (frames !== '') subscriber.writer.write(frames);
      }
    }
  }

  /** Look for the holes once: deliver what committed, forget the expired. */
  async function readLate(): Promise<void> {
    const now = Date.now();
    for (const [id, since] of skipped) {
      if (now - since > lateCommitGraceMs) skipped.delete(id);
    }
    if (skipped.size === 0) return;
    const ids = [...skipped.keys()].map((id) => id.toString());
    const rows = await sql<
      {
        id: string;
        org_id: string;
        user_id: string | null;
        entity: string;
        entity_id: string | null;
      }[]
    >`
      SELECT id::text AS id, org_id, user_id, entity, entity_id
      FROM app_realtime.outbox
      WHERE id = ANY(${ids}::bigint[])
      ORDER BY id ASC
    `;
    if (rows.length === 0) return;
    const late = rows.map(tailRowOf);
    for (const row of late) skipped.delete(row.id);
    insertIntoRing(late);
    dispatchLate(late);
  }

  /** Deliver rows (ascending) to one stream: its org-wide and own hints
   * strictly after its cursor, coalesced like a per-stream poll. */
  function deliver(subscriber: Subscriber, rows: readonly TailRow[]): void {
    const after = subscriber.cursor;
    const mine: TailRow[] = [];
    for (const row of rows) {
      if (row.orgId !== subscriber.orgId) continue;
      if (row.userId !== null && row.userId !== subscriber.userId) continue;
      if (after !== null && row.id <= after) continue;
      mine.push(row);
    }
    const last = rows[rows.length - 1];
    if (last !== undefined && (after === null || last.id > after)) {
      subscriber.cursor = last.id;
    }
    // One write per delivery: a replay of hundreds of hints is one batch
    // for the writer's backlog ceiling, not hundreds of queued writes.
    const frames = coalesceHints(mine).map(hintFrame).join('');
    if (frames !== '') subscriber.writer.write(frames);
  }

  /** Fan one page of new rows out to every live stream of their orgs. */
  function dispatch(rows: readonly TailRow[]): void {
    // A live stream's cursor is not advanced here: the tail only moves
    // forward, so every row it reads is new to every live stream except one
    // that resumed AHEAD of this process's tail (its cursor came from
    // another pod) — and the check below filters that one by its cursor.
    const perOrg = new Map<string, TailRow[]>();
    for (const row of rows) {
      const list = perOrg.get(row.orgId);
      if (list === undefined) perOrg.set(row.orgId, [row]);
      else list.push(row);
    }
    for (const [orgId, orgRows] of perOrg) {
      const subscribers = byOrg.get(orgId);
      if (subscribers === undefined) continue;
      // Most streams get exactly the org-wide hints: frame those once and
      // hand every such stream the same strings.
      const orgWide = orgRows.filter((row) => row.userId === null);
      const targeted = orgRows.length !== orgWide.length;
      const sharedFrames = coalesceHints(orgWide).map(hintFrame).join('');
      for (const subscriber of subscribers) {
        if (!subscriber.live || subscriber.ended) continue;
        if (
          targeted ||
          (subscriber.cursor !== null &&
            orgRows[0] !== undefined &&
            orgRows[0].id <= subscriber.cursor)
        ) {
          deliver(subscriber, orgRows);
        } else {
          if (sharedFrames !== '') subscriber.writer.write(sharedFrames);
        }
      }
    }
  }

  async function readTail(after: bigint): Promise<TailRow[]> {
    const rows = await sql<
      {
        id: string;
        org_id: string;
        user_id: string | null;
        entity: string;
        entity_id: string | null;
      }[]
    >`
      SELECT id::text AS id, org_id, user_id, entity, entity_id
      FROM app_realtime.outbox
      WHERE id > ${after.toString()}::bigint
      ORDER BY id ASC
      LIMIT ${tailPage}
    `;
    return rows.map(tailRowOf);
  }

  /** The tail position plus the newest rows below it for the ring. */
  async function startTail(): Promise<void> {
    const latest = toBigInt(await latestOutboxId(sql));
    const rows = await sql<
      {
        id: string;
        org_id: string;
        user_id: string | null;
        entity: string;
        entity_id: string | null;
      }[]
    >`
      SELECT id::text AS id, org_id, user_id, entity, entity_id
      FROM app_realtime.outbox
      WHERE id <= ${latest.toString()}::bigint
      ORDER BY id DESC
      LIMIT ${ringCapacity}
    `;
    ring = rows
      .map((row) => ({
        id: toBigInt(row.id),
        idText: row.id,
        orgId: row.org_id,
        userId: row.user_id ?? null,
        entity: row.entity,
        entityId: row.entity_id,
      }))
      .reverse();
    cursor = latest;
    // Ids among the newest rows that are not there yet may belong to
    // transactions still in flight as the tail starts: give them the same
    // grace as a hole the tail reads past.
    const recent = ring.slice(-LATE_COMMIT_STARTUP_ROWS);
    const [first, ...rest] = recent;
    if (first !== undefined) noteSkipped(first.id, rest);
    // Streams that attached before the tail knew its position start here.
    for (const subscriber of all) {
      if (subscriber.live && subscriber.cursor === null) {
        subscriber.cursor = latest;
      }
    }
    const waiters = cursorWaiters;
    cursorWaiters = [];
    for (const wake of waiters) wake();
  }

  /** Re-prove every attached reader in a few batched queries. */
  async function recheckReaders(): Promise<void> {
    const subscribers = [...all].filter((s) => !s.ended);
    for (let i = 0; i < subscribers.length; i += RECHECK_CHUNK) {
      const chunk = subscribers.slice(i, i + RECHECK_CHUNK);
      const sessionIds = [...new Set(chunk.map((s) => s.sessionId))];
      const liveSessions = new Set(
        (
          await sql<{ id: string }[]>`
            SELECT "id" FROM "session"
            WHERE "id" = ANY(${sessionIds}::text[]) AND "expiresAt" > now()
          `
        ).map((row) => row.id),
      );
      const orgIds = chunk.map((s) => s.orgId);
      const userIds = chunk.map((s) => s.userId);
      const activeMembers = new Set(
        (
          await sql<{ organizationId: string; userId: string; role: string }[]>`
            SELECT "organizationId", "userId", "role" FROM "member"
            WHERE ("organizationId", "userId") IN (
              SELECT * FROM unnest(${orgIds}::text[], ${userIds}::text[])
            )
          `
        )
          .filter((row) => row.role.toLowerCase() !== 'disabled')
          .map((row) => `${row.organizationId}\u0000${row.userId}`),
      );
      for (const subscriber of chunk) {
        if (subscriber.ended) continue;
        const allowed =
          liveSessions.has(subscriber.sessionId) &&
          activeMembers.has(`${subscriber.orgId}\u0000${subscriber.userId}`);
        if (!allowed) {
          // Terminal: the reader no longer belongs here. The client closes
          // its source on this event instead of reconnecting into a 403.
          subscriber.writer.write(frameEvent({ event: 'forbidden', data: '' }));
          end(subscriber);
        }
      }
    }
  }

  /**
   * The recheck runs beside the tail, never inside it: at tens of thousands
   * of streams it is a few hundred batched reads, and hints must not wait
   * for them. A fault keeps every stream open (the next pass retries); only
   * a definite refusal ends one.
   */
  async function runRecheck(): Promise<void> {
    rechecking = true;
    try {
      await recheckReaders();
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        outage.failed(error);
      } else {
        console.error(
          '[backend] /events re-check failed, retrying next pass:',
          error,
        );
        reportError(error, { tags: { 'tale.lane': 'events-poll' } });
      }
    } finally {
      rechecking = false;
    }
  }

  function schedule(delayMs: number): void {
    setTimeout(() => {
      void tick();
    }, delayMs);
  }

  async function tick(): Promise<void> {
    if (all.size === 0) {
      if (idleSince !== null && Date.now() - idleSince >= lingerMs) {
        // Nobody listens: stop reading, and forget the position — rows
        // inserted while stopped may be reclaimed before a restart reads
        // them, so the ring could not prove it is contiguous any more.
        loopRunning = false;
        cursor = null;
        ring = [];
        skipped.clear();
        return;
      }
      schedule(options.pollIntervalMs);
      return;
    }
    let again = false;
    if (
      !rechecking &&
      Date.now() - lastRecheckAt >= options.authRecheckIntervalMs
    ) {
      lastRecheckAt = Date.now();
      void runRecheck();
    }
    try {
      if (cursor === null) await startTail();
      if (cursor !== null) {
        const from = cursor;
        const rows = await readTail(from);
        if (rows.length > 0) {
          noteSkipped(from, rows);
          const last = rows[rows.length - 1];
          if (last !== undefined) cursor = last.id;
          appendToRing(rows);
          dispatch(rows);
          again = rows.length >= tailPage;
        }
        if (skipped.size > 0) await readLate();
      }
      unavailableBackoffMs = options.errorBackoffMs;
      outage.recovered();
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        // A restart, not a defect: logged, reported only past the threshold.
        // Heartbeats keep their own timer meanwhile, so the lanes stay open.
        outage.failed(error);
        schedule(unavailableBackoffMs);
        unavailableBackoffMs = Math.min(
          unavailableBackoffMs * 2,
          options.unavailableBackoffMaxMs,
        );
        return;
      }
      console.error('[backend] /events poll failed, backing off:', error);
      reportError(error, { tags: { 'tale.lane': 'events-poll' } });
      schedule(options.errorBackoffMs);
      return;
    }
    // Housekeeping rides the tail: throttled, non-overlapping, and never
    // awaited — its failures are its own.
    void reclaimer.tick();
    schedule(again ? 0 : options.pollIntervalMs);
  }

  function ensureLoop(): void {
    idleSince = null;
    if (loopRunning) return;
    loopRunning = true;
    schedule(0);
  }

  function waitForCursor(subscriber: Subscriber): Promise<void> {
    if (cursor !== null || subscriber.ended) return Promise.resolve();
    return new Promise((resolve) => {
      cursorWaiters.push(resolve);
    });
  }

  /**
   * Bring a resumed stream up to the tail through the database: the path
   * for a cursor older than the ring. It reads its own pages until it has
   * caught up with a tail that did not move during its last read, then
   * joins the live fan-out.
   */
  async function catchUp(
    subscriber: Subscriber,
    resumeCursor: string,
  ): Promise<void> {
    let verifyResume = true;
    let backoffMs = options.errorBackoffMs;
    while (!subscriber.ended) {
      try {
        await waitForCursor(subscriber);
        if (subscriber.ended) return;
        const snapshot = cursor;
        const after = subscriber.cursor ?? toBigInt(resumeCursor);
        const rows = await readHintsAfter(sql, after.toString(), {
          orgId: subscriber.orgId,
          userId: subscriber.userId,
          limit: CATCH_UP_PAGE,
        });
        if (verifyResume) {
          // Checked once, AFTER the first read, so the verdict is exact:
          // reclaim removes a strict id-prefix, so a cursor row still present
          // after the read proves every row above it was there to be read.
          if (!(await outboxRetainsCursor(sql, resumeCursor))) {
            subscriber.writer.write(frameEvent({ event: 'resync', data: '' }));
          }
          verifyResume = false;
        }
        const tailRows: TailRow[] = rows.map((row) => ({
          id: toBigInt(row.id),
          idText: row.id,
          orgId: row.orgId,
          userId: subscriber.userId,
          entity: row.entity,
          entityId: row.entityId,
        }));
        subscriber.cursor = after;
        deliver(subscriber, tailRows);
        if (
          rows.length < CATCH_UP_PAGE &&
          snapshot !== null &&
          cursor === snapshot
        ) {
          if (subscriber.cursor === null || subscriber.cursor < snapshot) {
            subscriber.cursor = snapshot;
          }
          subscriber.live = true;
          return;
        }
        backoffMs = options.errorBackoffMs;
      } catch (error) {
        if (subscriber.ended) return;
        if (isDatabaseUnavailable(error)) {
          outage.failed(error);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          backoffMs = Math.min(backoffMs * 2, options.unavailableBackoffMaxMs);
          continue;
        }
        console.error('[backend] /events resume failed, backing off:', error);
        reportError(error, { tags: { 'tale.lane': 'events-poll' } });
        await new Promise((resolve) =>
          setTimeout(resolve, options.errorBackoffMs),
        );
      }
    }
  }

  /**
   * The oldest id the outbox still holds (null: none). Reclaim removes a
   * strict id-prefix, so a cursor below it is one the database no longer
   * retains — the verdict `outboxRetainsCursor` gives, for every resume at
   * once.
   */
  function oldestRetained(): Promise<bigint | null> {
    const now = Date.now();
    if (oldestRead !== null && now - oldestRead.at < OLDEST_RETAINED_TTL_MS) {
      return oldestRead.value;
    }
    const value = sql<{ oldest: string | null }[]>`
      SELECT min(id)::text AS oldest FROM app_realtime.outbox
    `.then((rows) => {
      const oldest = rows[0]?.oldest;
      return oldest === null || oldest === undefined ? null : toBigInt(oldest);
    });
    const read = { at: now, value };
    oldestRead = read;
    // A failed read is not shared: the next resume asks again.
    value.catch(() => {
      if (oldestRead === read) oldestRead = null;
    });
    return value;
  }

  /** Tell a ring-resumed stream to resync when its cursor left retention. */
  function verifyRingResume(subscriber: Subscriber, resumeAt: bigint): void {
    oldestRetained()
      .then((oldest) => {
        if (subscriber.ended) return;
        if (oldest === null || oldest > resumeAt) {
          subscriber.writer.write(frameEvent({ event: 'resync', data: '' }));
        }
      })
      .catch((error: unknown) => {
        // The replay already happened; only the resync verdict is lost, and
        // the next reconnect asks again.
        console.warn('[backend] /events resume retention check failed:', error);
      });
  }

  /** Whether the ring alone can replay everything after `resumeCursor`. */
  function ringCovers(resumeCursor: bigint): boolean {
    if (cursor === null) return false;
    if (resumeCursor >= cursor) return true;
    const oldest = ring[0];
    return oldest !== undefined && resumeCursor >= oldest.id;
  }

  return {
    size: () => all.size,
    attach(stream, subscription) {
      return new Promise<void>((resolve) => {
        // The writer needs the stream's shared state and the subscriber
        // needs the writer: build the state first, then extend it in place
        // so both hold the same object.
        const target: FanoutStream = {
          stream,
          lastWriteAt: Date.now(),
          ended: false,
        };
        const writer = createStreamWriter(target, {
          maxPendingWrites: options.maxPendingWrites,
          onOverflow: () => {
            console.warn(
              '[backend] /events: a stream stopped reading; ending it so it resumes',
            );
            end(subscriber);
            stream.abort();
          },
        });
        const subscriber: Subscriber = Object.assign(target, {
          orgId: subscription.orgId,
          userId: subscription.userId,
          sessionId: subscription.sessionId,
          cursor: null,
          live: false,
          writer,
          finish: () => {
            void writer.flushed().then(() => resolve());
          },
        });
        stream.onAbort(() => end(subscriber));
        if (stream.aborted) {
          resolve();
          return;
        }
        all.add(subscriber);
        let peers = byOrg.get(subscriber.orgId);
        if (peers === undefined) {
          peers = new Set();
          byOrg.set(subscriber.orgId, peers);
        }
        peers.add(subscriber);
        heartbeat.start();
        ensureLoop();
        // Spread the browsers' native reconnects: a deploy ends every stream
        // of a process at once, and each comes back after this many ms.
        subscriber.writer.write(`retry: ${jitteredRetryMs()}\n\n`);

        const resume =
          subscription.resumeCursor !== null &&
          /^\d+$/.test(subscription.resumeCursor)
            ? subscription.resumeCursor
            : null;
        if (resume === null) {
          subscriber.cursor = cursor;
          subscriber.live = true;
          return;
        }
        const resumeAt = toBigInt(resume);
        if (ringCovers(resumeAt)) {
          subscriber.cursor = resumeAt;
          deliver(subscriber, ring);
          subscriber.live = true;
          verifyRingResume(subscriber, resumeAt);
          return;
        }
        void catchUp(subscriber, resume);
      });
    },
  };
}
