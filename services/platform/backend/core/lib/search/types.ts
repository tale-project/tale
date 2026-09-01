import type { Doc, TableNames } from '../rows';

/**
 * Which engine resolves a strategy. `'scan'` is the org-scoped index scan +
 * substring match used today (Convex full-text `searchIndex` is disabled — see
 * `TODO(search-index-disabled)`). `'searchIndex'` is the future path: flip a
 * strategy's `engine` (and fill `searchIndexName`/`searchIndexField`) and the
 * dispatcher routes through `.withSearchIndex()` with zero call-site changes.
 */
export type SearchEngine = 'scan' | 'searchIndex';

/** Fields shared by every engine variant of a {@link SearchStrategy}. */
interface SearchStrategyBase<T extends TableNames> {
  table: T;
  /** Org-scoped base index used by the scan engine (e.g. `by_organizationId`). */
  orgIndex: string;
  /** Text fields matched (case-insensitive substring), in relevance priority. */
  textFields: ReadonlyArray<keyof Doc<T>>;
  /** Array-of-string fields (e.g. `tags`) matched with `.some(includes)`. */
  arrayTextFields?: ReadonlyArray<keyof Doc<T>>;
  /** Id-like fields matched exactly (e.g. `externalId`). Coerced via `String`. */
  idFields?: ReadonlyArray<keyof Doc<T>>;
  /** Drop soft-deleted rows (`lifecycleStatus !== 'active'`) when the table
   *  carries the field. */
  activeOnly?: boolean;
}

/**
 * Per-entity descriptor consumed by {@link runEntitySearch}. The single place
 * that knows how a table is searched — call sites never branch on engine.
 *
 * Discriminated on `engine`: the `'searchIndex'` variant *requires*
 * `searchIndexName`/`searchIndexField`, so a strategy can't compile with
 * `engine: 'searchIndex'` but no index metadata (which would otherwise fall
 * through to the scan engine silently). `'scan'` carries no index fields.
 */
export type SearchStrategy<T extends TableNames> =
  | (SearchStrategyBase<T> & { engine: 'scan' })
  | (SearchStrategyBase<T> & {
      engine: 'searchIndex';
      /** Name of the `.searchIndex()` to use. */
      searchIndexName: string;
      /** The search index's `searchField`. */
      searchIndexField: string;
    });
