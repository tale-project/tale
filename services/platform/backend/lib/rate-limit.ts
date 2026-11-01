import type { Sql, TransactionSql } from 'postgres';

/**
 * Platform rate limiting on Postgres — the 0.5 replacement for
 * `@convex-dev/rate-limiter` (shard fields dropped: a single atomic UPSERT
 * per charge doesn't OCC-conflict the way Convex writes did). Charges run
 * inside the caller's transaction when one exists, so a rolled-back request
 * also rolls back its charge — matching 0.4 semantics, including under
 * serializable retry (the retry's re-charge lands on the rolled-back state).
 *
 * Every rule in `RATE_LIMITS` is charged by a live door — `rate-limit.test.ts`
 * fails on a rule nothing charges, so the catalog reads as the list of what
 * IS limited, never as what 0.4 once limited. Add the rule and its charge in
 * the same change.
 *
 * A rule charged on every request of a busy caller declares `slices`: each
 * process leases a slice of the bucket in one write and spends it in memory
 * (`chargeFromSlice`), so a key holder's reads stop queuing on its row while
 * the bucket stays a hard ceiling across processes. Its doors charge it on
 * the pool, never inside a transaction: a slice outlives the request that
 * leased it.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface TokenBucketRule {
  kind: 'token bucket';
  /** Tokens added per `period`. */
  rate: number;
  period: number;
  capacity: number;
  /** Charge from leased slices, one write per slice (`chargeFromSlice`). */
  slices?: SliceRule;
}

export interface SliceRule {
  /** How long a process may spend a leased slice, in ms. */
  lifetime: number;
  /** The most tokens one lease takes. */
  largest: number;
}

export interface FixedWindowRule {
  kind: 'fixed window';
  /** Requests allowed per `period` window. */
  rate: number;
  period: number;
}

export type RateLimitRule = TokenBucketRule | FixedWindowRule;

/** The rules the platform's doors charge, grouped by tier. */
export const RATE_LIMITS = {
  // TIER 2: external API calls
  // An organization's automation steps calling outside APIs through the
  // HTTP connector, across the deployment. How many run at once is the
  // native's own per-process gate.
  'automation:http': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 120,
  },
  // An organization's runs that are never stored — tries of a draft, tests
  // run by hand — counted per execution (a suite charges its tests). They
  // run in the API process, which also caps how many run at once.
  'automation:bench': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 240,
  },
  'external:onedrive-list': {
    kind: 'token bucket',
    rate: 100,
    period: MINUTE,
    capacity: 120,
  },
  'external:onedrive-read': {
    kind: 'token bucket',
    rate: 50,
    period: MINUTE,
    capacity: 60,
  },
  // The Google Drive picker and import lanes: the OneDrive twins' budgets,
  // in buckets of their own.
  'external:google-drive-list': {
    kind: 'token bucket',
    rate: 100,
    period: MINUTE,
    capacity: 120,
  },
  'external:google-drive-read': {
    kind: 'token bucket',
    rate: 50,
    period: MINUTE,
    capacity: 60,
  },

  // TIER 3: file & folder operations
  'folder:mutate': { kind: 'fixed window', rate: 60, period: MINUTE },
  'file:upload': { kind: 'fixed window', rate: 50, period: MINUTE },
  'file:rag-retry': { kind: 'fixed window', rate: 10, period: MINUTE },

  // TIER 3.55: knowledge entries
  'knowledge:mutate': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
  },
  // Agents writing entries (`knowledge_entry_write`) draw on a budget of
  // their own per organization, so an agent that loops on its writes runs
  // dry here while people's edits keep `knowledge:mutate` to themselves.
  'knowledge:agent-write': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 40,
  },

  // TIER 3.6: projects
  'project:create': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 40,
  },
  'project:delete-cascade': {
    kind: 'token bucket',
    rate: 5,
    period: MINUTE,
    capacity: 8,
  },

  // TIER 3.7: tasks
  'task:create': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 90,
  },
  'task:comment': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 90,
  },

  // TIER 4: security
  'security:sse-auth': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 120,
  },
  'security:login-ip': { kind: 'fixed window', rate: 30, period: MINUTE },
  // Per user: one newsletter can carry dozens of remote images, and the
  // browser asks for all of them at once when the message opens.
  'security:image-proxy': {
    kind: 'token bucket',
    rate: 300,
    period: MINUTE,
    capacity: 600,
  },
  'webdav:auth-fail-ip': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 40,
  },
  'webdav:auth-fail-org': {
    kind: 'token bucket',
    rate: 300,
    period: MINUTE,
    capacity: 600,
  },
  'webdav:app-password-create': {
    kind: 'fixed window',
    rate: 20,
    period: HOUR,
  },

  // TIER 5: workflow / agent / REST / runtime operations
  'connector:slack-events': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 240,
  },
  // Every request through the /api/v1 doors, charged to its key holder. Its
  // slices live 5 s, the time the bucket refills 10 tokens, so a holder at its
  // sustained rate spends the largest slice within its lifetime. Leases leave
  // that refill unclaimed: a burst from a full bucket gets about 190 requests
  // through instead of 200.
  'rest:api': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 200,
    slices: { lifetime: 5_000, largest: 10 },
  },
  // The inbound automation webhook door, which no key authenticates: every
  // delivery is charged to its sender's IP (trusted-proxy-derived, like
  // `rest:auth-fail-ip`) BEFORE the token is hashed or looked up, and an
  // accepted token's trigger has a budget of its own — the run-start lane's
  // size, since a delivery costs a durable run — so a leaked URL can start
  // at most a bounded number of runs a minute.
  'webhook:ip': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 240,
  },
  'webhook:trigger': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 40,
  },
  // Bearer keys that FAIL to authenticate at the /api/v1 door, keyed on
  // the trusted-proxy-derived client IP — the pre-auth lane, so a stranger
  // never draws from a key holder's `rest:api` budget (the `webdav:auth-
  // fail-ip` posture on the REST door).
  'rest:auth-fail-ip': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 40,
  },
  // The trusted-headers hand-off door: a presented key that resolves to no
  // live row is charged to the source IP before it learns anything — the
  // `rest:auth-fail-ip` posture on the browser-facing door.
  'trusted-headers:auth-fail-ip': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 40,
  },
  'rest:execute': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 40,
  },
  // Settings changes over MCP (`apply_settings`): a coding agent loops, and
  // every change runs a native writer that may snapshot a history file or
  // reach a vendor, so a key holder's changes have a budget of their own.
  'rest:settings': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 60,
  },
  // Coding agents that register themselves with the sign-in server (open
  // dynamic client registration, `auth/agent-oauth.ts`): a source registers
  // at most ten clients an hour, and the deployment 500 a day, before the
  // provider sees the request.
  'oauth:register-ip': { kind: 'fixed window', rate: 10, period: HOUR },
  'oauth:register-global': { kind: 'fixed window', rate: 500, period: DAY },
  // A token request the provider refused, charged to its source after the
  // answer: hosted agents share egress addresses, so a token request that
  // works costs nothing.
  'oauth:token-fail-ip': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 40,
  },
  // The sandbox-device door: a join token or device secret that matches
  // nothing is charged to its source IP — the trusted-headers posture.
  'sandbox-devices:auth-fail-ip': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 40,
  },
  'rest:upload': {
    kind: 'token bucket',
    rate: 240,
    period: MINUTE,
    capacity: 300,
  },

  // TIER 6: maintenance
  'cleanup:tts': { kind: 'token bucket', rate: 1, period: HOUR, capacity: 1 },

  // TIER 7: governance
  'governance:dsar_request': { kind: 'fixed window', rate: 5, period: DAY },

  // TIER 8: TTS
  'tts:synthesize:user': {
    kind: 'token bucket',
    rate: 40,
    period: MINUTE,
    capacity: 60,
  },
  'tts:synthesize:org': {
    kind: 'token bucket',
    rate: 200,
    period: MINUTE,
    capacity: 400,
  },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

export class RateLimitExceededError extends Error {
  readonly retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Charge `count` against a rule. One atomic UPSERT; over-limit charges leave
 * the stored state untouched and report `retryAfter` (ms). Pass a
 * transaction to tie the charge to the caller's commit/rollback. A single
 * token of a rule with `slices` is spent from this process's slice.
 */
export async function limitRate(
  sql: Sql | TransactionSql,
  name: RateLimitName,
  opts: { key: string; count?: number },
): Promise<RateLimitResult> {
  const rule: RateLimitRule = RATE_LIMITS[name];
  const count = opts.count ?? 1;
  const now = Date.now();

  if (rule.kind === 'token bucket') {
    if (count > rule.capacity) {
      return { ok: false, retryAfter: rule.period };
    }
    if (rule.slices !== undefined && count === 1) {
      return chargeFromSlice(sql, name, opts.key, rule, rule.slices);
    }
    const left = await takeTokens(sql, name, opts.key, rule, {
      count,
      ceiling: rule.capacity,
      now,
    });
    if (left !== null) {
      return { ok: true };
    }
    return refuseTokens(sql, name, opts.key, rule, count, now);
  }

  const windowStart = Math.floor(now / rule.period) * rule.period;
  if (count > rule.rate) {
    return { ok: false, retryAfter: windowStart + rule.period - now };
  }
  const rows = await sql<{ value: string }[]>`
    INSERT INTO app.rate_limits AS rl (name, key, value, ts)
    VALUES (${name}, ${opts.key}, ${count}, ${windowStart})
    ON CONFLICT (name, key) DO UPDATE SET
      value = CASE WHEN rl.ts = ${windowStart}
                   THEN rl.value + ${count} ELSE ${count} END,
      ts = ${windowStart}
    WHERE (CASE WHEN rl.ts = ${windowStart} THEN rl.value ELSE 0 END)
          + ${count} <= ${rule.rate}
    RETURNING value::text
  `;
  if (rows.length > 0) {
    return { ok: true };
  }
  return { ok: false, retryAfter: windowStart + rule.period - now };
}

/**
 * Take `count` tokens from a bucket's row in one atomic UPSERT, refilled to
 * at most `ceiling` first: the rule's capacity for tokens spent at once, less
 * a lifetime's refill for a leased slice. Answers the tokens the row keeps,
 * or null when it cannot pay (and is left untouched).
 */
async function takeTokens(
  sql: Sql | TransactionSql,
  name: RateLimitName,
  key: string,
  rule: TokenBucketRule,
  charge: { count: number; ceiling: number; now: number },
): Promise<number | null> {
  const { count, ceiling, now } = charge;
  const ratePerMs = rule.rate / rule.period;
  const rows = await sql<{ value: string }[]>`
    INSERT INTO app.rate_limits AS rl (name, key, value, ts)
    VALUES (${name}, ${key}, ${ceiling - count}, ${now})
    ON CONFLICT (name, key) DO UPDATE SET
      value = LEAST(
        ${ceiling}::double precision,
        rl.value + (${now} - rl.ts) * ${ratePerMs}::float8
      ) - ${count},
      ts = ${now}
    WHERE LEAST(
        ${ceiling}::double precision,
        rl.value + (${now} - rl.ts) * ${ratePerMs}::float8
      ) >= ${count}
    RETURNING value::text
  `;
  const row = rows[0];
  return row === undefined ? null : Number(row.value);
}

async function refuseTokens(
  sql: Sql | TransactionSql,
  name: RateLimitName,
  key: string,
  rule: TokenBucketRule,
  count: number,
  now: number,
): Promise<RateLimitResult> {
  const available = await readTokens(sql, name, key, rule, now);
  const deficit = count - available;
  return {
    ok: false,
    retryAfter: Math.ceil(deficit / (rule.rate / rule.period)),
  };
}

/**
 * What one process holds of one key's bucket. Tokens are spendable only
 * within a lifetime of `leasedAt`, which only the lease that granted them
 * sets.
 */
interface Slice {
  tokens: number;
  /** Tokens the last lease (or single charge) took, and how many it served. */
  size: number;
  served: number;
  /** On `performance.now()`, read before the lease's statement was sent. */
  leasedAt: number;
  /** The row's tokens after this process's last statement, and its stamp. */
  rowTokens: number;
  rowAt: number;
  /** Settles with the lease in flight; charges arriving meanwhile wait. */
  leasing: Promise<unknown> | null;
}

/**
 * A process forgets a slice this long after its lease: it has long lapsed,
 * and the pace it was spent at no longer sizes a lease.
 */
const FORGET_SLICE_AFTER = MINUTE;

/** Per database client: a process's pool holds one set. */
const heldSlices = new WeakMap<
  Sql | TransactionSql,
  { slices: Map<string, Slice>; sweptAt: number }
>();

/**
 * Spend one token of a sliced rule from this process's slice, leasing the
 * next slice when it is spent or lapsed. The limit stays exact across
 * processes:
 *
 * - A lease refills the row to at most `capacity − lifetime × rate` before
 *   it takes its tokens, and they are spent within `lifetime` of its stamp or
 *   dropped, never returned. Over any window W, the leases stamped from one
 *   lifetime before it plus the tokens charged at once inside it add up to at
 *   most `capacity − lifetime × rate + (W + lifetime) × rate`: the
 *   `capacity + rate × W` a charge per request allows, also while processes
 *   that still charge per request share the row. Without the lower ceiling a
 *   slice spent late would add up to `lifetime × rate` to a full bucket.
 * - A slice follows demand: a key's first charge in a process takes one
 *   token directly, and each next slice takes what the last one was spent at
 *   over a lifetime, at most twice the last and `largest`, so a steady caller
 *   drops no tokens and a burst doubles its slices. No lease takes more than
 *   half of what the row kept at this process's last statement plus its
 *   refill since, so a bucket running low is charged one token at a time and
 *   refuses with the `retryAfter` of a direct charge.
 */
async function chargeFromSlice(
  sql: Sql | TransactionSql,
  name: RateLimitName,
  key: string,
  rule: TokenBucketRule,
  slicing: SliceRule,
): Promise<RateLimitResult> {
  const ratePerMs = rule.rate / rule.period;
  const ceiling = rule.capacity - slicing.lifetime * ratePerMs;
  const slices = holdSlices(sql);
  const id = `${name}|${key}`;
  for (;;) {
    const at = performance.now();
    const slice = slices.get(id);
    if (
      slice !== undefined &&
      slice.tokens >= 1 &&
      at - slice.leasedAt < slicing.lifetime
    ) {
      slice.tokens -= 1;
      slice.served += 1;
      return { ok: true };
    }
    if (slice?.leasing) {
      await slice.leasing;
      continue;
    }
    const now = Date.now();
    const size =
      slice === undefined
        ? 1
        : Math.min(
            slicing.largest,
            slice.size * 2,
            Math.floor(
              (slice.served * slicing.lifetime) / (at - slice.leasedAt),
            ),
            Math.floor(
              Math.min(
                ceiling,
                slice.rowTokens + (now - slice.rowAt) * ratePerMs,
              ) / 2,
            ),
          );
    if (slice !== undefined && size >= 2) {
      const lease = takeTokens(sql, name, key, rule, {
        count: size,
        ceiling,
        now,
      });
      slice.leasing = Promise.allSettled([lease]);
      let left: number | null;
      try {
        left = await lease;
      } finally {
        slice.leasing = null;
      }
      if (left !== null) {
        slice.tokens = size - 1;
        slice.size = size;
        slice.served = 1;
        slice.leasedAt = at;
        slice.rowTokens = left;
        slice.rowAt = now;
        return { ok: true };
      }
      // The row holds less than this slice: one token at a time from here.
      slice.rowTokens = 0;
      slice.rowAt = now;
    }
    const left = await takeTokens(sql, name, key, rule, {
      count: 1,
      ceiling: rule.capacity,
      now,
    });
    const current = slices.get(id) ?? newSlice(slices, id);
    current.rowTokens = left ?? 0;
    current.rowAt = now;
    if (left === null) {
      return refuseTokens(sql, name, key, rule, 1, now);
    }
    // A lease that landed meanwhile keeps its tokens and its lapse.
    if (
      !(
        current.tokens >= 1 &&
        performance.now() - current.leasedAt < slicing.lifetime
      )
    ) {
      current.tokens = 0;
      current.size = 1;
      current.served = 1;
      current.leasedAt = at;
    }
    return { ok: true };
  }
}

function holdSlices(sql: Sql | TransactionSql): Map<string, Slice> {
  const at = performance.now();
  const held = heldSlices.get(sql);
  if (held === undefined) {
    const slices = new Map<string, Slice>();
    heldSlices.set(sql, { slices, sweptAt: at });
    return slices;
  }
  if (at - held.sweptAt >= FORGET_SLICE_AFTER) {
    held.sweptAt = at;
    for (const [id, slice] of held.slices) {
      if (slice.leasing === null && at - slice.leasedAt >= FORGET_SLICE_AFTER) {
        held.slices.delete(id);
      }
    }
  }
  return held.slices;
}

function newSlice(slices: Map<string, Slice>, id: string): Slice {
  const slice: Slice = {
    tokens: 0,
    size: 1,
    served: 0,
    leasedAt: Number.NEGATIVE_INFINITY,
    rowTokens: 0,
    rowAt: 0,
    leasing: null,
  };
  slices.set(id, slice);
  return slice;
}

async function readTokens(
  sql: Sql | TransactionSql,
  name: string,
  key: string,
  rule: TokenBucketRule,
  now: number,
): Promise<number> {
  const rows = await sql<{ value: string; ts: string }[]>`
    SELECT value::text, ts::text FROM app.rate_limits
    WHERE name = ${name} AND key = ${key}
  `;
  const row = rows[0];
  if (!row) {
    return rule.capacity;
  }
  const refilled =
    Number(row.value) + (now - Number(row.ts)) * (rule.rate / rule.period);
  return Math.min(rule.capacity, refilled);
}

function throwIfLimited(name: RateLimitName, result: RateLimitResult): void {
  if (!result.ok) {
    throw new RateLimitExceededError(
      `Rate limit exceeded for ${name}. Try again in ${Math.ceil(result.retryAfter / 1000)} seconds.`,
      result.retryAfter,
    );
  }
}

/** Charge an org-scoped rule; throws `RateLimitExceededError` when over. */
export async function checkOrganizationRateLimit(
  sql: Sql | TransactionSql,
  name: RateLimitName,
  organizationId: string,
  count = 1,
): Promise<void> {
  throwIfLimited(
    name,
    await limitRate(sql, name, { key: `org:${organizationId}`, count }),
  );
}

/** Charge a user-scoped rule; throws `RateLimitExceededError` when over. */
export async function checkUserRateLimit(
  sql: Sql | TransactionSql,
  name: RateLimitName,
  userId: string,
  count = 1,
): Promise<void> {
  throwIfLimited(
    name,
    await limitRate(sql, name, { key: `user:${userId}`, count }),
  );
}

/** Charge an IP-scoped rule; throws `RateLimitExceededError` when over. */
export async function checkIpRateLimit(
  sql: Sql | TransactionSql,
  name: RateLimitName,
  ip: string,
  count = 1,
): Promise<void> {
  throwIfLimited(name, await limitRate(sql, name, { key: `ip:${ip}`, count }));
}

/** Charge a rule keyed on a resource the caller names (`trigger:<id>`);
 * throws `RateLimitExceededError` when over. */
export async function checkKeyedRateLimit(
  sql: Sql | TransactionSql,
  name: RateLimitName,
  key: string,
  count = 1,
): Promise<void> {
  throwIfLimited(name, await limitRate(sql, name, { key, count }));
}
