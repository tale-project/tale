/**
 * `PatternRegistry` — the seam between the YAML data tree and the engine.
 *
 * A registry holds two things:
 *  - pattern factories, keyed by pattern name — built from the pattern
 *    definition files (pure-data regexes compiled directly; `impl: native`
 *    files paired with their code half from the native builder table);
 *  - the locale datasets, resolved for the locale-aware factories.
 *
 * Construction paths:
 *  - `fromDefaults()` — loads `configs/platform/system/pii/` (node-side,
 *    mtime-cached). The everyday path.
 *  - `fromData(data)` — pure; tests and embedders inject data directly.
 *  - `empty()` — for consumers that bring only their own patterns.
 *
 * Registries are additive/replacing, never deleting: disable a pattern by
 * omitting it from `ScrubberOptions.patterns`, not by removing it here.
 * Each instance owns its factory map (mutations never leak across
 * instances); the heavy per-data work — compiling data regexes, vetting
 * national-ID specs — is memoized per loaded data object, so building a
 * fresh registry per scrubber stays cheap.
 */

import safe from 'safe-regex2';

import type { LocaleCode, PiiPatternFactory } from '../core/types';
import {
  loadPiiData,
  type LoadPiiDataOptions,
  type PiiData,
} from '../data/loader';
import { compileRegexKnob, NATIVE_PATTERN_BUILDERS } from '../patterns/native';
import type { LocaleConfig, PiiPatternFile } from '../schema';

interface BuiltData {
  readonly factories: ReadonlyMap<string, PiiPatternFactory>;
  readonly locales: ReadonlyMap<string, LocaleConfig>;
}

/**
 * Vet a locale's national-ID specs: every regex source must compile AND
 * pass static safe-regex analysis. Fail-open per spec — drop the offender
 * with a warning naming only locale and id (the pattern source can leak
 * ID-template structure and never reaches the log), so one bad spec cannot
 * take the registry down.
 */
function vetLocale(cfg: LocaleConfig): LocaleConfig {
  const safeIds = cfg.nationalIds.filter((spec) => {
    try {
      void new RegExp(spec.pattern);
    } catch {
      console.warn(
        `[pii] dropping invalid nationalId regex in locale "${cfg.locale}": ${spec.id}`,
      );
      return false;
    }
    if (!safe(spec.pattern)) {
      console.warn(
        `[pii] dropping unsafe nationalId regex in locale "${cfg.locale}": ${spec.id}`,
      );
      return false;
    }
    return true;
  });
  return safeIds.length === cfg.nationalIds.length
    ? cfg
    : { ...cfg, nationalIds: safeIds };
}

/** Build one factory from a pattern definition file, or null to skip it. */
function buildFactory(file: PiiPatternFile): PiiPatternFactory | null {
  if (file.impl === 'native') {
    const builder = NATIVE_PATTERN_BUILDERS[file.name];
    if (!builder) {
      console.warn(
        `[pii] pattern file "${file.name}" declares impl: native but no native builder is registered; skipping`,
      );
      return null;
    }
    return builder(file);
  }
  // Pure-data pattern: compile the declared regex once, no post-filter.
  const regex = compileRegexKnob(file);
  if (!regex) return null;
  const pattern = { name: file.name, regex, replacement: file.replacement };
  return () => [pattern];
}

// The expensive half of registry construction, memoized on the loaded
// data's object identity (the loader returns a stable reference until a
// file changes, so this runs once per data generation).
const builtCache = new WeakMap<PiiData, BuiltData>();

function buildData(data: PiiData): BuiltData {
  const cached = builtCache.get(data);
  if (cached) return cached;

  const factories = new Map<string, PiiPatternFactory>();
  for (const file of data.patterns) {
    if (factories.has(file.name)) {
      console.warn(
        `[pii] duplicate pattern definition "${file.name}"; keeping the first`,
      );
      continue;
    }
    const factory = buildFactory(file);
    if (factory) factories.set(file.name, factory);
  }

  const locales = new Map<string, LocaleConfig>();
  for (const cfg of data.locales) {
    if (locales.has(cfg.locale)) {
      console.warn(
        `[pii] duplicate locale dataset "${cfg.locale}"; keeping the first`,
      );
      continue;
    }
    locales.set(cfg.locale, vetLocale(cfg));
  }

  const built: BuiltData = { factories, locales };
  builtCache.set(data, built);
  return built;
}

const EMPTY_LOCALES: ReadonlyMap<string, LocaleConfig> = new Map();

export class PatternRegistry {
  /** Instance-owned `name -> factory` table, mutated by add/override. */
  private factories: Map<string, PiiPatternFactory>;
  /** Locale datasets — read-only, shared across instances of one data set. */
  private localesByCode: ReadonlyMap<string, LocaleConfig>;

  private constructor(
    factories: Map<string, PiiPatternFactory>,
    localesByCode: ReadonlyMap<string, LocaleConfig>,
  ) {
    this.factories = factories;
    this.localesByCode = localesByCode;
  }

  /** Registry over injected data — pure, no filesystem. */
  static fromData(data: PiiData): PatternRegistry {
    const built = buildData(data);
    return new PatternRegistry(new Map(built.factories), built.locales);
  }

  /** Registry over the shipped configs tree (node-side, mtime-cached). */
  static fromDefaults(options?: LoadPiiDataOptions): PatternRegistry {
    return PatternRegistry.fromData(loadPiiData(options));
  }

  /** No patterns, no locales — for bring-your-own-pattern consumers. */
  static empty(): PatternRegistry {
    return new PatternRegistry(new Map(), EMPTY_LOCALES);
  }

  /**
   * Replace an existing factory under the same name (e.g. harden a
   * built-in with extra validation). Unknown names log and no-op — a typo
   * should not crash startup when running with the original factory is
   * strictly better.
   */
  override(name: string, factory: PiiPatternFactory): this {
    if (!this.factories.has(name)) {
      console.debug(
        `[pii] PatternRegistry.override("${name}") — no such pattern; ignored`,
      );
      return this;
    }
    this.factories.set(name, factory);
    return this;
  }

  /** Add a new factory. Name conflicts throw rather than silently shadow. */
  add(name: string, factory: PiiPatternFactory): this {
    if (!name) throw new Error('[pii] PatternRegistry.add: name required');
    if (this.factories.has(name)) {
      throw new Error(
        `[pii] PatternRegistry.add: "${name}" already registered (use override?)`,
      );
    }
    this.factories.set(name, factory);
    return this;
  }

  get(name: string): PiiPatternFactory | undefined {
    return this.factories.get(name);
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  /** Registered pattern names, in insertion order. */
  patternNames(): string[] {
    return [...this.factories.keys()];
  }

  /** Every locale code this registry has a dataset for. */
  listLocales(): LocaleCode[] {
    return [...this.localesByCode.keys()];
  }

  /** One locale dataset by code. Throws on unknown codes. */
  loadLocale(code: LocaleCode): LocaleConfig {
    const cfg = this.localesByCode.get(code);
    if (!cfg) {
      throw new Error(
        `[pii] unknown locale code: ${code}. Known: ${[...this.localesByCode.keys()].join(', ')}`,
      );
    }
    return cfg;
  }

  /**
   * Resolve a locale selector: `'*'` is every dataset; an explicit list
   * resolves each code via `loadLocale` so unknown codes fail loudly
   * (the governance resolver filters before it ever gets here).
   */
  resolveLocales(selector: LocaleCode[] | '*'): LocaleConfig[] {
    if (selector === '*') return [...this.localesByCode.values()];
    return selector.map((code) => this.loadLocale(code));
  }
}
