/**
 * Shared option types for the scrubber and the tokenizer, plus the locale
 * selector aggregation both entry points use. Kept in its own module so
 * the tokenizer stays a peer of the scrubber (the scrubber imports the
 * tokenization core from the tokenizer; putting these here keeps that
 * dependency one-directional).
 */

import type { LocaleCode } from '../core/types';
import type { PatternRegistry } from './registry';

/**
 * Per-pattern toggle. Locale-aware patterns accept `{ locales }` to pick
 * the dataset subset; `true` (and any other truthy toggle) means every
 * locale the registry has data for. Universal patterns ignore the locale
 * selection entirely.
 */
export type PatternToggle = boolean | { locales: LocaleCode[] | '*' };

export interface ScrubberOptions {
  /**
   * Action on detection. Defaults to `'tokenize'` — the safest
   * round-trippable choice:
   *  - `'tokenize'` — splice stable indexed tokens (`[EMAIL_1]`).
   *  - `'mask'`     — splice generic tokens (`[EMAIL]`); one-way.
   *  - `'block'`    — short-circuit with a blocked outcome.
   */
  mode?: 'mask' | 'block' | 'tokenize';

  /**
   * Per-pattern enable map, keyed by registry pattern name (the built-in
   * names plus any registry additions). Omitted names are disabled;
   * unknown names are logged and skipped at materialization.
   */
  patterns: {
    email?: PatternToggle;
    phone?: PatternToggle;
    creditCard?: PatternToggle;
    cvc?: PatternToggle;
    iban?: PatternToggle;
    ipAddress?: PatternToggle;
    macAddress?: PatternToggle;
    jwt?: PatternToggle;
    ssn?: PatternToggle;
    dateOfBirth?: PatternToggle;
    address?: PatternToggle;
    nationalId?: PatternToggle;
    [customName: string]: PatternToggle | undefined;
  };

  /**
   * Admin-supplied custom patterns (already validated by
   * `piiCustomPatternSchema`). Compiled directly — they do not go through
   * the registry — and re-gated at compile time (syntax + static safety)
   * as defense in depth.
   */
  customPatterns?: ReadonlyArray<{
    name: string;
    regex: string;
    replacement: string;
  }>;

  /**
   * The pattern/locale registry to resolve against. Defaults to
   * `PatternRegistry.fromDefaults()` (the shipped configs tree).
   */
  registry?: PatternRegistry;

  /** Input byte cap before scanning. Defaults to 50 KB. */
  maxBytes?: number;

  /** Per-pattern regex wall-clock budget in milliseconds. Default 50. */
  perPatternBudgetMs?: number;
}

/**
 * Union the locale selections referenced by every locale-aware toggle.
 * Building patterns over the union lets one registry pass cover every
 * factory; universal factories ignore the argument anyway.
 */
export function collectLocaleSelector(
  options: ScrubberOptions,
): LocaleCode[] | '*' {
  const seen = new Set<string>();
  for (const toggle of Object.values(options.patterns)) {
    if (!toggle) continue;
    // Any bare `true` (or truthy junk from an untyped caller) widens the
    // union to every locale — a toggle without an explicit subset opts
    // into the full dataset.
    if (toggle === true || typeof toggle !== 'object') return '*';
    if (toggle.locales === '*') return '*';
    if (Array.isArray(toggle.locales)) {
      for (const code of toggle.locales) seen.add(code);
    }
  }
  return [...seen];
}
