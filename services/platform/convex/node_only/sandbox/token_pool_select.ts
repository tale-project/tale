/**
 * Pure token-pool mapping + selection — the testable core of the token-source
 * rotation engine. Isolated here (no 'use node', no convex imports) so it is
 * unit-testable without the node-only action module, mirroring
 * `agent_run_outcome.ts` / `api_error_detection.ts`.
 */

import type { TokenSourceResponseMapping } from '../../../lib/shared/schemas/token_sources';
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

/** Coerce a broker expiry field (ISO 8601 string, or epoch seconds/ms) to ms. */
export function parseExpiryMs(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Heuristic: values below ~1e12 are epoch SECONDS, above are ms.
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string') {
    // `dayjs.utc` parses a timezone-LESS ISO timestamp (e.g. Python's
    // `datetime.utcnow().isoformat()` → "2026-06-22T18:21:33.093441") as UTC
    // rather than the host's local zone — `Date.parse`/`new Date` would treat it
    // as local and skew expiry by the UTC offset (a UTC+8 host falsely expires a
    // still-valid token). An explicit `Z`/offset is respected as-is.
    const d = dayjs.utc(raw);
    return d.isValid() ? d.valueOf() : undefined;
  }
  return undefined;
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
  const arr = readJsonPath(json, mapping.tokensPath);
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const item of arr) {
    if (!isRecord(item)) continue;
    const token = item[mapping.tokenField];
    if (typeof token !== 'string' || token.length === 0) continue;
    if (
      mapping.statusField !== undefined &&
      mapping.statusActiveValue !== undefined &&
      item[mapping.statusField] !== mapping.statusActiveValue
    ) {
      continue;
    }
    if (mapping.expiryField !== undefined) {
      const expiryMs = parseExpiryMs(item[mapping.expiryField]);
      if (expiryMs !== undefined && expiryMs <= nowMs + skewMs) continue;
    }
    out.push(token);
  }
  return [...new Set(out)];
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
