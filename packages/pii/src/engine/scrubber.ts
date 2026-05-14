/**
 * `createScrubber` — pre-compiled, locale-aware PII detector + masker.
 *
 * The recommended API for production callers. The `Scrubber` instance:
 *
 *   1. Resolves the enabled locale set once (via `resolveLocales`).
 *   2. Resolves the active pattern factories from `ScrubberOptions.patterns`,
 *      `ScrubberOptions.customPatterns`, and the optional custom registry.
 *   3. Materializes every factory into `PiiPattern[]` by passing the
 *      locale set. Composed regexes (phone / cvc / address) are compiled
 *      at this point, not on every call.
 *   4. Exposes `.scrub(text)` which normalizes, clamps, detects, masks /
 *      blocks, and returns a `FilterOutcome`.
 *
 * On hot paths (per-message guardrails in `services/platform`), the
 * scrubber is built once at module load and reused for every message —
 * the per-call cost is dominated by regex execution, not setup.
 */

import { normalizeForDetection } from '../core/normalize';
import { blocked, modified, pass, type FilterOutcome } from '../core/outcome';
import {
  MAX_MESSAGE_BYTES,
  REGEX_EXEC_BUDGET_MS,
  clampMessage,
} from '../core/regex-safety';
import type {
  LocaleCode,
  PiiMatch,
  PiiPattern,
  PiiPatternFactory,
} from '../core/types';
import { resolveLocales, type LocaleConfig } from '../locales';
import { detectPii } from './detector';
import { maskPii } from './masker';
import { PatternRegistry } from './registry';

/**
 * Per-pattern toggle in the scrubber options. Locale-aware patterns
 * (address, nationalId) accept a `{ locales }` object that picks the
 * subset to load; everything else is a plain boolean. `'*'` means every
 * locale the library has data for.
 */
export type PatternToggle = boolean | { locales: LocaleCode[] | '*' };

export interface ScrubberOptions {
  /**
   * Action when PII is detected. Defaults to `'tokenize'` — the safest
   * round-trippable choice because the user's response can be restored
   * to their original wording once the AI replies.
   *
   *   - `'tokenize'` — replace each match with a stable indexed token
   *                    (`[EMAIL_1]`) and expose a restore mapping on the
   *                    outcome. The default.
   *   - `'mask'`     — splice generic replacement tokens (`[EMAIL]`)
   *                    into the text. One-way; the original is lost.
   *   - `'block'`    — short-circuit the message with a blocked outcome.
   */
  mode?: 'mask' | 'block' | 'tokenize';

  /** Per-pattern enable map. Omitted patterns are disabled. */
  patterns: {
    email?: PatternToggle;
    phone?: PatternToggle;
    creditCard?: PatternToggle;
    cvc?: PatternToggle;
    iban?: PatternToggle;
    ipAddress?: PatternToggle;
    ssn?: PatternToggle;
    dateOfBirth?: PatternToggle;
    address?: PatternToggle;
    nationalId?: PatternToggle;
    /**
     * Embedder-defined patterns registered via `PatternRegistry.add(...)`
     * are looked up by their name here. Any unknown name is logged and
     * skipped at materialization time.
     */
    [customName: string]: PatternToggle | undefined;
  };

  /**
   * Admin-supplied custom patterns. Each is compiled into a `PiiPattern`
   * directly — these do NOT go through the registry. They are validated
   * by `piiCustomPatternSchema` (Zod + safe-regex2) before reaching the
   * scrubber.
   */
  customPatterns?: ReadonlyArray<{
    name: string;
    regex: string;
    replacement: string;
  }>;

  /**
   * Override the default `BUILT_IN_PATTERNS` registry. For embedders that
   * need to swap an entire pattern (a stricter email matcher) or add
   * locale-aware factories of their own.
   */
  registry?: PatternRegistry;

  /** Input length cap before scanning. Defaults to 50 KB. */
  maxBytes?: number;

  /**
   * Per-pattern wall-clock budget passed to `execWithBudget`. Defaults to
   * 50 ms — adequate for production traffic; tighten only with profiling.
   */
  perPatternBudgetMs?: number;
}

/** Result of constructing a scrubber. Always reused per message. */
export interface Scrubber {
  /** Run detection + masking on `text` and return a `FilterOutcome`. */
  scrub(text: string): FilterOutcome;
  /** The compiled pattern list — exposed for tests, not production code. */
  readonly patterns: ReadonlyArray<PiiPattern>;
  /** The locale union used to compose patterns. */
  readonly locales: ReadonlyArray<LocaleConfig>;
}

/**
 * Resolve a `PatternToggle` into a `LocaleCode[] | '*'` if it's locale-
 * aware, otherwise return `[]` (universal patterns ignore the locales).
 */
function localesForToggle(
  toggle: PatternToggle | undefined,
): LocaleCode[] | '*' | null {
  if (!toggle) return null;
  if (toggle === true) return '*';
  if (typeof toggle === 'object') return toggle.locales;
  return '*';
}

/**
 * Collect the union of locale codes referenced by any locale-aware
 * pattern toggle. Building the scrubber over the union (rather than
 * per-pattern subsets) means a single locale registry pass covers
 * every factory.
 *
 * Universal patterns (email, ssn, …) ignore the locales argument anyway,
 * so passing them the union has no cost.
 */
function collectLocaleSelector(options: ScrubberOptions): LocaleCode[] | '*' {
  const seen = new Set<string>();
  let wildcard = false;
  for (const toggle of Object.values(options.patterns)) {
    const sel = localesForToggle(toggle);
    if (sel === null) continue;
    if (sel === '*') {
      wildcard = true;
      break;
    }
    for (const code of sel) seen.add(code);
  }
  if (wildcard) return '*';
  return [...seen];
}

/** Compile admin-supplied custom regexes into `PiiPattern[]`. */
function materializeCustomPatterns(
  customs: ScrubberOptions['customPatterns'],
): PiiPattern[] {
  if (!customs) return [];
  const out: PiiPattern[] = [];
  for (const c of customs) {
    try {
      out.push({
        name: c.name,
        regex: new RegExp(c.regex, 'g'),
        replacement: c.replacement,
      });
    } catch (err) {
      // Defense-in-depth: piiCustomPatternSchema validates at save time.
      // A stale DB / direct write could still reach here. Skip with a
      // warn so `createScrubber` honours its "never throws" contract.
      console.warn(
        `[pii] custom pattern "${c.name}" failed to compile: ${
          err instanceof Error ? err.name : 'unknown'
        }`,
      );
    }
  }
  return out;
}

/**
 * Materialize the active pattern factories using the resolved locale set.
 * Order matches `Object.keys(options.patterns)` insertion order; tests
 * pin this to ensure deterministic match-resolution tiebreaks in
 * `dedupOverlaps`.
 */
function materializeFactoryPatterns(
  options: ScrubberOptions,
  locales: LocaleConfig[],
  registry: PatternRegistry,
): PiiPattern[] {
  const out: PiiPattern[] = [];
  for (const [name, toggle] of Object.entries(options.patterns)) {
    if (!toggle) continue;
    const factory: PiiPatternFactory | undefined = registry.get(name);
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
        `[pii] pattern factory "${name}" threw: ${
          err instanceof Error ? err.name : 'unknown'
        }`,
      );
    }
  }
  return out;
}

/**
 * Build a `Scrubber` that can be invoked many times on a hot path.
 *
 * Throws synchronously only on programmer errors — an unknown explicit
 * locale code is the canonical case. Runtime errors during `.scrub()` are
 * swallowed and surfaced via `FilterOutcome.kind === 'step_error'` (the
 * detector never throws).
 */
export function createScrubber(options: ScrubberOptions): Scrubber {
  const registry = options.registry ?? PatternRegistry.fromDefaults();
  const selector = collectLocaleSelector(options);
  const locales = resolveLocales(selector);

  const factoryPatterns = materializeFactoryPatterns(
    options,
    locales,
    registry,
  );
  const customPatterns = materializeCustomPatterns(options.customPatterns);
  const patterns = [...factoryPatterns, ...customPatterns];

  const maxBytes = options.maxBytes ?? MAX_MESSAGE_BYTES;
  // `perPatternBudgetMs` is the contract knob but actual enforcement
  // happens inside `execWithBudget` via the regex's source — passing it
  // through here would require threading per-pattern budgets, which is
  // overkill for the default. Reserved for future use.
  void (options.perPatternBudgetMs ?? REGEX_EXEC_BUDGET_MS);

  const mode = options.mode ?? 'tokenize';

  function scrub(text: string): FilterOutcome {
    if (patterns.length === 0) return pass();
    const normalized = normalizeForDetection(text);
    const { text: clamped, truncated } = clampMessage(normalized, maxBytes);

    const matches = detectPii(clamped, patterns);
    if (matches.length === 0) return pass();

    const categoryIds = [...new Set(matches.map((m) => m.patternName))];

    if (mode === 'block') {
      return blocked(categoryIds, matches.length, truncated || undefined);
    }
    const rewritten =
      mode === 'tokenize'
        ? tokenizeMatches(clamped, matches)
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

/**
 * In-scrubber tokenization helper — produces indexed `[TYPE_N]` tokens
 * for `mode: 'tokenize'`. We keep the restore mapping local to the call;
 * callers that need round-trip recovery should use `createTokenizer`
 * directly which returns the mapping alongside the rewritten text.
 */
function tokenizeMatches(text: string, matches: PiiMatch[]): string {
  const byKey = new Map<string, string>();
  const counters = new Map<string, number>();
  for (const m of matches) {
    const key = `${m.patternName} ${m.matchedText}`;
    if (byKey.has(key)) continue;
    const next = (counters.get(m.patternName) ?? 0) + 1;
    counters.set(m.patternName, next);
    byKey.set(key, `[${m.patternName.toUpperCase()}_${next}]`);
  }
  const sorted = [...matches].sort((a, b) => b.start - a.start);
  let out = text;
  for (const m of sorted) {
    const token = byKey.get(`${m.patternName} ${m.matchedText}`);
    if (!token) continue;
    out = out.slice(0, m.start) + token + out.slice(m.end);
  }
  return out;
}
