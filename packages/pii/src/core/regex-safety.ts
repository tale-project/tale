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

export interface ClampResult {
  text: string;
  truncated: boolean;
}

/**
 * Cap input length before scanning. Cheap byte-count clamp — JavaScript
 * `string.length` is UTF-16 code units, which is close enough to bytes for
 * the typical ASCII-heavy chat payload and avoids the cost of a real
 * `TextEncoder` round-trip.
 */
export function clampMessage(
  text: string,
  maxBytes: number = MAX_MESSAGE_BYTES,
): ClampResult {
  if (text.length <= maxBytes) return { text, truncated: false };
  return { text: text.slice(0, maxBytes), truncated: true };
}

export interface BudgetedMatch {
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
 *     race on `lastIndex`.
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

  const matches: BudgetedMatch[] = [];
  const start = Date.now();
  const local = new RegExp(regex.source, regex.flags);

  let match: RegExpExecArray | null;
  while ((match = local.exec(text)) !== null) {
    matches.push({
      index: match.index,
      length: match[0].length,
      matchedText: match[0],
    });
    if (Date.now() - start > budgetMs) {
      console.warn(
        `[regex-safety] exec budget ${budgetMs}ms exceeded for pattern ${regex.source.slice(0, 60)}`,
      );
      break;
    }
    if (match[0].length === 0) {
      local.lastIndex += 1;
    }
  }

  return matches;
}
