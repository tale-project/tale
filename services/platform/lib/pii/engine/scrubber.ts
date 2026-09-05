/**
 * `createScrubber` — the pre-compiled hot-path entry point.
 *
 * Construction resolves everything once: the locale union across every
 * locale-aware toggle, the enabled factories from the registry, the
 * materialized pattern list (composed regexes compile here, not per
 * call), the custom-pattern compilation, and the byte/budget knobs.
 * `.scrub(text)` then only normalizes, clamps, detects, and rewrites —
 * production callers build one scrubber per config and reuse it for every
 * message.
 *
 * Throws synchronously only on programmer errors (an unknown explicit
 * locale code is the canonical case — the governance resolver filters
 * those before they get here). `.scrub()` itself never throws: factory
 * and validator failures are logged and skipped, and detection is
 * fail-open under its budgets.
 */

import { normalizeForDetection } from '../core/normalize';
import { blocked, modified, pass, type FilterOutcome } from '../core/outcome';
import {
  MAX_MESSAGE_BYTES,
  REGEX_EXEC_BUDGET_MS,
  clampMessage,
} from '../core/regex-safety';
import type { PiiPattern } from '../core/types';
import type { LocaleConfig } from '../schema';
import { detectPii } from './detector';
import { maskPii } from './masker';
import { materializePatterns } from './materialize';
import type { ScrubberOptions } from './options';
import { applyTokenization } from './tokenizer';

/** A built scrubber. Reuse one instance per config across messages. */
export interface Scrubber {
  /** Detect + rewrite/block `text`, returning a filter outcome. */
  scrub(text: string): FilterOutcome;
  /** The compiled pattern list — exposed for tests, not production code. */
  readonly patterns: ReadonlyArray<PiiPattern>;
  /** The locale union the patterns were composed over. */
  readonly locales: ReadonlyArray<LocaleConfig>;
}

export function createScrubber(options: ScrubberOptions): Scrubber {
  const { patterns, locales } = materializePatterns(options);

  const maxBytes = options.maxBytes ?? MAX_MESSAGE_BYTES;
  const budgetMs = options.perPatternBudgetMs ?? REGEX_EXEC_BUDGET_MS;
  const mode = options.mode ?? 'tokenize';

  function scrub(text: string): FilterOutcome {
    if (patterns.length === 0) return pass();
    if (text.length === 0) return pass();
    const normalized = normalizeForDetection(text);
    const { text: clamped, truncated } = clampMessage(normalized, maxBytes);

    const matches = detectPii(clamped, patterns, budgetMs);
    // A clamped input with no match in its prefix is not clean, only
    // unscanned past the clamp — the flag travels on the pass too.
    if (matches.length === 0) return pass(truncated || undefined);

    const categoryIds = [...new Set(matches.map((m) => m.patternName))];

    if (mode === 'block') {
      return blocked(categoryIds, matches.length, truncated || undefined);
    }
    // Tokenize mode shares `applyTokenization` with `createTokenizer` so
    // the token format cannot drift; the restore mapping is discarded here
    // because the scrubber surface does not expose round-trips — a caller
    // that restores (the chat guardrail's tokenize filter) builds a
    // `createTokenizer` over the same options instead.
    const rewritten =
      mode === 'tokenize'
        ? applyTokenization(clamped, matches).text
        : maskPii(clamped, matches);
    return modified(
      rewritten,
      categoryIds,
      matches.length,
      truncated || undefined,
    );
  }

  return { scrub, patterns, locales };
}
