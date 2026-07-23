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

import safe from 'safe-regex2';

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
import { collectLocaleSelector, type ScrubberOptions } from './options';
import { PatternRegistry } from './registry';
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

/**
 * Compile admin-supplied custom patterns. Each is re-gated here — syntax
 * (`new RegExp`) and static backtracking analysis (safe-regex2) — even
 * though `piiCustomPatternSchema` already gates at save time: a stale row
 * or direct write must degrade to a skipped pattern with a warning, never
 * a throw and never an unbounded regex on the hot path.
 */
function materializeCustomPatterns(
  customs: ScrubberOptions['customPatterns'],
): PiiPattern[] {
  if (!customs) return [];
  const out: PiiPattern[] = [];
  for (const c of customs) {
    let compiled: RegExp;
    try {
      compiled = new RegExp(c.regex, 'g');
    } catch (err) {
      console.warn(
        `[pii] custom pattern "${c.name}" failed to compile: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      continue;
    }
    let isSafe = false;
    try {
      isSafe = safe(c.regex);
    } catch (err) {
      console.warn(
        `[pii] custom pattern "${c.name}" safety analysis threw: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
    if (!isSafe) {
      console.warn(
        `[pii] custom pattern "${c.name}" rejected as backtracking-prone; skipping`,
      );
      continue;
    }
    out.push({ name: c.name, regex: compiled, replacement: c.replacement });
  }
  return out;
}

/**
 * Materialize the enabled factories against the resolved locale set.
 * Iteration order follows the options' insertion order, which is the
 * dedup tiebreak order — tests pin it.
 */
function materializeFactoryPatterns(
  options: ScrubberOptions,
  locales: LocaleConfig[],
  registry: PatternRegistry,
): PiiPattern[] {
  const out: PiiPattern[] = [];
  for (const [name, toggle] of Object.entries(options.patterns)) {
    if (!toggle) continue;
    const factory = registry.get(name);
    if (!factory) {
      console.debug(
        `[pii] ScrubberOptions references unknown pattern "${name}"; skipping`,
      );
      continue;
    }
    try {
      out.push(...factory(locales));
    } catch (err) {
      console.warn(
        `[pii] pattern factory "${name}" threw: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }
  return out;
}

export function createScrubber(options: ScrubberOptions): Scrubber {
  const registry = options.registry ?? PatternRegistry.fromDefaults();
  const locales = registry.resolveLocales(collectLocaleSelector(options));

  const patterns = [
    ...materializeFactoryPatterns(options, locales, registry),
    ...materializeCustomPatterns(options.customPatterns),
  ];

  const maxBytes = options.maxBytes ?? MAX_MESSAGE_BYTES;
  const budgetMs = options.perPatternBudgetMs ?? REGEX_EXEC_BUDGET_MS;
  const mode = options.mode ?? 'tokenize';

  function scrub(text: string): FilterOutcome {
    if (patterns.length === 0) return pass();
    if (text.length === 0) return pass();
    const normalized = normalizeForDetection(text);
    const { text: clamped, truncated } = clampMessage(normalized, maxBytes);

    const matches = detectPii(clamped, patterns, budgetMs);
    if (matches.length === 0) return pass();

    const categoryIds = [...new Set(matches.map((m) => m.patternName))];

    if (mode === 'block') {
      return blocked(categoryIds, matches.length, truncated || undefined);
    }
    // Tokenize mode shares `applyTokenization` with `createTokenizer` so
    // the token format cannot drift; the restore mapping is discarded here
    // because the scrubber surface does not expose round-trips — callers
    // that need them use the tokenizer directly.
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
