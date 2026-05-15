/**
 * Pattern registry — extension point for embedders.
 *
 * The default scrubber resolves its pattern set from `BUILT_IN_PATTERNS`
 * + the optional `customPatterns` array on `ScrubberOptions`. That covers
 * the 95% case. For consumers who need to **swap** a built-in (a stricter
 * email matcher, a relaxed phone matcher) or **add** patterns by factory
 * (a custom API-key shape that needs to compose from locales), the
 * `PatternRegistry` provides a typed mutable surface.
 *
 * Design notes
 *   - The registry is purely additive / replacing — it never *deletes*
 *     built-ins. Disable a pattern by omitting it from
 *     `ScrubberOptions.patterns`, not by removing it from the registry.
 *   - Built-ins are kept in a private map; `fromDefaults()` clones the
 *     map so multiple registries don't share state.
 *   - Method chaining (`fromDefaults().override(...).add(...)`) returns
 *     `this`, so registry construction reads as one expression.
 */

import type { PiiPatternFactory } from '../core/types';
import { BUILT_IN_PATTERNS } from '../patterns';

/**
 * Lightweight descriptor for admin UIs that need to enumerate registered
 * patterns without materializing factories. `localeAware` tells the UI
 * whether to render a locale picker alongside the toggle; `description`
 * is free-form English (UI-side i18n keys off `name`).
 */
interface PatternMeta {
  name: string;
  description?: string;
  localeAware: boolean;
  enabledByDefault?: boolean;
}

export class PatternRegistry {
  /** Internal `name -> factory` table. Mutated by `override` / `add`. */
  private entries: Map<string, PiiPatternFactory>;
  /** Optional descriptor table, keyed by the same names as `entries`. */
  private metas: Map<string, PatternMeta>;

  private constructor(
    entries: Map<string, PiiPatternFactory>,
    metas: Map<string, PatternMeta> = new Map(),
  ) {
    this.entries = entries;
    this.metas = metas;
  }

  /**
   * Start from the library defaults — every built-in factory pre-registered
   * under its `BuiltInPatternName`. The internal map is a fresh clone so
   * mutations don't leak across instances.
   */
  static fromDefaults(): PatternRegistry {
    const m = new Map<string, PiiPatternFactory>();
    for (const [name, factory] of Object.entries(BUILT_IN_PATTERNS)) {
      m.set(name, factory);
    }
    return new PatternRegistry(m);
  }

  /** Start empty. For the rare consumer that wants only their own patterns. */
  static empty(): PatternRegistry {
    return new PatternRegistry(new Map());
  }

  /**
   * Replace an existing built-in (or previously-added) factory under the
   * same name. Useful for hardening a pattern with extra validation.
   *
   * Logs a debug message and silently no-ops when the name is unknown —
   * the alternative (throw) would crash startup for a typo, which is
   * worse than running with the original factory still in place.
   */
  override(name: string, factory: PiiPatternFactory): this {
    if (!this.entries.has(name)) {
      console.debug(
        `[pii] PatternRegistry.override("${name}") — no such pattern; ignored`,
      );
      return this;
    }
    this.entries.set(name, factory);
    return this;
  }

  /**
   * Add a new pattern under a name not already in the registry. Names
   * must be non-empty strings; conflicts throw rather than silently
   * shadow.
   */
  add(name: string, factory: PiiPatternFactory): this {
    if (!name) throw new Error('[pii] PatternRegistry.add: name required');
    if (this.entries.has(name)) {
      throw new Error(
        `[pii] PatternRegistry.add: "${name}" already registered (use override?)`,
      );
    }
    this.entries.set(name, factory);
    return this;
  }

  /**
   * Variant of `.add()` that captures admin-UI metadata alongside the
   * factory. Use this when a plugin wants its pattern to surface in the
   * settings list with a description / locale-aware flag; otherwise
   * `.add()` is fine and `.list()` falls back to a minimal descriptor
   * derived from built-in defaults.
   */
  registerWithMeta(
    name: string,
    factory: PiiPatternFactory,
    meta: Omit<PatternMeta, 'name'>,
  ): this {
    this.add(name, factory);
    this.metas.set(name, { name, ...meta });
    return this;
  }

  /** Read-only access to the factory for a given name. */
  get(name: string): PiiPatternFactory | undefined {
    return this.entries.get(name);
  }

  /**
   * Descriptors for every registered factory, in insertion order. Used
   * by admin UIs to render the pattern toggle list.
   *
   * `localeAware` is computed by a runtime heuristic — calling the
   * factory with an empty `locales` array. Factories that strictly
   * compose their regex from locale keyword sets (address, nationalId)
   * return `[]` and are flagged as locale-aware. Factories that ignore
   * `locales` (email, ssn, …) return their pattern regardless and are
   * flagged as locale-agnostic. The heuristic intentionally
   * misclassifies phone / cvc (they always return one pattern even
   * with an empty locale set) — consumers needing a stricter signal
   * can override via `registerWithMeta`.
   *
   * Exceptions thrown by the factory during introspection are caught
   * and logged with the pattern name only (never the error message —
   * which could include matched text on edge-case throw sites). When
   * an exception fires we default `localeAware: false`.
   */
  list(): PatternMeta[] {
    const out: PatternMeta[] = [];
    for (const [name, factory] of this.entries) {
      const explicit = this.metas.get(name);
      if (explicit) {
        out.push(explicit);
        continue;
      }
      let localeAware = false;
      try {
        localeAware = factory([]).length === 0;
      } catch (err) {
        console.debug(
          `[pii] PatternRegistry.list: factory "${name}" threw during introspection: ${
            err instanceof Error ? err.name : 'unknown'
          }`,
        );
      }
      out.push({ name, localeAware });
    }
    return out;
  }
}
