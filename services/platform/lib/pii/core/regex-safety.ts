/**
 * Regex-safety utilities — ReDoS defenses for any regex that touches
 * untrusted input.
 *
 * V8 has no built-in regex timeout: a sufficiently-pathological pattern
 * (nested quantifiers, ambiguous alternation) can stall a JavaScript thread
 * indefinitely. `execWithBudget` wraps the `exec` loop with a wall-clock
 * check and aborts cooperatively. `clampMessage` caps input size *before*
 * scanning so a 10 MB paste cannot trigger a worst-case match.
 *
 * Each defense is necessary on its own but neither is sufficient:
 *   - `clampMessage` alone: input shrinks, but a single catastrophic regex
 *     can still spend hundreds of ms inside one `exec()` call.
 *   - `execWithBudget` alone: budget is checked between `exec()` calls, so
 *     one pathological exec on a huge input can still blow past the budget.
 *
 * Custom user-supplied regexes get a third defense at the schema layer:
 * `safe-regex2` static analysis rejects backtracking-prone shapes before
 * they ever reach the detector.
 */

export const MAX_MESSAGE_BYTES = 50_000;
export const REGEX_EXEC_BUDGET_MS = 50;

/** Escape regex metacharacters so a literal string can be used inside a pattern. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ClampResult {
  text: string;
  truncated: boolean;
}

// Shared encoder/decoder — TextEncoder/TextDecoder are available in V8
// runtimes (Node, Bun) and all modern browsers. `fatal: false` lets the
// decoder degrade a split multi-byte tail to U+FFFD instead of throwing;
// the boundary walk below ensures we never actually decode a partial
// sequence on the happy path, but the non-fatal mode is the safety net.
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Cap input length before scanning, measured in real UTF-8 bytes. Truncates
 * at a code-point boundary so a multibyte sequence is never split in half.
 *
 * Fast path: a single JS string code unit encodes to at most 4 UTF-8 bytes
 * (surrogate pairs cost 4 bytes for 2 code units = 2 bytes/unit; the worst
 * single-unit case is a BMP character at 3 bytes — 4 is a safe upper bound).
 * If `text.length * 4 <= maxBytes` the encoding cannot possibly exceed the
 * cap and we skip the encoder entirely. For ASCII-dominated chat payloads
 * this is the common case.
 *
 * Overflow note: JS string length is capped at 2^28 - 16 (~268M chars),
 * so `length * 4` maxes at ~1.07 billion — well within Number.MAX_SAFE_INTEGER.
 * No BigInt or overflow guard is needed here.
 */
export function clampMessage(
  text: string,
  maxBytes: number = MAX_MESSAGE_BYTES,
): ClampResult {
  if (text.length * 4 <= maxBytes) return { text, truncated: false };

  const encoded = utf8Encoder.encode(text);
  if (encoded.length <= maxBytes) return { text, truncated: false };

  // Walk back to the start of the last complete UTF-8 code point that fits.
  // UTF-8 continuation bytes match `10xxxxxx`; back up until we land on a
  // leading byte (`0xxxxxxx` for ASCII or `11xxxxxx` for multi-byte start)
  // so we never decode a half-encoded sequence.
  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }

  const truncated = utf8Decoder.decode(encoded.subarray(0, end));
  return { text: truncated, truncated: true };
}

interface BudgetedMatch {
  index: number;
  length: number;
  matchedText: string;
}

/**
 * Run `regex.exec(text)` in a loop with a wall-clock budget. If the budget
 * is exceeded, return the matches collected so far and log a warning. The
 * caller decides whether a partial match set is acceptable (PII: yes —
 * fail-open on regex DoS); we never throw from here.
 *
 * Requirements:
 *   - `regex` must have the `g` flag so `lastIndex` advances. Without `g`,
 *     `exec` always re-matches the same span and this loops forever.
 *   - A local copy of the regex is created so concurrent callers do not
 *     race on `lastIndex` (see below).
 *
 * `budgetMs` is clamped to a positive finite number; misconfigured values
 * (NaN, Infinity, negative, zero) fall back to `REGEX_EXEC_BUDGET_MS` so a
 * bad config cannot silently disable the defense.
 *
 * Zero-length matches (e.g. `^`, `\b`, `(?=…)`) advance `lastIndex` by one
 * to avoid an infinite loop on a successful match that consumed nothing.
 */
export function execWithBudget(
  regex: RegExp,
  text: string,
  budgetMs: number = REGEX_EXEC_BUDGET_MS,
): BudgetedMatch[] {
  if (!regex.global) {
    throw new Error('execWithBudget requires a regex with the g flag');
  }

  const effectiveBudget =
    Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : REGEX_EXEC_BUDGET_MS;

  const matches: BudgetedMatch[] = [];
  const start = Date.now();
  // Clone the regex into a local instance before iterating. A `g`-flagged
  // RegExp keeps mutable `lastIndex` state on the object itself, so two
  // concurrent callers sharing the same compiled pattern (the registry
  // hands the same instance to every scrub) would race on it: one call
  // advancing `lastIndex` mid-loop can cause the other to skip ranges or
  // re-scan from the wrong offset, producing missed PII or infinite
  // loops. The clone is cheap (regex compilation is cached by V8 on the
  // source/flags pair) and isolates `lastIndex` to this invocation.
  const local = new RegExp(regex.source, regex.flags);

  let match: RegExpExecArray | null;
  // Check the wall-clock budget every 16 iterations instead of every single
  // one. `Date.now()` is cheap but not free; batching reduces overhead by
  // ~16x while still catching runaway patterns quickly. 16 is a deliberate
  // compromise: high enough to matter for tight-loop patterns, low enough
  // that a single non-catastrophic match step (microseconds) times 16 stays
  // well under 1 ms — so we won't overshoot the budget by a meaningful amount.
  let iterCount = 0;
  while ((match = local.exec(text)) !== null) {
    matches.push({
      index: match.index,
      length: match[0].length,
      matchedText: match[0],
    });
    iterCount++;
    if ((iterCount & 15) === 0 && Date.now() - start > effectiveBudget) {
      console.warn(
        `[regex-safety] exec budget ${effectiveBudget}ms exceeded for pattern ${regex.source.slice(0, 60)}`,
      );
      break;
    }
    if (match[0].length === 0) {
      local.lastIndex += 1;
    }
  }

  return matches;
}
