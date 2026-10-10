import { setTimeout as sleep } from 'node:timers/promises';

import { LRUCache } from 'lru-cache';
import type { Sql } from 'postgres';

import {
  AUTH_INVALIDATION_TRIGGERS,
  presentAuthInvalidationTriggers,
} from '../db/auth-invalidation-triggers.ts';
import type { OrganizationMember } from './membership.ts';
import { sessionCookieCacheSeconds } from './session-cache.ts';
import type { SessionBundle } from './session.ts';

/**
 * The per-process cache of what authentication resolves on every request:
 * the session (with its user) a cookie names, and the memberships of a user.
 *
 * Without it every authenticated request reads the session and its user,
 * then the user's memberships for the org gate — reads before the request
 * does anything of its own, and at a large deployment the biggest share of
 * the database's work. With it, a process answers them from memory for as
 * long as nothing changed them:
 *
 * - A change reaches every process through `app_realtime.auth_invalidations`
 *   (migration 0195): triggers on Better Auth's `session`, `user` and
 *   `member` tables write a row for every change a cached copy must not
 *   outlive, whoever makes it, and each process reads the new rows five
 *   times a second. A process whose last good read is more than a second
 *   old answers nothing from memory, and one that cannot see the triggers
 *   installed never does.
 * - A session is answered from memory only until Better Auth would slide
 *   its expiry (`updateAge`, a minute at most): the request after that
 *   resolves through Better Auth, which writes the refresh the idle sweep
 *   reads, and fills the cache again.
 * - A read that raced a change is not kept: a fill notes how far the log
 *   was applied when it started, and drops what it read when a row for the
 *   same session or user was applied meanwhile.
 *
 * Off with `AUTH_REQUEST_CACHE=off`. The session half is off as well while
 * the signed-cookie cache is on (`SESSION_COOKIE_CACHE_SECONDS`), which
 * already answers sessions without the database.
 */

/** How often the log is read. */
const POLL_MS = 200;
/** How long after the start of its last good read the cache still answers. */
const STALE_AFTER_MS = 1_000;
/** The longest one cached entry answers, whatever else would allow. */
const ENTRY_MAX_MS = 60_000;
/** How long a process that cannot see its triggers waits to look again. */
const TRIGGER_RECHECK_MS = 60_000;
/** Applied changes remembered for the fills still in flight. */
const RECENT_MAX = 10_000;
/** Log rows remembered as applied, so a re-read applies nothing twice. */
const APPLIED_IDS_MAX = 50_000;
/** Entries one process keeps per cache. */
const SESSION_ENTRIES = 100_000;
const MEMBERSHIP_ENTRIES = 100_000;

export interface AuthRequestCacheStats {
  serving: boolean;
  sessionHits: number;
  sessionMisses: number;
  membershipHits: number;
  membershipMisses: number;
  applied: number;
}

export interface AuthRequestCache {
  /**
   * The session `cookie` (the exact value Better Auth reads, or null to
   * bypass) names: from memory when it may be, else `resolve`'s answer.
   */
  session(
    cookie: string | null,
    resolve: () => Promise<SessionBundle | null>,
  ): Promise<SessionBundle | null>;
  /** The user's membership rows: from memory when they may be, else `read`'s. */
  memberships(
    userId: string,
    read: () => Promise<OrganizationMember[]>,
  ): Promise<OrganizationMember[]>;
  /** One read of the log — the loop's step, and the tests'. */
  poll(): Promise<void>;
  stats(): AuthRequestCacheStats;
  /** Stop the loop; resolves once the read in flight has finished. */
  stop(): Promise<void>;
}

export interface AuthRequestCacheOptions {
  /** Whether the session half answers (off under the signed-cookie cache). */
  sessions?: boolean;
  /** Better Auth's session config, in seconds (`sessionIdleWindowSeconds`). */
  sessionConfig: { expiresIn: number; updateAge: number };
  now?: () => number;
  pollMs?: number;
  staleAfterMs?: number;
  /** Run the loop; off, `poll` is the caller's to call. */
  loop?: boolean;
}

interface SessionEntry {
  bundle: SessionBundle;
  sessionId: string;
  userId: string;
  serveUntil: number;
}

interface MembershipEntry {
  rows: OrganizationMember[];
  serveUntil: number;
}

interface Applied {
  seq: number;
  kind: string;
  subjectId: string;
}

/**
 * The raw value of the one cookie named `name` in a `Cookie` header — the
 * cookie Better Auth reads the session from — or null when it is absent or
 * sent more than once. Two copies are left to Better Auth alone: which one
 * a parser takes is its own choice, and the cache must never file a session
 * under a value Better Auth did not read. Raw, not decoded: the cache only
 * compares it, and a session token is plain alphanumerics before its `.`.
 */
export function soleCookieValue(
  header: string | null,
  name: string,
): string | null {
  if (header === null) return null;
  let value: string | null = null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    if (value !== null) return null;
    value = part.slice(eq + 1).trim();
  }
  return value === '' ? null : value;
}

/** Whether `AUTH_REQUEST_CACHE` leaves the cache on (anything but `off`). */
export function authRequestCacheEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AUTH_REQUEST_CACHE?.trim().toLowerCase() !== 'off';
}

/** Whether the session half may answer: off under the signed-cookie cache. */
export function authRequestSessionCacheEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return authRequestCacheEnabled(env) && sessionCookieCacheSeconds(env) === 0;
}

function dateMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * When a cached session stops answering: the moment Better Auth would slide
 * its expiry (`expiresAt - expiresIn + updateAge`, its own rule), its expiry
 * itself, or {@link ENTRY_MAX_MS} from now — whichever comes first. Null for
 * a bundle without the fields the rule reads.
 */
function sessionServeUntil(
  bundle: SessionBundle,
  config: { expiresIn: number; updateAge: number },
  now: number,
): number | null {
  const session: Record<string, unknown> = bundle.session;
  const expiresAt = dateMs(Reflect.get(session, 'expiresAt'));
  if (expiresAt === null) return null;
  const refreshDue =
    expiresAt - config.expiresIn * 1000 + config.updateAge * 1000;
  return Math.min(refreshDue, expiresAt, now + ENTRY_MAX_MS);
}

export function createAuthRequestCache(
  sql: Sql,
  options: AuthRequestCacheOptions,
): AuthRequestCache {
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? POLL_MS;
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  const sessionsOn = options.sessions ?? true;
  const sessions = new LRUCache<string, SessionEntry>({
    max: SESSION_ENTRIES,
    dispose: (entry, key) => {
      unindex(bySession, entry.sessionId, key);
      unindex(byUser, entry.userId, key);
    },
  });
  /** Cached session keys per session id and per user id. */
  const bySession = new Map<string, Set<string>>();
  const byUser = new Map<string, Set<string>>();
  const memberships = new LRUCache<string, MembershipEntry>({
    max: MEMBERSHIP_ENTRIES,
  });
  const appliedIds = new LRUCache<string, true>({ max: APPLIED_IDS_MAX });
  const recent: Applied[] = [];
  /** Changes applied so far; a fill notes it before it reads. */
  let seq = 0;
  /** The oldest change `recent` still holds is `floor + 1`. */
  let floor = 0;
  /** `pg_snapshot_xmin` of the last good read: the next reads from there. */
  let horizon: string | null = null;
  /** When the last good read started; null before the first. */
  let goodSince: number | null = null;
  let triggersReady = false;
  let triggersCheckedAt: number | null = null;
  let failing = false;
  const counters = {
    sessionHits: 0,
    sessionMisses: 0,
    membershipHits: 0,
    membershipMisses: 0,
    applied: 0,
  };

  function unindex(
    index: Map<string, Set<string>>,
    id: string,
    key: string,
  ): void {
    const keys = index.get(id);
    if (keys === undefined) return;
    keys.delete(key);
    if (keys.size === 0) index.delete(id);
  }

  function addIndex(
    index: Map<string, Set<string>>,
    id: string,
    key: string,
  ): void {
    const keys = index.get(id);
    if (keys === undefined) index.set(id, new Set([key]));
    else keys.add(key);
  }

  function dropSessions(index: Map<string, Set<string>>, id: string): void {
    const keys = index.get(id);
    if (keys === undefined) return;
    // Each delete unindexes its key from this very set (`dispose`); a set's
    // iterator moves on past an entry removed behind it.
    for (const key of keys) sessions.delete(key);
  }

  function serving(): boolean {
    return (
      triggersReady && goodSince !== null && now() - goodSince <= staleAfterMs
    );
  }

  /** Whether a change to one of `subjects` was applied after `mark`. */
  function changedSince(
    mark: number,
    subjects: readonly { kind: string; subjectId: string }[],
  ): boolean {
    // The changes after `mark` are no longer all remembered: assume the worst.
    if (mark < floor) return true;
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      const change = recent[index];
      if (change === undefined || change.seq <= mark) break;
      if (
        subjects.some(
          (subject) =>
            subject.kind === change.kind &&
            subject.subjectId === change.subjectId,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  function apply(kind: string, subjectId: string): void {
    seq += 1;
    recent.push({ seq, kind, subjectId });
    // Trimmed in halves, so a busy log does not shift the array per row.
    if (recent.length > RECENT_MAX * 2) {
      const dropped = recent.splice(0, recent.length - RECENT_MAX);
      floor = dropped.at(-1)?.seq ?? floor;
    }
    counters.applied += 1;
    switch (kind) {
      case 'session': {
        dropSessions(bySession, subjectId);
        break;
      }
      case 'user': {
        dropSessions(byUser, subjectId);
        memberships.delete(subjectId);
        break;
      }
      case 'member': {
        memberships.delete(subjectId);
        break;
      }
      default: {
        // A kind this image does not know (a later image's): the safe
        // answer is to forget everything cached.
        sessions.clear();
        memberships.clear();
      }
    }
  }

  async function checkTriggers(): Promise<void> {
    const present = await presentAuthInvalidationTriggers(sql);
    const ready = AUTH_INVALIDATION_TRIGGERS.every((name) => present.has(name));
    if (!ready && triggersCheckedAt === null) {
      console.error(
        `[auth-cache] the invalidation triggers are missing (${AUTH_INVALIDATION_TRIGGERS.filter((name) => !present.has(name)).join(', ')}): sessions and memberships are read on every request`,
      );
    }
    triggersReady = ready;
    triggersCheckedAt = now();
  }

  async function poll(): Promise<void> {
    const started = now();
    try {
      if (
        !triggersReady &&
        (triggersCheckedAt === null ||
          started - triggersCheckedAt >= TRIGGER_RECHECK_MS)
      ) {
        await checkTriggers();
      }
      // Every row a transaction may still have been writing at the last
      // read: its xid is at least that read's xmin, whatever id it drew.
      const rows = await sql<
        {
          horizon: string;
          id: string | null;
          kind: string | null;
          subjectId: string | null;
        }[]
      >`
        WITH h AS (SELECT pg_snapshot_xmin(pg_current_snapshot()) AS horizon)
        SELECT h.horizon::text AS horizon, i.id::text AS id, i.kind,
               i.subject_id AS "subjectId"
        FROM h LEFT JOIN LATERAL (
          SELECT id, kind, subject_id FROM app_realtime.auth_invalidations
          WHERE writer_xid >= ${horizon}::xid8
          ORDER BY id
        ) i ON true
      `;
      for (const row of rows) {
        if (row.id === null || row.kind === null || row.subjectId === null) {
          continue;
        }
        if (appliedIds.has(row.id)) continue;
        appliedIds.set(row.id, true);
        apply(row.kind, row.subjectId);
      }
      horizon = rows[0]?.horizon ?? horizon;
      goodSince = started;
      if (failing) {
        failing = false;
        console.log('[auth-cache] reading the invalidation log again');
      }
    } catch (error) {
      if (!failing) {
        failing = true;
        console.warn(
          '[auth-cache] the invalidation log cannot be read; answering from the database until it can:',
          error,
        );
      }
    }
  }

  const stopping = new AbortController();
  const { signal } = stopping;
  const loop =
    options.loop === false
      ? Promise.resolve()
      : (async () => {
          while (!signal.aborted) {
            await poll();
            if (signal.aborted) break;
            await sleep(pollMs, undefined, { signal }).catch(
              (error: unknown) => {
                if (!signal.aborted) throw error;
              },
            );
          }
        })();

  return {
    async session(cookie, resolve) {
      if (!sessionsOn || cookie === null || !serving()) return resolve();
      const hit = sessions.get(cookie);
      if (hit !== undefined && now() < hit.serveUntil) {
        counters.sessionHits += 1;
        return hit.bundle;
      }
      counters.sessionMisses += 1;
      if (hit !== undefined) sessions.delete(cookie);
      const mark = seq;
      const bundle = await resolve();
      if (bundle === null) {
        sessions.delete(cookie);
        return null;
      }
      const session: Record<string, unknown> = bundle.session;
      const token = Reflect.get(session, 'token');
      const at = now();
      const serveUntil = sessionServeUntil(bundle, options.sessionConfig, at);
      // Kept only when the cookie carries the very session Better Auth
      // resolved — never a bundle under another cookie's name — and nothing
      // changed it while it was read.
      if (
        typeof token === 'string' &&
        cookie.startsWith(`${token}.`) &&
        serveUntil !== null &&
        serveUntil > at &&
        serving() &&
        !changedSince(mark, [
          { kind: 'session', subjectId: bundle.session.id },
          { kind: 'user', subjectId: bundle.user.id },
        ])
      ) {
        sessions.set(cookie, {
          bundle,
          sessionId: bundle.session.id,
          userId: bundle.user.id,
          serveUntil,
        });
        addIndex(bySession, bundle.session.id, cookie);
        addIndex(byUser, bundle.user.id, cookie);
      }
      return bundle;
    },

    async memberships(userId, read) {
      if (!serving()) return read();
      const hit = memberships.get(userId);
      if (hit !== undefined && now() < hit.serveUntil) {
        counters.membershipHits += 1;
        return hit.rows;
      }
      counters.membershipMisses += 1;
      const mark = seq;
      const rows = await read();
      if (
        serving() &&
        !changedSince(mark, [
          { kind: 'member', subjectId: userId },
          { kind: 'user', subjectId: userId },
        ])
      ) {
        memberships.set(userId, { rows, serveUntil: now() + ENTRY_MAX_MS });
      }
      return rows;
    },

    poll,

    stats() {
      return { serving: serving(), ...counters };
    },

    async stop() {
      stopping.abort();
      await loop;
    },
  };
}

/** How long a log row is kept. Every process reads it within a second; an
 * hour leaves room for one that was cut off from the database a while. */
const AUTH_INVALIDATION_RETENTION_MS = 60 * 60 * 1000;
/** Rows one reclaim DELETE takes, and the rounds one sweep runs at most. */
const RECLAIM_BATCH = 5_000;
const RECLAIM_MAX_BATCHES = 20;

/** Delete log rows past {@link AUTH_INVALIDATION_RETENTION_MS}, oldest
 * first, in bounded batches (the worker's `realtime.reclaim_outbox`). */
export async function reclaimAuthInvalidations(
  sql: Sql,
  nowMs: number = Date.now(),
): Promise<number> {
  const cutoff = nowMs - AUTH_INVALIDATION_RETENTION_MS;
  let deleted = 0;
  for (let round = 0; round < RECLAIM_MAX_BATCHES; round += 1) {
    const removed = await sql`
      DELETE FROM app_realtime.auth_invalidations
      WHERE id IN (
        SELECT id FROM app_realtime.auth_invalidations
        WHERE created_at_ms < ${cutoff}
        ORDER BY id
        LIMIT ${RECLAIM_BATCH}
      )
    `;
    deleted += removed.count;
    if (removed.count < RECLAIM_BATCH) break;
  }
  return deleted;
}

let installed: AuthRequestCache | null = null;

/** The process's cache, or null where none runs (the worker, the tests). */
export function authRequestCache(): AuthRequestCache | null {
  return installed;
}

/**
 * Start the process's cache: an API process's boot (`main.ts`), or a test
 * that wants one. Returns null when `AUTH_REQUEST_CACHE` turns it off.
 */
export function startAuthRequestCache(
  sql: Sql,
  options: AuthRequestCacheOptions,
  env: Record<string, string | undefined> = process.env,
): AuthRequestCache | null {
  if (!authRequestCacheEnabled(env)) return null;
  const cache = createAuthRequestCache(sql, {
    sessions: authRequestSessionCacheEnabled(env),
    ...options,
  });
  installed = cache;
  return cache;
}

/** Stop the process's cache and stop consulting it. */
export async function stopAuthRequestCache(): Promise<void> {
  const cache = installed;
  installed = null;
  await cache?.stop();
}
