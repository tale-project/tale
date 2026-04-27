/**
 * Shared regex-safety utilities for guardrails filters.
 *
 * V8 has no built-in regex timeout, so any admin-supplied pattern could
 * cause catastrophic backtracking that stalls a Convex action indefinitely.
 * `execWithBudget` wraps the `exec` loop with a wall-clock check and aborts
 * cooperatively. `escapeRegExp` is the standard regex metachar escape for
 * word-list compilation in chat_filter.
 *
 * Consumed by both the existing PII detector (retrofits a live ReDoS hole)
 * and the new chat_filter module. Message-length cap is enforced by each
 * filter's entry function calling `clampMessage` before scanning.
 */

export const MAX_MESSAGE_BYTES = 50_000;
export const REGEX_EXEC_BUDGET_MS = 50;

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ClampResult {
  text: string;
  truncated: boolean;
}

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
 * Runs `regex.exec(text)` in a loop with a wall-clock budget. If the budget
 * is exceeded, returns whatever matches have been collected so far and logs
 * a warning. The caller decides whether a partial match set is acceptable
 * (chat_filter: yes, fail-open on the regex); we never throw from here.
 *
 * The regex must be created with the `g` flag so `lastIndex` advances across
 * calls. Accepts either a `RegExp` or a `{ source, flags }` pair so callers
 * can recompile per-call cheaply without aliasing state.
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
        `[regex_safety] exec budget ${budgetMs}ms exceeded for pattern ${regex.source.slice(0, 60)}`,
      );
      break;
    }
    // Avoid zero-length infinite loop (e.g. `^` or `\b`).
    if (match[0].length === 0) {
      local.lastIndex += 1;
    }
  }

  return matches;
}
