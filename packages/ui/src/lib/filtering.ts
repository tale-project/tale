/**
 * Client-Side Filtering Utilities
 *
 * Comprehensive filtering utilities for:
 * - Multi-field filtering with AND/OR logic
 * - Text search across multiple fields
 * - Enum/value-based filtering
 * - Range filtering (dates, numbers)
 * - Custom predicate filtering
 */

/**
 * Filter configuration for a single field
 */
interface FieldFilter<T> {
  /** The field to filter on */
  field: keyof T;
  /** Set of allowed values (empty set = no filter) */
  values: Set<unknown>;
}

/**
 * Filter multiple items by field values (multi-select filter)
 *
 * @param items - Array of items to filter
 * @param filters - Array of field filters (AND logic between filters)
 * @returns Filtered array
 *
 * @example
 * const products = [
 *   { name: 'A', status: 'active', priority: 'high' },
 *   { name: 'B', status: 'inactive', priority: 'low' }
 * ];
 * const filtered = filterByFields(products, [
 *   { field: 'status', values: new Set(['active']) },
 *   { field: 'priority', values: new Set(['high', 'medium']) }
 * ]);
 * // Result: [{ name: 'A', status: 'active', priority: 'high' }]
 */
export function filterByFields<T>(items: T[], filters: FieldFilter<T>[]): T[] {
  if (!filters || filters.length === 0) return items;

  return items.filter((item) => {
    return filters.every((filter) => {
      if (filter.values.size === 0) return true;
      return filter.values.has(item[filter.field]);
    });
  });
}

/**
 * A field to search within {@link filterByTextSearch}: either a top-level key
 * of the item, or an accessor that returns the value to match (used to reach
 * nested fields such as a related customer's name).
 */
type SearchField<T> =
  | keyof T
  | ((item: T) => string | number | null | undefined);

/**
 * Filter items by text search across multiple fields
 *
 * @param items - Array of items to filter
 * @param searchTerm - Search term (case-insensitive)
 * @param fields - Fields to search in: top-level keys or accessor functions
 *   (the latter let callers match nested values, e.g. `(c) => c.customer.name`)
 * @param matchMode - Match mode: 'includes' (substring) or 'startsWith'
 * @returns Filtered array
 *
 * @example
 * const items = [
 *   { name: 'Apple', description: 'Fruit' },
 *   { name: 'Banana', description: 'Yellow fruit' }
 * ];
 * const results = filterByTextSearch(items, 'app', ['name', 'description']);
 * // Result: [{ name: 'Apple', description: 'Fruit' }]
 */
export function filterByTextSearch<T>(
  items: T[],
  searchTerm: string,
  fields: SearchField<T>[],
  matchMode: 'includes' | 'startsWith' = 'includes',
): T[] {
  if (!searchTerm || searchTerm.trim() === '') return items;

  const normalizedSearch = searchTerm.toLowerCase().trim();

  return items.filter((item) => {
    return fields.some((field) => {
      const value = typeof field === 'function' ? field(item) : item[field];
      if (value == null) return false;

      const normalizedValue = String(value).toLowerCase();

      return matchMode === 'startsWith'
        ? normalizedValue.startsWith(normalizedSearch)
        : normalizedValue.includes(normalizedSearch);
    });
  });
}
