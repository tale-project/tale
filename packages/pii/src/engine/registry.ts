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

export class PatternRegistry {
  /** Internal `name -> factory` table. Mutated by `override` / `add`. */
  private entries: Map<string, PiiPatternFactory>;

  private constructor(entries: Map<string, PiiPatternFactory>) {
    this.entries = entries;
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

  /** Read-only access to the factory for a given name. */
  get(name: string): PiiPatternFactory | undefined {
    return this.entries.get(name);
  }

  /** Names of every registered factory, in insertion order. */
  list(): string[] {
    return [...this.entries.keys()];
  }
}
