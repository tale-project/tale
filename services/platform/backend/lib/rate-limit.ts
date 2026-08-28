import type { Sql, TransactionSql } from 'postgres';

/**
 * Platform rate limiting on Postgres — the 0.5 replacement for
 * `@convex-dev/rate-limiter`. The RULES map is the 0.4 catalog ported as
 * data (shard fields dropped: a single atomic UPSERT per charge doesn't
 * OCC-conflict the way Convex writes did). Charges run inside the caller's
 * transaction when one exists, so a rolled-back request also rolls back its
 * charge — matching 0.4 semantics, including under serializable retry
 * (the retry's re-charge lands on the rolled-back state).
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface TokenBucketRule {
  kind: 'token bucket';
  /** Tokens added per `period`. */
  rate: number;
  period: number;
  capacity: number;
}

export interface FixedWindowRule {
  kind: 'fixed window';
  /** Requests allowed per `period` window. */
  rate: number;
  period: number;
}

export type RateLimitRule = TokenBucketRule | FixedWindowRule;

/** The 0.4 rule catalog (convex/lib/rate_limiter/index.ts), shards dropped. */
export const RATE_LIMITS = {
  // TIER 1: AI operations
  'ai:chat': { kind: 'token bucket', rate: 30, period: MINUTE, capacity: 40 },
  'ai:improve': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 25,
  },
  'ai:workflow-assistant': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 30,
  },
  'ai:summarize': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 15,
  },

  // TIER 2: external API calls
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
  'external:onedrive-search': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 40,
  },
  'external:email-test': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 15,
  },
  'external:oauth-callback': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 15,
  },
  'connectors:dispatch': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 80,
  },
  'tools:dispatch': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 80,
  },
  'external:integration-test': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 15,
  },

  // TIER 3: file & folder operations
  'folder:mutate': { kind: 'fixed window', rate: 60, period: MINUTE },
  'file:upload': { kind: 'fixed window', rate: 50, period: MINUTE },
  'file:rag-retry': { kind: 'fixed window', rate: 10, period: MINUTE },
  'file:generate-document': { kind: 'fixed window', rate: 20, period: MINUTE },
  'file:generate-pptx': { kind: 'fixed window', rate: 10, period: MINUTE },
  'file:generate-docx': { kind: 'fixed window', rate: 10, period: MINUTE },
  'file:generate-excel': { kind: 'fixed window', rate: 20, period: MINUTE },

  // TIER 3.55: knowledge entries
  'knowledge:write': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
  },
  'knowledge:mutate': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
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
  'security:storage-access': {
    kind: 'fixed window',
    rate: 100,
    period: MINUTE,
  },
  'security:tts-audio-fetch': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 240,
  },
  'security:image-proxy': { kind: 'fixed window', rate: 200, period: MINUTE },
  'security:sse-auth': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 120,
  },
  'security:workspace-file': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 240,
  },
  'security:screencast-auth': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 120,
  },
  'security:login-ip': { kind: 'fixed window', rate: 30, period: MINUTE },
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
  'workflow:cancel': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 25,
  },
  'workflow:run': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 25,
  },
  'workflow:webhook': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 100,
  },
  'workflow:api': {
    kind: 'token bucket',
    rate: 100,
    period: MINUTE,
    capacity: 150,
  },
  'agent:webhook': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 50,
  },
  'connector:slack-events': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 240,
  },
  'notify:slack': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 60,
  },
  'openai:chat': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 50,
  },
  'openai:images': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 15,
  },
  'openai:models': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 200,
  },
  'rest:api': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 200,
  },
  'rest:execute': {
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
  'runtime:register': { kind: 'fixed window', rate: 5, period: MINUTE },
  'runtime:claim': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 40,
  },
  'runtime:heartbeat': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
  },
  'runtime:events': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 120,
  },
  'agent:document-list': { kind: 'fixed window', rate: 30, period: MINUTE },
  'email:send': {
    kind: 'token bucket',
    rate: 100,
    period: HOUR,
    capacity: 120,
  },

  // TIER 6: maintenance
  'cleanup:retention': { kind: 'fixed window', rate: 1, period: HOUR },
  'cleanup:personalization': { kind: 'fixed window', rate: 1, period: HOUR },
  'cleanup:tts': { kind: 'token bucket', rate: 1, period: HOUR, capacity: 1 },
  'provision:autoheal': {
    kind: 'token bucket',
    rate: 1,
    period: 5 * MINUTE,
    capacity: 1,
  },
  'cleanup:slack-dedup': {
    kind: 'token bucket',
    rate: 1,
    period: HOUR,
    capacity: 1,
  },

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
  'tts:capability-probe:user': {
    kind: 'token bucket',
    rate: 12,
    period: MINUTE,
    capacity: 20,
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
 * transaction to tie the charge to the caller's commit/rollback.
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
    const ratePerMs = rule.rate / rule.period;
    const rows = await sql<{ value: string }[]>`
      INSERT INTO app.rate_limits AS rl (name, key, value, ts)
      VALUES (${name}, ${opts.key}, ${rule.capacity - count}, ${now})
      ON CONFLICT (name, key) DO UPDATE SET
        value = LEAST(
          ${rule.capacity}::double precision,
          rl.value + (${now} - rl.ts) * ${ratePerMs}
        ) - ${count},
        ts = ${now}
      WHERE LEAST(
          ${rule.capacity}::double precision,
          rl.value + (${now} - rl.ts) * ${ratePerMs}
        ) >= ${count}
      RETURNING value::text
    `;
    if (rows.length > 0) {
      return { ok: true };
    }
    const available = await readTokens(sql, name, opts.key, rule, now);
    const deficit = count - available;
    return { ok: false, retryAfter: Math.ceil(deficit / ratePerMs) };
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

/** Non-consuming probe of the same state `limitRate` charges. */
export async function checkRate(
  sql: Sql | TransactionSql,
  name: RateLimitName,
  opts: { key: string; count?: number },
): Promise<RateLimitResult> {
  const rule: RateLimitRule = RATE_LIMITS[name];
  const count = opts.count ?? 1;
  const now = Date.now();

  if (rule.kind === 'token bucket') {
    const available = await readTokens(sql, name, opts.key, rule, now);
    if (available >= count) {
      return { ok: true };
    }
    return {
      ok: false,
      retryAfter: Math.ceil((count - available) / (rule.rate / rule.period)),
    };
  }

  const windowStart = Math.floor(now / rule.period) * rule.period;
  const rows = await sql<{ value: string; ts: string }[]>`
    SELECT value::text, ts::text FROM app.rate_limits
    WHERE name = ${name} AND key = ${opts.key}
  `;
  const row = rows[0];
  const used = row && Number(row.ts) === windowStart ? Number(row.value) : 0;
  if (used + count <= rule.rate) {
    return { ok: true };
  }
  return { ok: false, retryAfter: windowStart + rule.period - now };
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
