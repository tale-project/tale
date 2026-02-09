/**
 * Client-Side Sorting Utilities
 *
 * Generic sorting functions for arrays with support for:
 * - String sorting (case-insensitive, locale-aware)
 * - Date/timestamp sorting
 * - Numeric sorting
 * - Ascending/descending order
 * - Null/undefined handling
 */

type SortOrder = 'asc' | 'desc';

/**
 * Type-safe comparator function
 */
type Comparator<T> = (a: T, b: T) => number;

/**
 * Sort by string field (case-insensitive, locale-aware)
 *
 * @param field - The field name to sort by
 * @param order - Sort order ('asc' or 'desc')
 * @returns Comparator function
 *
 * @example
 * const products = [{ name: 'Banana' }, { name: 'apple' }];
 * products.sort(sortByString('name', 'asc')); // [{ name: 'apple' }, { name: 'Banana' }]
 */
function sortByString<T>(
  field: keyof T,
  order: SortOrder = 'asc',
): Comparator<T> {
  return (a: T, b: T) => {
    const aVal = a[field];
    const bVal = b[field];

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return order === 'asc' ? 1 : -1;
    if (bVal == null) return order === 'asc' ? -1 : 1;

    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();

    const result = aStr.localeCompare(bStr);
    return order === 'asc' ? result : -result;
  };
}

/**
 * Sort by date/timestamp field
 *
 * @param field - The field name to sort by (should be a number timestamp or Date)
 * @param order - Sort order ('asc' or 'desc')
 * @returns Comparator function
 *
 * @example
 * const items = [{ createdAt: 1000 }, { createdAt: 2000 }];
 * items.sort(sortByDate('createdAt', 'desc')); // [{ createdAt: 2000 }, { createdAt: 1000 }]
 */
function sortByDate<T>(
  field: keyof T,
  order: SortOrder = 'asc',
): Comparator<T> {
  return (a: T, b: T) => {
    const aVal = a[field];
    const bVal = b[field];

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return order === 'asc' ? 1 : -1;
    if (bVal == null) return order === 'asc' ? -1 : 1;

    const aTime =
      typeof aVal === 'number' ? aVal : new Date(aVal as any).getTime();
    const bTime =
      typeof bVal === 'number' ? bVal : new Date(bVal as any).getTime();

    return order === 'asc' ? aTime - bTime : bTime - aTime;
  };
}

/**
 * Sort by numeric field
 *
 * @param field - The field name to sort by
 * @param order - Sort order ('asc' or 'desc')
 * @returns Comparator function
 *
 * @example
 * const products = [{ price: 100 }, { price: 50 }];
 * products.sort(sortByNumber('price', 'asc')); // [{ price: 50 }, { price: 100 }]
 */
function sortByNumber<T>(
  field: keyof T,
  order: SortOrder = 'asc',
): Comparator<T> {
  return (a: T, b: T) => {
    const aVal = a[field];
    const bVal = b[field];

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return order === 'asc' ? 1 : -1;
    if (bVal == null) return order === 'asc' ? -1 : 1;

    const aNum = Number(aVal);
    const bNum = Number(bVal);

    return order === 'asc' ? aNum - bNum : bNum - aNum;
  };
}
