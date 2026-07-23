/**
 * Governance policy → engine options.
 *
 * Takes a VALIDATED `PiiConfig` (the org's `pii_config` governance policy,
 * `lib/shared/schemas/pii.ts` — the frozen name contract) plus a loaded
 * registry, and yields the `ScrubberOptions` the engine runs on.
 *
 * Degradation posture — a stale admin config must never brick the
 * guardrail pipeline, so nothing here throws for config content:
 *  - enabled pattern names are intersected with the registry's known
 *    names; unknown names are logged and skipped;
 *  - locale filters are intersected with the loaded locale datasets;
 *    unknown codes are logged and skipped (an empty remainder simply
 *    means the locale-aware patterns contribute nothing);
 *  - custom patterns pass through to the engine, which re-gates each
 *    (compile + static safety) and skips failures with a warning.
 */

import type { PiiConfig } from '../../lib/shared/schemas/pii';
import type { PatternToggle, ScrubberOptions } from './engine/options';
import { PatternRegistry } from './engine/registry';
import { createScrubber, type Scrubber } from './engine/scrubber';

/**
 * Resolve a policy into scrubber options against `registry`, or null when
 * the policy is disabled (callers skip the filter entirely).
 */
export function resolveScrubberOptions(
  config: PiiConfig,
  registry: PatternRegistry,
): ScrubberOptions | null {
  if (!config.enabled) return null;

  // Locale filter: absent means every available locale. Present, it is
  // intersected with the datasets the registry actually loaded.
  let localeFilter: string[] | undefined;
  if (config.locales) {
    const known = new Set(registry.listLocales());
    localeFilter = config.locales.filter((code) => {
      if (known.has(code)) return true;
      console.warn(
        `[pii] pii_config references unknown locale "${code}"; skipping`,
      );
      return false;
    });
  }

  const toggle: PatternToggle =
    localeFilter === undefined ? true : { locales: localeFilter };

  const patterns: ScrubberOptions['patterns'] = {};
  for (const name of config.enabledPatterns) {
    if (!registry.has(name)) {
      console.warn(
        `[pii] pii_config enables unknown pattern "${name}"; skipping`,
      );
      continue;
    }
    patterns[name] = toggle;
  }

  return {
    mode: config.mode,
    patterns,
    customPatterns: config.customPatterns,
    registry,
  };
}

/**
 * Convenience end-to-end: policy in, ready scrubber out (null when the
 * policy is disabled). The registry defaults to the shipped configs tree.
 */
export function createScrubberFromConfig(
  config: PiiConfig,
  registry: PatternRegistry = PatternRegistry.fromDefaults(),
): Scrubber | null {
  const options = resolveScrubberOptions(config, registry);
  if (!options) return null;
  return createScrubber(options);
}
