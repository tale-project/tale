/**
 * Pattern materialization — the one resolution from `ScrubberOptions` to
 * the compiled pattern list, shared by the scrubber and the tokenizer.
 *
 * Both entry points must see exactly the same patterns for the same
 * options: the locale union across every locale-aware toggle, the enabled
 * factories from the registry in toggle order (the dedup tiebreak order —
 * tests pin it), then the admin's custom patterns. A second copy of this
 * walk is how tokenize mode once lost the custom patterns that mask mode
 * honoured.
 */

import safe from 'safe-regex2';

import type { PiiPattern } from '../core/types';
import type { LocaleConfig } from '../schema';
import { collectLocaleSelector, type ScrubberOptions } from './options';
import { PatternRegistry } from './registry';

export interface MaterializedPatterns {
  /** The compiled pattern list, in the order detection runs it. */
  readonly patterns: PiiPattern[];
  /** The locale union the locale-aware patterns were composed over. */
  readonly locales: LocaleConfig[];
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

/**
 * Resolve `options` into the pattern list the engine runs. Throws only on
 * a programmer error (an unknown explicit locale code); factory and
 * custom-pattern failures are logged and skipped.
 */
export function materializePatterns(
  options: ScrubberOptions,
): MaterializedPatterns {
  const registry = options.registry ?? PatternRegistry.fromDefaults();
  const locales = registry.resolveLocales(collectLocaleSelector(options));
  return {
    patterns: [
      ...materializeFactoryPatterns(options, locales, registry),
      ...materializeCustomPatterns(options.customPatterns),
    ],
    locales,
  };
}
