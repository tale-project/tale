/**
 * Pure token-pool mapping + selection — the testable core of the token-source
 * rotation engine. Isolated here (no 'use node', no convex imports) so it is
 * unit-testable without the node-only action module, mirroring
 * `agent_run_outcome.ts` / `api_error_detection.ts`.
 */

import type {
  TokenSourceAuth,
  TokenSourceResponseMapping,
} from '../../../lib/shared/schemas/token_sources';
import dayjs from '../../../lib/utils/date/dayjs-setup';
import { isRecord } from '../../../lib/utils/type-utils';
import { readJsonPath } from '../../lib/json/json_path';

export type TokenSelection = 'random' | 'round-robin' | 'first';

/** A clear, non-leaky failure of the token-source path (never carries a token,
 *  the broker URL, or the response body — only a failure class). */
export class TokenSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenSourceError';
  }
}

/**
 * The auth headers for a broker request. Shared by the runtime pool fetcher
 * (`resolveTokenPool`) and the management UI's `testTokenSource` probe so the
 * test exercises exactly the request the rotation engine will make.
 */
export function buildAuthHeaders(
  auth: TokenSourceAuth,
  secret: string | undefined,
): Record<string, string> {
  if (auth.method === 'none') return {};
  if (secret === undefined || secret === '') {
    throw new TokenSourceError('broker auth secret is not configured');
  }
  if (auth.method === 'bearer') return { authorization: `Bearer ${secret}` };
  return { [auth.headerName]: secret };
}

/** Coerce a broker expiry field (ISO 8601 string, or epoch seconds/ms) to ms. */
export function parseExpiryMs(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Heuristic: values below ~1e12 are epoch SECONDS, above are ms.
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // A pure-digit string is an epoch (seconds or ms), not an ISO timestamp:
    // `dayjs.utc("1700000000")` misreads it as the year 1700 and the token gets
    // silently dropped as long-expired. Route it through the numeric heuristic
    // so a broker that JSON-encodes expiry as a string epoch still works.
    if (/^\d+$/.test(trimmed)) return parseExpiryMs(Number(trimmed));
    // `dayjs.utc` parses a timezone-LESS ISO timestamp (e.g. Python's
    // `datetime.utcnow().isoformat()` → "2026-06-22T18:21:33.093441") as UTC
    // rather than the host's local zone — `Date.parse`/`new Date` would treat it
    // as local and skew expiry by the UTC offset (a UTC+8 host falsely expires a
    // still-valid token). An explicit `Z`/offset is respected as-is.
    const d = dayjs.utc(trimmed);
    return d.isValid() ? d.valueOf() : undefined;
  }
  return undefined;
}

/**
 * Per-item outcome counts of running `mapping` over a broker response — the
 * data behind both the runtime pool (`usableTokens`) and the management UI's
 * mapping preview, which flags *why* items were dropped instead of silently
 * yielding an empty pool. Carries no response data beyond the token strings.
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
  /** Items dropped by the `statusField`/`statusActiveValue` filter. */
  inactiveCount: number;
  /** Items dropped because they expire within `skewMs` of `nowMs`. */
  expiredCount: number;
  /** Soonest parseable expiry among the usable tokens, epoch ms. */
  nextExpiryMs?: number;
}

/**
 * Run `mapping` over a broker's JSON response and classify every item: read
 * the array at `tokensPath`, take `tokenField` off each item, and drop items
 * that are not `statusActiveValue` or that expire within `skewMs` of now —
 * counting each drop reason. The single source of truth for the mapping walk;
 * `mapTokens` is its runtime projection.
 */
export function diagnoseTokenMapping(
  json: unknown,
  mapping: TokenSourceResponseMapping,
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
      mapping.statusActiveValue !== undefined &&
      item[mapping.statusField] !== mapping.statusActiveValue
    ) {
      inactiveCount += 1;
      continue;
    }
    if (mapping.expiryField !== undefined) {
      const expiryMs = parseExpiryMs(item[mapping.expiryField]);
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
 * Extract the usable token list from a broker's JSON response per `mapping`:
 * read the array at `tokensPath`, take `tokenField` off each item, and drop
 * items that are not `statusActiveValue` or that expire within `skewMs` of now.
 * Returns de-duplicated token strings.
 */
export function mapTokens(
  json: unknown,
  mapping: TokenSourceResponseMapping,
  nowMs: number,
  skewMs: number,
): string[] {
  return diagnoseTokenMapping(json, mapping, nowMs, skewMs).usableTokens;
}

/**
 * Pick one token from the pool, excluding any already tried this turn (so a
 * failover always advances to a fresh credential). `random` (default) picks
 * uniformly; `first` is deterministic. `round-robin` has no cross-run cursor in
 * v1, so it behaves as `first` (the exclude set advances it within a turn).
 * Returns null when every token is excluded. `randomFn` is injectable for tests.
 */
export function pickToken(
  tokens: readonly string[],
  exclude: ReadonlySet<string>,
  selection: TokenSelection = 'random',
  randomFn: () => number = Math.random,
): string | null {
  const candidates = tokens.filter((t) => !exclude.has(t));
  if (candidates.length === 0) return null;
  if (selection === 'first' || selection === 'round-robin')
    return candidates[0];
  return candidates[Math.floor(randomFn() * candidates.length)] ?? null;
}
