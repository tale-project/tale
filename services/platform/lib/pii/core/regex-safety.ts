/**
 * ReDoS defenses for every regex the engine runs over untrusted input.
 *
 * V8 has no regex timeout: a pathological pattern can stall the thread
 * indefinitely. Two runtime defenses compose — each necessary, neither
 * sufficient alone:
 *
 *  - `clampMessage` caps input size BEFORE scanning, so a 10 MB paste can
 *    never feed a worst-case match. Alone it still lets one catastrophic
 *    regex burn hundreds of milliseconds inside a single `exec`.
 *  - `execWithBudget` bounds the exec loop with a wall-clock budget and
 *    aborts cooperatively. The budget is only checked BETWEEN `exec`
 *    calls, so it needs the input clamp to bound each individual call.
 *
 * Org-supplied regexes get a third, static defense upstream: safe-regex2
 * analysis in `piiCustomPatternSchema` (and again at compile time in the
 * engine) rejects backtracking-prone shapes before they ever execute.
 */

/** Input byte cap applied before any pattern runs. */
export const MAX_MESSAGE_BYTES = 50_000;

/** Default per-pattern wall-clock budget for the exec loop. */
export const REGEX_EXEC_BUDGET_MS = 50;

/** Escape regex metacharacters so a literal keyword can embed in a pattern. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ClampResult {
  text: string;
  truncated: boolean;
}

// TextEncoder/TextDecoder work in every runtime the library targets (Bun,
// Node, browsers, V8 isolates). Non-fatal decoding is the safety net for a
// split multi-byte tail; the boundary walk below avoids it on every path.
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Cap input length in real UTF-8 bytes, truncating on a code-point
 * boundary so no multi-byte sequence is split.
 *
 * Fast path: one UTF-16 code unit encodes to at most 4 UTF-8 bytes (3 for
 * the worst single unit, 2/unit for surrogate pairs), so when
 * `text.length * 4 <= maxBytes` the encoder is skipped entirely — the
 * common case for chat-sized payloads. JS strings cap at ~2^28 characters,
 * so the multiplication cannot overflow a double.
 */
export function clampMessage(
  text: string,
  maxBytes: number = MAX_MESSAGE_BYTES,
): ClampResult {
  if (text.length * 4 <= maxBytes) return { text, truncated: false };

  const encoded = utf8Encoder.encode(text);
  if (encoded.length <= maxBytes) return { text, truncated: false };

  // Walk back over UTF-8 continuation bytes (10xxxxxx) until a leading
  // byte, so the cut lands on a complete code point.
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }

  return {
    text: utf8Decoder.decode(encoded.subarray(0, end)),
    truncated: true,
  };
}

export interface BudgetedMatch {
  index: number;
  length: number;
  matchedText: string;
}

/**
 * Run `regex.exec` in a loop under a wall-clock budget. On budget
 * exhaustion the matches collected so far are returned and a warning is
 * logged — fail-open by design (for PII scrubbing a partial match set
 * beats a hung guardrail); this function never throws for input reasons.
 *
 * Contract:
 *  - `regex` must carry the `g` flag (otherwise `exec` re-matches the same
 *    span forever) — a missing flag is a programmer error and throws.
 *  - The regex is cloned locally: a `g` regex keeps mutable `lastIndex`
 *    state on the object, and the registry hands the same compiled
 *    instance to every scrub, so concurrent callers would otherwise race
 *    on it (skipped ranges, re-scans, missed PII). V8 caches compilation
 *    on (source, flags), so the clone is cheap.
 *  - Zero-length matches advance `lastIndex` by one to avoid an infinite
 *    loop on lookarounds and anchors.
 *  - A misconfigured budget (NaN, Infinity, <= 0) falls back to the
 *    default so bad config can never silently disable the defense.
 *
 * The clock is sampled every 16 iterations: `Date.now()` is cheap but not
 * free, and 16 non-catastrophic match steps stay well under a millisecond,
 * so the budget cannot be meaningfully overshot.
 */
export function execWithBudget(
  regex: RegExp,
  text: string,
  budgetMs: number = REGEX_EXEC_BUDGET_MS,
): BudgetedMatch[] {
  if (!regex.global) {
    throw new Error('[pii] execWithBudget requires a regex with the g flag');
  }

  const effectiveBudget =
    Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : REGEX_EXEC_BUDGET_MS;

  const matches: BudgetedMatch[] = [];
  const start = Date.now();
  const local = new RegExp(regex.source, regex.flags);

  let match: RegExpExecArray | null;
  let iterations = 0;
  while ((match = local.exec(text)) !== null) {
    matches.push({
      index: match.index,
      length: match[0].length,
      matchedText: match[0],
    });
    iterations += 1;
    if ((iterations & 15) === 0 && Date.now() - start > effectiveBudget) {
      console.warn(
        `[pii] regex exec budget ${effectiveBudget}ms exceeded for pattern ${regex.source.slice(0, 60)}`,
      );
      break;
    }
    if (match[0].length === 0) {
      local.lastIndex += 1;
    }
  }

  return matches;
}
