/**
 * Pure token-pool mapping + selection — the testable core of the
 * subscription-broker credential path. No `'use node'`, no Convex imports,
 * so it unit-tests without the node action module; the thin fetch wrapper
 * lives in `resolve_credential.ts`.
 *
 * Semantics preserved from the retired token-source rotation engine so
 * migrated broker credentials behave identically: config-driven response
 * mapping (JSONPath to the array + per-item field names), active-status and
 * expiry-skew filtering, de-duplication, and `random`/`first` selection with
 * `round-robin` behaving as `first` (no cross-run cursor; an exclude set
 * advances it within a turn).
 */

import type {
  BrokerAuth,
  BrokerResponseMapping,
  BrokerSelection,
} from '../../../lib/shared/schemas/providers';
import dayjs from '../../../lib/utils/date/dayjs-setup';
import { isRecord } from '../../../lib/utils/type-utils';
import { readJsonPath } from '../lib/json/json_path';

/**
 * A clear, non-leaky failure of the broker credential path — never carries a
 * token, the broker URL, or the response body; only a failure class and an
 * actionable hint.
 */
export class BrokerPoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrokerPoolError';
  }
}

/**
 * The auth headers for a broker request. `secret` is the resolved broker
 * auth secret (from the encrypted credential data, or the operator env-ref);
 * required for every method except `none`.
 */
export function buildBrokerAuthHeaders(
  auth: BrokerAuth,
  secret: string | undefined,
): Record<string, string> {
  switch (auth.method) {
    case 'none':
      return {};
    case 'bearer': {
      if (secret === undefined || secret === '') {
        throw new BrokerPoolError(
          'The broker auth secret is not configured — re-enter it on the credential, or set the env var its config names.',
        );
      }
      return { authorization: `Bearer ${secret}` };
    }
    case 'header': {
      if (secret === undefined || secret === '') {
        throw new BrokerPoolError(
          'The broker auth secret is not configured — re-enter it on the credential, or set the env var its config names.',
        );
      }
      return { [auth.headerName]: secret };
    }
    default: {
      const _exhaustive: never = auth;
      return _exhaustive;
    }
  }
}

/** Coerce a broker expiry field (ISO 8601 string, or epoch seconds/ms) to
 * epoch ms; `undefined` when unparseable. */
export function parseExpiryMs(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Values below ~1e12 are epoch SECONDS, above are ms.
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // A pure-digit string is an epoch (seconds or ms), not an ISO timestamp:
    // `dayjs.utc("1700000000")` misreads it as the year 1700 and the token
    // gets silently dropped as long-expired. Route it through the numeric
    // heuristic so a broker that JSON-encodes expiry as a string epoch works.
    if (/^\d+$/.test(trimmed)) return parseExpiryMs(Number(trimmed));
    // `dayjs.utc` parses a timezone-LESS ISO timestamp (e.g. Python's
    // `datetime.utcnow().isoformat()`) as UTC rather than the host's local
    // zone — `Date.parse` would treat it as local and skew expiry by the UTC
    // offset. An explicit `Z`/offset is respected as-is.
    const parsed = dayjs.utc(trimmed);
    return parsed.isValid() ? parsed.valueOf() : undefined;
  }
  return undefined;
}

/**
 * Per-item outcome counts of running a mapping over a broker response — the
 * data behind the runtime pool (`usableTokens`) and the empty-pool diagnosis,
 * which explains WHY items were dropped instead of yielding a bare "no
 * tokens". Carries no response data beyond the token strings.
 */
export interface TokenMappingDiagnostics {
  /** Whether `tokensPath` resolved to an array at all. */
  pathFound: boolean;
  /** Items in the array at `tokensPath` (0 when the path missed). */
  itemCount: number;
  /** De-duplicated tokens that survived every filter, in response order. */
  usableTokens: string[];
  /** Items with no non-empty string at `tokenField` (or not objects). */
  missingTokenField: number;
  /** Items dropped by the `statusField`/`activeValue` filter. */
  inactiveCount: number;
  /** Items dropped because they expire within `skewMs` of `nowMs`. */
  expiredCount: number;
  /** Soonest parseable expiry among the usable tokens, epoch ms. */
  nextExpiryMs?: number;
}

/**
 * Run `mapping` over a broker's JSON response and classify every item: read
 * the array at `tokensPath`, take `tokenField` off each item, drop items not
 * matching `activeValue` or expiring within `skewMs` of `nowMs` — counting
 * each drop reason. The single source of truth for the mapping walk — the
 * resolver reads `usableTokens` off the result.
 */
export function diagnoseTokenMapping(
  json: unknown,
  mapping: BrokerResponseMapping,
  nowMs: number,
  skewMs: number,
): TokenMappingDiagnostics {
  const arr = readJsonPath(json, mapping.tokensPath);
  if (!Array.isArray(arr)) {
    return {
      pathFound: false,
      itemCount: 0,
      usableTokens: [],
      missingTokenField: 0,
      inactiveCount: 0,
      expiredCount: 0,
    };
  }
  const usable: string[] = [];
  let missingTokenField = 0;
  let inactiveCount = 0;
  let expiredCount = 0;
  let nextExpiryMs: number | undefined;
  for (const item of arr) {
    const token = isRecord(item) ? item[mapping.tokenField] : undefined;
    if (!isRecord(item) || typeof token !== 'string' || token.length === 0) {
      missingTokenField += 1;
      continue;
    }
    if (
      mapping.statusField !== undefined &&
      mapping.activeValue !== undefined &&
      item[mapping.statusField] !== mapping.activeValue
    ) {
      inactiveCount += 1;
      continue;
    }
    if (mapping.expiresField !== undefined) {
      const expiryMs = parseExpiryMs(item[mapping.expiresField]);
      if (expiryMs !== undefined && expiryMs <= nowMs + skewMs) {
        expiredCount += 1;
        continue;
      }
      if (
        expiryMs !== undefined &&
        (nextExpiryMs === undefined || expiryMs < nextExpiryMs)
      ) {
        nextExpiryMs = expiryMs;
      }
    }
    usable.push(token);
  }
  return {
    pathFound: true,
    itemCount: arr.length,
    usableTokens: [...new Set(usable)],
    missingTokenField,
    inactiveCount,
    expiredCount,
    ...(nextExpiryMs !== undefined && { nextExpiryMs }),
  };
}

/**
 * Explain an empty pool in the caller's terms: name the mapping piece that
 * dropped everything and the way out. Only meaningful when
 * `diagnostics.usableTokens` is empty.
 */
export function describeEmptyPool(
  diagnostics: TokenMappingDiagnostics,
  mapping: BrokerResponseMapping,
): string {
  if (!diagnostics.pathFound) {
    return `the response has no array at tokensPath "${mapping.tokensPath}" — check the response mapping against the broker's JSON shape.`;
  }
  if (diagnostics.itemCount === 0) {
    return `the array at "${mapping.tokensPath}" is empty — the broker currently serves no tokens.`;
  }
  const parts: string[] = [];
  if (diagnostics.missingTokenField > 0) {
    parts.push(
      `${diagnostics.missingTokenField} item(s) carry no string at tokenField "${mapping.tokenField}"`,
    );
  }
  if (diagnostics.inactiveCount > 0) {
    parts.push(
      `${diagnostics.inactiveCount} item(s) are not "${mapping.activeValue ?? ''}" at statusField "${mapping.statusField ?? ''}"`,
    );
  }
  if (diagnostics.expiredCount > 0) {
    parts.push(
      `${diagnostics.expiredCount} item(s) expire within the configured expiry skew`,
    );
  }
  const detail =
    parts.length > 0
      ? parts.join('; ')
      : `all ${diagnostics.itemCount} item(s) were filtered out`;
  return `${detail} — fix the response mapping, or wait for the broker to serve fresh tokens.`;
}

/**
 * Pick one token from the pool, excluding any already tried this turn (so a
 * failover always advances to a fresh credential). `random` picks uniformly;
 * `first` is deterministic; `round-robin` keeps no cross-run cursor and
 * behaves as `first` (the exclude set advances it within a turn). Returns
 * null when every token is excluded. `randomFn` is injectable for tests.
 */
export function pickToken(
  tokens: readonly string[],
  exclude: ReadonlySet<string>,
  selection: BrokerSelection,
  randomFn: () => number = Math.random,
): string | null {
  const candidates = tokens.filter((t) => !exclude.has(t));
  if (candidates.length === 0) return null;
  switch (selection) {
    case 'first':
    case 'round-robin':
      return candidates[0];
    case 'random':
      return candidates[Math.floor(randomFn() * candidates.length)] ?? null;
    default: {
      const _exhaustive: never = selection;
      return _exhaustive;
    }
  }
}
