/**
 * Smart index selection for Convex queries
 *
 * Selects the optimal index based on available filters to minimize
 * the number of documents scanned.
 */

import type { IndexConfig, IndexSelectionResult, QueryFilters } from './types';

/**
 * Select the optimal index based on available filters
 *
 * Strategy:
 * 1. Score each index by how many filter fields it covers (in prefix order)
 * 2. Add priority bonus if specified
 * 3. Select the highest scoring index
 *
 * @example
 * ```ts
 * const indexes: IndexConfig[] = [
 *   { name: 'by_organizationId', fields: ['organizationId'] },
 *   { name: 'by_organizationId_and_status', fields: ['organizationId', 'status'] },
 *   { name: 'by_organizationId_and_email', fields: ['organizationId', 'email'], priority: 10 },
 * ];
 *
 * const result = selectOptimalIndex(indexes, {
 *   organizationId: 'org123',
 *   status: 'active',
 * });
 * // Result: { indexName: 'by_organizationId_and_status', indexedFields: ['organizationId', 'status'], remainingFilters: [] }
 * ```
 */
export function selectOptimalIndex(
  indexes: IndexConfig[],
  filters: QueryFilters,
): IndexSelectionResult {
  if (indexes.length === 0) {
    throw new Error('At least one index must be provided');
  }

  let bestIndex = indexes[0];
  let bestScore = -1;
  let bestIndexedFields: string[] = [];

  for (const index of indexes) {
    let score = index.priority ?? 0;
    const indexedFields: string[] = [];

    // Count consecutive fields from the start that have filter values
    // This respects Convex's index prefix requirement
    for (const field of index.fields) {
      const filterValue = filters[field];

      // Check if filter value is present and usable
      if (filterValue === undefined || filterValue === null) {
        break; // Can't use further index fields without this one
      }

      // Arrays can't be used in index equality (need in-memory filtering)
      if (Array.isArray(filterValue)) {
        // Only break if array is not empty - empty arrays are no-op filters
        if (filterValue.length > 0) {
          break;
        }
        // Empty array means no filter, continue to next field
        continue;
      }

      // This field can be indexed
      indexedFields.push(field);
      score += 10; // 10 points per indexed field
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
      bestIndexedFields = indexedFields;
    }
  }

  // Determine which filters need in-memory processing
  const indexedFieldSet = new Set(bestIndexedFields);
  const remainingFilters: string[] = [];

  for (const [field, value] of Object.entries(filters)) {
    // Skip if already handled by index
    if (indexedFieldSet.has(field)) continue;

    // Skip empty/undefined filters
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === '') continue;

    remainingFilters.push(field);
  }

  return {
    indexName: bestIndex.name,
    indexedFields: bestIndexedFields,
    remainingFilters,
  };
}

/**
 * Create a filter function for fields not covered by the index
 *
 * @example
 * ```ts
 * const filterFn = createInMemoryFilter(
 *   { status: ['active', 'churned'], locale: 'en' },
 *   ['status', 'locale']
 * );
 * ```
 */
export function createInMemoryFilter<T extends Record<string, unknown>>(
  filters: QueryFilters,
  fieldsToFilter: string[],
): (item: T) => boolean {
  if (fieldsToFilter.length === 0) {
    return () => true;
  }

  // Pre-compute filter sets for O(1) lookups on arrays
  const filterSets = new Map<string, Set<unknown>>();
  for (const field of fieldsToFilter) {
    const value = filters[field];
    if (Array.isArray(value) && value.length > 0) {
      filterSets.set(field, new Set(value));
    }
  }

  return (item: T): boolean => {
    for (const field of fieldsToFilter) {
      const filterValue = filters[field];
      const itemValue = item[field];

      // Array filter: item value must be in the array
      if (filterSets.has(field)) {
        const allowedValues = filterSets.get(field)!;
        if (!allowedValues.has(itemValue)) {
          return false;
        }
        continue;
      }

      // Scalar filter: exact match
      if (filterValue !== undefined && filterValue !== null && filterValue !== '') {
        if (itemValue !== filterValue) {
          return false;
        }
      }
    }

    return true;
  };
}

/**
 * Create a search filter function for text search across multiple fields
 *
 * @example
 * ```ts
 * const searchFn = createSearchFilter('john', ['name', 'email']);
 * // Matches items where name OR email contains 'john' (case-insensitive)
 * ```
 */
export function createSearchFilter<T extends Record<string, unknown>>(
  searchTerm: string | undefined,
  searchFields: string[],
): (item: T) => boolean {
  if (!searchTerm || searchTerm.trim() === '' || searchFields.length === 0) {
    return () => true;
  }

  const searchLower = searchTerm.toLowerCase();

  return (item: T): boolean => {
    for (const field of searchFields) {
      const value = item[field];
      if (typeof value === 'string' && value.toLowerCase().includes(searchLower)) {
        return true;
      }
      if (typeof value === 'number' && String(value).includes(searchLower)) {
        return true;
      }
    }
    return false;
  };
}

/**
 * Combine multiple filter functions into one
 */
export function combineFilters<T>(
  ...filters: Array<(item: T) => boolean>
): (item: T) => boolean {
  return (item: T): boolean => {
    for (const filter of filters) {
      if (!filter(item)) {
        return false;
      }
    }
    return true;
  };
}
